"use client";

import NumberFlow from "@number-flow/react";
import { useExtracted } from "next-intl";
import { useState } from "react";
import { useGetGameOverview, useGetGameOverviewBucketed } from "@/api/analytics/hooks/useGetGameAnalytics";
import { BucketSelection } from "@/components/BucketSelection";
import { Card, CardContent, CardLoader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSecondsAsMinutesAndSeconds } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { ChangePercentage } from "../MainSection/Overview";
import { GameActivityChart, GameChartStat } from "./GameActivityChart";

function GameStat({
  label,
  value,
  previous,
  selected,
  onSelect,
  formatter,
  isLoading,
  reverseColor,
}: {
  label: string;
  value: number;
  previous: number;
  selected?: boolean;
  onSelect?: () => void;
  formatter?: (value: number) => string;
  isLoading: boolean;
  reverseColor?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      className={`min-w-0 border-r border-neutral-100 px-3 py-3 text-left last:border-r-0 dark:border-neutral-800 ${
        selected ? "bg-neutral-50 dark:bg-neutral-850" : ""
      } ${onSelect ? "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-850" : "cursor-default"}`}
    >
      <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xl font-medium">
        {isLoading ? (
          <Skeleton className="h-7 w-16 rounded-md" />
        ) : (
          <span className="truncate">
            {formatter ? formatter(value) : <NumberFlow value={value} format={{ notation: "compact" }} />}
          </span>
        )}
        {!isLoading && <ChangePercentage current={value} previous={previous} reverseColor={reverseColor} />}
      </div>
    </button>
  );
}

export function GameOverview() {
  const t = useExtracted();
  const bucket = useStore(state => state.bucket);
  const [selectedStat, setSelectedStat] = useState<GameChartStat>("players");
  const current = useGetGameOverview();
  const previous = useGetGameOverview({ periodTime: "previous" });
  const series = useGetGameOverviewBucketed({ bucket });
  const previousSeries = useGetGameOverviewBucketed({ bucket, periodTime: "previous" });
  const isLoading = current.isLoading || previous.isLoading;

  const values = current.data;
  const previousValues = previous.data;
  const metric = (key: keyof NonNullable<typeof values>, fallback = 0) => Number(values?.[key] ?? fallback);
  const previousMetric = (key: keyof NonNullable<typeof previousValues>, fallback = 0) =>
    Number(previousValues?.[key] ?? fallback);

  const chartLabels: Record<GameChartStat, string> = {
    players: t("Players"),
    sessions: t("Play Sessions"),
    actions: t("Gameplay Actions"),
    level_starts: t("Level Starts"),
    completion_rate: t("Completion Rate"),
  };

  return (
    <>
      <Card>
        {(current.isFetching || previous.isFetching) && <CardLoader />}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <GameStat
            label={t("Players")}
            value={metric("players")}
            previous={previousMetric("players")}
            selected={selectedStat === "players"}
            onSelect={() => setSelectedStat("players")}
            isLoading={isLoading}
          />
          <GameStat
            label={t("Play Sessions")}
            value={metric("sessions")}
            previous={previousMetric("sessions")}
            selected={selectedStat === "sessions"}
            onSelect={() => setSelectedStat("sessions")}
            isLoading={isLoading}
          />
          <GameStat
            label={t("Gameplay Actions")}
            value={metric("actions")}
            previous={previousMetric("actions")}
            selected={selectedStat === "actions"}
            onSelect={() => setSelectedStat("actions")}
            isLoading={isLoading}
          />
          <GameStat
            label={t("Level Starts")}
            value={metric("level_starts")}
            previous={previousMetric("level_starts")}
            selected={selectedStat === "level_starts"}
            onSelect={() => setSelectedStat("level_starts")}
            isLoading={isLoading}
          />
          <GameStat
            label={t("Completion Rate")}
            value={metric("completion_rate")}
            previous={previousMetric("completion_rate")}
            selected={selectedStat === "completion_rate"}
            onSelect={() => setSelectedStat("completion_rate")}
            formatter={value => `${value.toFixed(1)}%`}
            reverseColor={false}
            isLoading={isLoading}
          />
          <GameStat
            label={t("Median Session")}
            value={metric("median_session_duration")}
            previous={previousMetric("median_session_duration")}
            formatter={formatSecondsAsMinutesAndSeconds}
            isLoading={isLoading}
          />
        </div>
      </Card>

      <Card>
        {(series.isFetching || previousSeries.isFetching) && <CardLoader />}
        <CardContent className="p-2 py-3 md:p-4">
          <div className="flex items-center justify-between px-2 md:px-0">
            <span className="text-sm text-neutral-700 dark:text-neutral-200">{chartLabels[selectedStat]}</span>
            <BucketSelection />
          </div>
          <div className="h-[200px] md:h-[290px]">
            <GameActivityChart data={series.data} previousData={previousSeries.data} selectedStat={selectedStat} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
