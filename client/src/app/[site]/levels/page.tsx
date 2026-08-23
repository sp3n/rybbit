"use client";

import { GameLevelAttempt } from "@/api/analytics/endpoints";
import { useGetGameLevels } from "@/api/analytics/hooks/useGetGameAnalytics";
import { ErrorState } from "@/components/ErrorState";
import { NothingFound } from "@/components/NothingFound";
import { Card, CardContent, CardDescription, CardHeader, CardLoader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSetPageTitle } from "@/hooks/useSetPageTitle";
import { formatSecondsAsMinutesAndSeconds } from "@/lib/utils";
import { ListChecks } from "lucide-react";
import { useExtracted } from "next-intl";
import { GameAnalysisHeader, GameSummaryStrip, ReconstructedDataNotice } from "../components/game/GameAnalysisLayout";
import { SubHeader } from "../components/SubHeader/SubHeader";

function formatLevelName(value: string) {
  return value
    .replace(/^L_/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
}

function OutcomeBar({ level }: { level: GameLevelAttempt }) {
  const t = useExtracted();
  const total = Math.max(level.attempts, 1);
  const segments = [
    { key: "completed", value: level.completions, className: "bg-emerald-500" },
    { key: "failed", value: level.failures, className: "bg-red-500" },
    { key: "quit", value: level.quits, className: "bg-yellow-500" },
    { key: "retry", value: level.retries, className: "bg-blue-500" },
    { key: "abandoned", value: level.abandoned, className: "bg-neutral-300 dark:bg-neutral-600" },
  ];

  return (
    <div className="min-w-[260px]">
      <div className="flex h-1.5 w-full overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-800">
        {segments.map(segment => (
          <div key={segment.key} className={segment.className} style={{ width: `${(segment.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
        <span>
          {level.completions.toLocaleString()} {t("complete")}
        </span>
        <span>
          {level.failures.toLocaleString()} {t("failed")}
        </span>
        <span>
          {level.quits.toLocaleString()} {t("quit")}
        </span>
        <span>
          {level.retries.toLocaleString()} {t("retried")}
        </span>
        <span>
          {level.abandoned.toLocaleString()} {t("no outcome")}
        </span>
      </div>
    </div>
  );
}

function LevelRowsSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3, 4].map(row => (
        <Skeleton key={row} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}

export default function GameLevelsPage() {
  const t = useExtracted();
  const { data, isLoading, isFetching, error } = useGetGameLevels();
  useSetPageTitle("Levels & Attempts");

  const summary = data?.summary;
  const duration = summary?.median_attempt_seconds;

  return (
    <div className="mx-auto max-w-[1300px] space-y-3 p-2 md:p-4">
      <SubHeader />
      <GameAnalysisHeader
        title={t("Levels & Attempts")}
        description={t("See where runs succeed, fail, repeat, or stop without a recorded outcome.")}
      />
      <GameSummaryStrip
        isLoading={isLoading}
        items={[
          { label: t("Attempts"), value: (summary?.attempts ?? 0).toLocaleString() },
          { label: t("Players"), value: (summary?.players ?? 0).toLocaleString() },
          { label: t("Completion Rate"), value: `${Number(summary?.completion_rate ?? 0).toFixed(1)}%` },
          { label: t("Attempts per Player"), value: Number(summary?.attempts_per_player ?? 0).toFixed(1) },
          {
            label: t("Median Attempt"),
            value: duration ? formatSecondsAsMinutesAndSeconds(duration) : t("Not available"),
          },
        ]}
      />
      <ReconstructedDataNotice attempts={summary?.reconstructed_attempts ?? 0} />

      <Card>
        {isFetching && <CardLoader />}
        <CardHeader className="pb-3">
          <CardTitle>{t("Level outcomes")}</CardTitle>
          <CardDescription>
            {t("Each level start creates one attempt. The latest terminal action determines its outcome.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <LevelRowsSkeleton />
          ) : error ? (
            <ErrorState
              title={t("Failed to load level attempts")}
              message={t("There was a problem fetching game progression data. Please try again later.")}
            />
          ) : !data?.levels.length ? (
            <NothingFound
              icon={<ListChecks className="h-10 w-10" />}
              title={t("No level attempts in this period")}
              description={t("Level events appear here after the game records a level start.")}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">{t("Level")}</TableHead>
                    <TableHead className="text-right">{t("Players")}</TableHead>
                    <TableHead className="text-right">{t("Attempts")}</TableHead>
                    <TableHead>{t("Outcome mix")}</TableHead>
                    <TableHead className="text-right">{t("Per player")}</TableHead>
                    <TableHead className="text-right">{t("Median")}</TableHead>
                    <TableHead className="pr-4 text-right">{t("Success")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.levels.map((level, index) => (
                    <TableRow key={level.level}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                          <span className="font-medium">{formatLevelName(level.level)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{level.players.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{level.attempts.toLocaleString()}</TableCell>
                      <TableCell>
                        <OutcomeBar level={level} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{level.attempts_per_player.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {level.median_attempt_seconds
                          ? formatSecondsAsMinutesAndSeconds(level.median_attempt_seconds)
                          : "–"}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-medium tabular-nums">
                        {level.completion_rate.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t border-neutral-100 px-4 py-3 text-xs text-muted-foreground dark:border-neutral-800">
                {t("No outcome means the selected period ended without a completion, failure, quit, or retry event.")}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
