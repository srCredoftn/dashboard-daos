/**
Rôle: Utilitaires Frontend — src/frontend/utils/auth-cleanup.ts
Domaine: Frontend/Utils
Exports: clearAuthenticationData, checkAuthState, forceCleanRestart
Sécurité: veille à la validation d’entrée, gestion JWT/refresh, et limites de débit
*/
/**
 * Utility to clean up authentication data
 * Useful when tokens become invalid after server restarts
 */

export function clearAuthenticationData() {
  try {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");

    // Clear any other auth-related data that might exist
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.includes("auth") ||
          key.includes("token") ||
          key.includes("session"))
      ) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));

    console.log("🧹 Authentication data cleared successfully");
    console.log("🔄 Please refresh the page and log in again");

    return true;
  } catch (error) {
    console.error("❌ Failed to clear authentication data:", error);
    return false;
  }
}

/**
 * Check if current authentication state seems problematic
 */
export function checkAuthState() {
  const token = localStorage.getItem("auth_token");
  const user = localStorage.getItem("auth_user");

  console.log("🔍 Current auth state:");
  console.log("Token present:", !!token);
  console.log("User data present:", !!user);

  if (token && user) {
    try {
      const userData = JSON.parse(user);
      console.log("User: [redacted-email] Role:", userData.role);
    } catch (error) {
      console.warn("⚠️ User data appears corrupted");
      return false;
    }
  }

  return true;
}

/**
 * Force a clean logout and page refresh
 */
export function forceCleanRestart() {
  clearAuthenticationData();

  // Wait a bit then refresh
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}

// Make functions available globally for debugging
if (typeof window !== "undefined") {
  (window as any).authDebug = {
    clear: clearAuthenticationData,
    check: checkAuthState,
    restart: forceCleanRestart,
  };
}
