/**
Rôle: Entrée/Bootstrap backend — src/backend-express/index.ts
Domaine: Backend/Core
Exports: createServer
Dépendances: express, cors, helmet, express-rate-limit, ./utils/logger, ./utils/rate-limit-debug, ./routes/demo, ./routes/dao-simple
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
Performance: cache/partitionnement/bundling optimisés
*/
/**
 * Express app: sécurité (helmet, rate-limit, CORS), routes API, boot/reset, logs, gestion d'erreurs.
 * Utilisé par server.ts pour démarrer le backend.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { logger, requestLogger } from "./utils/logger";
import { RateLimitDebugger } from "./utils/rate-limit-debug";
import { handleDemo } from "./routes/demo";
import daoRoutes from "./routes/dao-simple";
import authRoutes from "./routes/auth";
import commentRoutes from "./routes/comments";
import taskRoutes from "./routes/tasks";
import createAdminRoutes from "./routes/admin";
import notificationsRoutes from "./routes/notifications";

export function createServer(): express.Application {
  const app = express();

  // Optional DB connectivity assertion depending on runtime flags
  (async () => {
    try {
      const { assertDbConnectivityIfRequired } = await import(
        "./config/runtime"
      );
      await assertDbConnectivityIfRequired();
    } catch (e) {
      logger.error("Startup DB check failed", "SERVER");
      if (
        (process.env.STRICT_DB_MODE || "false").toLowerCase() === "true" &&
        (process.env.FALLBACK_ON_DB_ERROR || "true").toLowerCase() !== "true"
      ) {
        setTimeout(() => process.exit(1), 10);
      }
    }
  })();

  // Runtime boot id (can be rotated without restarting)
  let runtimeBootId = process.env.TOKEN_BOOT_ID || `dev-${Date.now()}`;
  function setRuntimeBootId(id: string) {
    runtimeBootId = id;
    return runtimeBootId;
  }

  // Trust proxy for rate limiting in development
  app.set("trust proxy", 1);

  // Security middleware
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false, // Allow embedding for development
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
        },
      },
    }),
  );

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === "production" ? 100 : 1000, // More permissive in development
    message: {
      error: "Too many requests from this IP, please try again later.",
      retryAfter: "15 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Auth-specific rate limiting (adaptatif selon l'environnement)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === "production" ? 20 : 100, // Plus permissif en développement
    message: {
      error: "Too many authentication attempts, please try again later.",
      retryAfter: "15 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting pour certains cas en développement
    skip: (_req) => {
      if (process.env.NODE_ENV === "development") {
        // Plus de flexibilité en dev, mais garde une protection minimale
        return false;
      }
      return false;
    },
  });

  // CORS configuration - restrictive in production, permissive in development (allows builder preview origin)
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      // Allow non-browser tools or same-origin (no origin)
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV === "production") {
        const allowed = process.env.FRONTEND_URL;
        return callback(null, origin === allowed);
      }
      // In development, allow any origin (useful for preview environments)
      return callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };
  app.use(cors(corsOptions));

  // Body parsing middleware with size limits
  app.use(
    express.json({
      limit: "10mb",
      verify: (_req, _res, buf, encoding) => {
        // Basic JSON structure validation
        if (buf && buf.length) {
          try {
            JSON.parse(buf.toString((encoding as BufferEncoding) || "utf8"));
          } catch (err) {
            // Créer une erreur HTTP typee au lieu d'utiliser any
            interface HttpError extends Error {
              status: number;
            }
            const error = new Error("Invalid JSON") as HttpError;
            error.status = 400;
            throw error;
          }
        }
      },
    }),
  );

  // Expose current bootId to clients via header on all responses so
  // frontend can auto-purge stale local storage without manual steps
  app.use((_req, res, next) => {
    try {
      res.setHeader("X-Boot-Id", runtimeBootId);
    } catch (_) {}
    next();
  });
  app.use(
    express.urlencoded({
      extended: true,
      limit: "10mb",
    }),
  );

  // Security headers
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    next();
  });

  // Request logging avec le nouveau système
  app.use(requestLogger());

  // Retry helper middleware (attach req.retry) - load lazily without blocking startup
  import("./middleware/retry")
    .then(({ retryMiddleware }) => {
      app.use(retryMiddleware(3, 200));
    })
    .catch(() => {});

  // Debug rate limiting en développement
  if (process.env.NODE_ENV === "development") {
    app.use(RateLimitDebugger.autoLog());
    app.get("/api/debug/rate-limits", RateLimitDebugger.getDebugRoute());
  }

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
    });
  });

  // Boot info endpoint used by frontend to invalidate stale local storage between deployments
  app.get("/api/boot", (_req, res) => {
    const shouldSeed =
      process.env.SEED_DAOS === "1" || process.env.SEED_DAOS === "true";
    res.json({
      bootId: runtimeBootId,
      seedDaos: shouldSeed,
      serverTime: new Date().toISOString(),
    });
  });

  // Perform a safe runtime reset ONLY when TRIGGER_RESET is explicitly enabled
  // This attempts to clear DB-backed DAOs first, falling back to in-memory storage.
  const shouldRuntimeReset =
    process.env.TRIGGER_RESET === "1" || process.env.TRIGGER_RESET === "true";
  if (shouldRuntimeReset) {
    (async () => {
      try {
        logger.info("Runtime reset requested", "BOOT");
        const { AuthService } = await import("./services/authService");

        // Try clearing persistent storage (DB) first
        try {
          const { DaoService } = await import("./services/daoService");
          await DaoService.clearAll();
          logger.info("DAOs cleared", "BOOT");
        } catch (dbErr) {
          // Fallback to clearing in-memory storage
          try {
            const { daoStorage } = await import("./data/daoStorage");
            daoStorage.clearAll(false);
            logger.info("DAOs cleared (in-memory fallback)", "BOOT");
          } catch (fallbackErr) {
            logger.error("Failed to clear DAOs", "BOOT", {
              message: String((fallbackErr as Error)?.message),
            });
          }
        }

        // Clear sessions and reinitialize users per environment
        await AuthService.clearAllSessions();
        await AuthService.reinitializeUsers();

        // Rotate runtime boot id to force frontend clients to purge local storage
        const newBoot = `boot_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        setRuntimeBootId(newBoot);
        logger.info("BootId rotated", "BOOT");

        logger.info("Runtime reset complete", "BOOT");
      } catch (err) {
        logger.error("Runtime reset failed", "BOOT", {
          message: String((err as Error)?.message),
        });
      }
    })();
  } else {
    logger.info("Runtime reset skipped", "BOOT");
  }

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "pong - secure";
    res.json({ message: ping, timestamp: new Date().toISOString() });
  });

  app.get("/api/demo", handleDemo);

  // Apply auth rate limiting to auth routes
  app.use("/api/auth", authLimiter);

  // API routes
  app.use("/api/dao", daoRoutes);
  app.use("/api/dao", taskRoutes); // Task routes are nested under /api/dao
  app.use("/api/auth", authRoutes);
  app.use("/api/comments", commentRoutes);
  app.use("/api/notifications", notificationsRoutes);

  // Admin routes (runtime reset without restart)
  try {
    const adminRouter = createAdminRoutes(setRuntimeBootId);
    app.use("/api/admin", adminRouter);
  } catch (e) {
    console.warn("Admin routes failed to register:", e);
  }

  // 404 handler
  app.use("*", (req, res) => {
    res.status(404).json({
      error: "Route not found",
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  });

  // Global error handler
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error(
        "Unhandled error",
        "ERROR_HANDLER",
        {
          message: String(err?.message || err),
          url: req.originalUrl,
          method: req.method,
        },
        (req as any).user?.id,
        req.ip,
      );

      const status = Number(err?.status) || 500;
      const generic = status >= 500;
      res.status(status).json({
        error: generic
          ? "Internal Server Error"
          : String(err?.message || "Error"),
        timestamp: new Date().toISOString(),
      });
    },
  );

  return app;
}
