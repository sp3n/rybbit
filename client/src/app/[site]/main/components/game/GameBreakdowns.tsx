"use client";

import { useExtracted } from "next-intl";
import { ReactNode } from "react";
import { useGetGameBreakdowns } from "@/api/analytics/hooks/useGetGameAnalytics";
import { GameBreakdownItem } from "@/api/analytics/endpoints";
import { GamePlatformIcon, getGamePlatformInfo } from "@/components/GamePlatform";
import { CardLoader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatSecondsAsMinutesAndSeconds } from "@/lib/utils";
import { TabbedSectionCard, TabbedSectionItem } from "../../../components/shared/TabbedSectionCard";

function EmptyMessage() {
  const t = useExtracted();
  return <div className="py-12 text-center text-sm text-muted-foreground">{t("No game data in this period")}</div>;
}

function BreakdownList({
  items,
  label,
}: {
  items?: GameBreakdownItem[];
  label?: (item: GameBreakdownItem) => ReactNode;
}) {
  const t = useExtracted();
  if (!items?.length) return <EmptyMessage />;
  const max = Math.max(...items.map(item => item.actions), 1);

  return (
    <ScrollArea className="h-[314px]">
      <div className="space-y-1.5 pr-2">
        <div className="flex justify-between px-2 text-xs text-muted-foreground">
          <span>{t("Dimension")}</span>
          <span>{t("Actions · Players")}</span>
        </div>
        {items.map(item => (
          <div key={item.value} className="relative overflow-hidden rounded-md px-2 py-2">
            <div
              className="absolute inset-y-0 left-0 bg-neutral-100 dark:bg-neutral-850"
              style={{ width: `${(item.actions / max) * 100}%` }}
            />
            <div className="relative flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0 truncate">{label ? label(item) : item.value}</div>
              <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {item.actions.toLocaleString()} · {item.players.toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function GameTechnicalBreakdowns() {
  const t = useExtracted();
  const { data, isFetching } = useGetGameBreakdowns();
  const tabs: TabbedSectionItem<"platforms" | "builds">[] = [
    {
      value: "platforms",
      label: t("Platforms"),
      content: (
        <BreakdownList
          items={data?.platforms}
          label={item => {
            const platform = getGamePlatformInfo(item.value);
            return (
              <div className="flex items-center gap-2 truncate">
                <GamePlatformIcon code={item.value} />
                <span className="truncate">{platform.label}</span>
              </div>
            );
          }}
        />
      ),
    },
    {
      value: "builds",
      label: t("Build Versions"),
      content: <BreakdownList items={data?.versions} />,
    },
  ];

  return (
    <div className="relative">
      {isFetching && <CardLoader />}
      <TabbedSectionCard defaultValue="platforms" tabs={tabs} />
    </div>
  );
}

export function GamePlayBreakdowns() {
  const t = useExtracted();
  const { data, isFetching } = useGetGameBreakdowns();
  const tabs: TabbedSectionItem<"modes" | "difficulty">[] = [
    { value: "modes", label: t("Play Modes"), content: <BreakdownList items={data?.modes} /> },
    { value: "difficulty", label: t("Difficulty"), content: <BreakdownList items={data?.difficulties} /> },
  ];

  return (
    <div className="relative">
      {isFetching && <CardLoader />}
      <TabbedSectionCard defaultValue="modes" tabs={tabs} />
    </div>
  );
}

export function GameProgression() {
  const t = useExtracted();
  const { data, isFetching } = useGetGameBreakdowns();

  return (
    <TabbedSectionCard
      defaultValue="levels"
      tabs={[
        {
          value: "levels",
          label: t("Level Progression"),
          content: (
            <div className="relative">
              {isFetching && <CardLoader />}
              {!data?.levels.length ? (
                <EmptyMessage />
              ) : (
                <ScrollArea className="h-[314px]">
                  <div className="space-y-1 pr-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_56px_56px_62px] gap-2 px-2 text-xs text-muted-foreground">
                      <span>{t("Level")}</span>
                      <span className="text-right">{t("Starts")}</span>
                      <span className="text-right">{t("Done")}</span>
                      <span className="text-right">{t("Rate")}</span>
                    </div>
                    {data.levels.map(level => (
                      <div
                        key={level.value}
                        className="grid grid-cols-[minmax(0,1fr)_56px_56px_62px] items-center gap-2 rounded-md px-2 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-850"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{level.value}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {level.failures} {t("failed")}, {level.quits} {t("quit")}, {level.retries} {t("retried")}
                            {level.median_completion_seconds !== null
                              ? ` · ${formatSecondsAsMinutesAndSeconds(level.median_completion_seconds)} ${t("median")}`
                              : ""}
                          </div>
                        </div>
                        <span className="text-right text-sm tabular-nums">{level.starts.toLocaleString()}</span>
                        <span className="text-right text-sm tabular-nums">{level.completions.toLocaleString()}</span>
                        <span className="text-right text-sm tabular-nums">{level.completion_rate.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
