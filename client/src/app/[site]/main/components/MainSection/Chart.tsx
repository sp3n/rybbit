"use client";
import { useNivoTheme } from "@/lib/nivo";
import { StatType, useStore } from "@/lib/store";
import { LineCustomSvgLayer, LineCustomSvgLayerProps, LineSeries, ResponsiveLine } from "@nivo/line";
import { useWindowSize } from "@uidotdev/usehooks";
import { DateTime } from "luxon";
import { GetOverviewBucketedResponse } from "../../../../../api/analytics/endpoints";
import { APIResponse } from "../../../../../api/types";
import { formatSecondsAsMinutesAndSeconds, formatter } from "../../../../../lib/utils";
import { userLocale, hour12, formatChartDateTime } from "../../../../../lib/dateTimeUtils";
import { getTimezone } from "../../../../../lib/store";
import { ChartTooltip } from "../../../../../components/charts/ChartTooltip";
import { getChartTimeBounds } from "./chartTimeBounds";

const formatTooltipValue = (value: number, selectedStat: StatType): string => {
  if (selectedStat === "bounce_rate") {
    return `${value.toFixed(1)}%`;
  }
  if (selectedStat === "session_duration") {
    return formatSecondsAsMinutesAndSeconds(value);
  }
  return value.toLocaleString();
};

const Y_TICK_VALUES = 5;

export function Chart({
  data,
  previousData,
  max,
  chartXMax,
}: {
  data: APIResponse<GetOverviewBucketedResponse> | undefined;
  previousData: APIResponse<GetOverviewBucketedResponse> | undefined;
  max: number;
  chartXMax: Date | undefined;
}) {
  const { time, bucket, selectedStat } = useStore();
  const { width } = useWindowSize();
  const nivoTheme = useNivoTheme();
  const timezone = getTimezone();

  const { min: chartMin, max: boundsMax } = getChartTimeBounds(time, bucket, timezone);
  // Prefer the actual last-current-bucket so the line reaches the right edge;
  // fall back to the period boundary when there's no current data.
  const chartMax = chartXMax ?? boundsMax;

  const maxTicks = Math.round((width ?? Infinity) / 75);

  // Pair current and previous datapoints by index from the START of each
  // period (Mar 1 ↔ Feb 1, Mar 2 ↔ Feb 2, …). If the current period has more
  // datapoints than the previous (e.g. March 31d vs Feb 28d), the trailing
  // current days have no previous twin — matches PreviousChart's overlay,
  // which shifts previous data onto the current period's x-axis.
  const formattedData =
    data?.data
      ?.map((e, i) => {
        // Parse timestamp in the selected timezone, then convert to UTC for chart
        const timestamp = DateTime.fromSQL(e.time, { zone: timezone }).toUTC();

        // filter out dates from the future
        if (timestamp > DateTime.now()) {
          return null;
        }

        const prevPoint = previousData?.data?.[i];

        return {
          x: timestamp.toFormat("yyyy-MM-dd HH:mm:ss"),
          y: e[selectedStat],
          previousY: prevPoint ? prevPoint[selectedStat] : false,
          currentTime: timestamp,
          previousTime: prevPoint
            ? DateTime.fromSQL(prevPoint.time, { zone: timezone }).toUTC()
            : undefined,
        };
      })
      .filter(e => e !== null) || [];

  const currentDayStr = DateTime.now().toISODate();
  const currentMonthStr = DateTime.now().toFormat("yyyy-MM-01");
  const shouldNotDisplay =
    time.mode === "all-time" || // do not display in all-time mode
    time.mode === "year" || // do not display in year mode
    (time.mode === "month" && time.month !== currentMonthStr) || // do not display in month mode if month is not current
    (time.mode === "day" && time.day !== currentDayStr) || // do not display in day mode if day is not current
    (time.mode === "range" && time.endDate !== currentDayStr) || // do not display in range mode if end date is not current day
    (time.mode === "day" && (bucket === "minute" || bucket === "five_minutes")) || // do not display in day mode if bucket is minute or five_minutes
    (time.mode === "past-minutes" && (bucket === "minute" || bucket === "five_minutes")); // do not display in 24-hour mode if bucket is minute or five_minutes
  const displayDashed = formattedData.length >= 2 && !shouldNotDisplay;

  const baseGradient = {
    offset: 0,
    color: "hsl(var(--dataviz))",
  };

  const croppedData = formattedData.slice(0, -1);

  // add original data and styles to chart
  const chartPropsData = [
    {
      id: "croppedData",
      data: displayDashed ? croppedData : formattedData,
    },
  ];
  const chartPropsDefs = [
    {
      id: "croppedData",
      type: "linearGradient",
      colors: [
        { ...baseGradient, opacity: 1 },
        { offset: 100, color: baseGradient.color, opacity: 0 },
      ],
    },
  ];
  const chartPropsFill = [
    {
      id: "croppedData",
      match: {
        id: "croppedData",
      },
    },
  ];

  // add dashed data and styles to chart
  if (displayDashed) {
    chartPropsData.push({
      id: "dashedData",
      data: [croppedData.at(-1)!, formattedData.at(-1)!],
    });
    chartPropsDefs.push({
      id: "dashedData",
      type: "linearGradient",
      colors: [
        { ...baseGradient, opacity: 0.35 },
        { offset: 100, color: baseGradient.color, opacity: 0 },
      ],
    });
    chartPropsFill.push({
      id: "dashedData",
      match: {
        id: "dashedData",
      },
    });
  }

  const DashedLine: LineCustomSvgLayer<LineSeries> = ({
    series,
    lineGenerator,
    xScale,
    yScale,
  }: LineCustomSvgLayerProps<LineSeries>) => {
    return series.map(({ id, data, color }) => (
      <path
        key={id}
        d={lineGenerator(data.map(d => ({ x: xScale(d.data.x), y: yScale(d.data.y) })))!}
        fill="none"
        stroke={color}
        style={id === "dashedData" ? { strokeDasharray: "3, 6", strokeWidth: 3 } : { strokeWidth: 2 }}
      />
    ));
  };

  return (
    <ResponsiveLine
      data={chartPropsData}
      theme={nivoTheme}
      margin={{ top: 10, right: 15, bottom: 30, left: 40 }}
      xScale={{
        type: "time",
        format: "%Y-%m-%d %H:%M:%S",
        precision: "second",
        useUTC: true,
        max: chartMax,
        min: chartMin,
      }}
      yScale={{
        type: "linear",
        min: 0,
        stacked: false,
        reverse: false,
        max: Math.max(max, 1),
      }}
      enableGridX={true}
      enableGridY={true}
      gridYValues={Y_TICK_VALUES}
      yFormat=" >-.2f"
      axisTop={null}
      axisRight={null}
      axisBottom={{
        tickSize: 5,
        tickPadding: 10,
        tickRotation: 0,
        truncateTickAt: 0,
        tickValues: Math.min(
          maxTicks,
          time.mode === "day" || (time.mode === "past-minutes" && time.pastMinutesStart === 1440)
            ? 24
            : Math.min(12, data?.data?.length ?? 0)
        ),
        format: value => {
          const dt = DateTime.fromJSDate(value, { zone: "utc" }).setZone(getTimezone()).setLocale(userLocale);
          if (time.mode === "past-minutes") {
            if (time.pastMinutesStart < 1440) {
              return dt.toFormat(hour12 ? "h:mm" : "HH:mm");
            }
            return dt.toFormat(hour12 ? "ha" : "HH:mm");
          }
          if (time.mode === "day") {
            return dt.toFormat(hour12 ? "ha" : "HH:mm");
          }
          return dt.toFormat(hour12 ? "MMM d" : "dd MMM");
        },
      }}
      axisLeft={{
        tickSize: 5,
        tickPadding: 10,
        tickRotation: 0,
        truncateTickAt: 0,
        tickValues: Y_TICK_VALUES,
        format: formatter,
      }}
      enableTouchCrosshair={true}
      enablePoints={false}
      useMesh={true}
      animate={false}
      enableSlices={"x"}
      colors={["hsl(var(--dataviz))"]}
      enableArea={true}
      areaBaselineValue={0}
      areaOpacity={0.3}
      defs={chartPropsDefs}
      fill={chartPropsFill}
      sliceTooltip={({ slice }: any) => {
        const currentY = Number(slice.points[0].data.yFormatted);
        const previousY = Number(slice.points[0].data.previousY) || 0;
        const currentTime = slice.points[0].data.currentTime as DateTime;
        const previousTime = slice.points[0].data.previousTime as DateTime;

        const diff = currentY - previousY;
        const diffPercentage = previousY ? (diff / previousY) * 100 : null;

        return (
          <ChartTooltip>
            {diffPercentage !== null && (
              <div
                className="text-base font-medium px-2 pt-1.5 pb-1"
                style={{
                  color: diffPercentage > 0 ? "hsl(var(--green-400))" : "hsl(var(--red-400))",
                }}
              >
                {diffPercentage > 0 ? "+" : ""}
                {diffPercentage.toFixed(2)}%
              </div>
            )}
            <div className="w-full h-px bg-neutral-100 dark:bg-neutral-750"></div>

            <div className="m-2">
              <div className="flex justify-between text-sm w-40">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-3 rounded-[3px] bg-dataviz" />
                  {formatChartDateTime(currentTime, bucket)}
                </div>
                <div>{formatTooltipValue(currentY, selectedStat)}</div>
              </div>
              {previousTime && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-3 rounded-[3px] bg-neutral-200 dark:bg-neutral-750" />
                    {formatChartDateTime(previousTime, bucket)}
                  </div>
                  <div>{formatTooltipValue(previousY, selectedStat)}</div>
                </div>
              )}
            </div>
          </ChartTooltip>
        );
      }}
      layers={[
        "grid",
        "markers",
        "axes",
        "areas",
        "crosshair",
        displayDashed ? DashedLine : "lines",
        // "lines",
        "slices",
        "points",
        "mesh",
        "legends",
      ]}
    />
  );
}
