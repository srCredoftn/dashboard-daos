import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { daoHistoryApi } from "@/services/daoHistoryApi";
import type { DaoHistoryEntry } from "@shared/api";

function yyyyMmDd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function DaoHistory() {
  const [items, setItems] = useState<DaoHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<"day" | "month" | "year" | "range">(
    "day",
  );
  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDd(today));
  const [selectedMonth, setSelectedMonth] = useState<string>(
    String(today.getMonth() + 1),
  );
  const [selectedYear, setSelectedYear] = useState<string>(
    String(today.getFullYear()),
  );
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [sortDesc, setSortDesc] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: any = {};
      if (mode === "day") params.date = selectedDate;
      if (mode === "month") {
        const y = Number(selectedYear);
        const m = Number(selectedMonth);
        const from = new Date(Date.UTC(y, m - 1, 1));
        const to = new Date(Date.UTC(y, m, 0));
        params.dateFrom = yyyyMmDd(from);
        params.dateTo = yyyyMmDd(to);
      }
      if (mode === "year") {
        const y = Number(selectedYear);
        params.dateFrom = `${y}-01-01`;
        params.dateTo = `${y}-12-31`;
      }
      if (mode === "range") {
        if (dateFrom) params.dateFrom = dateFrom;
        if (dateTo) params.dateTo = dateTo;
      }

      const list = await daoHistoryApi.getHistory(params);
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedDate, selectedMonth, selectedYear, dateFrom, dateTo]);

  // Groupement par jour (YYYY-MM-DD)
  const grouped = useMemo(() => {
    const map = new Map<string, DaoHistoryEntry[]>();
    for (const it of items) {
      const d = new Date(it.createdAt);
      const key = yyyyMmDd(d);
      const arr = map.get(key) || [];
      arr.push(it);
      map.set(key, arr);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => (sortDesc ? (a[0] < b[0] ? 1 : -1) : a[0] > b[0] ? 1 : -1));
    return entries;
  }, [items, sortDesc]);

  // Années pratiques (fenêtre ±3 ans)
  const years = useMemo(() => {
    const y = today.getFullYear();
    return Array.from({ length: 7 }, (_, i) => String(y - 3 + i));
  }, [today]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">Historique des modifications</h2>
            <p className="text-sm text-muted-foreground">
              Journal des mises à jour de DAO et tâches, filtrable par jour/mois/année ou plage
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              Rafraîchir
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSortDesc((v) => !v)}>
              {sortDesc ? "Tri: récents → anciens" : "Tri: anciens → récents"}
            </Button>
          </div>
        </div>

        {/* Barre de filtres */}
        <Card className="mb-4">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Mode</label>
                <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Jour</SelectItem>
                    <SelectItem value="month">Mois</SelectItem>
                    <SelectItem value="year">Année</SelectItem>
                    <SelectItem value="range">Plage</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "day" && (
                <div>
                  <label className="text-xs text-muted-foreground">Date</label>
                  <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
                </div>
              )}

              {mode === "month" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground">Mois</label>
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Mois" /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
                          <SelectItem key={m} value={m}>{m.padStart(2, "0")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Année</label>
                    <Select value={selectedYear} onValueChange={setSelectedYear}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Année" /></SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={y}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {mode === "year" && (
                <div>
                  <label className="text-xs text-muted-foreground">Année</label>
                  <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Année" /></SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={y}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {mode === "range" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground">Du</label>
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Au</label>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                </>
              )}

              <div className="flex items-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => {
                  setMode("day");
                  setSelectedDate(yyyyMmDd(new Date()));
                }}>Aujourd'hui</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  setMode("month");
                  setSelectedMonth(String(new Date().getMonth() + 1));
                  setSelectedYear(String(new Date().getFullYear()));
                }}>Ce mois</Button>
                <Button variant="outline" size="sm" onClick={() => {
                  setMode("year");
                  setSelectedYear(String(new Date().getFullYear()));
                }}>Cette année</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="mb-4">
            <CardContent className="pt-6 text-red-600">
              {error === "UNAUTHORIZED" ? "Accès non autorisé. Veuillez vous reconnecter." : error}
            </CardContent>
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
        ) : grouped.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Aucun élément d'historique pour la période choisie
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.map(([day, entries]) => (
              <div key={day}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{new Date(day + "T00:00:00").toLocaleDateString("fr-FR")}</h3>
                  <Badge variant="secondary">{entries.length} élément{entries.length > 1 ? "s" : ""}</Badge>
                </div>
                <div className="space-y-3">
                  {entries.map((entry) => (
                    <Card key={entry.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <CardTitle className="text-base sm:text-lg">{entry.summary}</CardTitle>
                            <CardDescription className="text-xs sm:text-sm">
                              {new Date(entry.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} • {entry.numeroListe}
                            </CardDescription>
                          </div>
                          <Badge variant="secondary">{entry.daoId.slice(0, 6)}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2 pt-0">
                        <Separator />
                        <ul className="mt-3 space-y-1">
                          {entry.lines.map((ln, idx) => (
                            <li key={idx} className="text-sm whitespace-pre-line">• {ln}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
