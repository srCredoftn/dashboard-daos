/**
Rôle: Utilitaires Backend — src/backend-express/utils/devLog.ts
Domaine: Backend/Utils
Exports: devLog, authLog, apiLog
Dépendances: ./logger
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
*/
/**
 * Utility for development-only logging
 * Only logs in development/test environments
 */

import { logger } from "./logger";

const isDevelopment =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

export const devLog = {
  info: (message: string, data?: any) => {
    if (isDevelopment) logger.info(message, "DEV", data);
  },
  warn: (message: string, data?: any) => {
    if (isDevelopment) logger.warn(message, "DEV", data);
  },
  error: (message: string, data?: any) => {
    if (isDevelopment) logger.error(message, "DEV", data);
  },
  debug: (message: string, data?: any) => {
    if (isDevelopment) logger.debug?.(message as any, "DEV", data as any);
  },
};

// Specific logging functions for common patterns (generic, no PII)
export const authLog = {
  login: (_email: string, success: boolean = true) => {
    if (isDevelopment)
      logger.audit(`Login ${success ? "success" : "failure"}`, undefined);
  },
  logout: (_email: string) => {
    if (isDevelopment) logger.audit("User logout", undefined);
  },
  tokenVerification: (_email: string, success: boolean = true) => {
    if (isDevelopment)
      logger.audit(
        `Token verification ${success ? "success" : "failure"}`,
        undefined,
      );
  },
};

export const apiLog = {
  request: (method: string, path: string, _userId?: string) => {
    if (isDevelopment) logger.api(`${method} ${path}`);
  },
  response: (
    method: string,
    path: string,
    status: number,
    duration?: number,
  ) => {
    if (isDevelopment)
      logger.info(
        `${method} ${path} - ${status}${duration ? ` (${duration}ms)` : ""}`,
        "HTTP",
      );
  },
};
