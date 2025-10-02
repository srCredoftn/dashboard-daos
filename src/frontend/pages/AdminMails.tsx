import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getToken } from "@/utils/auth-storage";

type MailJob = {
  id: string;
  to: string[];
  subject: string;
  body: string;
  type?: string;
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  nextAttemptAt?: number;
  processed?: boolean;
  failed?: boolean;
};

export default function AdminMails() {
  const [queue, setQueue] = useState<MailJob[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [diag, setDiag] = useState<any>(null);

  const token = getToken();

  async function fetchData() {
    setLoading(true);
    try {
      const headers: any = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      // Helper to fetch and parse JSON safely (avoid reusing response body)
      async function fetchJson(url: string) {
        const res = await fetch(url, { headers: { ...headers } });
        const ct = res.headers.get("content-type") || "";
        if (!res.ok) {
          // try to extract JSON error body, otherwise text
          if (ct.includes("application/json")) {
            const json = await res.json().catch(() => null);
            throw new Error(json?.error || JSON.stringify(json) || `HTTP ${res.status}`);
          }
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `HTTP ${res.status}`);
        }
        if (ct.includes("application/json")) return await res.json();
        // if not JSON, return raw text
        return await res.text();
      }

      // Fetch sequentially to avoid potential stream reuse issues on some environments
      const qRes: any = await fetchJson("/api/admin/mail-queue");
      const logsRes: any = await fetchJson("/api/admin/mail-logs");
      const diagRes: any = await fetchJson("/api/admin/mail-diagnostics");

      if (qRes?.ok) setQueue(qRes.queue || []);
      else if (Array.isArray(qRes)) setQueue(qRes as any);

      if (logsRes?.ok) setLogs(logsRes.logs || []);
      else if (Array.isArray(logsRes)) setLogs(logsRes as any);

      if (diagRes?.ok) setDiag(diagRes);
      else if (typeof diagRes === "object") setDiag(diagRes);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      String(l.id || "").toLowerCase().includes(s) ||
      String(l.subject || "").toLowerCase().includes(s) ||
      (Array.isArray(l.to) && l.to.join(",").toLowerCase().includes(s)) ||
      String(l.type || "").toLowerCase().includes(s)
    );
  });

  async function requeue(id: string) {
    try {
      const headers: any = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch("/api/admin/mail-queue/requeue", {
        method: "POST",
        headers,
        body: JSON.stringify({ id }),
      }).then((r) => r.json());
      if (res?.ok) {
        await fetchData();
        alert("Job requeued");
      } else {
        alert("Requeue failed");
      }
    } catch (e) {
      console.error(e);
      alert("Erreur réseau");
    }
  }

  return (
    <div className="container mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4">Gestion des mails</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card>
          <div className="p-4">
            <h3 className="font-semibold">Diagnostics SMTP</h3>
            <pre className="text-sm mt-2">{JSON.stringify(diag || {}, null, 2)}</pre>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <h3 className="font-semibold">File d'attente</h3>
            <div className="mt-2 text-sm">Total: {queue.length}</div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <h3 className="font-semibold">Historique</h3>
            <div className="mt-2 text-sm">Total: {logs.length}</div>
          </div>
        </Card>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Input placeholder="Recherche id, sujet, destinataire, type..." value={search} onChange={(e:any)=>setSearch(e.target.value)} />
        <Button onClick={() => fetchData()} disabled={loading}>Rafraîchir</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="p-4">
            <h3 className="font-semibold mb-2">File d'attente (pending/failed)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th>ID</th>
                    <th>Destinataires</th>
                    <th>Sujet</th>
                    <th>Type</th>
                    <th>Attempts</th>
                    <th>Next try</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((qj) => (
                    <tr key={qj.id} className="border-t">
                      <td className="py-2 align-top">{qj.id}</td>
                      <td className="py-2 align-top">{(qj.to || []).join(", ")}</td>
                      <td className="py-2 align-top">{qj.subject}</td>
                      <td className="py-2 align-top">{qj.type}</td>
                      <td className="py-2 align-top">{qj.attempts}</td>
                      <td className="py-2 align-top">{qj.nextAttemptAt ? new Date(qj.nextAttemptAt).toLocaleString() : "-"}</td>
                      <td className="py-2 align-top">
                        <Button onClick={() => requeue(qj.id)} size="sm">Requeue</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <h3 className="font-semibold mb-2">Historique des mails</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th>Statut</th>
                    <th>ID</th>
                    <th>Destinataires</th>
                    <th>Sujet / Template</th>
                    <th>Créé</th>
                    <th>Traité</th>
                    <th>Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((l) => (
                    <tr key={l.id + String(l.processedAt || l.createdAt)} className="border-t">
                      <td className="py-2 align-top">{l.status || (l.failed ? 'failed' : l.processed ? 'sent' : 'unknown')}</td>
                      <td className="py-2 align-top">{l.id}</td>
                      <td className="py-2 align-top">{(l.to || []).join(", ")}</td>
                      <td className="py-2 align-top">{l.subject || l.type}</td>
                      <td className="py-2 align-top">{l.createdAt ? new Date(l.createdAt).toLocaleString() : '-'}</td>
                      <td className="py-2 align-top">{l.processedAt ? new Date(l.processedAt).toLocaleString() : '-'}</td>
                      <td className="py-2 align-top text-red-600">{l.lastError || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
