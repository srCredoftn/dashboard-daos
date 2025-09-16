import mongoose from "mongoose";
import UserModel from "../models/User";
import type { PersistedUser, UserRepository } from "./userRepository";

export class MongoUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<PersistedUser | null> {
    const u = await UserModel.findOne({
      email: email.toLowerCase(),
      isActive: true,
    }).exec();
    if (!u) return null;
    return u.toObject() as PersistedUser;
  }
  async findById(id: string): Promise<PersistedUser | null> {
    const u = await UserModel.findOne({ id, isActive: true }).exec();
    return u ? (u.toObject() as PersistedUser) : null;
  }
  async listActive(): Promise<PersistedUser[]> {
    const docs = await UserModel.find({ isActive: true })
      .sort({ createdAt: 1 })
      .exec();
    return docs.map((d) => d.toObject() as PersistedUser);
  }
  async create(
    u: Omit<PersistedUser, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    },
  ): Promise<PersistedUser> {
    const now = new Date().toISOString();
    const email = u.email.toLowerCase();
    const update = {
      $set: {
        name: u.name,
        role: u.role,
        isActive: true,
        isSuperAdmin: Boolean(u.isSuperAdmin),
        passwordHash: u.passwordHash,
      },
      $setOnInsert: {
        id: u.id || new mongoose.Types.ObjectId().toHexString(),
        email,
        createdAt: u.createdAt || now,
      },
    } as any;
    const updated = await UserModel.findOneAndUpdate({ email }, update, {
      upsert: true,
      new: true,
    }).exec();
    return updated!.toObject() as PersistedUser;
  }
  async updateById(
    id: string,
    updates: Partial<Omit<PersistedUser, "id" | "email" | "createdAt">>,
  ): Promise<PersistedUser | null> {
    const updated = await UserModel.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true },
    ).exec();
    return updated ? (updated.toObject() as PersistedUser) : null;
  }
  async deactivateById(id: string): Promise<boolean> {
    const res = await UserModel.findOneAndUpdate(
      { id },
      { $set: { isActive: false } },
    ).exec();
    return Boolean(res);
  }
  async deleteAll(): Promise<void> {
    await UserModel.deleteMany({}).exec();
  }
}
