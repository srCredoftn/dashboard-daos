import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { daoHistoryApi } from "@/services/daoHistoryApi";
import type { DaoHistoryEntry } from "@shared/api";

export default function DaoHistory() {
  const [items, setItems] = useState<DaoHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await daoHistoryApi.getHistory();
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">Historique des modifications</h2>
            <p className="text-sm text-muted-foreground">Journal agrégé des validations quotidiennes</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              Rafraîchir
            </Button>
          </div>
        </div>

        {error && (
          <Card className="mb-4">
            <CardContent className="pt-6 text-red-600">{error}</CardContent>
          </Card>
        )}

        {loading ? (
          <Card>
            <CardHeader>
              <CardTitle>Chargement…</CardTitle>
              <CardDescription>Récupération de l'historique</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Aucun élément d'historique pour le moment
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {items.map((entry) => (
              <Card key={entry.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base sm:text-lg">{entry.summary}</CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {new Date(entry.createdAt).toLocaleString("fr-FR")} • {entry.numeroListe}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">{entry.daoId.slice(0, 6)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  <Separator />
                  <ul className="mt-3 space-y-1">
                    {entry.lines.map((ln, idx) => (
                      <li key={idx} className="text-sm whitespace-pre-line">
                        • {ln}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
