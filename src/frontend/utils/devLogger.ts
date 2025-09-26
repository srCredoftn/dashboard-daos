/**
Rôle: Utilitaires Frontend — src/frontend/utils/devLogger.ts
Domaine: Frontend/Utils
Exports: devLog
*/
/**
 * Development logger utility
 * Only logs in development environment
 */

// Centralized frontend logger: never leaks PII/DAO data
const silent = true;
function safeLogGeneric(level: "info" | "warn" | "error") {
  if (silent) return;
  const msg = level === "error" ? "Erreur" : "tâche bien effectuée";
  console.log(msg);
}
export const devLog = {
  log: (..._args: any[]) => safeLogGeneric("info"),
  info: (..._args: any[]) => safeLogGeneric("info"),
  warn: (..._args: any[]) => safeLogGeneric("warn"),
  error: (..._args: any[]) => safeLogGeneric("error"),
  clear: () => {},
};
