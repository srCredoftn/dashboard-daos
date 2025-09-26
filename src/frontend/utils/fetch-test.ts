/**
Rôle: Utilitaires Frontend — src/frontend/utils/fetch-test.ts
Domaine: Frontend/Utils
Dépendances: ./simple-fetch
*/
// Test utility for fetch functionality
import { simpleFetch } from "./simple-fetch";

export async function testFetchFunctionality() {
  console.log("🧪 Testing fetch functionality...");

  try {
    // Test simple GET request
    console.log("📡 Testing GET request to /api/health...");
    const response = await simpleFetch.get("/api/health");

    if (response.ok) {
      console.log("✅ Fetch test successful!");
      const data = await response.json().catch(() => ({}));
      console.log("📋 Response data:", data);
      return { success: true, data };
    } else {
      console.log("⚠️ Fetch test returned non-OK status:", response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    console.error("❌ Fetch test failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Test function to be called from console or components
export async function runFetchDiagnostic() {
  console.log("🔍 Running fetch diagnostic...");

  // Test 1: Basic fetch functionality
  const basicTest = await testFetchFunctionality();

  // Test 2: Check window.fetch availability
  const windowFetchAvailable =
    typeof window !== "undefined" && typeof window.fetch === "function";

  // Test 3: Check for error signatures
  const fetchString =
    typeof window !== "undefined" ? window.fetch.toString() : "N/A";
  const hasInterceptors =
    fetchString.toLowerCase().includes("fullstory") ||
    fetchString.toLowerCase().includes("sentry");

  const diagnostic = {
    basicFetchTest: basicTest,
    windowFetchAvailable,
    hasInterceptors,
    fetchSource: fetchString.substring(0, 100) + "...",
    timestamp: new Date().toISOString(),
  };

  console.log("📊 Fetch diagnostic results:", diagnostic);
  return diagnostic;
}

// Export for easy access from browser console
if (typeof window !== "undefined") {
  (window as any).testFetch = testFetchFunctionality;
  (window as any).runFetchDiagnostic = runFetchDiagnostic;
}
