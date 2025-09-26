/**
Rôle: Configuration backend — src/backend-express/config/database.ts
Domaine: Backend/Config
Dépendances: mongoose, ../utils/logger.js
Performance: cache/partitionnement/bundling optimisés
*/
import mongoose, { type ConnectOptions } from "mongoose";
import { logger } from "../utils/logger.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/dao-management";

// Fail-fast options to avoid long startup delays when MongoDB isn't running locally
// In development we keep very small timeouts so we immediately fall back to in-memory storage
const isProduction = process.env.NODE_ENV === "production";
const FAST_FAIL = process.env.MONGODB_FAST_FAIL !== "0"; // default true
const connectOptions: ConnectOptions = {
  serverSelectionTimeoutMS: FAST_FAIL ? (isProduction ? 5000 : 800) : undefined,
  connectTimeoutMS: FAST_FAIL ? (isProduction ? 5000 : 800) : undefined,
  maxPoolSize: 5,
};

export async function connectToDatabase() {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI, connectOptions);
      logger.info("✅ Connected to MongoDB", "DATABASE");
    }
    return mongoose.connection;
  } catch (error) {
    logger.error("❌ MongoDB connection error", "DATABASE", error);
    throw error;
  }
}

export async function disconnectFromDatabase() {
  try {
    await mongoose.disconnect();
    logger.info("🔌 Disconnected from MongoDB", "DATABASE");
  } catch (error) {
    logger.error("❌ MongoDB disconnection error", "DATABASE", error);
    throw error;
  }
}

// Handle connection events
mongoose.connection.on("connected", () => {
  logger.info("🟢 Mongoose connected to MongoDB", "DATABASE");
});

mongoose.connection.on("error", (err) => {
  logger.error("🔴 Mongoose connection error", "DATABASE", err);
});

mongoose.connection.on("disconnected", () => {
  logger.info("🟡 Mongoose disconnected from MongoDB", "DATABASE");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await disconnectFromDatabase();
  process.exit(0);
});
