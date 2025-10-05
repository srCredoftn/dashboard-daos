/**
Rôle: Route API Express — src/backend-express/routes/dao-simple.ts
Domaine: Backend/Routes
Exports: default
Dépendances: express, zod, ../utils/devLog, @shared/dao, ../services/daoService, ../utils/logger, ../services/txEmail
Liens: services (métier), middleware (auth, validation), repositories (persistance)
Sécurit��: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
Performance: cache/partitionnement/bundling optimisés
*/
import express from "express";
import { z } from "zod";
import {
  authenticate,
  requireAdmin,
  auditLog,
  requireDaoLeaderOrAdmin,
} from "../middleware/auth";
import { devLog } from "../utils/devLog";
import { DEFAULT_TASKS } from "@shared/dao";
import type { Dao } from "@shared/dao";
import { DaoService } from "../services/daoService";
import { logger } from "../utils/logger";
import { NotificationService } from "../services/notificationService";
import {
  tplDaoCreated,
  tplDaoUpdated,
  tplDaoDeleted,
  tplTaskNotification,
  tplDaoAggregatedUpdate,
  tplLeaderChanged,
} from "../services/notificationTemplates";
import { daoStorage } from "../data/daoStorage";
import { DaoChangeLogService } from "../services/daoChangeLogService";
import type { DaoHistoryEventType } from "@shared/api";

const router = express.Router();

// Schémas de validation
const teamMemberSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100).trim(),
  role: z.enum(["chef_equipe", "membre_equipe"]),
  email: z.string().email().optional(),
});

const taskSchema = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1).max(200).trim(),
  progress: z.number().min(0).max(100).nullable(),
  comment: z.string().max(1000).optional(),
  isApplicable: z.boolean(),
  assignedTo: z.array(z.string().max(50)).optional(),
  lastUpdatedBy: z.string().max(50).optional(),
  lastUpdatedAt: z.string().optional(),
});

const createDaoSchema = z.object({
  numeroListe: z.string().min(1).max(50).trim(),
  objetDossier: z.string().min(1).max(500).trim(),
  reference: z.string().min(1).max(200).trim(),
  autoriteContractante: z.string().min(1).max(200).trim(),
  dateDepot: z
    .string()
    .refine((date) => !isNaN(Date.parse(date)), "Format de date invalide"),
  equipe: z.array(teamMemberSchema).min(1).max(20),
  tasks: z.array(taskSchema).max(50).optional(),
});

const updateDaoSchema = createDaoSchema.partial();

const taskUpdateSchema = z.object({
  progress: z.number().min(0).max(100).optional(),
  comment: z.string().max(1000).optional(),
  isApplicable: z.boolean().optional(),
  assignedTo: z.array(z.string().max(50)).optional(),
});

/**
 * Nettoie une chaîne utilisateur:
 * - retire balises <script>/<style>
 * - supprime toutes balises HTML restantes
 * - trim
 */
function sanitizeString(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function splitMessageLines(message: string): string[] {
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * GET /api/dao
 * Liste les DAO avec filtres/tri/pagination côté serveur.
 * Query: search, autorite, sort, order (asc|desc), page, pageSize
 * Retour: { items, total, page, pageSize }
 */
router.get("/", authenticate, auditLog("VIEW_ALL_DAOS"), async (req, res) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    const autorite =
      typeof req.query.autorite === "string" ? req.query.autorite : undefined;
    const sort =
      typeof req.query.sort === "string" ? req.query.sort : undefined;
    const order = req.query.order === "asc" ? "asc" : "desc";
    const page = parseInt(String(req.query.page || "1"), 10) || 1;
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.pageSize || "20"), 10) || 20),
    );

    const result = await DaoService.getDaos({
      search,
      autorite,
      sort,
      order: order as any,
      page,
      pageSize,
    });

    devLog.info(
      `Service de ${result.items.length}/${result.total} DAO(s) pour ${req.user?.email} (${req.user?.role})`,
    );

    res.json({ items: result.items, total: result.total, page, pageSize });
  } catch (error) {
    devLog.error("Erreur dans GET /api/dao:", error);
    return void res.status(500).json({
      error: "Échec de récupération des DAO",
      code: "FETCH_ERROR",
    });
  }
});

/**
 * GET /api/dao/next-number
 * Calcule (sans créer) le prochain numéro de DAO.
 * Sécurité: utilisateur authentifié.
 * Retour: { nextNumber }
 */
router.get("/next-number", authenticate, async (req, res) => {
  try {
    const next = await DaoService.peekNextDaoNumber();

    logger.audit("Lecture du prochain numéro de DAO", req.user?.id, req.ip);
    res.json({ nextNumber: next });
  } catch (error) {
    logger.error(
      "Erreur lors de la génération du prochain numéro de DAO",
      "DAO_NEXT_NUMBER",
      {
        message: String((error as Error)?.message),
      },
    );
    res.status(500).json({
      error: "Échec de génération du prochain numéro de DAO",
      code: "GENERATION_ERROR",
    });
  }
});

/**
 * GET /api/dao/:id
 * Récupère un DAO par identifiant.
 * Sécurité: utilisateur authentifié.
 * Erreurs: 400 (ID invalide), 404 (DAO introuvable)
 */
router.get("/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    logger.audit("Requête de récupération d'un DAO", req.user?.id, req.ip);

    if (!id || id.length > 100) {
      logger.warn("ID de DAO invalide", "DAO_FETCH");
      return void res.status(400).json({
        error: "ID de DAO invalide",
        code: "INVALID_ID",
      });
    }

    const dao = await DaoService.getDaoById(id);
    if (!dao) {
      logger.warn("DAO introuvable", "DAO_FETCH");
      return void res.status(404).json({
        error: "DAO introuvable",
        code: "DAO_NOT_FOUND",
      });
    }

    logger.audit("DAO renvoyé", req.user?.id, req.ip);
    return void res.json(dao);
  } catch (error) {
    logger.error("Erreur lors de la récupération du DAO", "DAO_FETCH", {
      message: String((error as Error)?.message),
    });
    return void res.status(500).json({
      error: "Échec de récupération du DAO",
      code: "FETCH_ERROR",
    });
  }
});

// Stockage idempotence simple en mémoire pour éviter les créations en double dues à des doubles-clics rapides
const IDEMP_TTL_MS = 15_000;
const idempotencyCache = new Map<string, { expires: number; dao: Dao }>();

/**
 * POST /api/dao
 * Crée un nouveau DAO (réservé admin).
 * Corps: { numeroListe, objetDossier, reference, autoriteContractante, dateDepot, equipe[], tasks?[] }
 * Sécurité: admin + limitation sensitiveOperationLimit.
 * Idempotence: en-tête x-idempotency-key pour éviter les doublons.
 * Effets: notifications de création à tous les utilisateurs.
 */
router.post(
  "/",
  authenticate,
  requireAdmin,
  auditLog("CREATE_DAO"),
  async (req, res) => {
    try {
      // Nettoyer les entrées expirées
      const nowTs = Date.now();
      for (const [k, v] of idempotencyCache) {
        if (v.expires <= nowTs) idempotencyCache.delete(k);
      }

      // Gestion de l’idempotence
      const idempKeyRaw = req.header("x-idempotency-key");
      const idempKey = (idempKeyRaw || "").trim();
      if (idempKey && idempotencyCache.has(idempKey)) {
        const cached = idempotencyCache.get(idempKey)!;
        if (cached.expires > nowTs) {
          return void res.status(201).json(cached.dao);
        }
        idempotencyCache.delete(idempKey);
      }

      const validatedData = createDaoSchema.parse(req.body);

      // Nettoyer les champs de type chaîne
      const sanitizedData = {
        ...validatedData,
        numeroListe: sanitizeString(validatedData.numeroListe),
        objetDossier: sanitizeString(validatedData.objetDossier),
        reference: sanitizeString(validatedData.reference),
        autoriteContractante: sanitizeString(
          validatedData.autoriteContractante,
        ),
        equipe: validatedData.equipe.map((member) => ({
          ...member,
          name: sanitizeString(member.name),
        })),
      };

      const now = new Date().toISOString();
      const tasks = (
        validatedData.tasks && validatedData.tasks.length
          ? validatedData.tasks
          : DEFAULT_TASKS.map((task) => ({
              ...task,
              progress: null,
              comment: "",
            }))
      ).map((t: any, idx: number) => ({
        id: typeof t.id === "number" ? t.id : idx + 1,
        name: sanitizeString(t.name),
        progress: t.isApplicable ? (t.progress ?? null) : null,
        comment: t.comment ? sanitizeString(t.comment) : undefined,
        isApplicable: t.isApplicable,
        assignedTo: Array.isArray(t.assignedTo)
          ? t.assignedTo.map((s: string) => sanitizeString(s))
          : [],
        lastUpdatedBy: req.user!.id,
        lastUpdatedAt: now,
      }));

      const newDao = await DaoService.createDao({
        numeroListe: sanitizedData.numeroListe,
        objetDossier: sanitizedData.objetDossier,
        reference: sanitizedData.reference,
        autoriteContractante: sanitizedData.autoriteContractante,
        dateDepot: sanitizedData.dateDepot,
        equipe: sanitizedData.equipe,
        tasks,
      });

      if (idempKey) {
        idempotencyCache.set(idempKey, {
          expires: Date.now() + IDEMP_TTL_MS,
          dao: newDao,
        });
      }

      logger.audit("DAO créé avec succès", req.user?.id, req.ip);

      // Notifier la plateforme et enregistrer l'historique
      try {
        const t = tplDaoCreated(newDao);
        NotificationService.broadcast(t.type, t.title, t.message, t.data);
        const lines = splitMessageLines(t.message);
        const fallbackLines = lines.length
          ? lines
          : [
              `DAO ${newDao.numeroListe} créé par ${req.user?.name || "un utilisateur"}`,
            ];
        DaoChangeLogService.recordEvent({
          dao: newDao,
          summary: t.title,
          lines: fallbackLines,
          eventType: "dao_created",
          createdAt: newDao.createdAt,
        });
      } catch (_) {}

      res.status(201).json(newDao);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return void res.status(400).json({
          error: "Erreur de validation",
          details: error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
          code: "VALIDATION_ERROR",
        });
      }
      if (error?.code === 11000) {
        return void res.status(400).json({
          error: "Numéro de DAO déjà existant",
          code: "DUPLICATE_NUMBER",
        });
      }

      logger.error("Échec de création du DAO", "DAO_CREATE", {
        message: (error as Error)?.message,
      });
      res.status(500).json({
        error: "Échec de création du DAO",
        code: "CREATE_ERROR",
      });
    }
  },
);

/**
 * PUT /api/dao/:id
 * Met à jour un DAO (chef d'équipe ou admin).
 * Règles:
 *  - Les admins non-chefs ne peuvent PAS modifier progression/applicabilité/assignations en masse.
 *  - Chaînes nettoyées pour éviter l'injection HTML.
 * Effets: notification de mise à jour (clés changées), marquage des changements d'équipe.
 */
router.put(
  "/:id",
  authenticate,
  requireDaoLeaderOrAdmin("id"),
  auditLog("UPDATE_DAO"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!id || id.length > 100) {
        return void res.status(400).json({
          error: "ID de DAO invalide",
          code: "INVALID_ID",
        });
      }

      const validatedData = updateDaoSchema.parse(req.body);

      // Sanitize updates
      const updates: Partial<Dao> = {};
      if (validatedData.numeroListe)
        updates.numeroListe = sanitizeString(validatedData.numeroListe);
      if (validatedData.objetDossier)
        updates.objetDossier = sanitizeString(validatedData.objetDossier);
      if (validatedData.reference)
        updates.reference = sanitizeString(validatedData.reference);
      if (validatedData.autoriteContractante)
        updates.autoriteContractante = sanitizeString(
          validatedData.autoriteContractante,
        );
      if (validatedData.equipe)
        updates.equipe = validatedData.equipe.map((m) => ({
          ...m,
          name: sanitizeString(m.name),
        }));
      if (validatedData.tasks) updates.tasks = validatedData.tasks as any;

      const before = await DaoService.getDaoById(id);

      // Restreindre l���admin (non-chef) de changer la progression/l’applicabilité/les assignations des tâches via mise à jour de masse
      try {
        const isAdmin = req.user?.role === "admin";
        const isLeader = before?.equipe?.some(
          (m) => m.id === req.user!.id && m.role === "chef_equipe",
        );
        if (
          isAdmin &&
          !isLeader &&
          Array.isArray(validatedData.tasks) &&
          before
        ) {
          const beforeMap = new Map(before.tasks.map((t) => [t.id, t]));
          const forbiddenChange = (validatedData.tasks as any[]).some(
            (t: any) => {
              const prev = beforeMap.get(t.id);
              if (!prev) return false;
              const progChanged =
                typeof t.progress === "number" &&
                (prev.progress ?? 0) !== t.progress;
              const applChanged =
                typeof t.isApplicable === "boolean" &&
                prev.isApplicable !== t.isApplicable;
              const assignChanged =
                Array.isArray(t.assignedTo) &&
                JSON.stringify(prev.assignedTo || []) !==
                  JSON.stringify(t.assignedTo || []);
              return progChanged || applChanged || assignChanged;
            },
          );
          if (forbiddenChange) {
            return void res.status(403).json({
              error:
                "Seul le chef d'équipe peut modifier la progression, l'applicabilité ou l'assignation",
              code: "ADMIN_NOT_LEADER_FORBIDDEN",
            });
          }
        }
      } catch (_) {}

      const updated = await DaoService.updateDao(id, updates);
      if (!updated) {
        return void res
          .status(404)
          .json({ error: "DAO introuvable", code: "DAO_NOT_FOUND" });
      }

      // Notify on team role/member changes
      try {
        let hasTaskChanges = false;

        if (before && validatedData.equipe) {
          const beforeMap = new Map(before.equipe.map((m) => [m.id, m]));
          const afterMap = new Map(updated.equipe.map((m) => [m.id, m]));

          const changed: string[] = [];
          for (const [idKey, after] of afterMap) {
            const prev = beforeMap.get(idKey);
            if (!prev) changed.push(`${after.name} ajouté`);
            else if (prev.role !== after.role)
              changed.push(`${after.name}: ${prev.role} → ${after.role}`);
          }
          for (const [_idKey, prev] of beforeMap) {
            if (!afterMap.has(prev.id)) changed.push(`${prev.name} retiré`);
          }

          // Détection de changement de chef d'équipe
          const oldLeader = before.equipe.find((m) => m.role === "chef_equipe");
          const newLeader = updated.equipe.find(
            (m) => m.role === "chef_equipe",
          );
          const leaderChanged =
            (oldLeader?.id || null) !== (newLeader?.id || null);

          if (leaderChanged) {
            try {
              DaoChangeLogService.recordLeaderChange(
                updated,
                oldLeader ? oldLeader.name : null,
                newLeader ? newLeader.name : null,
              );
              const t = tplLeaderChanged({
                dao: updated,
                oldLeader: oldLeader?.name || null,
                newLeader: newLeader?.name || null,
              });
              // Notification en app uniquement (pas d'email automatique hors validation)
              NotificationService.broadcast(t.type, t.title, t.message, {
                ...t.data,
                skipEmailMirror: true,
              });
            } catch (_) {}
          }

          if (changed.length > 0) {
            // Flag team change for later template rendering
            (res as any).teamChanged = true;

            // Notification en app uniquement (pas d'email automatique hors validation)
            NotificationService.broadcast(
              "role_update",
              "Modification de l'équipe",
              changed.join(", "),
              { daoId: updated.id, changes: changed, skipEmailMirror: true },
            );
          }
        }

        // Si les tâches ont changé via ce endpoint, ne FLAGGER que les changements (pas de broadcast ici)
        if (before && Array.isArray(validatedData.tasks)) {
          const byIdBefore = new Map(before.tasks.map((t) => [t.id, t]));
          const sameArray = (a?: string[], b?: string[]) => {
            const aa = [...(a || [])].sort();
            const bb = [...(b || [])].sort();
            if (aa.length !== bb.length) return false;
            for (let i = 0; i < aa.length; i++)
              if (aa[i] !== bb[i]) return false;
            return true;
          };

          const taskChanges: Array<{
            prev: any;
            curr: any;
            changeType:
              | "progress"
              | "applicability"
              | "assignees"
              | "comment"
              | "general";
          }> = [];

          for (const t of updated.tasks) {
            const prev = byIdBefore.get(t.id);
            if (!prev) continue;
            const p1 = prev.progress ?? 0;
            const p2 = t.progress ?? 0;
            if (prev.isApplicable !== t.isApplicable) {
              hasTaskChanges = true;
              taskChanges.push({ prev, curr: t, changeType: "applicability" });
              continue;
            }
            if (p1 !== p2 && t.isApplicable) {
              hasTaskChanges = true;
              taskChanges.push({ prev, curr: t, changeType: "progress" });
            }
            if (prev.comment !== t.comment) {
              hasTaskChanges = true;
              taskChanges.push({ prev, curr: t, changeType: "comment" });
            }
            if (!sameArray(prev.assignedTo, t.assignedTo)) {
              hasTaskChanges = true;
              taskChanges.push({ prev, curr: t, changeType: "assignees" });
            }
          }

          // Diffuser un email pour chaque changement significatif de tâche
          try {
            for (const c of taskChanges) {
              const t = tplTaskNotification({
                dao: updated,
                previous: c.prev,
                current: c.curr,
                changeType: c.changeType,
                comment: c.curr.comment,
              });
              NotificationService.broadcast(t.type, t.title, t.message, t.data);
            }
          } catch (_) {}
        }

        // Mark on res.locals to inform later step whether to broadcast generic update
        (res as any).hasTaskChanges =
          (res as any).hasTaskChanges || hasTaskChanges;
      } catch (_) {}

      // Always broadcast a general DAO update, enregistrer l'historique et email all users
      let historyPayload: {
        summary: string;
        lines: string[];
        eventType: DaoHistoryEventType;
      } | null = null;
      try {
        const hasTaskChanges = (res as any).hasTaskChanges === true;

        const changedKeys = new Set<string>();
        if (before && updated) {
          if (before.numeroListe !== updated.numeroListe)
            changedKeys.add("numeroListe");
          if (before.objetDossier !== updated.objetDossier)
            changedKeys.add("objetDossier");
          if (before.reference !== updated.reference)
            changedKeys.add("reference");
          if (before.autoriteContractante !== updated.autoriteContractante)
            changedKeys.add("autoriteContractante");
          if (before.dateDepot !== updated.dateDepot)
            changedKeys.add("dateDepot");
          if ((res as any).teamChanged === true) {
            changedKeys.add("chef");
            changedKeys.add("membres");
          }
        }

        if (changedKeys.size > 0 || !hasTaskChanges) {
          const t = tplDaoUpdated(updated, changedKeys);
          // Enregistrer ces changements pour la validation (email côté "Valider")
          try {
            if (changedKeys.size > 0) {
              DaoChangeLogService.recordDaoChanged(updated, changedKeys);
            }
          } catch {}
          // Si l'équipe a changé, envoyer un email immédiat "Mise à jour d’un DAO"
          if ((res as any).teamChanged === true) {
            NotificationService.broadcast(t.type, t.title, t.message, t.data);
          }
          // Conserver l'historique
          historyPayload = {
            summary: t.title,
            lines: splitMessageLines(t.message),
            eventType: "dao_updated",
          };
        } else if (hasTaskChanges) {
          historyPayload = {
            summary: "Mise à jour des tâches du DAO",
            lines: [
              `Le DAO ${updated.numeroListe} a reçu des mises à jour de tâches.`,
              "Consultez le détail des tâches pour visualiser les changements.",
            ],
            eventType: "dao_task_update",
          };
        }
      } catch (_) {}

      if (historyPayload) {
        try {
          DaoChangeLogService.recordEvent({
            dao: updated,
            summary: historyPayload.summary,
            lines: historyPayload.lines,
            eventType: historyPayload.eventType,
            createdAt: updated.updatedAt,
          });
        } catch (_) {}
      }

      logger.audit("DAO mis à jour avec succès", req.user?.id, req.ip);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return void res.status(400).json({
          error: "Erreur de validation",
          details: error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
          code: "VALIDATION_ERROR",
        });
      }
      if (error?.code === 11000) {
        return void res.status(400).json({
          error: "Numéro de DAO déjà existant",
          code: "DUPLICATE_NUMBER",
        });
      }

      logger.error("Échec de mise à jour du DAO", "DAO_UPDATE", {
        message: (error as Error)?.message,
      });
      res.status(500).json({
        error: "Échec de mise à jour du DAO",
        code: "UPDATE_ERROR",
      });
    }
  },
);

/**
 * DELETE /api/dao/:id
 * Suppression désactivée pour éviter la perte de données (toujours 403).
 */
router.delete(
  "/:id",
  authenticate,
  auditLog("DELETE_DAO_ATTEMPT"),
  async (_req, res) => {
    return res.status(403).json({
      error: "La suppression de DAO est désactivée",
      code: "DAO_DELETE_DISABLED",
    });
  },
);

/**
 * GET /api/dao/admin/verify-integrity
 * Vérifie l'intégrité du stockage et retourne un petit rapport.
 * Sécurité: admin.
 */
router.get(
  "/admin/verify-integrity",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      logger.audit("Integrity check requested", req.user?.id, req.ip);

      // Force integrity verification
      const isIntegrityOk = daoStorage.verifyIntegrity();

      const allDaos = await DaoService.getAllDaos();

      const report = {
        integrityCheck: isIntegrityOk ? "PASSÉ" : "ÉCHOUÉ",
        totalDaos: allDaos.length,
        daos: allDaos.map((dao) => ({
          id: dao.id,
          numeroListe: dao.numeroListe,
          objetDossier: dao.objetDossier.substring(0, 50) + "...",
        })),
        timestamp: new Date().toISOString(),
      };

      logger.audit("Rapport d'intégrité généré", req.user?.id, req.ip);
      res.json(report);
    } catch (error) {
      logger.error("Échec de la vérification d'intégrité", "DAO_INTEGRITY", {
        message: (error as Error)?.message,
      });
      res.status(500).json({
        error: "Échec de vérification de l'intégrité",
        code: "INTEGRITY_CHECK_ERROR",
      });
    }
  },
);

/**
 * GET /api/dao/admin/last
 * Retourne le dernier DAO créé.
 * Sécurité: admin.
 */
router.get("/admin/last", authenticate, requireAdmin, async (_req, res) => {
  try {
    const last = await DaoService.getLastCreatedDao();
    if (!last)
      return void res.status(404).json({ error: "Aucun DAO", code: "NO_DAO" });
    return void res.json({
      id: last.id,
      numeroListe: last.numeroListe,
      createdAt: last.createdAt,
    });
  } catch (error) {
    logger.error("Error fetching last DAO", "DAO_ADMIN");
    return void res.status(500).json({
      error: "Échec de récupération du dernier DAO",
      code: "LAST_FETCH_ERROR",
    });
  }
});

/**
 * DELETE /api/dao/admin/delete-last
 * Supprime le dernier DAO créé et diffuse une notification.
 * Sécurité: admin.
 */
router.delete(
  "/admin/delete-last",
  authenticate,
  requireAdmin,
  auditLog("DELETE_LAST_DAO"),
  async (req, res) => {
    try {
      const last = await DaoService.getLastCreatedDao();
      if (!last) {
        return void res.status(404).json({
          error: "Aucun DAO à supprimer",
          code: "NO_DAO",
        });
      }

      const deleted = await DaoService.deleteDao(last.id);
      if (!deleted) {
        return void res
          .status(404)
          .json({ error: "DAO introuvable", code: "DAO_NOT_FOUND" });
      }

      try {
        const t = tplDaoDeleted(last);
        NotificationService.broadcast(t.type, t.title, t.message, t.data);
      } catch (_) {}

      logger.audit("Dernier DAO supprimé avec succès", req.user?.id, req.ip);
      return void res.json({
        deletedId: last.id,
        numeroListe: last.numeroListe,
      });
    } catch (error) {
      logger.error("Échec de suppression du dernier DAO", "DAO_DELETE_LAST", {
        message: (error as Error)?.message,
      });
      return void res.status(500).json({
        error: "Échec de suppression du dernier DAO",
        code: "DELETE_LAST_ERROR",
      });
    }
  },
);

/**
 * PUT /api/dao/:id/tasks/reorder
 * Réordonne les tâches d'un DAO selon un tableau d'IDs complet.
 * Règles: doit contenir tous les IDs existants, ordre libre.
 */
router.put(
  "/:id/tasks/reorder",
  authenticate,
  requireDaoLeaderOrAdmin("id"),
  auditLog("REORDER_TASKS"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { taskIds } = req.body as { taskIds: number[] };

      if (!id || id.length > 100) {
        return void res.status(400).json({
          error: "ID de DAO invalide",
          code: "INVALID_DAO_ID",
        });
      }

      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        return void res.status(400).json({
          error: "Tableau d'IDs de tâches invalide",
          code: "INVALID_TASK_IDS",
        });
      }

      const dao = await DaoService.getDaoById(id);
      if (!dao) {
        return void res.status(404).json({
          error: "DAO introuvable",
          code: "DAO_NOT_FOUND",
        });
      }

      const existingTaskIds = dao.tasks.map((t) => t.id);
      const invalidIds = taskIds.filter(
        (tid) => !existingTaskIds.includes(tid),
      );
      if (invalidIds.length > 0) {
        return void res.status(400).json({
          error: "Certains IDs de tâches n'existent pas",
          code: "INVALID_TASK_IDS",
          invalidIds,
        });
      }

      if (
        taskIds.length !== dao.tasks.length ||
        !existingTaskIds.every((tid) => taskIds.includes(tid))
      ) {
        return void res.status(400).json({
          error:
            "La liste des IDs de tâches doit inclure toutes les tâches existantes",
          code: "INCOMPLETE_TASK_LIST",
        });
      }

      const reorderedTasks = taskIds.map(
        (taskId) => dao.tasks.find((task) => task.id === taskId)!,
      );

      const updated = await DaoService.updateDao(id, {
        tasks: reorderedTasks,
      });

      // Notify and email all users
      try {
        // Suppression de l'ancien broadcast de réorganisation des tâches
      } catch (_) {}

      logger.audit("Réordonnancement des tâches réussi", req.user?.id, req.ip);
      res.json(updated);
    } catch (error) {
      logger.error(
        "Échec du réordonnancement des tâches",
        "DAO_TASKS_REORDER",
        {
          message: (error as Error)?.message,
        },
      );
      res.status(500).json({
        error: "Échec du réordonnancement des tâches",
        code: "REORDER_ERROR",
      });
    }
  },
);

/**
 * PUT /api/dao/:id/tasks/:taskId
 * Met à jour une tâche précise (progression, commentaire, applicable, assignations).
 * Règles:
 *  - Admin non-chef interdit pour progression/applicabilité/assignations.
 * Effets: notification ciblée (type selon changement détecté).
 */
router.put(
  "/:id/tasks/:taskId",
  authenticate,
  requireDaoLeaderOrAdmin("id"),
  auditLog("UPDATE_TASK"),
  async (req, res) => {
    try {
      const { id, taskId } = req.params;

      if (!id || id.length > 100) {
        return void res.status(400).json({
          error: "ID de DAO invalide",
          code: "INVALID_DAO_ID",
        });
      }

      const parsedTaskId = parseInt(taskId);
      if (isNaN(parsedTaskId) || parsedTaskId < 1) {
        return void res.status(400).json({
          error: "ID de tâche invalide",
          code: "INVALID_TASK_ID",
        });
      }

      const validatedData = taskUpdateSchema.parse(req.body);

      const dao = await DaoService.getDaoById(id);
      if (!dao) {
        return void res.status(404).json({
          error: "DAO introuvable",
          code: "DAO_NOT_FOUND",
        });
      }

      const task = dao.tasks.find((t) => t.id === parsedTaskId);
      if (!task) {
        return void res.status(404).json({
          error: "Tâche introuvable",
          code: "TASK_NOT_FOUND",
        });
      }

      // Enforce rule: an admin who is not the team lead cannot change progression, applicability, or assignments
      const isAdmin = req.user?.role === "admin";
      const isLeader = dao.equipe.some(
        (m) => m.id === req.user!.id && m.role === "chef_equipe",
      );
      if (
        isAdmin &&
        !isLeader &&
        (Object.prototype.hasOwnProperty.call(validatedData, "progress") ||
          Object.prototype.hasOwnProperty.call(validatedData, "isApplicable") ||
          Object.prototype.hasOwnProperty.call(validatedData, "assignedTo"))
      ) {
        return void res.status(403).json({
          error:
            "Seul le chef d'équipe peut modifier la progression, l'applicabilité ou l'assignation",
          code: "ADMIN_NOT_LEADER_FORBIDDEN",
        });
      }

      const previous = { ...task };

      if (typeof validatedData.progress === "number") {
        task.progress = validatedData.progress;
      }
      if (typeof validatedData.comment === "string") {
        task.comment = sanitizeString(validatedData.comment);
      }
      if (typeof validatedData.isApplicable === "boolean") {
        task.isApplicable = validatedData.isApplicable;
      }
      if (Array.isArray(validatedData.assignedTo)) {
        task.assignedTo = validatedData.assignedTo.map((s) =>
          sanitizeString(s),
        );
      }

      task.lastUpdatedBy = req.user!.id;
      task.lastUpdatedAt = new Date().toISOString();

      const updated = await DaoService.updateDao(id, { tasks: dao.tasks });

      // Enregistrer pour agrégation (validation)
      try {
        const fullDao = await DaoService.getDaoById(id);
        if (fullDao) DaoChangeLogService.recordTaskChange(fullDao, task);
      } catch (_) {}

      // Broadcast task notification à tous les utilisateurs
      let taskHistoryPayload: { summary: string; lines: string[] } | null =
        null;
      try {
        const prevSet = new Set(previous.assignedTo || []);
        const currSet = new Set(task.assignedTo || []);
        const added: string[] = [];
        const removed: string[] = [];
        for (const id of currSet) if (!prevSet.has(id)) added.push(id);
        for (const id of prevSet) if (!currSet.has(id)) removed.push(id);

        let changeType:
          | "progress"
          | "applicability"
          | "assignees"
          | "comment"
          | "general" = "general";
        if ((previous.progress ?? 0) !== (task.progress ?? 0))
          changeType = "progress";
        else if (previous.isApplicable !== task.isApplicable)
          changeType = "applicability";
        else if (added.length || removed.length) changeType = "assignees";
        else if (previous.comment !== task.comment) changeType = "comment";

        const notif = tplTaskNotification({
          dao,
          previous,
          current: task,
          changeType,
          added,
          removed,
          comment: previous.comment !== task.comment ? task.comment : undefined,
        });

        // Notification + email immédiat
        NotificationService.broadcast(
          notif.type,
          notif.title,
          notif.message,
          notif.data,
        );
        taskHistoryPayload = {
          summary: notif.title,
          lines: splitMessageLines(notif.message),
        };
      } catch (_) {}

      if (taskHistoryPayload) {
        try {
          DaoChangeLogService.recordEvent({
            dao,
            summary: taskHistoryPayload.summary,
            lines: taskHistoryPayload.lines,
            eventType: "dao_task_update",
            createdAt: task.lastUpdatedAt || new Date().toISOString(),
          });
        } catch (_) {}
      }

      logger.audit("Tâche mise à jour avec succès", req.user?.id, req.ip);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return void res.status(400).json({
          error: "Erreur de validation",
          details: error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
          code: "VALIDATION_ERROR",
        });
      }

      logger.error("Échec de mise à jour de la tâche", "DAO_TASK_UPDATE", {
        message: (error as Error)?.message,
      });
      res.status(500).json({
        error: "Échec de mise à jour de la tâche",
        code: "TASK_UPDATE_ERROR",
      });
    }
  },
);

// Validation agrégée: POST /api/dao/:id/validate
router.post(
  "/:id/validate",
  authenticate,
  auditLog("VALIDATE_DAO_CHANGES"),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!id || id.length > 100) {
        return void res.status(400).json({
          error: "ID de DAO invalide",
          code: "INVALID_DAO_ID",
        });
      }

      const dao = await DaoService.getDaoById(id);
      if (!dao) {
        return void res.status(404).json({
          error: "DAO introuvable",
          code: "DAO_NOT_FOUND",
        });
      }

      const aggregated = DaoChangeLogService.aggregateAndClear(dao, 6);
      if (!aggregated) {
        return void res
          .status(200)
          .json({ ok: true, message: "Aucune modification" });
      }

      const { summary, history } = aggregated;

      try {
        // Choisir UNE notification email en fonction de la nature des changements
        if (summary.kind === "tasks") {
          NotificationService.broadcast(
            "task_notification",
            "Mise à jour d’une tâche",
            summary.lines.join("\n"),
            { event: "task_validation", daoId: dao.id },
          );
        } else {
          // top-level DAO changes
          const t = tplDaoAggregatedUpdate({ dao, lines: summary.lines });
          NotificationService.broadcast(t.type, t.title, t.message, t.data);
        }
      } catch (_) {}

      return void res.json({ ok: true, summary, historyId: history.id });
    } catch (error) {
      logger.error("Échec de validation des changements", "DAO_VALIDATE", {
        message: String((error as Error)?.message),
      });
      return void res.status(500).json({
        error: "Échec de validation des changements",
        code: "VALIDATE_ERROR",
      });
    }
  },
);

// Historique: GET /api/dao/history?date=YYYY-MM-DD&dateFrom=..&dateTo=..
router.get("/history", authenticate, async (req, res) => {
  try {
    const date =
      typeof req.query.date === "string" ? req.query.date : undefined;
    const dateFrom =
      typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo =
      typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
    const list = DaoChangeLogService.listHistory({ date, dateFrom, dateTo });
    return void res.json({ items: list });
  } catch (error) {
    logger.error("Échec de récupération de l'historique DAO", "DAO_HISTORY", {
      message: String((error as Error)?.message),
    });
    return void res.status(500).json({
      error: "Échec de récupération de l'historique",
      code: "HISTORY_ERROR",
    });
  }
});

export default router;
