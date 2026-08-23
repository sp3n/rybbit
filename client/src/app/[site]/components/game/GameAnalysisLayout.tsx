"use client";

import { ReactNode } from "react";
import { Card, CardLoader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArchiveRestore, DatabaseZap } from "lucide-react";
import { useExtracted } from "next-intl";

export function GameAnalysisHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="py-1">
      <h1 className="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export type GameSummaryItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
};

export function GameSummaryStrip({ items, isLoading }: { items: GameSummaryItem[]; isLoading?: boolean }) {
  return (
    <Card>
      {isLoading && <CardLoader />}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {items.map(item => (
          <div
            key={item.label}
            className="min-w-0 border-b border-r border-neutral-100 px-3 py-3 last:border-r-0 md:border-b-0 dark:border-neutral-800"
          >
            <div className="truncate text-xs font-medium text-muted-foreground">{item.label}</div>
            {isLoading ? (
              <Skeleton className="mt-2 h-6 w-20 rounded-md" />
            ) : (
              <div className="mt-1 truncate text-lg font-medium tabular-nums">{item.value}</div>
            )}
            {!isLoading && item.detail && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.detail}</div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ReconstructedDataNotice({ attempts }: { attempts: number }) {
  const t = useExtracted();
  if (!attempts) return null;

  return (
    <Alert variant="warning" className="rounded-lg">
      <ArchiveRestore className="h-4 w-4" />
      <AlertTitle>{t("Includes reconstructed history")}</AlertTitle>
      <AlertDescription>
        {t(
          "{attempts} attempts were reconstructed from aggregate Plausible data. Event totals are preserved; players, sessions, durations, and cross-property combinations are approximate.",
          { attempts: attempts.toLocaleString() }
        )}
      </AlertDescription>
    </Alert>
  );
}

export function ReconstructedAnalysisExclusionNotice() {
  const t = useExtracted();

  return (
    <Alert variant="info" className="rounded-lg">
      <DatabaseZap className="h-4 w-4" />
      <AlertTitle>{t("Reconstructed history excluded")}</AlertTitle>
      <AlertDescription>
        {t(
          "This analysis uses native telemetry only. Aggregate Plausible history is omitted because reconstructed players, sessions, and event sequences are approximate."
        )}
      </AlertDescription>
    </Alert>
  );
}
