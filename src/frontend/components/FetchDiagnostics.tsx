/**
Rôle: Composant applicatif — src/frontend/components/FetchDiagnostics.tsx
Domaine: Frontend/Components
Exports: FetchDiagnostics
Dépendances: react, @/components/ui/button, @/components/ui/alert, @/components/ui/badge, lucide-react, @/utils/secure-fetch
Liens: ui/* (atomes), hooks, contexts, services côté client
Performance: cache/partitionnement/bundling optimisés
*/
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Info, Bug } from "lucide-react";
import { useFetchDiagnostics, secureFetch } from "@/utils/secure-fetch";

export default function FetchDiagnostics() {
  const [isVisible, setIsVisible] = useState(false);
  const [testResults, setTestResults] = useState<{
    nativeFetch?: boolean;
    secureFetch?: boolean;
    error?: string;
  }>({});

  const diagnostics = useFetchDiagnostics();

  const runConnectivityTest = async () => {
    setTestResults({});

    try {
      // Test avec fetch natif
      console.log("🧪 Testing native fetch...");
      const nativeResponse = await window.fetch("/api/health", {
        method: "GET",
        cache: "no-cache",
      });
      const nativeSuccess = nativeResponse.ok;

      // Test avec secure fetch
      console.log("🧪 Testing secure fetch...");
      const secureResponse = await secureFetch.get("/api/health", {
        useNativeFetch: true,
      });
      const secureSuccess = secureResponse.ok;

      setTestResults({
        nativeFetch: nativeSuccess,
        secureFetch: secureSuccess,
      });

      console.log("✅ Connectivity tests completed");
    } catch (error) {
      console.error("❌ Connectivity test failed:", error);
      setTestResults({
        nativeFetch: false,
        secureFetch: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  if (!isVisible) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsVisible(true)}
          className="bg-white shadow-lg border-2"
        >
          <Bug className="h-4 w-4 mr-2" />
          Fetch Debug
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <Card className="shadow-lg border-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center">
              <Bug className="h-5 w-5 mr-2" />
              Fetch Diagnostics
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsVisible(false)}
              className="h-6 w-6 p-0"
            >
              ×
            </Button>
          </div>
          <CardDescription>
            Diagnostic des problèmes de connectivité réseau
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status du fetch */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">État du fetch:</span>
              <Badge
                variant={diagnostics.isNativeFetch ? "default" : "destructive"}
              >
                {diagnostics.isNativeFetch ? (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Natif
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Intercepté
                  </>
                )}
              </Badge>
            </div>

            {!diagnostics.isNativeFetch && (
              <Alert variant="destructive" className="mb-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Fetch a été modifié par un service tiers (probablement
                  FullStory)
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Source du fetch */}
          <div>
            <span className="text-sm font-medium">Source fetch:</span>
            <div className="bg-gray-100 p-2 rounded-md mt-1">
              <pre className="text-xs text-gray-700 overflow-hidden">
                {diagnostics.fetchSource}
              </pre>
            </div>
          </div>

          {/* Recommandations */}
          {diagnostics.recommendations.length > 0 && (
            <div>
              <span className="text-sm font-medium">Recommandations:</span>
              <ul className="mt-1 space-y-1">
                {diagnostics.recommendations.map((rec, index) => (
                  <li
                    key={index}
                    className="text-xs text-gray-600 flex items-start"
                  >
                    <Info className="h-3 w-3 mr-1 mt-0.5 flex-shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tests de connectivité */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                Tests de connectivité:
              </span>
              <Button
                size="sm"
                onClick={runConnectivityTest}
                className="h-7 text-xs"
              >
                Tester
              </Button>
            </div>

            {Object.keys(testResults).length > 0 && (
              <div className="space-y-2">
                {testResults.nativeFetch !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Fetch natif:</span>
                    <Badge
                      variant={
                        testResults.nativeFetch ? "default" : "destructive"
                      }
                    >
                      {testResults.nativeFetch ? "OK" : "Échec"}
                    </Badge>
                  </div>
                )}

                {testResults.secureFetch !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs">Secure fetch:</span>
                    <Badge
                      variant={
                        testResults.secureFetch ? "default" : "destructive"
                      }
                    >
                      {testResults.secureFetch ? "OK" : "Échec"}
                    </Badge>
                  </div>
                )}

                {testResults.error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {testResults.error}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          {/* Actions rapides */}
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="flex-1 text-xs h-7"
            >
              Recharger
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => console.log("🔍 Fetch diagnostics:", diagnostics)}
              className="flex-1 text-xs h-7"
            >
              Log Console
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
