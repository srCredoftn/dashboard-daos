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
  recipients: "all" | string[];
  readBy: Set<string>;
  createdAt: string;
}

export interface PersistedNotification extends Omit<ServerNotification, "readBy"> {
  readBy: string[];
}

export interface NotificationRepository {
  listForUser(userId: string): Promise<PersistedNotification[]>;
  add(n: PersistedNotification): Promise<PersistedNotification>;
  markRead(userId: string, notifId: string): Promise<boolean>;
  markAllRead(userId: string): Promise<number>;
  clearAll(): Promise<void>;
}
