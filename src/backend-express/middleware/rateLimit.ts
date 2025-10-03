import type { Request, Response } from "express";
import type { RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

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
export function sensitiveOperationLimit(
  options: SensitiveLimitOptions = {},
): RequestHandler {
  // Env-configurable toggle and values
  const enabledEnv = (
    process.env.SENSITIVE_LIMIT_ENABLED ??
    process.env.SENSITIVE_OPS_RATE_LIMIT_ENABLED ??
    "false"
  ).toLowerCase();
  const enabled = enabledEnv === "true" || enabledEnv === "1";

  const windowMs = Number(
    process.env.SENSITIVE_LIMIT_WINDOW_MS ?? options.windowMs ?? 60_000,
  );
  const limit = Number(
    process.env.SENSITIVE_LIMIT_MAX ?? options.limit ?? options.max ?? 0,
  ); // default 0 => disabled
  const message = options.message ?? "Trop de tentatives, réessayez plus tard";

  // No-op when disabled or non-positive limits
  if (
    !enabled ||
    !isFinite(windowMs) ||
    windowMs <= 0 ||
    !isFinite(limit) ||
    limit <= 0
  ) {
    return (_req: Request, _res: Response, next) => next();
  }

  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
      const base = ipKeyGenerator(req as any);
      const userId = req?.user?.id ? String(req.user.id) : "anon";
      return `${base}:${userId}`;
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
