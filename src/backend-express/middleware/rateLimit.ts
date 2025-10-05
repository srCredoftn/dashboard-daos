import type { Request, Response, NextFunction, RequestHandler } from "express";

// Désactivation globale des limites de débit: middleware no-op
export function sensitiveOperationLimit(
  _options: unknown = {},
): RequestHandler {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}
