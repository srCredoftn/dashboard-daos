/**
Rôle: Types & contrats partagés — src/shared/api.ts
Domaine: Shared
Exports: DemoResponse, DaoHistoryEntry, DaoAggregatedSummary
Liens: importé par frontend et backend
*/
/**
 * Code partagé entre client et serveur.
 * Utile pour partager des types et/ou de petites fonctions JS
 * réutilisables côté client et serveur.
 */

/**
 * Type d'exemple pour la réponse /api/demo
 */
export interface DemoResponse {
  message: string;
}

/**
 * Types d'événements historisés pour un DAO
 */
export type DaoHistoryEventType =
  | "dao_created"
  | "dao_updated"
  | "dao_task_update"
  | "dao_team_update";

/**
 * Entrée d'historique des modifications de DAO (journal quotidien)
 */
export interface DaoHistoryEntry {
  id: string;
  daoId: string;
  numeroListe: string;
  createdAt: string; // ISO
  summary: string; // Titre + courte synthèse
  lines: string[]; // Lignes détaillées (affichage)
  eventType: DaoHistoryEventType;
}

/**
 * Résumé agrégé renvoyé lors d'une validation côté serveur
 */
export interface DaoAggregatedSummary {
  daoId: string;
  numeroListe: string;
  title: string; // "Mise à jour DAO" ou "Mise à jour d’une tâche"
  message: string; // corps prêt pour notification/email
  lines: string[]; // lignes utilisées pour le message
  createdAt: string; // ISO
  kind?: "tasks" | "dao"; // nature des changements agrégés
}
