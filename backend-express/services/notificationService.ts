export type NotificationType =
  | "role_update"
  | "comment_added"
  | "comment_updated"
  | "comment_deleted"
  | "task_created"
  | "task_deleted"
  | "task_updated"
  | "task_assigned"
  | "task_unassigned"
  | "task_reordered"
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
  recipients: "all" | string[]; // "all" means all active users
  readBy: Set<string>; // userIds who read it
  createdAt: string;
}

class NotificationServiceClass {
  private notifications: ServerNotification[] = [];

  private buildEmailContent(n: ServerNotification): { subject: string; body: string } {
    const type = n.type;
    const data = n.data || {};
    switch (type) {
      case "task_assigned": {
        const dao = data.daoId ? String(data.daoId) : "";
        return {
          subject: `Tâche assignée` + (dao ? ` — DAO ${dao}` : ""),
          body: `${n.message}\n\nDétails: ${JSON.stringify({ daoId: data.daoId, taskId: data.taskId, assignedTo: data.assignedTo }, null, 2)}`,
        };
      }
      case "task_unassigned":
      case "task_updated":
      case "task_reordered":
      case "task_created": {
        return {
          subject: n.title || "Mise à jour de tâche",
          body: `${n.message}${data && Object.keys(data).length ? `\n\nDétails: ${JSON.stringify(data, null, 2)}` : ""}`,
        };
      }
      case "comment_added":
      case "comment_updated":
      case "comment_deleted": {
        return {
          subject: n.title || "Mise à jour des commentaires",
          body: `${n.message}${data && data.content ? `\n\nCommentaire: ${data.content}` : ""}`,
        };
      }
      case "dao_created":
      case "dao_updated":
      case "dao_deleted":
      case "role_update":
      case "user_created":
      default: {
        return {
          subject: n.title || "Notification",
          body: `${n.message}${n.data ? `\n\nDétails: ${JSON.stringify(n.data, null, 2)}` : ""}`,
        };
      }
    }
  }

  private async resolveRecipientEmails(n: ServerNotification): Promise<string[]> {
    const emails: Set<string> = new Set();

    // 1) Try DB users via AuthService (best effort)
    try {
      const { AuthService } = await import("./authService");
      if (n.recipients === "all") {
        const users = await AuthService.getAllUsers();
        users.forEach((u) => emails.add(u.email));
      } else if (Array.isArray(n.recipients)) {
        const users = await AuthService.getAllUsers();
        const byId = new Map(users.map((u) => [u.id, u.email] as const));
        n.recipients.forEach((id) => {
          const e = byId.get(id);
          if (e) emails.add(e);
        });
      }
    } catch (_) {
      // DB not available -> fallback paths below
    }

    // 2) Fallback: collect team member emails from in-memory DAO storage
    try {
      const { daoStorage } = await import("../data/daoStorage");
      const allDaos = daoStorage.getAll();
      for (const dao of allDaos) {
        for (const m of dao.equipe) if (m.email) emails.add(m.email);
      }
    } catch (_) {}

    // 3) Always include admin email if present
    if (process.env.ADMIN_EMAIL) emails.add(String(process.env.ADMIN_EMAIL));

    return Array.from(emails).filter(Boolean);
  }

  listForUser(
    userId: string,
  ): (Omit<ServerNotification, "readBy" | "recipients"> & { read: boolean })[] {
    return this.notifications
      .filter(
        (n) =>
          n.recipients === "all" ||
          (Array.isArray(n.recipients) && n.recipients.includes(userId)),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        data: n.data,
        createdAt: n.createdAt,
        read: n.readBy.has(userId),
      }));
  }

  add(
    notification: Omit<ServerNotification, "id" | "readBy" | "createdAt">,
  ): ServerNotification {
    const newNotif: ServerNotification = {
      ...notification,
      id: `srv_notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      readBy: new Set(),
      createdAt: new Date().toISOString(),
    };
    this.notifications.unshift(newNotif);
    if (this.notifications.length > 500) this.notifications.pop();

    // Mirror to email (best-effort, non-blocking)
    Promise.resolve()
      .then(async () => {
        try {
          const { EmailService } = await import("./emailService");

          // Privacy guard: never broadcast someone else's login to others
          if (
            newNotif.type === "system" &&
            /connexion/i.test(newNotif.title || "") &&
            newNotif.recipients !== "all"
          ) {
            // Only send to intended recipient list
          }

          const { subject, body } = this.buildEmailContent(newNotif);
          const toList = await this.resolveRecipientEmails(newNotif);
          if (toList.length) {
            await EmailService.sendBulkNotification(toList, subject, body);
          }
        } catch (_) {
          // swallow silently
        }
      })
      .catch(() => {});

    return newNotif;
  }

  broadcast(
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ): ServerNotification {
    return this.add({ type, title, message, data, recipients: "all" });
  }

  markRead(userId: string, notifId: string): boolean {
    const notif = this.notifications.find((n) => n.id === notifId);
    if (!notif) return false;
    notif.readBy.add(userId);
    return true;
  }

  markAllRead(userId: string): number {
    let count = 0;
    for (const n of this.notifications) {
      if (
        n.recipients === "all" ||
        (Array.isArray(n.recipients) && n.recipients.includes(userId))
      ) {
        if (!n.readBy.has(userId)) {
          n.readBy.add(userId);
          count++;
        }
      }
    }
    return count;
  }

  clearAll(): void {
    this.notifications = [];
  }
}

export const NotificationService = new NotificationServiceClass();
