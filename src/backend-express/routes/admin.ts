/**
Rôle: Route API Express — src/backend-express/routes/admin.ts
Domaine: Backend/Routes
Exports: createAdminRoutes
Dépendances: express, ../data/daoStorage, ../services/notificationService, ../services/authService, ../utils/idempotency
Liens: services (métier), middleware (auth, validation), repositories (persistance)
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
Performance: cache/partitionnement/bundling optimisés
*/
import express from "express";
import { daoStorage } from "../data/daoStorage";
import { NotificationService } from "../services/notificationService";
import { AuthService } from "../services/authService";
import { getIdempotency, setIdempotency } from "../utils/idempotency";

/**
 * Fabrique de routes admin recevant un setter du bootId runtime.
 * Permet de régénérer un identifiant côté serveur pour forcer le purge côté client.
 */
export default function createAdminRoutes(setBootId: (id: string) => string) {
  const router = express.Router();

  /**
   * POST /api/admin/reset-app
   * Réinitialise l'application (données + sessions), optionnellement fait tourner le bootId.
   * Body: { rotateBootId?: boolean, seedDaos?: boolean }
   * Sécurité: en prod, requiert un JWT admin (Authorization: Bearer ...).
   */
  // Body: { rotateBootId?: boolean, seedDaos?: boolean }
  router.post("/reset-app", async (req, res) => {
    try {
      // In production, require an admin token. In development, allow local unauthenticated resets.
      if (process.env.NODE_ENV === "production") {
        // Require Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(403).json({ error: "Forbidden: missing token" });
        }
        const token = authHeader.substring(7);
        const { AuthService } = await import("../services/authService");
        const verified = await AuthService.verifyToken(token);
        if (!verified || verified.role !== "admin") {
          return res.status(403).json({ error: "Forbidden: invalid token" });
        }
      }

      const { rotateBootId = true, seedDaos = false } = req.body || {};

      // Clear server-side data (DB or in-memory)
      try {
        const { DaoService } = await import("../services/daoService");
        await DaoService.clearAll();
      } catch (e) {
        // Fallback to daoStorage clear if DaoService clear fails
        try {
          daoStorage.clearAll(Boolean(seedDaos));
        } catch (_) {}
      }

      NotificationService.clearAll();

      // Reset auth users and sessions to defaults
      await AuthService.reinitializeUsers();
      await AuthService.clearAllSessions();

      // Optionally rotate boot id to force frontend clients to purge local storage
      let newBootId: string | null = null;
      if (rotateBootId) {
        const generated = Math.random().toString(36).slice(2, 14);
        newBootId = setBootId(generated);
      }

      return res.json({ ok: true, bootId: newBootId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * GET /api/admin/sessions
   * Liste les sessions actives.
   * Dev: sans auth. Prod: JWT admin requis.
   */
  router.get("/sessions", async (req, res) => {
    try {
      if (process.env.NODE_ENV === "production") {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(403).json({ error: "Forbidden: missing token" });
        }
        const token = authHeader.substring(7);
        const { AuthService } = await import("../services/authService");
        const verified = await AuthService.verifyToken(token);
        if (!verified || verified.role !== "admin") {
          return res.status(403).json({ error: "Forbidden: invalid token" });
        }
      }
      const { AuthService } = await import("../services/authService");
      const sessions = await AuthService.listActiveSessions();
      return res.json({ sessions, count: sessions.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * POST /api/admin/revoke-session
   * Révoque un token d'accès précis.
   * Prod: JWT admin requis.
   */
  router.post("/revoke-session", async (req, res) => {
    try {
      if (process.env.NODE_ENV === "production") {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(403).json({ error: "Forbidden: missing token" });
        }
        const token = authHeader.substring(7);
        const { AuthService } = await import("../services/authService");
        const verified = await AuthService.verifyToken(token);
        if (!verified || verified.role !== "admin") {
          return res.status(403).json({ error: "Forbidden: invalid token" });
        }
      }

      const { token: tokenToRevoke } = req.body || {};
      if (!tokenToRevoke || typeof tokenToRevoke !== "string") {
        return res.status(400).json({ error: "token is required in body" });
      }

      const { AuthService } = await import("../services/authService");
      await AuthService.logout(tokenToRevoke);
      return res.json({ ok: true, revoked: tokenToRevoke });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * POST /api/admin/send-test-email
   * Envoie une notification système et un email de test (destinataire(s) optionnels).
   * Body: { to?: string | string[], message?: string }
   * Prod: JWT admin requis.
   */
  // Body: { to?: string | string[], message?: string }
  router.post("/send-test-email", async (req, res) => {
    try {
      if (process.env.NODE_ENV === "production") {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(403).json({ error: "Forbidden: missing token" });
        }
        const token = authHeader.substring(7);
        const { AuthService } = await import("../services/authService");
        const verified = await AuthService.verifyToken(token);
        if (!verified || verified.role !== "admin") {
          return res.status(403).json({ error: "Forbidden: invalid token" });
        }
      }

      const { to, message } = req.body || {};
      const text =
        typeof message === "string" && message.trim()
          ? message.trim()
          : "Test de notification et d'email depuis la plateforme";

      const { NotificationService } = await import(
        "../services/notificationService"
      );
      const { sendEmail, emailAllUsers } = await import("../services/txEmail");

      // Create a notification (broadcast or targeted)
      const notif = NotificationService.broadcast(
        "system",
        "Test d\u2019envoi",
        text,
        { test: true },
      );

      // Send email: if 'to' provided send direct, else broadcast to all users
      let emailResult: any = { sent: false };
      try {
        if (to) {
          if (Array.isArray(to)) {
            await sendEmail(
              to,
              "Gestion des DAOs 2SND - Test",
              text,
              "SYSTEM_TEST",
            );
          } else {
            await sendEmail(
              String(to),
              "Gestion des DAOs 2SND - Test",
              text,
              "SYSTEM_TEST",
            );
          }
          emailResult.sent = true;
        } else {
          await emailAllUsers(
            "Gestion des DAOs 2SND - Test",
            text,
            "SYSTEM_TEST",
          );
          emailResult.sent = true;
        }
      } catch (e) {
        emailResult.error = String((e as Error)?.message || e);
      }

      return res.json({
        ok: true,
        notif: notif?.id || null,
        email: emailResult,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * DELETE /api/admin/delete-last-dao
   * Supprime le DAO le plus récent.
   * Sécurité: JWT admin + mot de passe du super admin dans le corps.
   * Idempotence: x-idempotency-key supporté.
   */
  router.delete("/delete-last-dao", async (req, res) => {
    try {
      const idempKey = (req.header("x-idempotency-key") || "").trim();
      if (idempKey) {
        const cached = getIdempotency(idempKey);
        if (cached) return res.json(cached);
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(403).json({ error: "Forbidden: missing token" });
      }
      const token = authHeader.substring(7);
      const { AuthService } = await import("../services/authService");
      const verified = await AuthService.verifyToken(token);
      if (!verified || verified.role !== "admin") {
        return res.status(403).json({ error: "Forbidden: invalid token" });
      }

      // Require the current super admin password for destructive action
      const pwd = (req.body?.password || "").toString();
      if (!pwd) {
        return res.status(400).json({ error: "Password is required" });
      }
      const superAdmin = AuthService.getSuperAdmin();
      if (!superAdmin) {
        return res.status(403).json({ error: "No super admin configured" });
      }
      const valid = await AuthService.verifyPasswordById(superAdmin.id, pwd);
      if (!valid) {
        return res
          .status(403)
          .json({ error: "Invalid password", code: "INVALID_PASSWORD" });
      }

      const { DaoService } = await import("../services/daoService");
      const last = await DaoService.getLastCreatedDao();
      if (!last) {
        return res
          .status(404)
          .json({ error: "No DAO to delete", code: "NO_DAO" });
      }

      const ok = await DaoService.deleteDao(last.id);
      if (!ok) {
        return res
          .status(404)
          .json({ error: "DAO not found", code: "DAO_NOT_FOUND" });
      }

      try {
        const { tplDaoDeleted } = await import(
          "../services/notificationTemplates"
        );
        const t = tplDaoDeleted(last);
        NotificationService.broadcast(t.type, t.title, t.message, t.data);
        // Centralized email system in use; no legacy EmailService calls
      } catch (_) {}

      const response = { deletedId: last.id, numeroListe: last.numeroListe };
      if (idempKey) setIdempotency(idempKey, response);

      return res.json(response);
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
