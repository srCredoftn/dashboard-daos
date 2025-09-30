/**
Rôle: Contexte/Provider React — src/frontend/contexts/NotificationContext.tsx
Domaine: Frontend/State
Exports: ClientNotification, NotificationProvider, useNotifications, useNotificationsOptional
Dépendances: react, @/services/notificationsApi
Liens: services, pages/ composantes consommatrices, types @shared/*
Performance: cache/partitionnement/bundling optimisés
*/
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { notificationsApi } from "@/services/notificationsApi";

export type ClientNotification = {
  id: string;
  type:
    | "role_update"
    | "dao_created"
    | "dao_updated"
    | "dao_deleted"
    | "user_created"
    | "mention"
    | "task_notification"
    | "system";
  title: string;
  message: string;
  data?: any;
  createdAt: string;
  read: boolean;
};

interface NotificationContextValue {
  notifications: ClientNotification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  removeNotification: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  refresh: () => Promise<void>;
  addNotification: (n: any) => void;
}

// Contexte centralisé pour les notifications
const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function NotificationProvider({ children }: { children: ReactNode }) {
  // Etat local de la liste des notifications (limité à 200 items pour éviter la surcharge UI)
  const [notifications, setNotifications] = useState<ClientNotification[]>([]);

  // Rafraîchit la liste depuis l'API et trie par date décroissante
  const refresh = async () => {
    const list = await notificationsApi.list();
    setNotifications(
      list.slice(0, 200).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    );
  };

  // Polling léger toutes les 8s (uniquement onglet visible) + premier chargement
  useEffect(() => {
    refresh().catch(() => {});
    const id = setInterval(() => {
      // Ne poller que si l'onglet est visible
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      ) {
        refresh().catch(() => {});
      }
    }, 8000);
    return () => clearInterval(id);
  }, []);

  // Marquer une notification comme lue (optimiste)
  const markAsRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id);
    } finally {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    }
  };

  // Marquer toutes comme lues (optimiste)
  const markAllAsRead = async () => {
    try {
      await notificationsApi.markAllRead();
    } finally {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  // Retirer une notification (soft-remove côté UI, après markAsRead)
  const removeNotification = async (id: string) => {
    await markAsRead(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // Vider toutes les notifications (en les marquant d'abord comme lues)
  const clearAll = async () => {
    await markAllAsRead();
    setNotifications([]);
  };

  // Ajout manuel (ex: événements locaux) avec valeurs par défaut sûres
  const addNotification = (n: any) => {
    const item: ClientNotification = {
      id:
        n.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: n.type || "system",
      title: n.title || "Notification",
      message: n.message || "",
      data: n.data,
      createdAt: new Date().toISOString(),
      read: false,
    };
    setNotifications((prev) => [item, ...prev].slice(0, 200));
  };

  // Log email delivery errors to client console (no PII)
  useEffect(() => {
    try {
      const seenKey = "__seen_mail_err_ids__";
      const seenRaw = (window as any)[seenKey] as Set<string> | undefined;
      const seen = seenRaw instanceof Set ? seenRaw : new Set<string>();
      for (const n of notifications) {
        if (seen.has(n.id)) continue;
        const isEmailError =
          n.type === "system" &&
          (n.title?.toLowerCase().includes("erreur d'envoi d'email") ||
            n.title?.toLowerCase().includes("erreur d’envoi d’email") ||
            n.data?.emailError === true);
        if (isEmailError) {
          const code = n.data?.code ? ` (code ${n.data.code})` : "";
          console.error(`⚠️ Problème d'envoi d'email${code}:`, n.message);
          seen.add(n.id);
        }
      }
      (window as any)[seenKey] = seen;
    } catch {}
  }, [notifications]);

  // Dérivé: nombre de non lues
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  // Valeur exposée du contexte
  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    refresh,
    addNotification,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// Hook consommateur — renvoie des stubs no-op si Provider absent (sécurité UI)
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    return {
      notifications: [],
      unreadCount: 0,
      markAsRead: async () => {},
      markAllAsRead: async () => {},
      removeNotification: async () => {},
      clearAll: async () => {},
      refresh: async () => {},
      addNotification: () => {},
    };
  }
  return ctx;
}

export function useNotificationsOptional() {
  return useNotifications();
}
