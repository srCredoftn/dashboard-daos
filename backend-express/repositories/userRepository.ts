import type { User, UserRole } from "@shared/dao";

export interface PersistedUser extends User {
  passwordHash: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<PersistedUser | null>;
  findById(id: string): Promise<PersistedUser | null>;
  listActive(): Promise<PersistedUser[]>;
  create(
    u: Omit<PersistedUser, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    },
  ): Promise<PersistedUser>;
  updateById(
    id: string,
    updates: Partial<Omit<PersistedUser, "id" | "email" | "createdAt">>,
  ): Promise<PersistedUser | null>;
  deactivateById(id: string): Promise<boolean>;
  deleteAll(): Promise<void>;
}
