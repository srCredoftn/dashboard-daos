import { connectToDatabase } from "./database";

export type StorageConfig = {
  useMongo: boolean;
  strictDbMode: boolean; // if true and useMongo=true, fail fast on DB error
  fallbackOnDbError: boolean; // if true and useMongo=true, fallback to memory when DB fails
};

export function getStorageConfig(): StorageConfig {
  const useMongo = (process.env.USE_MONGO || "false").toLowerCase() === "true";
  const strictDbMode = (process.env.STRICT_DB_MODE || "false").toLowerCase() === "true";
  const fallbackOnDbError = (process.env.FALLBACK_ON_DB_ERROR || "true").toLowerCase() === "true";
  return { useMongo, strictDbMode, fallbackOnDbError };
}

export async function assertDbConnectivityIfRequired(): Promise<void> {
  const cfg = getStorageConfig();
  if (!cfg.useMongo) return; // memory mode, nothing to check

  try {
    await connectToDatabase();
  } catch (e) {
    if (cfg.strictDbMode && !cfg.fallbackOnDbError) {
      // Fail hard at startup
      throw new Error(
        `STRICT_DB_MODE=true and USE_MONGO=true but MongoDB is unreachable. Error: ${String(
          (e as Error).message,
        )}`,
      );
    }
    // else: allow runtime fallback by services
    console.warn(
      `⚠️ MongoDB unreachable at startup. Fallback may be used during runtime (FALLBACK_ON_DB_ERROR=${cfg.fallbackOnDbError}).`,
    );
  }
}
