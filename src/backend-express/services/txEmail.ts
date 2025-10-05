/**
Rôle: Service métier côté serveur — src/backend-express/services/txEmail.ts
Domaine: Backend/Services
Exports: MailType, computeDaoProgress, Templates
Dépendances: ../utils/logger, @shared/dao
Liens: appels /api, utils de fetch, types @shared/*
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
Performance: cache/partitionnement/bundling optimisés
*/
import nodemailer from "nodemailer";
import { logger } from "../utils/logger";
import type { Dao, DaoTask } from "@shared/dao";
import { AuthService } from "./authService";

// Diagnostics (mémoire) pour aider au debug des emails
const emailEvents: Array<{
  ts: string;
  subject: string;
  toCount: number;
  success: boolean;
  error?: string;
}> = [];
let lastTransportError: string | null = null;

// Types d'événements mail pour la journalisation structurée (sans données sensibles)
export type MailType =
  | "USER_CREATED"
  | "USER_DELETED_USER"
  | "USER_DELETED_ADMIN"
  | "DAO_CREATED"
  | "DAO_UPDATED"
  | "TASK_CREATED"
  | "TASK_UPDATED"
  | "TASK_DELETED"
  | "TASK_ASSIGNED"
  | "TASK_REASSIGNED"
  | "TASK_COMMENTED"
  | "AUTH_PASSWORD_RESET"
  | "AUTH_PASSWORD_CHANGED"
  | "SYSTEM_TEST";

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function getMailLogoUrl(): string {
  const envUrl = (process.env.MAIL_LOGO_URL || "").trim();
  const fallback =
    "https://2sndtechnologies.com/wp-content/uploads/2023/09/Logo2snd.png";
  try {
    const url = envUrl || fallback;
    // Liste d’autorisation basique : seulement http/https
    if (!/^https?:\/\//i.test(url)) return fallback;
    return url;
  } catch {
    return fallback;
  }
}

function buildEmailHtml(subject: string, body: string): string {
  const logoUrl = getMailLogoUrl();
  const safeText = (body || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = safeText
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style=\"margin:0 0 12px; line-height:1.5; color:#1f2937;\">${p.replace(/\n/g, "<br/>")}</p>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang=\"fr\">
  <head>
    <meta http-equiv=\"Content-Type\" content=\"text/html; charset=UTF-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
    <title>${(subject && subject.trim()) || "Gestion des DAOs 2SND"}</title>
  </head>
  <body style=\"margin:0; padding:0; background-color:#f3f4f6;\">
    <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"background-color:#f3f4f6; padding:24px 0;\">
      <tr>
        <td align=\"center\">
          <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"max-width:640px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06);\">
            <tr>
              <td align=\"center\" style=\"padding:24px 24px 8px;\">
                <img src=\"${logoUrl}\" alt=\"Logo\" width=\"160\" style=\"display:block; max-width:60%; height:auto; margin:0 auto;\" />
              </td>
            </tr>
            <tr>
              <td style=\"padding:8px 24px 0; text-align:center;\">
                <h1 style=\"font-size:18px; line-height:1.4; margin:0 0 8px; color:#111827;\">Gestion des DAOs 2SND</h1>
              </td>
            </tr>
            <tr>
              <td style=\"padding:8px 24px 24px;\">
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td style=\"padding:16px 24px; border-top:1px solid #e5e7eb; color:#6b7280; font-size:12px;\">
                Cet email a été envoyé automatiquement par la plateforme DAO.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function getTransport() {
  try {
    const disabled =
      String(process.env.SMTP_DISABLE || "false").toLowerCase() === "true";
    if (disabled) return null;

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 465);
    const secure =
      String(process.env.SMTP_SECURE || "true").toLowerCase() === "true";
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      lastTransportError = "Missing SMTP host/user/pass in environment";
      return null;
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 15000,
      socketTimeout: 20000,
      tls: { rejectUnauthorized: false },
    } as any);

    try {
      await transport.verify();
      lastTransportError = null;
    } catch (e) {
      // Conserver l'erreur mais continuer (cert/self-signed, etc.)
      lastTransportError = String((e as Error)?.message || e);
    }

    return transport;
  } catch (e) {
    lastTransportError = String((e as Error)?.message || e);
    logger.warn("SMTP transport unavailable", "MAIL", {
      message: String((e as Error)?.message),
    });
    return null;
  }
}

// Envoi centralisé : fonction principale (HTML avec logo centré ; repli sécurisé)
export async function sendEmail(
  to: string | string[],
  subject: string,
  body: string,
  type?: MailType,
): Promise<void> {
  const recipients = Array.from(new Set(toArray(to).filter(Boolean)));
  if (recipients.length === 0) return;

  // Sujet dynamique avec repli
  const smtpSubject = (subject && subject.trim()) || "Gestion des DAOs 2SND";
  const html = buildEmailHtml(smtpSubject, body || "");

  // Envoi sans limitation: pas de batch ni délai

  const transport = await getTransport();
  if (transport) {
    try {
      const fromAddress =
        process.env.SMTP_FROM ||
        process.env.SMTP_USER ||
        "no-reply@example.com";
      const from = `"Gestion des DAOs 2SND" <${fromAddress}>`;

      // Envoi unique avec BCC de tous les destinataires
      try {
        await transport.sendMail({
          from,
          to: fromAddress,
          bcc: recipients.join(", "),
          subject: smtpSubject,
          text: body || "",
          html,
        });
        emailEvents.unshift({
          ts: new Date().toISOString(),
          subject: smtpSubject,
          toCount: recipients.length,
          success: true,
        });
        if (emailEvents.length > 50) emailEvents.length = 50;
        return;
      } catch (e) {
        const err: any = e;
        const code = err?.responseCode || err?.code || "unknown";
        const msg = String((e as Error)?.message || e);
        lastTransportError = msg;
        logger.error("Échec envoi SMTP", "MAIL", {
          message: msg,
          code,
          batchSize: recipients.length,
        });
        emailEvents.unshift({
          ts: new Date().toISOString(),
          subject: smtpSubject,
          toCount: recipients.length,
          success: false,
          error: `${code}: ${msg}`,
        });
        if (emailEvents.length > 50) emailEvents.length = 50;
      }
    } catch (e) {
      const err: any = e;
      const code = err?.responseCode || err?.code || "unknown";
      const msg = String((e as Error)?.message || e);
      lastTransportError = msg;
      logger.error("Échec envoi SMTP; mode log uniquement", "MAIL", {
        message: msg,
        code,
      });
      emailEvents.unshift({
        ts: new Date().toISOString(),
        subject: smtpSubject,
        toCount: recipients.length,
        success: false,
        error: `${code}: ${msg}`,
      });
      if (emailEvents.length > 50) emailEvents.length = 50;
    }
  } else {
    emailEvents.unshift({
      ts: new Date().toISOString(),
      subject: smtpSubject,
      toCount: recipients.length,
      success: false,
      error: lastTransportError || "No transport",
    });
    if (emailEvents.length > 50) emailEvents.length = 50;
  }

  const preview = (body || "").slice(0, 120).replace(/\s+/g, " ");
  logger.info(
    `Email d��sactivé (ignoré) | sujet: ${smtpSubject} | corps: ${preview}`,
    "MAIL",
  );
  if (type) logger.info(`Type d'email: ${type}`, "MAIL");
}

async function getAllUserEmails(): Promise<string[]> {
  try {
    const users = await AuthService.getAllUsers();
    return users.map((u) => u.email).filter(Boolean);
  } catch {
    return [];
  }
}

function frDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function teamLine(dao: Dao): { chef: string; membres: string } {
  const chef = dao.equipe.find((m) => m.role === "chef_equipe");
  const membres = dao.equipe.filter((m) => m.role !== "chef_equipe");
  const chefStr = chef ? chef.name : "Non défini";
  const membersStr = membres.map((m) => m.name).join(", ") || "Aucun";
  return { chef: chefStr, membres: membersStr };
}

export function computeDaoProgress(dao: Dao): number {
  const applicable = (dao.tasks || []).filter((t) => t.isApplicable);
  if (applicable.length === 0) return 0;
  const sum = applicable.reduce((acc, t) => acc + (t.progress ?? 0), 0);
  return Math.round(sum / applicable.length);
}

export const Templates = {
  user: {
    created(params: { name: string; email: string; password: string }) {
      const subject = "Votre compte a été créé sur la plateforme DAO";
      const body = [
        `Bonjour ${params.name},`,
        `Votre compte a été créé avec succès sur la plateforme DAO.`,
        `Identifiant : ${params.email}`,
        `Mot de passe : ${params.password}`,
        `Merci de vous connecter et de modifier votre mot de passe dès votre première connexion.`,
      ].join("\n\n");
      return { subject, body };
    },
    deletedUser(params: { name: string }) {
      const subject = "Suppression de votre compte";
      const body = [
        `Bonjour ${params.name},`,
        `Votre compte a été supprimé de la plateforme DAO.`,
      ].join("\n\n");
      return { subject, body };
    },
    deletedAdmin(params: { name: string; email: string }) {
      const subject = "Suppression d’un utilisateur";
      const body = [
        `Bonjour Admin,`,
        `L’utilisateur ${params.name} (${params.email}) a été supprimé.`,
      ].join("\n\n");
      return { subject, body };
    },
  },
  dao: {
    created(dao: Dao) {
      const subject = `Nouveau DAO créé - ${dao.objetDossier}`;
      const team = teamLine(dao);
      const body = [
        `Un nouveau DAO a été créé :`,
        `Nom : ${dao.objetDossier}`,
        `Référence : ${dao.reference}`,
        `Objet : ${dao.objetDossier}`,
        `Autorité contractante : ${dao.autoriteContractante}`,
        `Date de dépôt : ${frDate(dao.dateDepot)}`,
        `Chef d’équipe : ${team.chef}`,
        `Membres : ${team.membres}`,
      ].join("\n");
      return { subject, body };
    },
    updated(dao: Dao) {
      const subject = `Mise à jour DAO - ${dao.objetDossier}`;
      const team = teamLine(dao);
      const progress = computeDaoProgress(dao);
      const body = [
        `Le DAO ${dao.objetDossier} a été mis à jour :`,
        `Référence : ${dao.reference}`,
        `Objet : ${dao.objetDossier}`,
        `Autorité contractante : ${dao.autoriteContractante}`,
        `Date de dépôt : ${frDate(dao.dateDepot)}`,
        `Chef d’équipe : ${team.chef}`,
        `Membres : ${team.membres}`,
        `Niveau de progression : ${progress}%`,
      ].join("\n");
      return { subject, body };
    },
  },
  task: {
    created(ctx: { dao: Dao; task: DaoTask }) {
      const subject = `Nouvelle tâche - ${ctx.dao.objetDossier}`;
      const body = [
        `DAO : ${ctx.dao.objetDossier} (${ctx.dao.reference})`,
        `Autorité contractante : ${ctx.dao.autoriteContractante}`,
        `Date de dépôt : ${frDate(ctx.dao.dateDepot)}`,
        ``,
        `Tâche : ${ctx.task.name}`,
        `Niveau de progression : ${ctx.task.progress ?? 0}%`,
        ``,
        `Action : Création`,
      ].join("\n");
      return { subject, body };
    },
    updated(ctx: {
      dao: Dao;
      previous: DaoTask;
      current: DaoTask;
      action?: string;
      oldApplicable?: boolean;
      newApplicable?: boolean;
      assignedToName?: string;
      comment?: string;
    }) {
      const subject = `Mise à jour d’une tâche - ${ctx.dao.objetDossier}`;
      const lines: string[] = [
        `DAO : ${ctx.dao.objetDossier} (${ctx.dao.reference})`,
        `Autorité contractante : ${ctx.dao.autoriteContractante}`,
        `Date de dépôt : ${frDate(ctx.dao.dateDepot)}`,
        ``,
        `Tâche : ${ctx.current.name}`,
        `Niveau de progression : ${ctx.current.progress ?? 0}%`,
        ``,
        `Action : ${ctx.action || "Mise à jour"}`,
      ];
      if (ctx.oldApplicable !== undefined && ctx.newApplicable !== undefined) {
        lines.push(
          `Ancien statut : ${ctx.oldApplicable ? "Applicable" : "Non applicable"}`,
        );
        lines.push(
          `Nouveau statut : ${ctx.newApplicable ? "Applicable" : "Non applicable"}`,
        );
      }
      if (ctx.assignedToName) lines.push(`Assignée à : ${ctx.assignedToName}`);
      if (ctx.comment) lines.push(`Commentaire : "${ctx.comment}"`);
      const body = lines.join("\n");
      return { subject, body };
    },
    commented(ctx: { dao: Dao; task: DaoTask; comment: string }) {
      const subject = `Nouveau commentaire sur une tâche - ${ctx.dao.objetDossier}`;
      const body = [
        `DAO : ${ctx.dao.objetDossier} (${ctx.dao.reference})`,
        `Tâche : ${ctx.task.name}`,
        `Progression : ${ctx.task.progress ?? 0}%`,
        ``,
        `Action : Nouveau commentaire ajouté`,
        `Commentaire : "${ctx.comment}"`,
      ].join("\n");
      return { subject, body };
    },
  },
};

export async function emailAllUsers(
  subject: string,
  body: string,
  type?: MailType,
) {
  const recipients = await getAllUserEmails();
  const admin = (process.env.ADMIN_EMAIL || "").trim();
  if (admin && !recipients.includes(admin)) recipients.push(admin);
  await sendEmail(recipients, subject, body, type);
}

// Diagnostics exposés
export function getEmailDiagnostics() {
  const cfg = {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || null,
    disabled:
      String(process.env.SMTP_DISABLE || "false").toLowerCase() === "true",
    lastTransportError,
  };
  return { config: cfg, recent: emailEvents.slice(0, 20) };
}

export async function emailAdmin(
  subject: string,
  body: string,
  type?: MailType,
) {
  const admin = process.env.ADMIN_EMAIL;
  if (admin) await sendEmail(admin, subject, body, type);
}
