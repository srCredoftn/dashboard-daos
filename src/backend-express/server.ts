#!/usr/bin/env tsx
/**
Rôle: Entrée/Bootstrap backend — src/backend-express/server.ts
Domaine: Backend/Core
Dépendances: ./index.js, ./utils/logger.js
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
*/
/**
 * Bootstrap serveur: instancie l'app Express et démarre l'écoute, logs, arrêt gracieux.
 */
import { createServer } from "./index.js";
import { logger } from "./utils/logger.js";

const app = createServer();
const PORT = Number(process.env.BACKEND_PORT || 3001);

app.listen(PORT, () => {
  logger.info(`🚀 Secure backend server running on port ${PORT}`, "SERVER");
  logger.info(`🔐 Security features enabled:`, "SERVER");
  logger.info(`  ✅ Password hashing with bcrypt`, "SERVER");
  logger.info(`  ✅ JWT tokens with expiration`, "SERVER");
  logger.info(`  ✅ Rate limiting`, "SERVER");
  logger.info(`  ✅ Input validation`, "SERVER");
  logger.info(`  ✅ CORS protection`, "SERVER");
  logger.info(`  ✅ Helmet security headers`, "SERVER");
  logger.info(`  ✅ Audit logging`, "SERVER");
  logger.info(
    `📡 API endpoints available at http://localhost:${PORT}/api/`,
    "SERVER",
  );
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("🔄 SIGTERM received, shutting down gracefully", "SERVER");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("🔄 SIGINT received, shutting down gracefully", "SERVER");
  process.exit(0);
});
