/**
Rôle: Service métier côté serveur — src/backend-express/services/notificationService.ts
Domaine: Backend/Services
Exports: NotificationType, ServerNotification, NotificationService
Liens: appels /api, utils de fetch, types @shared/*
*/
import {} from /* emailAllUsers, sendEmail removed - mail queue used instead */ "./txEmail";
import { AuthService } from "./authService";
import { logger } from "../utils/logger";
import { MongoNotificationRepository } from "../repositories/mongoNotificationRepository";
import { MemoryNotificationRepository } from "../repositories/memoryNotificationRepository";

export type NotificationType =
  | "role_update"
  | "task_notification"
  | "dao_created"
  | "dao_updated"
  | "dao_deleted"
  | "user_created"
  | "system";

export interface ServerNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  recipients: "all" | string[];
  readBy: Set<string>;
  createdAt: string;
}

interface ClientNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  createdAt: string;
  read: boolean;
}

// Helper: tenter d'obtenir un dépôt de notifications persistant (mongo ou en mémoire)
async function getNotificationRepo() {
  try {
    if ((process.env.USE_MONGO || "").toLowerCase() === "true") {
      return new MongoNotificationRepository();
    }
  } catch {}
  try {
    return new MemoryNotificationRepository();
  } catch {}
  return null;
}

class InMemoryNotificationService {
  private notifications: ServerNotification[] = [];
  private MAX_ITEMS = 1000;

  private isRecipient(userId: string, n: ServerNotification): boolean {
    return (
      n.recipients === "all" ||
      (Array.isArray(n.recipients) && n.recipients.includes(userId))
    );
  }

  private toClient(userId: string, n: ServerNotification): ClientNotification {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      data: n.data,
      createdAt: n.createdAt,
      read: n.readBy.has(userId),
    };
  }

  /**
   * Liste les notifications visibles par un utilisateur, triées desc et limitées.
   */
  async listForUser(userId: string): Promise<ClientNotification[]> {
    const list = this.notifications
      .filter((n) => this.isRecipient(userId, n))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 200)
      .map((n) => this.toClient(userId, n));
    return list;
  }

  /**
   * Persiste une notification si un dépôt est disponible (best-effort), sinon reste mémoire.
   */
  private async persistNotification(item: ServerNotification) {
    try {
      const repo = await getNotificationRepo();
      if (!repo) return;
      const persisted = {
        id: item.id,
        type: item.type,
        title: item.title,
        message: item.message,
        data: item.data,
        recipients: item.recipients,
        readBy: Array.from(item.readBy),
        createdAt: item.createdAt,
      } as any;
      await repo.add(persisted);
      logger.info("Notification persistée", "NOTIF", { type: item.type });
    } catch (e) {
      logger.warn(
        "Échec de persistance de la notification (continuation en mémoire)",
        "NOTIF",
        {
          message: String((e as Error)?.message),
        },
      );
    }
  }

  /**
   * Miroir email robuste avec retries et logs sûrs.
   * - Diffusion à tous ou ciblée selon recipients
   * - En cas d'échec, génère une notification système (sans re-mirroring)
   */
  private async mirrorEmail(item: ServerNotification) {
    // Ignorer le mirroring pour les notifications internes/réservées au système
    if (item?.data && (item as any).data?.skipEmailMirror) return;

    const subject = item.title || "Notification";

    // Corps : uniquement le message, pas de titre dupliqué, pas de section "Détails"
    const body = String(item.message || "");

    try {
      // Use mail queue for robust delivery
      const { enqueueMail } = await import("./mailQueue");

      if (item.recipients === "all") {
        // Enqueue a broadcast: resolve emails server-side inside queue by using emailAllUsers via a small job split
        const tpl = {
          subject,
          body,
          type: undefined,
        };
        // fetch all emails now and enqueue as batches
        const allEmails = await (async () => {
          try {
            return (await AuthService.getAllUsers())
              .map((u) => u.email)
              .filter(Boolean);
          } catch {
            return [] as string[];
          }
        })();
        if (!allEmails || allEmails.length === 0) {
          logger.info(
            "Miroir email : aucun destinataire trouvé (skip)",
            "MAIL",
            { type: item.type },
          );
          return;
        }
        // Batch enqueue to avoid giant BCCs
        const BATCH_SIZE = Math.max(
          1,
          Number(process.env.SMTP_BATCH_SIZE || 25),
        );
        for (let i = 0; i < allEmails.length; i += BATCH_SIZE) {
          const batch = allEmails.slice(i, i + BATCH_SIZE);
          await enqueueMail(batch, tpl.subject, tpl.body, item.type);
        }

        logger.info("Miroir email (diffusion) enqueued", "MAIL", {
          type: item.type,
        });
        return;
      }

      // Map recipient user ids to emails
      const users = await AuthService.getAllUsers();
      const emails = users
        .filter(
          (u) =>
            Array.isArray(item.recipients) && item.recipients.includes(u.id),
        )
        .map((u) => u.email)
        .filter(Boolean);

      if (emails.length === 0) {
        logger.info("Miroir email : aucun destinataire trouvé (skip)", "MAIL", {
          type: item.type,
        });
        return;
      }

      // Enqueue as a single job (mailQueue will batch if needed)
      await enqueueMail(emails, subject, body, item.type);
      logger.info("Miroir email enqueued", "MAIL", { type: item.type });
    } catch (e) {
      const err: any = e;
      const code = err?.responseCode || err?.code || "unknown";
      const is504 =
        String(code) === "504" || /\b504\b/.test(String(err?.message || ""));
      logger.error("Échec du mirroring des emails après tentatives", "MAIL", {
        message: String((e as Error)?.message),
        code,
        type: item.type,
      });
      // Also surface to client via a system notification without re-mirroring
      const safeMsg = is504
        ? "Erreur d'envoi d'email (504 Gateway Timeout). Réessayer plus tard."
        : "Erreur d'envoi d'email. Réessayer plus tard.";
      await this.add({
        type: "system",
        title: "Erreur d'envoi d'email",
        message: safeMsg,
        data: { skipEmailMirror: true, emailError: true, code },
        recipients: "all",
      });
    }
  }

  /**
   * Ajoute une notification (mémoire + tentative de persistance + miroir email).
   */
  async add(n: Omit<ServerNotification, "id" | "readBy" | "createdAt">) {
    // Option de diffusion globale via variable d'environnement
    const broadcastAll =
      String(process.env.EMAIL_BROADCAST_ALL || "false").toLowerCase() ===
      "true";

    const item: ServerNotification = {
      ...n,
      recipients: broadcastAll ? "all" : n.recipients,
      id: `srv_notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      readBy: new Set<string>(),
      createdAt: new Date().toISOString(),
    };

    // add to in-memory store
    this.notifications.unshift(item);
    if (this.notifications.length > this.MAX_ITEMS) {
      this.notifications = this.notifications.slice(0, this.MAX_ITEMS);
    }

    // Best-effort persist + email mirror asynchronously
    (async () => {
      await this.persistNotification(item).catch(() => {});
      await this.mirrorEmail(item).catch(() => {});
    })();

    return item;
  }

  /**
   * Diffuse une notification à tous les utilisateurs.
   */
  broadcast(
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) {
    // Par défaut, éviter le mirroring email pour les broadcasts automatiques
    // Si on veut explicitement envoyer des emails pour un broadcast, passer { skipEmailMirror: false }
    const safeData = Object.assign({}, data || {}, {
      skipEmailMirror:
        (data && (data as any).skipEmailMirror) === false ? false : true,
    });
    return this.add({
      type,
      title,
      message,
      data: safeData,
      recipients: "all",
    });
  }

  /**
   * Marque une notification comme lue pour un utilisateur et persiste si possible.
   */
  markRead(userId: string, notifId: string) {
    const n = this.notifications.find((n) => n.id === notifId);
    if (!n) return false;
    if (!this.isRecipient(userId, n)) return false;
    n.readBy.add(userId);

    // update persisted store if possible (best-effort)
    (async () => {
      try {
        const repo = await getNotificationRepo();
        if (!repo) return;
        await repo.markRead(userId, notifId);
      } catch (e) {
        logger.warn("Échec de persistance du marquage comme lu", "NOTIF", {
          message: String((e as Error)?.message),
        });
      }
    })();

    return true;
  }

  /**
   * Marque toutes les notifications visibles par l'utilisateur comme lues.
   */
  markAllRead(userId: string) {
    let count = 0;
    for (const n of this.notifications) {
      if (this.isRecipient(userId, n) && !n.readBy.has(userId)) {
        n.readBy.add(userId);
        count++;
      }
    }

    (async () => {
      try {
        const repo = await getNotificationRepo();
        if (!repo) return;
        await repo.markAllRead(userId);
      } catch (e) {
        logger.warn(
          "Échec de persistance du marquage de toutes comme lues",
          "NOTIF",
          {
            message: String((e as Error)?.message),
          },
        );
      }
    })();

    return count;
  }

  /**
   * Vide toutes les notifications (mémoire et dépôt si dispo).
   */
  clearAll() {
    this.notifications = [];

    (async () => {
      try {
        const repo = await getNotificationRepo();
        if (!repo) return;
        await repo.clearAll();
      } catch (e) {
        logger.warn(
          "Échec de persistance lors du vidage des notifications",
          "NOTIF",
          {
            message: String((e as Error)?.message),
          },
        );
      }
    })();
  }
}

export const NotificationService = new InMemoryNotificationService();
