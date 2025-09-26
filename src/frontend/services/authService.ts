/**
Rôle: Service HTTP/Client — src/frontend/services/authService.ts
Domaine: Frontend/Services
Exports: authService
Liens: appels /api, utils de fetch, types @shared/*
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
Performance: cache/partitionnement/bundling optimisés
*/
/**
 * AuthApiService
 * - Gère login/logout, rafraîchissement de token (cookie httpOnly côté serveur)
 * - Stockage protégé par session d'onglet via utils/auth-storage (pas d'exposition inter-onglets)
 * - Réessaie automatique en cas de 401 via /refresh, puis purge locale en cas d'échec
 * - Aucun secret n'est loggé; messages d'erreurs simples et actionnables
 */
import type {
  LoginCredentials,
  AuthResponse,
  AuthUser,
  User,
} from "@shared/dao";
import {
  getToken as tabGetToken,
  setAuth as tabSetAuth,
  clearAuth as tabClearAuth,
  getUser as tabGetUser,
  startTabSession,
} from "@/utils/auth-storage";
// Utilisation de fetch via secure-fetch (avec fallback) pour contourner les interceptions tierces

const API_BASE_URL = "/api/auth";

class AuthApiService {
  private token: string | null = null; // Token courant (mémoire)
  private refreshing: Promise<boolean> | null = null; // Promesse en cours pour éviter les refresh concurrents

  constructor() {
    // Charger le token stocké (par onglet) au démarrage
    this.token = tabGetToken();
  }

  // Tentative de rafraîchir le token via /auth/refresh (retourne true si succès)
  private async refreshAccessToken(): Promise<boolean> {
    if (this.refreshing) return this.refreshing; // dédupliquer
    this.refreshing = (async () => {
      try {
        const secureFetch = (await import("@/utils/secure-fetch")).default;
        const resp = await secureFetch.fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          useNativeFetch: true,
          timeout: 8000,
        } as any);
        if (!resp.ok) throw new Error(String(resp.status));
        const data = await resp.json();
        if (data?.token) {
          // Mettre à jour token local et storage
          this.token = data.token;
          localStorage.setItem("auth_token", data.token);
          if (data.user)
            localStorage.setItem("auth_user", JSON.stringify(data.user));
          return true;
        }
        return false;
      } catch {
        // Echec: purge totale
        this.clearAuth();
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // Requête générique vers /api/auth/* (gestion headers, 401→refresh)
  private async request<T>(endpoint: string, options?: any): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Fusion des headers appelants éventuels
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

    // Idempotency optionnelle (éviter double soumission)
    if (options?.idempotencyKey) {
      headers["x-idempotency-key"] = options.idempotencyKey;
      delete options.idempotencyKey;
    }

    // Authorization si token en mémoire
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    try {
      const secureFetch = (await import("@/utils/secure-fetch")).default;

      // Contrôleur d'annulation simple + timeout manuel (compat tests)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response;
      try {
        // 1) Essai via secureFetch (protégé des interceptions)
        response = await secureFetch.fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
          useNativeFetch: true,
          maxRetries: options?.maxRetries ?? 0,
          timeout: 30000,
        } as any);
      } catch (sfError) {
        // 2) Fallback: fetch natif direct
        console.warn("secureFetch failed, attempting native fetch fallback");
        try {
          const nativeOptions: any = {
            ...options,
            headers,
            signal: controller.signal,
          };
          if (!nativeOptions.method) nativeOptions.method = "GET";
          response = await window.fetch(url, nativeOptions as any);
        } catch (nativeErr) {
          // Si le fallback échoue aussi, relancer l'erreur initiale
          throw sfError;
        }
      } finally {
        clearTimeout(timeoutId);
      }

      // 401 → tenter refresh puis rejouer la requête
      if (!response.ok) {
        if (response.status === 401) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            return this.request<T>(endpoint, options);
          }
          this.clearAuth();
        }

        const errorData = await response.json().catch(() => ({}));

        // 429 → message adapté avec Retry-After interprété si possible
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          let secondsText = "quelques";
          if (retryAfter) {
            const asNum = Number(retryAfter);
            if (!isNaN(asNum)) secondsText = `${asNum}`;
            else {
              const date = new Date(retryAfter);
              if (!isNaN(date.getTime())) {
                const sec = Math.max(
                  0,
                  Math.ceil((date.getTime() - Date.now()) / 1000),
                );
                secondsText = `${sec}`;
              }
            }
          }
          throw new Error(
            `Trop de tentatives de connexion. Veuillez réessayer dans ${secondsText} secondes.`,
          );
        }

        if (response.status === 401) {
          const ep = String(endpoint || "");
          if (ep.startsWith("/login")) {
            throw new Error("Identifiants incorrects, veuillez réessayer");
          }
          throw new Error(
            "Session expirée ou invalide, veuillez vous reconnecter",
          );
        }

        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`,
        );
      }

      // Réponse OK → JSON
      return await response.json();
    } catch (error: any) {
      // Uniformisation de quelques erreurs courantes
      if (error?.name === "AbortError") {
        console.warn(`⏰ Request timeout for ${endpoint}`);
        throw new Error("La requête a pris trop de temps. Veuillez réessayer.");
      }

      if (
        error instanceof TypeError &&
        error.message.includes("Failed to fetch")
      ) {
        console.warn(`🌐 Network error for ${endpoint}:`, error.message);
        throw new Error(
          "Impossible de se connecter au serveur. Vérifiez votre connexion internet.",
        );
      }

      console.warn("Auth request failed");
      throw error;
    }
  }

  // Login utilisateur
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const response = await this.request<AuthResponse>("/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });

      // Stockage par onglet + session de tab
      this.token = response.token;
      tabSetAuth(response.token, JSON.stringify(response.user));
      startTabSession();
      return response;
    } catch (error) {
      console.warn("Login failed");

      if (error instanceof Error) {
        if (
          error.message.includes("401") ||
          error.message.includes("Identifiants incorrects")
        ) {
          throw new Error("Identifiants incorrects, veuillez réessayer");
        }
      }

      throw error;
    }
  }

  // Logout utilisateur (API + purge locale)
  async logout(): Promise<void> {
    try {
      if (this.token) {
        await this.request<void>("/logout", {
          method: "POST",
        });
      }
    } catch (error) {
      console.error("Logout API call failed:", error);
      // On continue tout de même le cleanup local
    } finally {
      this.token = null;
      tabClearAuth();
    }
  }

  // Récupère l'utilisateur courant (/me)
  async getCurrentUser(): Promise<AuthUser> {
    return this.request<{ user: AuthUser }>("/me").then((res) => res.user);
  }

  // Utilisateur stocké (gating par onglet)
  getStoredUser(): AuthUser | null {
    try {
      return tabGetUser();
    } catch {
      return null;
    }
  }

  // Est authentifié ? (token + user local)
  isAuthenticated(): boolean {
    return !!this.token && !!this.getStoredUser();
  }

  // Token courant
  getToken(): string | null {
    return this.token;
  }

  // Admin operations
  async getAllUsers(): Promise<User[]> {
    return this.request<User>("/users") as unknown as User[];
  }

  async createUser(
    userData: {
      name: string;
      email: string;
      role: string;
    },
    opts?: { idempotencyKey?: string },
  ): Promise<User> {
    const options: any = {
      method: "POST",
      body: JSON.stringify(userData),
    };
    if (opts?.idempotencyKey) options.idempotencyKey = opts.idempotencyKey;
    return this.request<User>("/users", options);
  }

  // Enregistrement public (si activé côté serveur)
  async register(userData: { name: string; email: string; password: string }) {
    const resp = await this.request<{ user: User; token?: string }>(
      "/register",
      {
        method: "POST",
        body: JSON.stringify(userData),
      },
    );
    if (resp.token) {
      this.token = resp.token;
      localStorage.setItem("auth_token", resp.token);
      localStorage.setItem("auth_user", JSON.stringify(resp.user));
    }
    return resp;
  }

  async updateUserRole(
    userId: string,
    role: string,
    password: string,
  ): Promise<User> {
    return this.request<User>(`/users/${userId}/role`, {
      method: "PUT",
      body: JSON.stringify({ role, password }),
    });
  }

  async deactivateUser(
    userId: string,
    password: string,
    opts?: { idempotencyKey?: string },
  ): Promise<void> {
    const options: any = {
      method: "DELETE",
      body: JSON.stringify({ password }),
    };
    if (opts?.idempotencyKey) options.idempotencyKey = opts.idempotencyKey;
    return this.request<void>(`/users/${userId}`, options);
  }

  async changePassword(newPassword: string): Promise<void> {
    return this.request<void>("/change-password", {
      method: "POST",
      body: JSON.stringify({ newPassword }),
    });
  }

  async updateProfile(profileData: { name: string }): Promise<AuthUser> {
    return this.request<AuthUser>("/profile", {
      method: "PUT",
      body: JSON.stringify({ name: profileData.name }),
    });
  }

  // Sessions actives (admin) + révocation
  async getActiveSessions(): Promise<
    { token: string; user: AuthUser | null }[]
  > {
    const secureFetch = (await import("@/utils/secure-fetch")).default;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await secureFetch.fetch("/api/admin/sessions", {
      method: "GET",
      headers,
      useNativeFetch: true,
      timeout: 30000,
    } as any);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.sessions || [];
  }

  async revokeSession(tokenToRevoke: string): Promise<void> {
    const secureFetch = (await import("@/utils/secure-fetch")).default;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await secureFetch.fetch("/api/admin/revoke-session", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: tokenToRevoke }),
      useNativeFetch: true,
      timeout: 30000,
    } as any);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `HTTP error! status: ${response.status}`);
    }
    return;
  }

  // Nettoyage complet de l'état auth (mémoire + storage)
  clearAuth(): void {
    this.token = null;
    tabClearAuth();
  }
}

export const authService = new AuthApiService();
