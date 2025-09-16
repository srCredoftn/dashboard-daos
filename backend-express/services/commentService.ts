import type { TaskComment } from "@shared/dao";
import { getStorageConfig } from "../config/runtime";
import { connectToDatabase } from "../config/database";
import type { CommentRepository } from "../repositories/commentRepository";
import { MemoryCommentRepository } from "../repositories/memoryCommentRepository";
import { MongoCommentRepository } from "../repositories/mongoCommentRepository";

let repo: CommentRepository | null = null;
let attempted = false;
async function getRepo(): Promise<CommentRepository> {
  if (repo) return repo;
  if (attempted) return repo || new MemoryCommentRepository();
  attempted = true;
  const cfg = getStorageConfig();
  if (!cfg.useMongo) {
    repo = new MemoryCommentRepository();
    return repo;
  }
  try {
    await connectToDatabase();
    repo = new MongoCommentRepository();
    return repo;
  } catch (e) {
    if (cfg.strictDbMode && !cfg.fallbackOnDbError) throw e;
    repo = new MemoryCommentRepository();
    return repo;
  }
}

export class CommentService {
  static async getTaskComments(daoId: string, taskId: number): Promise<TaskComment[]> {
    const r = await getRepo();
    return r.listByTask(daoId, taskId);
  }

  static async getDaoComments(daoId: string): Promise<TaskComment[]> {
    const r = await getRepo();
    return r.listByDao(daoId);
  }

  static async addComment(commentData: Omit<TaskComment, "id" | "createdAt">): Promise<TaskComment> {
    const r = await getRepo();
    const comment: TaskComment = {
      ...commentData,
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString(),
    };
    return r.add(comment);
  }

  static async updateComment(commentId: string, userId: string, newContent: string): Promise<TaskComment | null> {
    const r = await getRepo();
    const existing = await r.getById(commentId);
    if (!existing) return null;
    if (existing.userId !== userId) throw new Error("Unauthorized: Can only update your own comments");
    return r.update(commentId, { content: newContent });
  }

  static async deleteComment(commentId: string, userId: string, isAdmin = false): Promise<boolean> {
    const r = await getRepo();
    const existing = await r.getById(commentId);
    if (!existing) return false;
    if (!isAdmin && existing.userId !== userId) throw new Error("Unauthorized: Can only delete your own comments");
    return r.delete(commentId);
  }

  static async getRecentComments(limit: number = 10): Promise<TaskComment[]> {
    const r = await getRepo();
    return r.listRecent(limit);
  }

  static async getCommentById(commentId: string): Promise<TaskComment | null> {
    const r = await getRepo();
    return r.getById(commentId);
  }

  static async initializeSampleComments() {
    const r = await getRepo();
    const recent = await r.listRecent(1);
    if (recent.length === 0) {
      const now = Date.now();
      const samples: TaskComment[] = [
        { id: "comment_1", taskId: 1, daoId: "1", userId: "2", userName: "Marie Dubois", content: "Drive créé et documents de base ajoutés. Prêt pour la phase suivante.", createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
        { id: "comment_2", taskId: 2, daoId: "1", userId: "3", userName: "Pierre Martin", content: "Demande de caution en cours. Attente de la réponse de la banque.", createdAt: new Date(now - 1 * 60 * 60 * 1000).toISOString() },
        { id: "comment_3", taskId: 2, daoId: "1", userId: "2", userName: "Marie Dubois", content: "Mise à jour: La banque a confirmé. Dossier complet à 75%.", createdAt: new Date(now - 30 * 60 * 1000).toISOString() },
      ];
      for (const s of samples) await r.add(s);
      console.log("📝 Sample comments initialized");
    }
  }
}
