import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { devLog, authLog } from "../utils/devLog";
import type {
  User,
  AuthUser,
  LoginCredentials,
  AuthResponse,
  UserRole,
} from "@shared/dao";
import { connectToDatabase } from "../config/database";
import mongoose from "mongoose";
import UserModel, { type UserDocument } from "../models/User";

const JWT_SECRET = process.env.JWT_SECRET;
const DEV_FALLBACK_ENABLED =
  ((process.env.ALLOW_DEV_AUTH_FALLBACK || "true").toLowerCase() ===
    "true" && process.env.NODE_ENV !== "production");

// In-memory fallback users for development when MongoDB is unavailable
const fallbackUsers: Array<{
  id: string;
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  lastLogin?: string;
  isActive: boolean;
  isSuperAdmin?: boolean;
}> = [];

function seedFallbackUsers() {
  if (!DEV_FALLBACK_ENABLED) return;
  if (fallbackUsers.length > 0) return;
  const now = new Date().toISOString();
  const demo = [
    { name: "Admin User", email: "admin@2snd.fr", role: "admin" as UserRole, password: "admin123" },
    { name: "Marie Dubois", email: "marie.dubois@2snd.fr", role: "user" as UserRole, password: "marie123" },
    { name: "Pierre Martin", email: "pierre.martin@2snd.fr", role: "user" as UserRole, password: "pierre123" },
  ];
  for (const u of demo) {
    const id = new mongoose.Types.ObjectId().toHexString();
    const passwordHash = bcrypt.hashSync(u.password, 10);
    fallbackUsers.push({
      id,
      name: u.name,
      email: u.email.toLowerCase(),
      role: u.role,
      passwordHash,
      createdAt: now,
      isActive: true,
      isSuperAdmin: u.role === "admin",
    });
  }
}
seedFallbackUsers();

let superAdminIdCache: string | null = null;
async function refreshSuperAdminCache() {
  try {
    await connectToDatabase();
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
    if (adminEmail) {
      const envAdmin = await UserModel.findOne({
        email: adminEmail,
        isActive: true,
        role: "admin",
      }).exec();
      if (envAdmin) {
        superAdminIdCache = envAdmin.id;
        return;
      }
    }
    const firstAdmin = await UserModel.find({ isActive: true, role: "admin" })
      .sort({ createdAt: 1 })
      .limit(1)
      .exec();
    superAdminIdCache = firstAdmin[0]?.id || null;
  } catch (_) {
    superAdminIdCache = null;
  }
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  devLog.error("🚨 ERREUR CRITIQUE: JWT_SECRET manquant ou trop court");
  devLog.error(
    "   Veuillez définir une variable d'environnement JWT_SECRET de plus de 32 caractères",
  );
  process.exit(1);
}

// Password reset tokens (ephemeral)
const resetTokens: Record<string, { email: string; expires: Date }> = {};

// Session tracking (ephemeral)
const activeSessions: Set<string> = new Set();

function normalizeName(name: string): string {
  return (name || "")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function ensureInitialUsers() {
  await connectToDatabase().catch((e) => {
    devLog.error("MongoDB indisponible pour l'authentification", e);
    throw e;
  });

  const shouldSeed =
    process.env.SEED_USERS === "1" || process.env.SEED_USERS === "true";

  if (shouldSeed) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SEED_USERS ne peut pas être activé en production");
    }
    const defaults = [
      {
        name: "Admin User",
        email: "admin@2snd.fr",
        role: "admin" as UserRole,
        password: "admin123",
      },
      {
        name: "Marie Dubois",
        email: "marie.dubois@2snd.fr",
        role: "user" as UserRole,
        password: "marie123",
      },
      {
        name: "Pierre Martin",
        email: "pierre.martin@2snd.fr",
        role: "user" as UserRole,
        password: "pierre123",
      },
    ];
    await UserModel.deleteMany({}).exec();
    for (const u of defaults) {
      const passwordHash = await bcrypt.hash(u.password, 12);
      const doc: Partial<UserDocument> = {
        id: new mongoose.Types.ObjectId().toHexString(),
        name: normalizeName(u.name),
        email: u.email.toLowerCase(),
        role: u.role,
        createdAt: new Date().toISOString(),
        isActive: true,
        passwordHash,
        isSuperAdmin: u.role === "admin",
      } as any;
      await UserModel.create(doc);
    }
    devLog.info("🔐 AuthService initialized with seeded demo users (MongoDB)");
    await refreshSuperAdminCache();
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = await UserModel.findOne({
      email: adminEmail.toLowerCase(),
    }).exec();
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    if (!existing) {
      await UserModel.create({
        id: new mongoose.Types.ObjectId().toHexString(),
        name: "Administrator",
        email: adminEmail.toLowerCase(),
        role: "admin",
        createdAt: new Date().toISOString(),
        isActive: true,
        isSuperAdmin: true,
        passwordHash,
      });
      devLog.info(`🔐 Admin user created from environment: ${adminEmail}`);
    } else if (!existing.isSuperAdmin) {
      existing.isSuperAdmin = true;
      if (!(await bcrypt.compare(adminPassword, existing.passwordHash))) {
        existing.passwordHash = passwordHash;
      }
      await existing.save();
      devLog.info(`🔐 Admin user ensured from environment: ${adminEmail}`);
    }
    await refreshSuperAdminCache();
    return;
  }

  if (DEV_FALLBACK_ENABLED) {
    const admin = fallbackUsers.find((u) => u.isSuperAdmin);
    if (admin) {
      superAdminIdCache = admin.id;
      devLog.info("🔐 Dev auth fallback active with in-memory admin user");
      return;
    }
  }

  devLog.warn(
    "⚠️ No initial users created. Set ADMIN_EMAIL + ADMIN_PASSWORD to create an admin on startup or run with SEED_USERS=true for development.",
  );
}

export class AuthService {
  static async initialize() {
    try {
      await ensureInitialUsers();
    } catch (e) {
      devLog.error(
        "Auth initialization skipped due to DB connectivity issues",
        e,
      );
    }
  }

  static async login(
    credentials: LoginCredentials,
  ): Promise<AuthResponse | null> {
    const email = credentials.email.toLowerCase();
    try {
      await connectToDatabase();
      const user = await UserModel.findOne({ email, isActive: true }).exec();
      if (!user) {
        authLog.login(credentials.email, false);
        return null;
      }
      const ok = await bcrypt.compare(credentials.password, user.passwordHash);
      if (!ok) {
        authLog.login(credentials.email, false);
        return null;
      }

      const authUser: AuthUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };

      const token = jwt.sign(
        authUser,
        JWT_SECRET as jwt.Secret,
        {
          expiresIn: JWT_EXPIRES_IN as any,
          issuer: "dao-management",
          audience: "dao-app",
        } as any,
      );

      activeSessions.add(token);

      user.lastLogin = new Date().toISOString();
      await user.save();

      authLog.login(user.email, true);
      return { user: authUser, token };
    } catch (error) {
      if (DEV_FALLBACK_ENABLED) {
        const u = fallbackUsers.find((x) => x.email === email && x.isActive);
        if (!u) {
          authLog.login(credentials.email, false);
          return null;
        }
        const ok = await bcrypt.compare(credentials.password, u.passwordHash);
        if (!ok) {
          authLog.login(credentials.email, false);
          return null;
        }
        const authUser: AuthUser = {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
        };
        const token = jwt.sign(
          authUser,
          JWT_SECRET as jwt.Secret,
          {
            expiresIn: JWT_EXPIRES_IN as any,
            issuer: "dao-management",
            audience: "dao-app",
          } as any,
        );
        activeSessions.add(token);
        u.lastLogin = new Date().toISOString();
        authLog.login(u.email, true);
        return { user: authUser, token };
      }
      devLog.error("Login error:", error);
      return null;
    }
  }

  static async verifyToken(token: string): Promise<AuthUser | null> {
    try {
      const decoded = jwt.verify(token, JWT_SECRET as string, {
        issuer: "dao-management",
        audience: "dao-app",
      }) as AuthUser;

      try {
        await connectToDatabase();
        const user = await UserModel.findOne({
          id: decoded.id,
          isActive: true,
        }).exec();
        if (!user) {
          activeSessions.delete(token);
          return null;
        }
        if (!activeSessions.has(token)) activeSessions.add(token);
        authLog.tokenVerification(user.email, true);
        return decoded;
      } catch (dbErr) {
        if (DEV_FALLBACK_ENABLED) {
          const u = fallbackUsers.find((x) => x.id === decoded.id && x.isActive);
          if (u) {
            if (!activeSessions.has(token)) activeSessions.add(token);
            authLog.tokenVerification(u.email, true);
            return decoded;
          }
        }
        activeSessions.delete(token);
        return null;
      }
    } catch (_) {
      activeSessions.delete(token);
      return null;
    }
  }

  static async listActiveSessions(): Promise<
    {
      sessionId: string;
      user: AuthUser | null;
      issuedAt?: number;
      expiresAt?: number;
    }[]
  > {
    const sessions = Array.from(activeSessions);
    const result: {
      sessionId: string;
      user: AuthUser | null;
      issuedAt?: number;
      expiresAt?: number;
    }[] = [];
    for (const token of sessions) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET as string, {
          issuer: "dao-management",
          audience: "dao-app",
        }) as AuthUser & { iat?: number; exp?: number };
        const sessionId = require("crypto")
          .createHash("sha256")
          .update(token)
          .digest("hex")
          .substring(0, 16);
        result.push({
          sessionId,
          user: {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role,
            name: decoded.name,
          },
          issuedAt: decoded.iat ? decoded.iat * 1000 : undefined,
          expiresAt: decoded.exp ? decoded.exp * 1000 : undefined,
        });
      } catch (_) {
        const sessionId = require("crypto")
          .createHash("sha256")
          .update(token)
          .digest("hex")
          .substring(0, 16);
        result.push({ sessionId, user: null });
      }
    }
    return result;
  }

  static async logout(token: string): Promise<void> {
    activeSessions.delete(token);
  }

  static async getCurrentUser(token: string): Promise<AuthUser | null> {
    return this.verifyToken(token);
  }

  static async getAllUsers(): Promise<User[]> {
    try {
      await connectToDatabase();
      const docs = await UserModel.find({ isActive: true }).exec();
      return docs.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
        isActive: u.isActive,
        isSuperAdmin: u.isSuperAdmin,
      }));
    } catch (_) {
      if (DEV_FALLBACK_ENABLED) {
        return fallbackUsers
          .filter((u) => u.isActive)
          .map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            createdAt: u.createdAt,
            lastLogin: u.lastLogin,
            isActive: u.isActive,
            isSuperAdmin: Boolean(u.isSuperAdmin),
          } as User));
      }
      throw _;
    }
  }

  static async getUserByEmail(email: string): Promise<User | null> {
    try {
      await connectToDatabase();
      const u = await UserModel.findOne({
        email: email.toLowerCase(),
        isActive: true,
      }).exec();
      if (!u) return null;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
        isActive: u.isActive,
        isSuperAdmin: u.isSuperAdmin,
      };
    } catch (_) {
      if (DEV_FALLBACK_ENABLED) {
        const u = fallbackUsers.find(
          (x) => x.email === email.toLowerCase() && x.isActive,
        );
        if (!u) return null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt,
          lastLogin: u.lastLogin,
          isActive: u.isActive,
          isSuperAdmin: Boolean(u.isSuperAdmin),
        } as User;
      }
      throw _;
    }
  }

  static getSuperAdmin(): User | null {
    // Synchronous snapshot using cache; only id is reliable here
    if (superAdminIdCache) {
      return {
        id: superAdminIdCache,
        name: "Super Admin",
        email: "",
        role: "admin",
        createdAt: "",
        isActive: true,
        isSuperAdmin: true,
      } as User;
    }
    if (DEV_FALLBACK_ENABLED) {
      const admin = fallbackUsers.find((u) => u.isSuperAdmin);
      if (admin) {
        return {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          createdAt: admin.createdAt,
          isActive: true,
          isSuperAdmin: true,
        } as User;
      }
    }
    return null;
  }

  static isSuperAdmin(userId: string): boolean {
    return Boolean(superAdminIdCache && superAdminIdCache === userId);
  }

  static async verifyPasswordByEmail(
    email: string,
    password: string,
  ): Promise<boolean> {
    await connectToDatabase();
    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      isActive: true,
    }).exec();
    if (!user) return false;
    try {
      return await bcrypt.compare(password, user.passwordHash);
    } catch {
      return false;
    }
  }

  static async verifyPasswordById(
    id: string,
    password: string,
  ): Promise<boolean> {
    await connectToDatabase();
    const user = await UserModel.findOne({ id, isActive: true }).exec();
    if (!user) return false;
    try {
      return await bcrypt.compare(password, user.passwordHash);
    } catch {
      return false;
    }
  }

  static async createUser(userData: {
    name: string;
    email: string;
    role: UserRole;
    password?: string;
  }): Promise<User> {
    await connectToDatabase();

    const normalizedName = normalizeName(userData.name);

    const sameName = await UserModel.findOne({
      isActive: true,
      name: new RegExp(`^${normalizedName}$`, "i"),
    }).exec();
    if (sameName) {
      throw new Error("User name already taken");
    }

    const existingUser = await UserModel.findOne({
      email: userData.email.toLowerCase(),
    }).exec();
    if (existingUser) {
      throw new Error("User already exists");
    }

    const defaultPassword = userData.password || "changeme123";
    const passwordHash = await bcrypt.hash(defaultPassword, 12);

    const doc = await UserModel.create({
      id: new mongoose.Types.ObjectId().toHexString(),
      name: normalizedName,
      email: userData.email.toLowerCase(),
      role: userData.role,
      createdAt: new Date().toISOString(),
      isActive: true,
      passwordHash,
      isSuperAdmin: userData.role === "admin",
    });

    devLog.info(`👤 New user created: ${doc.email} Role: ${doc.role}`);
    if (doc.role === "admin") await refreshSuperAdminCache();
    return {
      id: doc.id,
      name: doc.name,
      email: doc.email,
      role: doc.role,
      createdAt: doc.createdAt,
      isActive: doc.isActive,
      lastLogin: doc.lastLogin,
      isSuperAdmin: doc.isSuperAdmin,
    };
  }

  static async updateUserRole(
    id: string,
    role: UserRole,
  ): Promise<User | null> {
    await connectToDatabase();
    const doc = await UserModel.findOneAndUpdate(
      { id },
      { $set: { role } },
      { new: true },
    ).exec();
    if (!doc) return null;
    devLog.info(`🔄 User role updated: ${doc.email} → ${role}`);
    return {
      id: doc.id,
      name: doc.name,
      email: doc.email,
      role: doc.role,
      createdAt: doc.createdAt,
      lastLogin: doc.lastLogin,
      isActive: doc.isActive,
      isSuperAdmin: doc.isSuperAdmin,
    };
  }

  static async deactivateUser(id: string): Promise<boolean> {
    await connectToDatabase();
    const doc = await UserModel.findOneAndUpdate(
      { id },
      { $set: { isActive: false } },
      { new: true },
    ).exec();
    if (!doc) return false;

    for (const token of Array.from(activeSessions)) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET as string) as AuthUser;
        if (decoded.id === id) activeSessions.delete(token);
      } catch {}
    }

    devLog.info(`🚫 User deactivated: ${doc.email}`);
    return true;
  }

  static async changePassword(
    id: string,
    newPassword: string,
  ): Promise<boolean> {
    await connectToDatabase();
    const doc = await UserModel.findOne({ id, isActive: true }).exec();
    if (!doc) return false;
    doc.passwordHash = await bcrypt.hash(newPassword, 12);
    await doc.save();
    devLog.info(`🔑 Password changed for: ${doc.email}`);
    return true;
  }

  static async updateProfile(
    id: string,
    updates: { name: string; email?: string },
  ): Promise<User | null> {
    await connectToDatabase();
    const doc = await UserModel.findOne({ id, isActive: true }).exec();
    if (!doc) return null;

    if (
      updates.email &&
      updates.email.toLowerCase() !== doc.email.toLowerCase()
    ) {
      throw new Error("Email change not allowed");
    }

    const normalizedName = normalizeName(updates.name);
    const conflict = await UserModel.findOne({
      isActive: true,
      id: { $ne: id },
      name: new RegExp(`^${normalizedName}$`, "i"),
    }).exec();
    if (conflict) throw new Error("User name already taken");

    doc.name = normalizedName;
    await doc.save();

    devLog.info(`📝 Profile updated for: ${doc.email}`);
    return {
      id: doc.id,
      name: doc.name,
      email: doc.email,
      role: doc.role,
      createdAt: doc.createdAt,
      lastLogin: doc.lastLogin,
      isActive: doc.isActive,
      isSuperAdmin: doc.isSuperAdmin,
    };
  }

  static async generateResetToken(email: string): Promise<string | null> {
    await connectToDatabase();
    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      isActive: true,
    }).exec();
    if (!user) return null;

    const crypto = require("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    resetTokens[token] = { email: user.email, expires };
    devLog.info(`🔒 Password reset token generated for: ${user.email}`);
    return token;
  }

  static async verifyResetToken(
    token: string,
    email: string,
  ): Promise<boolean> {
    const resetData = resetTokens[token];
    if (!resetData) return false;
    if (resetData.email.toLowerCase() !== email.toLowerCase()) return false;
    if (new Date() > resetData.expires) {
      delete resetTokens[token];
      return false;
    }
    return true;
  }

  static async resetPasswordWithToken(
    token: string,
    email: string,
    newPassword: string,
  ): Promise<boolean> {
    const isValid = await this.verifyResetToken(token, email);
    if (!isValid) return false;

    await connectToDatabase();
    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      isActive: true,
    }).exec();
    if (!user) return false;

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    delete resetTokens[token];
    devLog.info(`🔑 Password reset successful for: ${user.email}`);
    return true;
  }

  static getActiveSessionCount(): number {
    return activeSessions.size;
  }

  static cleanupExpiredTokens(): void {
    let cleaned = 0;
    for (const token of Array.from(activeSessions)) {
      try {
        jwt.verify(token, JWT_SECRET as string);
      } catch {
        activeSessions.delete(token);
        cleaned++;
      }
    }
    if (cleaned > 0) devLog.info(`🧹 Cleaned ${cleaned} expired tokens`);
  }

  static async clearAllSessions(): Promise<void> {
    activeSessions.clear();
    devLog.info("🧹 All sessions cleared");
  }

  static async reinitializeUsers(): Promise<void> {
    await connectToDatabase();

    const shouldSeed =
      process.env.SEED_USERS === "1" || process.env.SEED_USERS === "true";
    if (shouldSeed) {
      await UserModel.deleteMany({}).exec();
      await ensureInitialUsers();
      await refreshSuperAdminCache();
      devLog.info("🔄 Users reinitialized to defaults (seed)");
      return;
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      await UserModel.deleteMany({}).exec();
      await ensureInitialUsers();
      await refreshSuperAdminCache();
      devLog.info("🔄 Users reinitialized to single env admin");
      return;
    }

    devLog.info("ℹ️ Users reinitialize skipped (no seed/env admin specified)");
  }
}

AuthService.initialize().catch(console.error);

if (process.env.NODE_ENV === "development") {
  setInterval(() => {
    devLog.debug(`📊 Active sessions: ${activeSessions.size}`);
  }, 30 * 1000);
}

setInterval(
  () => {
    AuthService.cleanupExpiredTokens();
  },
  60 * 60 * 1000,
);
