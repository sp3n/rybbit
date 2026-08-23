"use client";

import { DateTime } from "luxon";
import { useMemo } from "react";
import { GameOverviewBucketedResponse } from "@/api/analytics/endpoints";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { TimeSeriesChart, TimeSeriesChartPoint } from "@/components/charts/TimeSeriesChart";
import { getChartTimeBounds } from "@/components/charts/timeSeriesChartUtils";
import { formatChartDateTime } from "@/lib/dateTimeUtils";
import { getTimezone, useStore } from "@/lib/store";

export type GameChartStat = "players" | "sessions" | "actions" | "level_starts" | "completion_rate";

export function getGameChartValue(point: GameOverviewBucketedResponse[number], stat: GameChartStat) {
  if (stat === "completion_rate") {
    return point.level_starts > 0 ? (point.level_completions * 100) / point.level_starts : 0;
  }
  return Number(point[stat] ?? 0);
}

type CurrentPoint = TimeSeriesChartPoint & { currentTime: DateTime };
type PreviousPoint = TimeSeriesChartPoint & { originalTime: DateTime };

export function GameActivityChart({
  data,
  previousData,
  selectedStat,
}: {
  data?: GameOverviewBucketedResponse;
  previousData?: GameOverviewBucketedResponse;
  selectedStat: GameChartStat;
}) {
  const { time, previousTime, bucket } = useStore();
  const timezone = getTimezone();

  const { current, previous, chartMin, chartMax, max, displayDashed } = useMemo(() => {
    const { min, max: periodMax } = getChartTimeBounds(time, bucket, timezone);
    const now = DateTime.now();
    const upperBound = periodMax ?? now.toJSDate();
    const currentPoints: CurrentPoint[] = [];

    data?.forEach(point => {
      const timestamp = DateTime.fromSQL(point.time, { zone: timezone }).toUTC();
      if (
        timestamp > now ||
        (min && timestamp.toMillis() < min.getTime()) ||
        timestamp.toMillis() > upperBound.getTime()
      ) {
        return;
      }
      currentPoints.push({
        x: timestamp.toJSDate(),
        y: getGameChartValue(point, selectedStat),
        currentTime: timestamp,
      });
    });

    const { min: previousMin } = getChartTimeBounds(previousTime, bucket, timezone);
    const offset = min && previousMin ? min.getTime() - previousMin.getTime() : 0;
    const previousPoints: PreviousPoint[] = [];

    previousData?.forEach(point => {
      const originalTime = DateTime.fromSQL(point.time, { zone: timezone }).toUTC();
      const mappedTime = new Date(originalTime.toMillis() + offset);
      if ((min && mappedTime.getTime() < min.getTime()) || mappedTime.getTime() > upperBound.getTime()) return;
      previousPoints.push({ x: mappedTime, y: getGameChartValue(point, selectedStat), originalTime });
    });

    const values = [...currentPoints, ...previousPoints].map(point => point.y);
    return {
      current: currentPoints,
      previous: previousPoints,
      chartMin: min ?? currentPoints[0]?.x,
      chartMax: periodMax ?? currentPoints.at(-1)?.x ?? now.toJSDate(),
      max: Math.max(0, ...values),
      displayDashed: currentPoints.length >= 2 && time.mode !== "all-time" && time.mode !== "year",
    };
  }, [bucket, data, previousData, previousTime, selectedStat, time, timezone]);

  const formatValue = (value: number) =>
    selectedStat === "completion_rate" ? `${value.toFixed(1)}%` : value.toLocaleString();

  return (
    <TimeSeriesChart
      current={current}
      previous={previous}
      max={max}
      chartMin={chartMin}
      chartMax={chartMax}
      displayDashed={displayDashed}
      renderTooltip={({ point, previousPoint, bucket }) => (
        <ChartTooltip>
          <div className="m-2 flex flex-col gap-1">
            <div className="flex justify-between gap-4 text-sm">
              <span>{formatChartDateTime(point.currentTime, bucket)}</span>
              <span>{formatValue(point.y)}</span>
            </div>
            {previousPoint && (
              <div className="flex justify-between gap-4 text-sm text-muted-foreground">
                <span>{formatChartDateTime(previousPoint.originalTime, bucket)}</span>
                <span>{formatValue(previousPoint.y)}</span>
              </div>
            )}
          </div>
        </ChartTooltip>
      )}
    />
  );
}
