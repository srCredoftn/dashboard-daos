import type { Request, Response } from "express";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";

interface SensitiveLimitOptions {
  windowMs?: number;
  max?: number; // backward compat alias (will map to limit)
  limit?: number;
  message?: string;
}

/**
 * Rate limiter for sensitive operations (e.g., create DAO)
 * - Keys by IP + user when available
 * - Sends JSON 429 responses
 */
export function sensitiveOperationLimit(options: SensitiveLimitOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? 60_000; // 1 minute
  const limit = (options.limit ?? options.max) ?? 5; // 5 requests/minute by default
  const message = options.message ?? "Trop de tentatives, réessayez plus tard";

  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
      const userId = req?.user?.id ? String(req.user.id) : "anon";
      return `${req.ip}:${userId}`;
    },
    handler: (_req: Request, res: Response) => {
      const retryAfter = res.getHeader("Retry-After");
      res.status(429).json({
        error: message,
        code: "RATE_LIMITED",
        retryAfter,
      });
    },
  });

  return limiter as unknown as RequestHandler;
}
