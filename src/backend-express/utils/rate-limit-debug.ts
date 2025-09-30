/**
Rôle: Utilitaires Backend — src/backend-express/utils/rate-limit-debug.ts
Domaine: Backend/Utils
Exports: RateLimitDebugger
Dépendances: express, ./logger
*/
// Utilitaire pour diagnostiquer et déboguer les problèmes de rate limiting

import type { Request, Response } from "express";
import { logger } from "./logger";

// Interface pour tracker les rate limits
interface RateLimitInfo {
  ip: string;
  userId?: string;
  endpoint: string;
  attempts: number;
  resetTime: Date;
  remaining: number;
}

// Store global pour traquer les rate limits en développement
const rateLimitTracker = new Map<string, RateLimitInfo>();

export class RateLimitDebugger {
  // Middleware pour tracker les rate limits
  static trackRateLimit() {
    return (req: Request, res: Response, next: Function) => {
      if (process.env.NODE_ENV === "development") {
        const key = `${String(req.ip)}:${req.originalUrl}`;
        const rateLimitHeaders = {
          limit: res.get("X-RateLimit-Limit"),
          remaining: res.get("X-RateLimit-Remaining"),
          reset: res.get("X-RateLimit-Reset"),
        };

        if (rateLimitHeaders.limit) {
          rateLimitTracker.set(key, {
            ip: String(req.ip),
            userId: (req as any).user?.id,
            endpoint: req.originalUrl,
            attempts:
              parseInt(rateLimitHeaders.limit) -
              parseInt(rateLimitHeaders.remaining || "0"),
            resetTime: new Date(parseInt(rateLimitHeaders.reset || "0") * 1000),
            remaining: parseInt(rateLimitHeaders.remaining || "0"),
          });
        }
      }
      next();
    };
  }

  // Obtenir les informations de rate limiting pour une IP
  static getRateLimitInfo(ip: string): RateLimitInfo[] {
    return Array.from(rateLimitTracker.values()).filter(
      (info) => info.ip === ip,
    );
  }

  // Obtenir toutes les informations de rate limiting
  static getAllRateLimitInfo(): RateLimitInfo[] {
    return Array.from(rateLimitTracker.values());
  }

  // Vérifier si une IP est proche de la limite
  static isNearLimit(ip: string, threshold: number = 0.8): boolean {
    const infos = this.getRateLimitInfo(ip);
    return infos.some(
      (info) => info.remaining / (info.attempts + info.remaining) < threshold,
    );
  }

  // Logger pour diagnostiquer les problèmes de rate limiting
  static logRateLimitStatus(_req: Request, res: Response) {
    if (res.statusCode === 429) {
      logger.warn("Limite de requêtes dépassée", "RATE_LIMIT");
    }
  }

  // Middleware pour logger automatiquement les rate limits
  static autoLog() {
    return (req: Request, res: Response, next: Function) => {
      const originalSend = res.send;

      res.send = function (body) {
        RateLimitDebugger.logRateLimitStatus(req, res);
        return originalSend.call(this, body);
      };

      next();
    };
  }

  // Nettoyer les anciens enregistrements
  static cleanup() {
    const now = Date.now();
    for (const [key, info] of rateLimitTracker.entries()) {
      if (info.resetTime.getTime() < now) {
        rateLimitTracker.delete(key);
      }
    }
  }

  // Route de débogage pour voir l'état du rate limiting
  static getDebugRoute() {
    return (req: Request, res: Response) => {
      if (process.env.NODE_ENV !== "development") {
        res
          .status(404)
          .json({
            error: "Routes de débogage disponibles uniquement en développement",
          });
        return;
      }

      // Nettoyer les anciens enregistrements
      this.cleanup();

      const allInfo = this.getAllRateLimitInfo();
      const userIP = String(req.ip);
      const userInfo = this.getRateLimitInfo(userIP);

      res.json({
        currentIP: userIP,
        isNearLimit: this.isNearLimit(userIP),
        userRateLimits: userInfo,
        allRateLimits: allInfo,
        timestamp: new Date().toISOString(),
        tips: [
          "Les limites sont réinitialisées automatiquement après la fenêtre de temps",
          "En développement, les limites sont plus permissives",
          "Consultez les en-têtes X-RateLimit-* pour plus de détails",
        ],
      });
    };
  }

  // Utilitaire pour créer une exception temporaire
  static createBypass(_ip: string, _durationMs: number = 60000) {
    if (process.env.NODE_ENV === "development") {
      logger.info(
        "Contournement temporaire de la limite de requêtes créé",
        "RATE_LIMIT",
      );
      return true;
    }
    return false;
  }
}

// Nettoyer périodiquement les anciens enregistrements
if (process.env.NODE_ENV === "development") {
  setInterval(() => {
    RateLimitDebugger.cleanup();
  }, 60000); // Toutes les minutes
}
