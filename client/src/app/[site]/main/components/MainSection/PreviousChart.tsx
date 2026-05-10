"use client";
import { useNivoTheme } from "@/lib/nivo";
import { getTimezone, useStore } from "@/lib/store";
import { useTheme } from "next-themes";
import { ResponsiveLine } from "@nivo/line";
import { DateTime } from "luxon";
import { GetOverviewBucketedResponse } from "../../../../../api/analytics/endpoints";
import { APIResponse } from "../../../../../api/types";
import { getChartTimeBounds } from "./chartTimeBounds";

export function PreviousChart({
  data,
  max,
  chartXMax,
}: {
  data: APIResponse<GetOverviewBucketedResponse> | undefined;
  max: number;
  chartXMax: Date | undefined;
}) {
  const { time, previousTime, selectedStat, bucket } = useStore();
  const { resolvedTheme } = useTheme();
  const nivoTheme = useNivoTheme();

  const timezone = getTimezone();

  // Plot previous data on the CURRENT period's x-axis. Each previous timestamp
  // is shifted by (currentStart − prevStart) so the i-th bucket of each period
  // sits at the same x position — keeps day-of-month alignment when the months
  // have different lengths (e.g. April vs March). Drop anything past the
  // shared right edge so the previous line stops where the current line does.
  const { min: chartMin, max: boundsMax } = getChartTimeBounds(time, bucket, timezone);
  const { min: prevMin } = getChartTimeBounds(previousTime, bucket, timezone);
  const offsetMs = chartMin && prevMin ? chartMin.getTime() - prevMin.getTime() : 0;
  const chartMax = chartXMax ?? boundsMax;

  const formattedData = data?.data?.flatMap(e => {
    const prevTs = DateTime.fromSQL(e.time, { zone: timezone });
    const mappedMs = prevTs.toMillis() + offsetMs;
    if (chartMax && mappedMs > chartMax.getTime()) return [];
    return [
      {
        x: DateTime.fromMillis(mappedMs, { zone: "utc" }).toFormat("yyyy-MM-dd HH:mm:ss"),
        y: e[selectedStat],
      },
    ];
  });

  return (
    <ResponsiveLine
      data={[
        {
          id: "1",
          data: formattedData ?? [],
        },
      ]}
      theme={nivoTheme}
      margin={{ top: 10, right: 15, bottom: 30, left: 40 }}
      xScale={{
        type: "time",
        format: "%Y-%m-%d %H:%M:%S",
        precision: "second",
        useUTC: true,
        min: chartMin,
        max: chartMax,
      }}
      yScale={{
        type: "linear",
        min: 0,
        stacked: false,
        reverse: false,
        max: Math.max(max, 1),
      }}
      enableGridX={false}
      enableGridY={false}
      yFormat=" >-.2f"
      axisTop={null}
      axisRight={null}
      axisBottom={{
        tickSize: 5,
        tickPadding: 10,
        tickRotation: 0,
        truncateTickAt: 0,
        tickValues: 0,
        format: value => {
          const localTime = DateTime.fromJSDate(value, { zone: "utc" }).setZone(getTimezone());

          if ((time.mode === "past-minutes" && time.pastMinutesStart >= 1440) || time.mode === "day") {
            return localTime.toFormat("ha");
          } else if (time.mode === "range") {
            return localTime.toFormat("MMM d");
          } else if (time.mode === "week") {
            return localTime.toFormat("MMM d");
          } else if (time.mode === "month") {
            return localTime.toFormat("MMM d");
          }
          return "";
        },
      }}
      axisLeft={{
        tickSize: 5,
        tickPadding: 10,
        tickRotation: 0,
        truncateTickAt: 0,
        tickValues: 0,
      }}
      enableTouchCrosshair={true}
      enablePoints={false}
      useMesh={true}
      animate={false}
      // motionConfig="stiff"
      enableSlices={"x"}
      colors={[resolvedTheme === "dark" ? "hsl(var(--neutral-700))" : "hsl(var(--neutral-100))"]}
    />
  );
}
