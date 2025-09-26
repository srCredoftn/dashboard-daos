/**
Rôle: Service HTTP/Client — src/frontend/services/api.ts
Domaine: Frontend/Services
Exports: apiService
Dépendances: @shared/dao, ./cacheService
Liens: appels /api, utils de fetch, types @shared/*
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
Performance: cache/partitionnement/bundling optimisés
*/
/**
 * apiService: couche HTTP générique pour les appels /api.
 * Gère Authorization, idempotency, erreurs réseau, 401→refresh/redirect, cache invalidations.
 */
import type { Dao } from "@shared/dao";
import { cacheService } from "./cacheService";

const API_BASE_URL = "/api";

class ApiService {
  // Requête générique: ajoute headers (token, idempotency), gère erreurs et refresh
  private async request<T>(endpoint: string, options?: any): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    // Récupère le token (stocké par onglet)
    const { getToken } = await import("@/utils/auth-storage");
    const token = getToken();

    // Base headers JSON
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Fusionner d'éventuels headers fournis par l'appelant
    if (options?.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([key, value]: [string, string]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }

    // Idempotency facultatif pour éviter doublons côté serveur
    if (options?.idempotencyKey) {
      headers["x-idempotency-key"] = options.idempotencyKey;
      delete options.idempotencyKey; // ne pas transmettre au fetch brut
    }

    // Authorization si token dispo
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const secureFetch = (await import("@/utils/secure-fetch")).default;
      let response: Response | null = null;

      try {
        // Chemin privilégié: secureFetch + native fetch + retries + timeout
        response = await secureFetch.fetch(url, {
          ...options,
          headers,
          useNativeFetch: true,
          maxRetries: 2,
          timeout: 15000,
        } as any);
      } catch (secureErr) {
        // Fallback: fetch natif en cas d'échec du wrapper sécurité
        console.warn(
          "secure-fetch failed, falling back to native fetch:",
          secureErr,
        );
        response = await fetch(url, { ...(options || {}), headers });
      }

      // Gestion des statuts non-ok
      if (!response.ok) {
        // 401: tenter un refresh une fois puis rediriger login si échec
        if (response.status === 401) {
          try {
            const { authService } = await import("./authService");
            const ok = await (authService as any).refreshAccessToken?.();
            if (ok) {
              return this.request<T>(endpoint, options);
            }
          } catch {}
          localStorage.removeItem("auth_token");
          localStorage.removeItem("auth_user");
          if (!window.location.pathname.includes("/login")) {
            window.location.href = "/login";
          }
          throw new Error("Session expirée. Veuillez vous reconnecter.");
        }

        // Autres erreurs: tenter d'extraire un message JSON sinon generique
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`,
        );
      }

      // Succès: renvoyer JSON
      return await response.json();
    } catch (error) {
      // Uniformiser les erreurs réseau
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("Failed to fetch") ||
        msg.includes("Network request failed") ||
        msg.includes("SecureFetchError") ||
        msg.toLowerCase().includes("timeout") ||
        msg.toLowerCase().includes("abort")
      ) {
        throw new Error(
          "Erreur de connexion. Vérifiez votre connexion internet.",
        );
      }

      // Eviter le bruit pour not-found connus (géré côté appelant)
      const lower = msg.toLowerCase();
      if (lower.includes("dao not found") || lower.includes("404")) {
        try {
          const { devLog } = await import("@/utils/devLogger");
          devLog.warn(`API ${endpoint} returned not-found: ${msg}`);
        } catch {
          console.warn(`API ${endpoint} returned not-found: ${msg}`);
        }
        throw new Error(msg);
      }

      console.error(`API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  // DAO operations — listage avec normalisation + cache en prod
  async getAllDaos(): Promise<Dao[]> {
    // Fonction de fetch + normalisation des diverses formes possibles
    const fetchAndNormalize = async (): Promise<Dao[]> => {
      const res: any = await this.request<any>("/dao");
      if (Array.isArray(res)) return res; // réponse brute
      if (res && Array.isArray(res.items)) return res.items; // paginé
      if (res && Array.isArray(res.data)) return res.data; // data: []
      return [];
    };

    if (process.env.NODE_ENV !== "production") {
      const daos = await fetchAndNormalize();
      try {
        cacheService.delete("all-daos"); // éviter faux positifs en dev
      } catch {}
      return daos;
    }

    // En prod, mise en cache courte pour soulager le backend
    return cacheService.getOrSet("all-daos", fetchAndNormalize, 2 * 60 * 1000);
  }

  async getDaoById(id: string): Promise<Dao> {
    return cacheService.getOrSet(
      `dao-${id}`,
      async () => {
        const result = await this.request<Dao>(`/dao/${id}`);
        return result;
      },
      3 * 60 * 1000,
    );
  }

  async createDao(
    daoData: Omit<Dao, "id" | "createdAt" | "updatedAt">,
    opts?: { idempotencyKey?: string },
  ): Promise<Dao> {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey)
      headers["x-idempotency-key"] = opts.idempotencyKey;
    const result = await this.request<Dao>("/dao", {
      method: "POST",
      body: JSON.stringify(daoData),
      headers,
    });

    // Invalidation cache liste après création
    cacheService.delete("all-daos");

    return result;
  }

  async updateDao(
    id: string,
    updates: Partial<Dao>,
    skipCacheInvalidation = false,
  ): Promise<Dao> {
    const result = await this.request<Dao>(`/dao/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });

    if (!skipCacheInvalidation) {
      // Cas généraux: invalider les caches
      cacheService.delete("all-daos");
      cacheService.delete(`dao-${id}`);
    } else {
      // Mises à jour fréquentes: on réécrit le cache ponctuellement
      cacheService.set(`dao-${id}`, result, 3 * 60 * 1000);
    }

    return result;
  }

  async deleteDao(id: string): Promise<void> {
    const result = await this.request<void>(`/dao/${id}`, {
      method: "DELETE",
    });

    // Purger les caches liés
    cacheService.delete("all-daos");
    cacheService.delete(`dao-${id}`);

    return result;
  }

  async getNextDaoNumber(): Promise<string> {
    const response = await this.request<{ nextNumber: string }>(
      "/dao/next-number",
    );
    return response.nextNumber;
  }

  async deleteLastDao(opts: {
    idempotencyKey?: string;
    password: string;
  }): Promise<{ deletedId: string; numeroListe: string }> {
    // Action sensible: nécessite vérification server-side du mot de passe admin
    return await this.request<{ deletedId: string; numeroListe: string }>(
      "/admin/delete-last-dao",
      {
        method: "DELETE",
        idempotencyKey: opts?.idempotencyKey,
        body: JSON.stringify({ password: opts.password }),
      },
    );
  }

  async getLastDao(): Promise<{
    id: string;
    numeroListe: string;
    createdAt: string;
  }> {
    // Récupérer le dernier DAO via la liste triée (évite route admin-only)
    const res: any = await this.request<any>(
      "/dao?sort=createdAt&order=desc&page=1&pageSize=1",
    );
    const items: any[] = Array.isArray(res)
      ? res
      : Array.isArray(res?.items)
        ? res.items
        : [];
    if (items.length === 0) throw new Error("Aucun DAO disponible");
    const d = items[0];
    return { id: d.id, numeroListe: d.numeroListe, createdAt: d.createdAt };
  }
}

export const apiService = new ApiService();
