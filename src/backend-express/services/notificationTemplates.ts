/**
Rôle: Service métier côté serveur — src/backend-express/services/notificationTemplates.ts
Domaine: Backend/Services
Exports: formatDateFr, formatDateFrDateOnly, tplLoginSuccess, tplNewLogin, tplUserDeleted, tplDaoCreated, tplDaoUpdated, tplDaoDeleted
Dépendances: ./notificationService, @shared/dao
Liens: appels /api, utils de fetch, types @shared/*
*/
import { ServerNotification } from "./notificationService";

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDateFr(d: Date = new Date()): string {
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${day}/${month}/${year} - ${hours}h${minutes}`;
}

// Date seule (sans heure) pour notifications compactes
export function formatDateFrDateOnly(d: Date = new Date()): string {
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function tplLoginSuccess(params: {
  userName: string;
}): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const date = formatDateFr();
  return {
    type: "system",
    title: "Connexion réussie",
    message: `Utilisateur : ${params.userName}\nDate : ${date}`,
    data: { event: "login_success" },
  };
}

export function tplNewLogin(params: {
  userName: string;
}): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  return {
    type: "system",
    title: "Nouvelle Connexion",
    message: `Utilisateur : ${params.userName}\nVeuillez vous connecter pour changer votre mot de passe`,
    data: { event: "login_notice" },
  };
}

export function tplUserDeleted(params: {
  deletedUserName: string;
  actorName: string;
}): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const date = formatDateFr();
  return {
    type: "system",
    title: "Suppression d’un utilisateur",
    message: `Utilisateur supprimé : ${params.deletedUserName}\nAction effectuée par : ${params.actorName}\nDate : ${date}`,
    data: { event: "user_deleted" },
  };
}

// ===== DAO templates =====
import type { Dao } from "@shared/dao";

function teamForDao(dao: Dao): { chef: string; membres: string } {
  const chef = dao.equipe.find((m) => m.role === "chef_equipe");
  const membres = dao.equipe.filter((m) => m.role !== "chef_equipe");
  return {
    chef: chef ? chef.name : "Non défini",
    membres: membres.length ? membres.map((m) => m.name).join(", ") : "Aucun",
  };
}

function daoSummaryLines(dao: Dao, changed?: Set<string>): string[] {
  const t = teamForDao(dao);
  const suffix = (key: string): string => {
    switch (key) {
      case "reference":
      case "autoriteContractante":
      case "dateDepot":
        return " modifiée"; // feminine
      case "membres":
        return " modifiés"; // plural
      default:
        return " modifié"; // masculine/default
    }
  };
  const tag = (key: string, label: string) =>
    `${label}${changed?.has(key) ? suffix(key) : ""} :`;

  return [
    `${tag("numeroListe", "Numéro de liste")} ${dao.numeroListe}`,
    `${tag("reference", "Référence")} ${dao.reference}`,
    `${tag("objetDossier", "Objet du dossier")} ${dao.objetDossier}`,
    `${tag("autoriteContractante", "Autorité contractante")} ${dao.autoriteContractante}`,
    `${tag("chef", "Chef d’équipe")} ${t.chef}`,
    `${tag("membres", "Membres")} ${t.membres}`,
    `${tag("dateDepot", "Date de dépôt")} ${formatDateFrDateOnly(new Date(dao.dateDepot))}`,
  ];
}

export function tplDaoCreated(
  dao: Dao,
): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const lines = daoSummaryLines(dao);
  return {
    type: "dao_created",
    title: "Création d’un DAO",
    message: lines.join("\n"),
    data: { event: "dao_created", daoId: dao.id },
  };
}

export function tplDaoUpdated(
  after: Dao,
  changedKeys: Set<string>,
): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const lines = daoSummaryLines(after, changedKeys);
  return {
    type: "dao_updated",
    title: "Mise à jour d’un DAO",
    message: lines.join("\n"),
    data: {
      event: "dao_updated",
      daoId: after.id,
      changed: Array.from(changedKeys),
    },
  };
}

export function tplDaoDeleted(
  dao: Dao,
): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const lines = daoSummaryLines(dao);
  return {
    type: "dao_deleted",
    title: "Suppression DAO",
    message: lines.join("\n"),
    data: { event: "dao_deleted", daoId: dao.id },
  };
}

// Agrégation (validation)
export function tplDaoAggregatedUpdate(params: {
  dao: Dao;
  lines: string[];
}): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const { dao, lines } = params;
  const msg = lines.join("\n");
  return {
    type: "dao_updated",
    title: "Mise à jour DAO",
    message: msg,
    data: { event: "dao_aggregated_update", daoId: dao.id },
  };
}

export function tplLeaderChanged(params: {
  dao: Dao;
  oldLeader?: string | null;
  newLeader?: string | null;
}): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const { dao, oldLeader, newLeader } = params;
  const lines = [
    `Numéro de liste : ${dao.numeroListe}`,
    `Ancien Chef d'équipe : ${oldLeader || "Non défini"}`,
    `Nouveau Chef d'équipe : ${newLeader || "Non défini"}`,
  ];
  return {
    type: "role_update",
    title: "Changement de chef d'équipe",
    message: lines.join("\n"),
    data: { event: "leader_changed", daoId: dao.id },
  };
}

// ===== TASK templates =====
export function tplTaskNotification(params: {
  dao: Dao;
  previous?: any | null;
  current: any;
  changeType:
    | "progress"
    | "applicability"
    | "assignees"
    | "comment"
    | "general";
  added?: string[];
  removed?: string[];
  comment?: string;
}): Pick<ServerNotification, "type" | "title" | "message" | "data"> {
  const { dao, current, changeType, added, removed, comment } = params;

  const lines: string[] = [
    `Mise à jour d’une tâche`,
    `Numéro de liste : ${dao.numeroListe}`,
    `Autorité contractante : ${dao.autoriteContractante}`,
    `Date de dépôt : ${formatDateFrDateOnly(new Date(dao.dateDepot))}`,
    `Nom de la Tâche : ${current.name}`,
    `Numéro de la Tâche : ${current.id}`,
  ];

  if (typeof current.progress === "number") {
    const progLine =
      changeType === "progress"
        ? `Progression modifiée : ${current.progress}%`
        : `Progression : ${current.progress}%`;
    lines.push(progLine);
  }

  const appValue = current.isApplicable ? "Oui" : "Non";
  const appLine =
    changeType === "applicability"
      ? `Applicabilité modifiée : ${appValue}`
      : `Applicabilité : ${appValue}`;
  lines.push(appLine);

  if (changeType === "assignees") {
    const members = (current.assignedTo || []).map((id: string) => {
      return dao.equipe.find((m) => m.id === id)?.name || id;
    });
    lines.push(`Membres assignés modifiés: ${members.join(", ")}`);
  }

  if (comment && comment.trim()) {
    lines.push(`Commentaire : "${comment.trim()}"`);
  }

  return {
    type: "task_notification",
    title: "Mise à jour d’une tâche",
    message: lines.join("\n"),
    data: {
      event: "task_notification",
      daoId: dao.id,
      taskId: current.id,
      changeType,
      added: added || [],
      removed: removed || [],
    },
  };
}
