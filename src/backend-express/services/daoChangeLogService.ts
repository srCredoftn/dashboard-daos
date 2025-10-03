/**
Rôle: Service métier — suivi des changements DAO (agrégation + historique)
Domaine: Backend/Services
Exports: DaoChangeLogService
Liens: utilisé par routes DAO/Tâches/Commentaires et endpoint de validation
*/
import type { Dao, DaoTask } from "@shared/dao";
import { logger } from "../utils/logger";
import type { DaoAggregatedSummary, DaoHistoryEntry } from "@shared/api";

interface PendingTaskChange {
  taskId: number;
  isApplicable?: boolean;
  progress?: number | null;
  comment?: string;
}

interface PendingByDao {
  daoId: string;
  numeroListe: string;
  tasks: Map<number, PendingTaskChange>; // taskId -> latest state snapshot for fields of interest
  lastTouchedAt: string; // ISO
}

class InMemoryDaoChangeLogService {
  private pending: Map<string, PendingByDao> = new Map(); // daoId -> pending
  private historyByDay: Map<string, DaoHistoryEntry[]> = new Map(); // YYYY-MM-DD -> entries

  private dayKey(d = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  recordTaskChange(dao: Dao, task: DaoTask): void {
    const p = this.ensurePending(dao);
    const rec: PendingTaskChange = {
      taskId: task.id,
      isApplicable: task.isApplicable,
      progress: task.isApplicable ? (task.progress ?? 0) : null,
      comment: task.comment,
    };
    p.tasks.set(task.id, rec);
    p.lastTouchedAt = new Date().toISOString();
  }

  recordLeaderChange(
    dao: Dao,
    oldLeaderName: string | null,
    newLeaderName: string | null,
  ): void {
    // Pour l'agrégation « Mise à jour DAO », on n'ajoute pas de ligne spéciale pour le chef
    // car une notification dédiée est envoyée immédiatement. On marque tout de même l'activité.
    const p = this.ensurePending(dao);
    p.lastTouchedAt = new Date().toISOString();
    logger.info(
      `Leader change enregistré pour ${dao.numeroListe}: ${oldLeaderName} -> ${newLeaderName}`,
      "DAO_CHANGELOG",
    );
  }

  clearPending(daoId: string): void {
    this.pending.delete(daoId);
  }

  private ensurePending(dao: Dao): PendingByDao {
    let p = this.pending.get(dao.id);
    if (!p) {
      p = {
        daoId: dao.id,
        numeroListe: dao.numeroListe,
        tasks: new Map<number, PendingTaskChange>(),
        lastTouchedAt: new Date().toISOString(),
      };
      this.pending.set(dao.id, p);
    }
    return p;
  }

  buildAggregatedSummary(dao: Dao, maxLines = 6): DaoAggregatedSummary | null {
    const p = this.pending.get(dao.id);
    const createdAt = new Date().toISOString();
    if (!p || p.tasks.size === 0) {
      return null;
    }

    // Ordonner par taskId pour une sortie stable
    const entries = Array.from(p.tasks.values()).sort(
      (a, b) => a.taskId - b.taskId,
    );
    const lines: string[] = [];
    lines.push(`Numéro de liste : ${dao.numeroListe}`);
    let count = 0;
    for (const item of entries) {
      if (count >= maxLines) break;
      const parts: string[] = [];
      parts.push(`Tâche ${item.taskId} :`);
      if (typeof item.isApplicable === "boolean")
        parts.push(`Applicabilité : ${item.isApplicable ? "Oui" : "Non"}`);
      if (item.isApplicable && typeof item.progress === "number")
        parts.push(`Progression : ${item.progress}%`);
      if (item.comment && item.comment.trim())
        parts.push(`Commentaire: "${item.comment.trim()}"`);
      lines.push(parts.join(" "));
      count++;
    }

    if (entries.length > maxLines) {
      lines.push("(...)");
    }

    const message = lines.join("\n");
    return {
      daoId: dao.id,
      numeroListe: dao.numeroListe,
      title: "Mise à jour DAO",
      message,
      lines,
      createdAt,
    };
  }

  finalizeAndStoreHistory(summary: DaoAggregatedSummary): DaoHistoryEntry {
    const entry: DaoHistoryEntry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      daoId: summary.daoId,
      numeroListe: summary.numeroListe,
      createdAt: summary.createdAt,
      summary: summary.title,
      lines: summary.lines,
    };
    const key = this.dayKey(new Date(summary.createdAt));
    const arr = this.historyByDay.get(key) || [];
    arr.unshift(entry);
    this.historyByDay.set(key, arr.slice(0, 1000));
    return entry;
  }

  aggregateAndClear(
    dao: Dao,
    maxLines = 6,
  ): { summary: DaoAggregatedSummary; history: DaoHistoryEntry } | null {
    const summary = this.buildAggregatedSummary(dao, maxLines);
    if (!summary) return null;
    const history = this.finalizeAndStoreHistory(summary);
    this.clearPending(dao.id);
    return { summary, history };
  }

  listHistory(opts?: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
  }): DaoHistoryEntry[] {
    // Si date fournie, retourner ce jour
    if (opts?.date) {
      return (this.historyByDay.get(opts.date) || []).slice();
    }
    // Sinon, plage
    const from = opts?.dateFrom ? new Date(opts.dateFrom) : null;
    const to = opts?.dateTo ? new Date(opts.dateTo) : null;
    const out: DaoHistoryEntry[] = [];
    for (const [day, entries] of this.historyByDay) {
      const d = new Date(day + "T00:00:00.000Z");
      if (from && d < from) continue;
      if (to && d > to) continue;
      out.push(...entries);
    }
    // Tri décroissant par date de création des entrées
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}

export const DaoChangeLogService = new InMemoryDaoChangeLogService();
