"use client";

import { Ellipsis, Gamepad2, ListFilter, PanelsTopLeft, Power, Trophy } from "lucide-react";
import { useExtracted } from "next-intl";
import { useMemo } from "react";
import { SessionEvent } from "@/api/analytics/endpoints";
import { cn } from "@/lib/utils";
import { ToggleChip } from "../ToggleChip";
import { GAME_EVENT_CATEGORIES, GameEventCategory, getGameEventCategory } from "./gameEvents";

interface GameEventCategoryFilterProps {
  visibleCategories: Set<GameEventCategory>;
  onToggle: (category: GameEventCategory | "all") => void;
  events: SessionEvent[];
}

export function GameEventCategoryFilter({ visibleCategories, onToggle, events }: GameEventCategoryFilterProps) {
  const t = useExtracted();
  const counts = useMemo(() => {
    const result: Record<GameEventCategory, number> = {
      progression: 0,
      gameplay: 0,
      menus: 0,
      system: 0,
      other: 0,
    };
    events.forEach(event => {
      result[getGameEventCategory(event)] += 1;
    });
    return result;
  }, [events]);

  const options = [
    { value: "progression" as const, label: t("Progression"), icon: Trophy, color: "text-emerald-500" },
    { value: "gameplay" as const, label: t("Gameplay"), icon: Gamepad2, color: "text-violet-500" },
    { value: "menus" as const, label: t("Menus"), icon: PanelsTopLeft, color: "text-fuchsia-500" },
    { value: "system" as const, label: t("System"), icon: Power, color: "text-sky-500" },
    { value: "other" as const, label: t("Other"), icon: Ellipsis, color: "text-neutral-500" },
  ];
  const allSelected = GAME_EVENT_CATEGORIES.every(category => visibleCategories.has(category));

  const countBadge = (count: number, selected: boolean) =>
    count > 0 ? (
      <span
        className={cn(
          "ml-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
          selected
            ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300"
            : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500"
        )}
      >
        {count}
      </span>
    ) : null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <ToggleChip
        isSelected={allSelected}
        onClick={() => onToggle("all")}
        indicator={<ListFilter className="h-3 w-3 text-amber-500" />}
        label={t("All actions")}
        rightAdornment={countBadge(events.length, allSelected)}
      />
      {options.map(option => {
        const selected = visibleCategories.has(option.value);
        const Icon = option.icon;
        return (
          <ToggleChip
            key={option.value}
            isSelected={selected}
            onClick={() => onToggle(option.value)}
            indicator={<Icon className={cn("h-3 w-3", option.color)} />}
            label={option.label}
            rightAdornment={countBadge(counts[option.value], selected)}
          />
        );
      })}
    </div>
  );
}
