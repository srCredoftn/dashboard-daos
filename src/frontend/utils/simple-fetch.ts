/**
Rôle: Utilitaires Frontend — src/frontend/utils/simple-fetch.ts
Domaine: Frontend/Utils
Exports: SimpleFetchOptions, SimpleFetch, simpleFetch, default
*/
// Utilitaire fetch simple et robuste sans iframe
export interface SimpleFetchOptions extends RequestInit {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class SimpleFetch {
  private static instance: SimpleFetch;

  static getInstance(): SimpleFetch {
    if (!SimpleFetch.instance) {
      SimpleFetch.instance = new SimpleFetch();
    }
    return SimpleFetch.instance;
  }

  // Créer un timeout pour les requêtes
  private createTimeoutSignal(timeoutMs: number): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timeoutId),
    };
  }

  // Méthode principale de fetch
  async fetch(
    url: string | URL,
    options: SimpleFetchOptions = {},
  ): Promise<Response> {
    const {
      maxRetries = 2,
      retryDelay = 1000,
      timeout = 10000,
      ...fetchOptions
    } = options;

    let timeoutCleanup: (() => void) | null = null;

    // Ajouter un timeout si pas déjà spécifié
    if (!fetchOptions.signal && timeout > 0) {
      const timeoutData = this.createTimeoutSignal(timeout);
      fetchOptions.signal = timeoutData.signal;
      timeoutCleanup = timeoutData.cleanup;
    }

    let lastError: Error | null = null;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          console.log(
            `🌐 Simple fetch attempt ${attempt + 1}/${maxRetries + 1}: ${url}`,
          );

          // Utiliser window.fetch directement pour éviter les problèmes d'iframe
          const response = await window.fetch(url, fetchOptions);

          console.log(
            `✅ Simple fetch successful: ${url} (${response.status})`,
          );

          // Nettoyer le timeout sur succès
          if (timeoutCleanup) {
            timeoutCleanup();
          }

          return response;
        } catch (error) {
          lastError = error as Error;
          const errorMessage = lastError.message;

          console.warn(
            `⚠️ Simple fetch attempt ${attempt + 1} failed:`,
            errorMessage,
          );

          // Vérifier si c'est une erreur réseau temporaire
          const isRetriableError =
            errorMessage.includes("Failed to fetch") ||
            errorMessage.includes("network") ||
            errorMessage.includes("timeout") ||
            (errorMessage.includes("AbortError") &&
              !errorMessage.includes("timeout")) ||
            errorMessage.includes("TypeError");

          // Ne pas retry sur la dernière tentative ou si l'erreur n'est pas retriable
          if (attempt === maxRetries || !isRetriableError) {
            break;
          }

          // Délai avant le retry
          const delay = retryDelay * Math.pow(2, attempt);
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Si toutes les tentatives ont échoué
      console.error(`❌ All simple fetch attempts failed for: ${url}`);

      if (lastError) {
        const enhancedError = new Error(
          `Network request failed after ${maxRetries + 1} attempts: ${lastError.message}`,
        );
        enhancedError.name = "SimpleFetchError";
        enhancedError.stack = lastError.stack;
        throw enhancedError;
      }

      throw new Error("Network request failed: Unknown error");
    } finally {
      // S'assurer que le timeout est nettoyé
      if (timeoutCleanup) {
        timeoutCleanup();
      }
    }
  }

  // Méthodes utilitaires
  async get(
    url: string | URL,
    options: SimpleFetchOptions = {},
  ): Promise<Response> {
    return this.fetch(url, { ...options, method: "GET" });
  }

  async post(
    url: string | URL,
    data?: any,
    options: SimpleFetchOptions = {},
  ): Promise<Response> {
    const postOptions: SimpleFetchOptions = {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    if (data !== undefined) {
      postOptions.body = typeof data === "string" ? data : JSON.stringify(data);
    }

    return this.fetch(url, postOptions);
  }

  async put(
    url: string | URL,
    data?: any,
    options: SimpleFetchOptions = {},
  ): Promise<Response> {
    const putOptions: SimpleFetchOptions = {
      ...options,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    if (data !== undefined) {
      putOptions.body = typeof data === "string" ? data : JSON.stringify(data);
    }

    return this.fetch(url, putOptions);
  }

  async delete(
    url: string | URL,
    options: SimpleFetchOptions = {},
  ): Promise<Response> {
    return this.fetch(url, { ...options, method: "DELETE" });
  }
}

// Instance singleton
export const simpleFetch = SimpleFetch.getInstance();
export default simpleFetch;
