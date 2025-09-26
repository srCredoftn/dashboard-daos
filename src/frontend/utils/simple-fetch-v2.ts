/**
Rôle: Utilitaires Frontend — src/frontend/utils/simple-fetch-v2.ts
Domaine: Frontend/Utils
Exports: SimpleFetchOptions, SimpleFetchV2, simpleFetchV2, default
*/
// Utilitaire fetch simple et robuste v2 - Sans AbortError prématuré
export interface SimpleFetchOptions extends RequestInit {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class SimpleFetchV2 {
  private static instance: SimpleFetchV2;

  static getInstance(): SimpleFetchV2 {
    if (!SimpleFetchV2.instance) {
      SimpleFetchV2.instance = new SimpleFetchV2();
    }
    return SimpleFetchV2.instance;
  }

  // Méthode principale de fetch avec gestion améliorée des timeouts
  async fetch(
    url: string | URL,
    options: SimpleFetchOptions = {},
  ): Promise<Response> {
    const {
      maxRetries = 2,
      retryDelay = 1000,
      timeout = 15000, // 15 secondes par défaut
      ...fetchOptions
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let timeoutId: NodeJS.Timeout | null = null;
      let abortController: AbortController | null = null;

      try {
        console.log(
          `🌐 SimpleFetch v2 attempt ${attempt + 1}/${maxRetries + 1}: ${url}`,
        );

        // Créer un nouveau AbortController pour chaque tentative
        abortController = new AbortController();

        // Combiner avec le signal existant si présent
        let finalSignal = abortController.signal;
        if (fetchOptions.signal) {
          // Si un signal externe existe, l'utiliser en priorité
          finalSignal = fetchOptions.signal;
        }

        // Créer un timeout promise qui ne rejette que si vraiment nécessaire
        const timeoutPromise = new Promise<never>((_, reject) => {
          if (timeout > 0) {
            timeoutId = setTimeout(() => {
              if (abortController && !abortController.signal.aborted) {
                abortController.abort();
                reject(new Error(`Request timeout after ${timeout}ms`));
              }
            }, timeout);
          }
        });

        // Faire la requête avec Promise.race pour gérer le timeout
        const fetchPromise = window.fetch(url, {
          ...fetchOptions,
          signal: finalSignal,
        });

        const response = await Promise.race([
          fetchPromise,
          ...(timeout > 0 ? [timeoutPromise] : []),
        ]);

        // Nettoyer le timeout si la requête réussit
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        console.log(
          `✅ SimpleFetch v2 successful: ${url} (${response.status})`,
        );
        return response;
      } catch (error) {
        // Nettoyer le timeout en cas d'erreur
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        lastError = error as Error;
        const errorMessage = lastError.message;

        console.warn(
          `⚠️ SimpleFetch v2 attempt ${attempt + 1} failed:`,
          errorMessage,
        );

        // Vérifier si c'est une erreur réseau temporaire
        const isRetriableError =
          errorMessage.includes("Failed to fetch") ||
          errorMessage.includes("network") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("TypeError") ||
          (errorMessage.includes("AbortError") &&
            !errorMessage.includes("user"));

        // Ne pas retry si c'est la dernière tentative ou si l'erreur n'est pas retriable
        if (attempt === maxRetries || !isRetriableError) {
          break;
        }

        // Délai avant le retry avec backoff exponentiel
        const delay = retryDelay * Math.pow(2, attempt);
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Si toutes les tentatives ont échoué
    console.error(`❌ All SimpleFetch v2 attempts failed for: ${url}`);

    if (lastError) {
      // Améliorer le message d'erreur selon le type
      let friendlyMessage = lastError.message;

      if (lastError.message.includes("timeout")) {
        friendlyMessage =
          "La requête a pris trop de temps. Vérifiez votre connexion.";
      } else if (lastError.message.includes("Failed to fetch")) {
        friendlyMessage =
          "Impossible de contacter le serveur. Vérifiez votre connexion internet.";
      } else if (lastError.message.includes("AbortError")) {
        friendlyMessage = "La requête a été interrompue. Veuillez réessayer.";
      }

      const enhancedError = new Error(
        `${friendlyMessage} (${maxRetries + 1} tentatives)`,
      );
      enhancedError.name = "SimpleFetchError";
      enhancedError.stack = lastError.stack;
      throw enhancedError;
    }

    throw new Error("Erreur réseau inconnue");
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
export const simpleFetchV2 = SimpleFetchV2.getInstance();
export default simpleFetchV2;
