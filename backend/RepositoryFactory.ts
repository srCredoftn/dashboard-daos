import { getStorageConfig } from "../backend-express/config/runtime";
import { connectToDatabase } from "../backend-express/config/database";

// User repositories
import type { UserRepository } from "../backend-express/repositories/userRepository";
import { MemoryUserRepository } from "../backend-express/repositories/memoryUserRepository";
import { MongoUserRepository } from "../backend-express/repositories/mongoUserRepository";

// DAO repositories
import type { DaoRepository } from "../backend-express/repositories/daoRepository";
import { MemoryDaoRepository } from "../backend-express/repositories/memoryDaoRepository";
import { MongoDaoRepository } from "../backend-express/repositories/mongoDaoRepository";

// Comment repositories
import type { CommentRepository } from "../backend-express/repositories/commentRepository";
import { MemoryCommentRepository } from "../backend-express/repositories/memoryCommentRepository";
import { MongoCommentRepository } from "../backend-express/repositories/mongoCommentRepository";

// Notification repositories
import type { NotificationRepository } from "../backend-express/repositories/notificationRepository";
import { MemoryNotificationRepository } from "../backend-express/repositories/memoryNotificationRepository";
import { MongoNotificationRepository } from "../backend-express/repositories/mongoNotificationRepository";

// Singleton cache
let usersRepo: UserRepository | null = null;
let daosRepo: DaoRepository | null = null;
let commentsRepo: CommentRepository | null = null;
let notifsRepo: NotificationRepository | null = null;
let tried = false;

async function ensureDbIfNeeded() {
  const cfg = getStorageConfig();
  if (!cfg.useMongo) return;
  try {
    await connectToDatabase();
  } catch (e) {
    if (cfg.strictDbMode && !cfg.fallbackOnDbError) throw e;
  }
}

export const RepositoryFactory = {
  async users(): Promise<UserRepository> {
    if (usersRepo) return usersRepo;
    const cfg = getStorageConfig();
    if (!cfg.useMongo) {
      usersRepo = new MemoryUserRepository();
      return usersRepo;
    }
    try {
      await ensureDbIfNeeded();
      usersRepo = new MongoUserRepository();
    } catch (e) {
      if (cfg.strictDbMode && !cfg.fallbackOnDbError) throw e;
      usersRepo = new MemoryUserRepository();
    }
    return usersRepo;
  },

  async daos(): Promise<DaoRepository> {
    if (daosRepo) return daosRepo;
    const cfg = getStorageConfig();
    if (!cfg.useMongo) {
      daosRepo = new MemoryDaoRepository();
      return daosRepo;
    }
    try {
      await ensureDbIfNeeded();
      daosRepo = new MongoDaoRepository();
    } catch (e) {
      if (cfg.strictDbMode && !cfg.fallbackOnDbError) throw e;
      daosRepo = new MemoryDaoRepository();
    }
    return daosRepo;
  },

  async comments(): Promise<CommentRepository> {
    if (commentsRepo) return commentsRepo;
    const cfg = getStorageConfig();
    if (!cfg.useMongo) {
      commentsRepo = new MemoryCommentRepository();
      return commentsRepo;
    }
    try {
      await ensureDbIfNeeded();
      commentsRepo = new MongoCommentRepository();
    } catch (e) {
      if (cfg.strictDbMode && !cfg.fallbackOnDbError) throw e;
      commentsRepo = new MemoryCommentRepository();
    }
    return commentsRepo;
  },

  async notifications(): Promise<NotificationRepository> {
    if (notifsRepo) return notifsRepo;
    const cfg = getStorageConfig();
    if (!cfg.useMongo) {
      notifsRepo = new MemoryNotificationRepository();
      return notifsRepo;
    }
    try {
      await ensureDbIfNeeded();
      notifsRepo = new MongoNotificationRepository();
    } catch (e) {
      if (cfg.strictDbMode && !cfg.fallbackOnDbError) throw e;
      notifsRepo = new MemoryNotificationRepository();
    }
    return notifsRepo;
  },
};

export type { UserRepository, DaoRepository, CommentRepository, NotificationRepository };
