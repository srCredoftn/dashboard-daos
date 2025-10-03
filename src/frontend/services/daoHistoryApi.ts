/**
 * Rôle: Service HTTP/Client — src/frontend/services/daoHistoryApi.ts
 * Domaine: Frontend/Services
 * Exports: daoHistoryApi
 * Liens: appels /api, utils de fetch, types @shared/*
 */
import type { DaoAggregatedSummary, DaoHistoryEntry } from "@shared/api";
import { getToken } from "@/utils/auth-storage";
import secureFetch from "@/utils/secure-fetch";
import { authService } from "./authService";
import { devLog } from "@/utils/devLogger";

const API_BASE_URL = "/api/dao";

type RequestOptions = RequestInit & { idempotencyKey?: string };

type ValidateDaoResponse = {
  ok: boolean;
  summary?: DaoAggregatedSummary;
  historyId?: string;
  message?: string;
};

type HistoryResponse = {
  items?: DaoHistoryEntry[];
};

class DaoHistoryApi {
  private async request<T>(
    endpoint: string,
    options?: RequestOptions,
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = getToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (options?.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        for (const [key, value] of options.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, options.headers);
      }
    }

    if (options?.idempotencyKey) {
      headers["x-idempotency-key"] = options.idempotencyKey;
      delete options.idempotencyKey;
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const requestInit: RequestInit = {
      ...options,
      headers,
    };

    try {
      let response: Response | null = null;

      try {
        response = await secureFetch.fetch(url, {
          ...requestInit,
          useNativeFetch: true,
          maxRetries: 2,
          timeout: 15000,
        } as any);
      } catch (secureErr) {
        devLog.warn(
          "secureFetch a échoué pour daoHistoryApi, repli sur fetch natif:",
          secureErr,
        );
        response = await fetch(url, requestInit);
      }

      if (!response.ok) {
        if (response.status === 401) {
          try {
            const refreshed = await authService.tryRefresh?.();
            if (refreshed) {
              return this.request<T>(endpoint, { ...(options || {}), headers });
            }
          } catch (refreshErr) {
            devLog.error("Échec du rafraîchissement de session", refreshErr);
          }
          localStorage.removeItem("auth_token");
          localStorage.removeItem("auth_user");
          if (!window.location.pathname.includes("/login")) {
            window.location.href = "/login";
          }
          throw new Error("Session expirée. Veuillez vous reconnecter.");
        }

        const errorData = await response.json().catch(() => ({}));
        const message =
          (errorData && typeof errorData.error === "string"
            ? errorData.error
            : null) || `Erreur HTTP : statut ${response.status}`;
        throw new Error(message);
      }

      return (await response.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Failed to fetch") ||
        message.includes("Network request failed") ||
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("abort")
      ) {
        throw new Error(
          "Erreur de connexion. Vérifiez votre connexion internet.",
        );
      }

      devLog.error("Requête daoHistoryApi échouée", error);
      throw error;
    }
  }

  async validateDao(daoId: string): Promise<ValidateDaoResponse> {
    if (!daoId) throw new Error("Identifiant DAO manquant");
    return await this.request<ValidateDaoResponse>(`/${daoId}/validate`, {
      method: "POST",
    });
  }

  async getHistory(
    params: {
      date?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<DaoHistoryEntry[]> {
    const search = new URLSearchParams();
    if (params.date) search.set("date", params.date);
    if (params.dateFrom) search.set("dateFrom", params.dateFrom);
    if (params.dateTo) search.set("dateTo", params.dateTo);
    const query = search.toString();

    try {
      const response = await this.request<HistoryResponse | DaoHistoryEntry[]>(
        `/history${query ? `?${query}` : ""}`,
      );

      if (Array.isArray(response)) {
        return response;
      }

      if (response && Array.isArray(response.items)) {
        return response.items;
      }

      return [];
    } catch (error) {
      devLog.error("Échec de récupération de l'historique DAO", error);
      return [];
    }
  }
}

export const daoHistoryApi = new DaoHistoryApi();
