import { Loader2 } from "lucide-react";
import { useExtracted } from "next-intl";
import { useMemo } from "react";
import { SessionEvent } from "../../../api/analytics/endpoints";
import { EventTypeFilter } from "../../EventTypeFilter";
import { Button } from "../../ui/button";
import { GameEventCategoryFilter } from "../GameEventCategoryFilter";
import { GameEventCategory } from "../gameEvents";
import { PageviewItem } from "./PageviewItem";

interface TimelineTabProps {
  allEvents: SessionEvent[];
  filteredEvents: SessionEvent[];
  visibleEventTypes: Set<string>;
  onToggleEventType: (type: string) => void;
  isGame?: boolean;
  visibleGameCategories: Set<GameEventCategory>;
  onToggleGameCategory: (category: GameEventCategory | "all") => void;
  sessionEnd?: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  totalEvents: number;
  highlightedEventTimestamp?: number;
}

export function TimelineTab({
  highlightedEventTimestamp,
  allEvents,
  filteredEvents,
  visibleEventTypes,
  onToggleEventType,
  isGame = false,
  visibleGameCategories,
  onToggleGameCategory,
  sessionEnd,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  totalEvents,
}: TimelineTabProps) {
  const t = useExtracted();
  const showHostname = useMemo(() => {
    if (isGame) return false;
    const hostnames = new Set(allEvents.filter(e => e.type === "pageview").map(e => e.hostname));
    return hostnames.size > 1;
  }, [allEvents, isGame]);

  return (
    <>
      <div className="mb-4">
        {isGame ? (
          <GameEventCategoryFilter
            visibleCategories={visibleGameCategories}
            onToggle={onToggleGameCategory}
            events={allEvents}
          />
        ) : (
          <EventTypeFilter visibleTypes={visibleEventTypes} onToggle={onToggleEventType} events={allEvents} />
        )}
      </div>
      <div className="mb-4 px-1">
        {filteredEvents.map((pageview: SessionEvent, index: number) => {
          let nextTimestamp;
          if (index < filteredEvents.length - 1) {
            nextTimestamp = filteredEvents[index + 1].timestamp;
          } else if (sessionEnd) {
            nextTimestamp = sessionEnd;
          }

          return (
            <PageviewItem
              key={`${pageview.timestamp}-${index}`}
              item={pageview}
              index={index}
              isLast={index === filteredEvents.length - 1 && !hasNextPage}
              nextTimestamp={nextTimestamp}
              showHostname={showHostname}
              isGame={isGame}
              highlightedEventTimestamp={highlightedEventTimestamp}
            />
          );
        })}

        {hasNextPage && (
          <div className="flex justify-center mt-6 mb-4">
            <Button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              variant="outline"
              className="flex items-center gap-2"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t("Loading...")}</span>
                </>
              ) : (
                <span>{t("Load More")}</span>
              )}
            </Button>
          </div>
        )}

        {totalEvents > 0 && (
          <div className="text-center text-xs text-neutral-400 dark:text-neutral-500 mt-2">
            {isGame
              ? t("Showing {shown} of {total} actions", {
                  shown: String(allEvents.length),
                  total: String(totalEvents),
                })
              : t("Showing {shown} of {total} events", {
                  shown: String(allEvents.length),
                  total: String(totalEvents),
                })}
          </div>
        )}
      </div>
    </>
  );
}
