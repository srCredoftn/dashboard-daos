#!/usr/bin/env node
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";

function ensureDir(file) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function genSecret(bytes = 48) {
  return randomBytes(bytes).toString("hex");
}

function writeEnv(filePath, lines) {
  ensureDir(filePath);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, lines.join("\n") + "\n", { encoding: "utf8" });
    console.log(`✅ Created ${filePath}`);
  } else {
    console.log(`ℹ️  Skipped, exists: ${filePath}`);
  }
}

const rootEnv = join(process.cwd(), ".env");

const jwt1 = genSecret();

writeEnv(rootEnv, [
  `PORT=3001`,
  `FRONTEND_URL=http://localhost:8080`,
  `PING_MESSAGE=pong - secure`,
  `MONGODB_URI=mongodb://localhost:27017/dao-management`,
  `JWT_SECRET=${jwt1}`,
  `JWT_EXPIRES_IN=24h`,
  `FORCE_DB_ONLY=1`,
  `MONGODB_FAST_FAIL=1`,
  `SEED_DAOS=false`,
  `SEED_USERS=false`,
  `ADMIN_EMAIL=admin@exemple.com`,
  `ADMIN_PASSWORD=superpass`,
  `TOKEN_BOOT_ID=${genSecret(12)}`,
]);
