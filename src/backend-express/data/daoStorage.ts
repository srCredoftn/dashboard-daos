/**
Rôle: Entrée/Bootstrap backend — src/backend-express/data/daoStorage.ts
Domaine: Backend/Core
Exports: daoStorage
Dépendances: @shared/dao, ./mockDaos, ../utils/logger
Performance: cache/partitionnement/bundling optimisés
*/
import type { Dao } from "@shared/dao";
import { serverMockDaos } from "./mockDaos";
import { logger } from "../utils/logger";

// Decide whether to seed demo data (opt-in). Default: no seed for clean first run.
const SHOULD_SEED =
  process.env.SEED_DAOS === "1" || process.env.SEED_DAOS === "true";

// Shared in-memory storage for DAOs with optimized indexing
// In production, this would be replaced with a database service
class DaoStorage {
  // Start with an empty storage to guarantee a "clean" project state by default
  private storage: Dao[] = [];
  private idIndex: Map<string, number> = new Map();
  private autoriteIndex: Map<string, Dao[]> = new Map();

  constructor() {
    logger.info("Initializing DAO storage", "DAO_STORAGE");

    // Always initialize empty unless explicitly seeded later via clearAll(true)
    this.storage = [];
    this.idIndex.clear();
    this.autoriteIndex.clear();

    this.rebuildIndexes(true);

    // Immediate integrity check
    this.verifyIntegrity();

    logger.info("DAO storage ready", "DAO_STORAGE");
  }

  // Rebuild all indexes
  private rebuildIndexes(verbose = false): void {
    this.idIndex.clear();
    this.autoriteIndex.clear();

    this.storage.forEach((dao, index) => {
      // Index by ID
      this.idIndex.set(dao.id, index);

      // Index by autorite contractante
      const autorite = dao.autoriteContractante;
      if (!this.autoriteIndex.has(autorite)) {
        this.autoriteIndex.set(autorite, []);
      }
      this.autoriteIndex.get(autorite)!.push(dao);
    });

    if (verbose) {
      logger.info("DAO indexes rebuilt", "DAO_STORAGE", {
        count: this.storage.length,
      });
    }
  }

  // Get all DAOs (return a copy to avoid external mutations)
  getAll(): Dao[] {
    return [...this.storage];
  }

  // Find DAO by ID (optimized with index)
  findById(id: string): Dao | undefined {
    const index = this.idIndex.get(id);
    return index !== undefined ? this.storage[index] : undefined;
  }

  // Find DAO index by ID (optimized with index)
  findIndexById(id: string): number {
    return this.idIndex.get(id) ?? -1;
  }

  // Add new DAO
  add(dao: Dao): void {
    this.storage.push(dao);
    this.rebuildIndexes(true); // Rebuild indexes after adding
  }

  // Update DAO at index (with safe indexing)
  updateAtIndex(index: number, dao: Dao): void {
    if (index >= 0 && index < this.storage.length) {
      this.storage[index] = dao;
      // Toujours reconstruire les indexes pour éviter toute corruption
      this.rebuildIndexes(true);
      logger.info("DAO updated (indexes rebuilt)", "DAO_STORAGE");
    }
  }

  // Delete DAO by ID
  deleteById(id: string): boolean {
    const index = this.findIndexById(id);
    if (index !== -1) {
      this.storage.splice(index, 1);
      this.rebuildIndexes(true); // Rebuild indexes after deleting
      return true;
    }
    return false;
  }

  // Find DAOs by autorite contractante (optimized with index)
  findByAutorite(autorite: string): Dao[] {
    return this.autoriteIndex.get(autorite) || [];
  }

  // Filter DAOs by condition
  filter(predicate: (dao: Dao) => boolean): Dao[] {
    return this.storage.filter(predicate);
  }

  // Get storage size
  size(): number {
    return this.storage.length;
  }

  // Verify data integrity and fix any issues
  verifyIntegrity(): boolean {
    logger.info("Verifying DAO storage integrity", "DAO_STORAGE");

    // Check for duplicate IDs
    const idCounts = new Map<string, number>();
    for (const dao of this.storage) {
      const count = idCounts.get(dao.id) || 0;
      idCounts.set(dao.id, count + 1);
    }

    let hasIssues = false;
    for (const [_id, count] of idCounts) {
      if (count > 1) {
        logger.warn("Duplicate DAO ID detected", "DAO_STORAGE");
        hasIssues = true;
      }
    }

    // Check index consistency
    for (const [id, expectedIndex] of this.idIndex) {
      const actualDao = this.storage[expectedIndex];
      if (!actualDao || actualDao.id !== id) {
        logger.warn("Index inconsistency detected", "DAO_STORAGE");
        hasIssues = true;
      }
    }

    // Display current state
    logger.info("DAO storage state checked", "DAO_STORAGE", {
      size: this.storage.length,
    });

    if (hasIssues) {
      logger.info("Rebuilding indexes to fix issues", "DAO_STORAGE");
      this.rebuildIndexes(true);
    } else {
      logger.info("DAO storage integrity verified", "DAO_STORAGE");
    }

    return !hasIssues;
  }

  // Clear all stored DAOs (optionally seed with demo data)
  clearAll(seed = false): void {
    this.storage = seed && SHOULD_SEED ? [...serverMockDaos] : [];
    this.rebuildIndexes(true);
    this.verifyIntegrity();
    logger.info("DAO storage cleared", "DAO_STORAGE", { seeded: !!seed });
  }
}

// Export singleton instance
export const daoStorage = new DaoStorage();
