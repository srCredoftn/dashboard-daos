import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DaoHistoryEntry, DaoHistoryEventType } from "@shared/api";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Clock, ListChecks, PlusCircle, RefreshCw, Users } from "lucide-react";

interface HistoryEventCardProps {
  entry: DaoHistoryEntry;
}

interface EventConfig {
  label: string;
  icon: LucideIcon;
  badgeClass?: string;
  iconClass?: string;
}

const EVENT_CONFIG: Record<DaoHistoryEventType | "default", EventConfig> = {
  dao_created: {
    label: "Création de DAO",
    icon: PlusCircle,
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
    iconClass: "bg-emerald-500/90 text-white",
  },
  dao_updated: {
    label: "Mise à jour de DAO",
    icon: RefreshCw,
    badgeClass: "bg-blue-100 text-blue-700 border-blue-200",
    iconClass: "bg-blue-500/90 text-white",
  },
  dao_task_update: {
    label: "Mise à jour des tâches",
    icon: ListChecks,
    badgeClass: "bg-amber-100 text-amber-700 border-amber-200",
    iconClass: "bg-amber-500/90 text-white",
  },
  dao_team_update: {
    label: "Mise à jour de l'équipe",
    icon: Users,
    badgeClass: "bg-purple-100 text-purple-700 border-purple-200",
    iconClass: "bg-purple-500/90 text-white",
  },
  default: {
    label: "Activité",
    icon: Clock,
    badgeClass: "bg-muted text-muted-foreground border-border/60",
    iconClass: "bg-muted text-muted-foreground",
  },
};

export function HistoryEventCard({ entry }: HistoryEventCardProps) {
  const eventMeta = EVENT_CONFIG[entry.eventType] || EVENT_CONFIG.default;
  const createdAt = new Date(entry.createdAt);
  const formattedDate = createdAt.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const formattedTime = createdAt.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const lines = entry.lines.filter((line) => line.trim().length > 0);

  return (
    <Card className="border border-border/70 shadow-sm">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full",
                eventMeta.iconClass,
              )}
            >
              <eventMeta.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <Badge
                variant="outline"
                className={cn(
                  "border bg-muted text-xs font-semibold uppercase",
                  eventMeta.badgeClass,
                )}
              >
                {eventMeta.label}
              </Badge>
              <h3 className="mt-2 text-base font-semibold leading-snug">
                {entry.summary}
              </h3>
              <p className="text-xs text-muted-foreground">
                DAO {entry.numeroListe}
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="font-medium capitalize">{formattedDate}</div>
            <div>{formattedTime}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {lines.length > 0 ? (
          <ul className="space-y-2 text-sm leading-relaxed">
            {lines.map((line, index) => (
              <li key={`${entry.id}-${index}`} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/60" />
                <span className="flex-1 text-muted-foreground/90">{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aucun détail supplémentaire pour cet événement.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
