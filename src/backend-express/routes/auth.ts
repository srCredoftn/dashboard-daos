/**
Rôle: Route API Express — src/backend-express/routes/auth.ts
Domaine: Backend/Routes
Exports: default
Dépendances: express, zod, ../services/authService, ../services/notificationService, ../middleware/auth, ../utils/idempotency, ../utils/devLog, ../services/txEmail
Liens: services (métier), middleware (auth, validation), repositories (persistance)
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
Performance: cache/partitionnement/bundling optimisés
*/
import express from "express";
import { z } from "zod";
import { AuthService } from "../services/authService";
import { NotificationService } from "../services/notificationService";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getIdempotency, setIdempotency } from "../utils/idempotency";
import { authLog, devLog } from "../utils/devLog";
import {
  tplLoginSuccess,
  tplNewLogin,
  tplUserDeleted,
} from "../services/notificationTemplates";
import type { LoginCredentials } from "@shared/dao";

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200),
});

/**
 * Analyse l'en-tête Cookie en un objet clé/valeur.
 * - Entrée: header Cookie sous forme de chaîne (peut être null/undefined)
 * - Sortie: dictionnaire { nomCookie: valeur }
 * - Note: ne gère pas les attributs (Path, HttpOnly, Secure), uniquement paires k=v
 */
function parseCookies(header?: string | null): Record<string, string> {
  const res: Record<string, string> = {};
  if (!header) return res;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      res[k] = v;
    }
  });
  return res;
}

/**
 * Dépose le refresh_token dans un cookie httpOnly sécurisé.
 * - Cookie: refresh_token
 * - Secure: activé en production
 * - sameSite: strict (empêche CSRF via sites tiers)
 * - Path: limité à /api/auth/refresh
 * - maxAge: configurable via REFRESH_TTL_MS
 */
function setRefreshCookie(res: express.Response, token: string) {
  const isProd = (process.env.NODE_ENV || "development") === "production";
  res.cookie("refresh_token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: Number(process.env.REFRESH_TTL_MS || 1000 * 60 * 60 * 24 * 7),
  });
}

/**
 * Supprime le cookie httpOnly du refresh_token (rotation/fin de session).
 */
function clearRefreshCookie(res: express.Response) {
  res.cookie("refresh_token", "", {
    httpOnly: true,
    secure: (process.env.NODE_ENV || "development") === "production",
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: 0,
  });
}

// POST /api/auth/login - User login
/**
 * POST /api/auth/login
 * Authentifie un utilisateur avec email/mot de passe.
 * Corps: { email, password }
 * Réponses:
 *  - 200: { user, token }
 *  - 400: format des identifiants invalide
 *  - 401: identifiants incorrects
 * Effets:
 *  - Crée un refresh_token httpOnly en cookie
 *  - Déclenche des notifications internes (succès de connexion)
 */
router.post("/login", async (req, res) => {
  try {
    const credentials: LoginCredentials = loginSchema.parse(req.body);

    const authResponse = await AuthService.login(credentials);
    if (!authResponse) {
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    // Create refresh token and set secure httpOnly cookie
    try {
      const refresh = await AuthService.createRefreshTokenForUser(
        authResponse.user.id,
      );
      setRefreshCookie(res, refresh);
    } catch (e) {}

    try {
      const t = tplLoginSuccess({ userName: authResponse.user.name });
      NotificationService.add({
        ...t,
        recipients: [authResponse.user.id],
      });
      NotificationService.broadcast(
        t.type,
        t.title,
        `Utilisateur : ${authResponse.user.name}\nDate : ${new Date().toLocaleString("fr-FR")}`,
        { email: authResponse.user.email },
      );
    } catch (_) {}

    return res.json(authResponse);
  } catch (error) {
    authLog.login(req.body?.email || "unknown", false);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid credentials format" });
    }
    return res.status(401).json({ error: "Identifiants incorrects" });
  }
});

// POST /api/auth/refresh - Refresh access token using httpOnly cookie
/**
 * POST /api/auth/refresh
 * Rafraîchit le token d'accès via le cookie httpOnly refresh_token.
 * Réponses:
 *  - 200: { token, user }
 *  - 401: absence/invalidité du refresh token
 * Effets:
 *  - Rotation du refresh_token (défense contre le vol de token)
 */
router.post("/refresh", async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie || "");
    const refreshToken = cookies["refresh_token"];
    if (!refreshToken)
      return res.status(401).json({ error: "No refresh token" });

    const refreshed = await AuthService.refreshSession(refreshToken);
    if (!refreshed)
      return res.status(401).json({ error: "Invalid refresh token" });

    // Rotate cookie
    try {
      const newRefresh = await AuthService.createRefreshTokenForUser(
        refreshed.user.id,
      );
      setRefreshCookie(res, newRefresh);
    } catch {}

    return res.json({ token: refreshed.token, user: refreshed.user });
  } catch (e) {
    return res.status(401).json({ error: "Could not refresh" });
  }
});

// POST /api/auth/logout - User logout
/**
 * POST /api/auth/logout
 * Déconnecte l'utilisateur courant.
 * - Invalide le token d'accès et le refresh_token (cookie vidé)
 * - Ajoute une notification "Déconnexion" pour l'utilisateur
 */
router.post("/logout", authenticate, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.substring(7);

    const cookies = parseCookies(req.headers.cookie || "");
    const refreshToken = cookies["refresh_token"];

    await AuthService.logout(token || "", refreshToken);
    clearRefreshCookie(res);

    try {
      NotificationService.add({
        type: "system",
        title: "Déconnexion",
        message: `Vous vous êtes déconnecté(e) le ${new Date().toLocaleString("fr-FR")}`,
        data: {},
        recipients: [req.user!.id],
      });
    } catch {}

    return res.json({ message: "Logged out successfully" });
  } catch (error) {
    devLog.error("Logout error:", error);
    return res.status(500).json({ error: "Logout failed" });
  }
});

// GET /api/auth/me - Get current user info
/**
 * GET /api/auth/me
 * Retourne les informations de l'utilisateur courant (via authenticate).
 */
router.get("/me", authenticate, async (req, res) => {
  try {
    return res.json({ user: req.user });
  } catch (error) {
    devLog.error("Get user info error:", error);
    return res.status(500).json({ error: "Failed to get user info" });
  }
});

// GET /api/auth/users - Get all users (admin only)
/**
 * GET /api/auth/users (admin)
 * Liste tous les utilisateurs avec un indicateur isSuperAdmin.
 */
router.get("/users", authenticate, requireAdmin, async (_req, res) => {
  try {
    const users = await AuthService.getAllUsers();
    const sa = AuthService.getSuperAdmin();
    const withFlag = users.map((u) => ({
      ...u,
      isSuperAdmin: sa ? sa.id === u.id : false,
    }));
    return res.json(withFlag);
  } catch (error) {
    devLog.error("Get users error:", error);
    return res.status(500).json({ error: "Failed to get users" });
  }
});

// Public registration endpoint - allows first user to self-register when no users exist, or when ALLOW_SELF_REGISTER=true
/**
 * POST /api/auth/register
 * Inscription publique conditionnelle.
 * - Autorisée si aucun utilisateur n'existe ou si ALLOW_SELF_REGISTER=true
 * - Crée le premier utilisateur en admin, sinon en user
 * - Auto-login après création pour UX simplifiée
 */
router.post("/register", async (req, res) => {
  try {
    const allowSelf =
      (process.env.ALLOW_SELF_REGISTER || "false").toLowerCase() === "true";

    const existing = await AuthService.getAllUsers();

    if (existing.length > 0 && !allowSelf) {
      return res.status(403).json({ error: "Registration disabled" });
    }

    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email and password are required" });
    }

    const role = existing.length === 0 ? ("admin" as any) : ("user" as any);

    const newUser = await AuthService.createUser({
      name,
      email,
      role,
      password,
    });

    // Notify created user to login and change password (no password in notification)
    try {
      const t = tplNewLogin({ userName: newUser.name });
      NotificationService.add({ ...t, recipients: [newUser.id] });
    } catch {}

    // Auto-login newly created user
    const authResp = await AuthService.login({ email, password });

    // Broadcast creation (do not include PII in logs)
    try {
      NotificationService.broadcast(
        "user_created",
        "Nouvel utilisateur",
        "Un nouvel utilisateur a été créé",
        { userId: newUser.id },
      );
    } catch (_) {}

    const { logger } = await import("../utils/logger");
    logger.audit("User created successfully", req.user?.id, req.ip);

    return res.status(201).json({ user: newUser, token: authResp?.token });
  } catch (error: any) {
    const { logger } = await import("../utils/logger");
    logger.error("Registration failed", "AUTH_REGISTER", {
      message: String((error as Error)?.message),
    });
    return res
      .status(500)
      .json({ error: error?.message || "Registration failed" });
  }
});

// POST /api/auth/users - Create new user (admin only)
/**
 * POST /api/auth/users (admin)
 * Crée un utilisateur (idempotent via header x-idempotency-key).
 * Corps: { name, email, role, password }
 * Effets:
 *  - Notification de nouvel utilisateur
 *  - Journalisation d'audit
 */
router.post("/users", authenticate, requireAdmin, async (req, res) => {
  try {
    const idempKey = (req.header("x-idempotency-key") || "").trim();
    if (idempKey) {
      const cached = getIdempotency(idempKey);
      if (cached) return res.status(201).json(cached);
    }

    const userData = req.body;

    if (!userData.name || !userData.email || !userData.role) {
      return res
        .status(400)
        .json({ error: "Name, email, and role are required" });
    }

    const newUser = await AuthService.createUser({
      name: userData.name,
      email: userData.email,
      role: userData.role,
      password: userData.password, // Pass the password to the service
    });

    if (idempKey) setIdempotency(idempKey, newUser);

    // Notify created user to login and change password (no password in notification)
    try {
      const t = tplNewLogin({ userName: newUser.name });
      NotificationService.add({ ...t, recipients: [newUser.id] });
    } catch {}

    try {
      NotificationService.broadcast(
        "user_created",
        "Nouvel utilisateur",
        `${newUser.name} (${newUser.email}) a été créé`,
        { userId: newUser.id },
      );
    } catch (_) {}

    const { logger } = await import("../utils/logger");
    logger.audit("User created successfully", req.user?.id, req.ip);
    return res.status(201).json(newUser);
  } catch (error) {
    const { logger } = await import("../utils/logger");
    logger.error("Failed to create user", "USER_CREATE", {
      message: String((error as Error)?.message),
    });
    return res.status(500).json({ error: "Failed to create user" });
  }
});

// PUT /api/auth/users/:id/role - Update user role (admin only)
/**
 * PUT /api/auth/users/:id/role (super admin)
 * Met à jour le rôle d'un utilisateur.
 * Contraintes:
 *  - Doit être super admin
 *  - Validation du mot de passe courant requise
 * Effets: Notification broadcast du changement de rôle
 */
router.put("/users/:id/role", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, password } = req.body || {};

    if (!role) {
      return res.status(400).json({ error: "Role is required" });
    }

    // Only super admin can change roles and must confirm with current password
    if (!req.user || !AuthService.isSuperAdmin(req.user.id)) {
      return res.status(403).json({ error: "Forbidden: super admin required" });
    }
    const valid = await AuthService.verifyPasswordById(
      req.user.id,
      String(password || ""),
    );
    if (!valid) {
      return res
        .status(403)
        .json({ error: "Invalid password", code: "INVALID_PASSWORD" });
    }

    const updatedUser = await AuthService.updateUserRole(id, role);
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Broadcast notification to all users (email mirror handled internally)
    NotificationService.broadcast(
      "role_update",
      "Mise à jour du rôle utilisateur",
      `${updatedUser.name} a maintenant le rôle \"${role}\"`,
      { userId: updatedUser.id, newRole: role },
    );

    return res.json(updatedUser);
  } catch (error) {
    const { logger } = await import("../utils/logger");
    logger.error("Failed to update user role", "USER_ROLE", {
      message: String((error as Error)?.message),
    });
    return res.status(500).json({ error: "Failed to update user role" });
  }
});

// DELETE /api/auth/users/:id - Deactivate user (admin only)
/**
 * DELETE /api/auth/users/:id (super admin)
 * Désactive ou supprime un utilisateur (mode hard via ?hard=true ou body.mode="hard").
 * Garde-fous:
 *  - Impossible de se désactiver soi-même
 *  - Super admin + mot de passe requis
 * Effets: Notifications et audit
 */
router.delete("/users/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent admin from deactivating themselves
    if (req.user?.id === id) {
      return res
        .status(400)
        .json({ error: "Cannot deactivate your own account" });
    }

    // Only super admin can deactivate users and must confirm with current password
    if (!req.user || !AuthService.isSuperAdmin(req.user.id)) {
      return res.status(403).json({ error: "Forbidden: super admin required" });
    }

    const pwd = (req.body?.password || "").toString();
    if (!pwd) {
      return res.status(400).json({ error: "Password is required" });
    }
    const valid = await AuthService.verifyPasswordById(req.user.id, pwd);
    if (!valid) {
      return res
        .status(403)
        .json({ error: "Invalid password", code: "INVALID_PASSWORD" });
    }

    const hard =
      String(req.query?.hard || req.body?.hard || "").toLowerCase() ===
        "true" || String(req.body?.mode || "").toLowerCase() === "hard";

    const usersBefore = await AuthService.getAllUsers();
    const target = usersBefore.find((u) => u.id === id);

    if (hard) {
      const deleted = await AuthService.deleteUser(id);
      if (!deleted) {
        return res.status(404).json({ error: "User not found" });
      }

      try {
        const t = tplUserDeleted({
          deletedUserName: target ? target.name : `Utilisateur ${id}`,
          actorName: req.user?.name || "Admin",
        });
        NotificationService.broadcast(t.type, t.title, t.message, {
          userId: id,
        });
      } catch (_) {}

      const { logger } = await import("../utils/logger");
      logger.audit("User hard-deleted", req.user?.id, req.ip, { userId: id });

      return res.json({ message: "User deleted successfully" });
    } else {
      const deactivated = await AuthService.deactivateUser(id);
      if (!deactivated) {
        return res.status(404).json({ error: "User not found" });
      }

      try {
        NotificationService.broadcast(
          "system",
          "Utilisateur désactivé",
          `${target ? `${target.name} (${target.email})` : `Utilisateur ${id}`} a été désactivé`,
          { userId: id },
        );
      } catch (_) {}

      return res.json({ message: "User deactivated successfully" });
    }
  } catch (error) {
    devLog.error("Deactivate user error:", error);
    return res.status(500).json({ error: "Failed to deactivate user" });
  }
});

// POST /api/auth/change-password - Change password
/**
 * POST /api/auth/change-password
 * Change le mot de passe de l'utilisateur courant.
 * Règles: longueur minimale 6 caractères.
 */
router.post("/change-password", authenticate, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters long" });
    }

    const success = await AuthService.changePassword(req.user!.id, newPassword);
    if (!success) {
      return res.status(404).json({ error: "User not found" });
    }

    try {
      NotificationService.add({
        type: "system",
        title: "Mot de passe modifié",
        message: `Votre mot de passe a été modifié le ${new Date().toLocaleString("fr-FR")}.`,
        data: {},
        recipients: [req.user!.id],
      });
      // Diffusion globale
      NotificationService.broadcast(
        "system",
        "Mot de passe modifié",
        `${req.user!.name} a modifié son mot de passe`,
        { userId: req.user!.id },
      );
    } catch (_) {}

    return res.json({ message: "Password changed successfully" });
  } catch (error) {
    devLog.error("Change password error:", error);
    return res.status(500).json({ error: "Failed to change password" });
  }
});

// PUT /api/auth/profile - Update user profile (email change forbidden for all)
/**
 * PUT /api/auth/profile
 * Met à jour le profil (nom). Changement d'email interdit pour tous.
 */
router.put("/profile", authenticate, async (req, res) => {
  try {
    const { name, email } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }

    // If client tries to change email, reject explicitly
    if (email && email.toLowerCase() !== req.user!.email.toLowerCase()) {
      return res.status(403).json({ error: "Email change is not allowed" });
    }

    const updatedUser = await AuthService.updateProfile(req.user!.id, {
      name,
      email: req.user!.email,
    });
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const authUser = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
    };

    return res.json(authUser);
  } catch (error) {
    devLog.error("Update profile error:", error);
    if ((error as Error).message === "Email change not allowed") {
      return res.status(403).json({ error: "Email change is not allowed" });
    }
    if ((error as Error).message === "Email already exists") {
      return res.status(400).json({ error: "Email already exists" });
    }
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

// POST /api/auth/forgot-password - Request password reset
/**
 * POST /api/auth/forgot-password
 * Déclenche un code de réinitialisation pour l'email fourni.
 * Sécurité: ne révèle pas si l'email existe (réponse générique OK).
 * Dev: renvoie le code dans la réponse hors production.
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const token = await AuthService.generateResetToken(email);

    if (!token) {
      // Don't reveal if email exists or not for security
      return res.json({
        message:
          "Si cet email existe, un code de réinitialisation a été envoyé.",
      });
    }

    const response: any = {
      message:
        "Un code de réinitialisation a été envoyé à votre adresse email.",
    };
    if (process.env.NODE_ENV !== "production") {
      response.developmentToken = token;
    }

    return res.json(response);
  } catch (error) {
    devLog.error("Forgot password error:", error);
    return res
      .status(500)
      .json({ error: "Failed to process password reset request" });
  }
});

// POST /api/auth/verify-reset-token - Verify reset token
/**
 * POST /api/auth/verify-reset-token
 * Vérifie la validité d'un code de réinitialisation.
 */
router.post("/verify-reset-token", async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ error: "Email and token are required" });
    }

    const isValid = await AuthService.verifyResetToken(token, email);

    if (!isValid) {
      return res.status(400).json({ error: "Code invalide ou expiré" });
    }

    return res.json({ message: "Code vérifié avec succès" });
  } catch (error) {
    devLog.error("Verify reset token error:", error);
    return res.status(500).json({ error: "Failed to verify reset token" });
  }
});

// POST /api/auth/reset-password - Reset password with token
/**
 * POST /api/auth/reset-password
 * Réinitialise le mot de passe avec email + code valide.
 * Règles: mot de passe ≥ 6 caractères.
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({
        error: "Email, token, and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: "Le mot de passe doit contenir au moins 6 caractères",
      });
    }

    const success = await AuthService.resetPasswordWithToken(
      token,
      email,
      newPassword,
    );

    if (!success) {
      return res.status(400).json({ error: "Code invalide ou expiré" });
    }

    return res.json({ message: "Mot de passe réinitialisé avec succès" });
  } catch (error) {
    devLog.error("Reset password error:", error);
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
