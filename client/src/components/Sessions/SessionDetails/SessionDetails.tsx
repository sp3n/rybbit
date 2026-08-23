import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight } from "lucide-react";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useGetSite } from "../../../api/admin/hooks/useSites";
import { useGetSessionDetailsInfinite } from "../../../api/analytics/hooks/useGetUserSessions";
import { GetSessionsResponse, SessionEvent } from "../../../api/analytics/endpoints";
import { Button } from "../../ui/button";
import { canonicalizeGameEvents, GAME_EVENT_CATEGORIES, GameEventCategory, getGameEventCategory } from "../gameEvents";
import { SessionDetailsTimelineSkeleton } from "./SessionDetailsTimelineSkeleton";
import { SessionInfoTab } from "./SessionInfoTab";
import { TimelineTab } from "./TimelineTab";

interface SessionDetailsProps {
  session: GetSessionsResponse[number];
  userId?: string;
  highlightedEventTimestamp?: number;
}

export function SessionDetails({ session, userId, highlightedEventTimestamp }: SessionDetailsProps) {
  const {
    data: sessionDetailsData,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGetSessionDetailsInfinite(session.session_id);
  const { site } = useParams();
  const { data: siteMetadata } = useGetSite(site as string);
  const t = useExtracted();
  const isGame = siteMetadata?.type === "game";

  // Flatten all events into a single array
  const allEvents = useMemo(() => {
    if (!sessionDetailsData?.pages) return [];
    return sessionDetailsData.pages.flatMap(page => page?.events || []);
  }, [sessionDetailsData?.pages]);

  // Get session details from the first page
  const sessionDetails = sessionDetailsData?.pages[0]?.session;

  // Event type filter state
  const [visibleEventTypes, setVisibleEventTypes] = useState<Set<string>>(
    new Set(["pageview", "custom_event", "outbound", "button_click", "copy", "form_submit", "input_change"])
  );
  const [visibleGameCategories, setVisibleGameCategories] = useState<Set<GameEventCategory>>(
    new Set(GAME_EVENT_CATEGORIES)
  );

  const toggleEventType = (type: string) => {
    setVisibleEventTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  const toggleGameCategory = (category: GameEventCategory | "all") => {
    setVisibleGameCategories(previous => {
      if (category === "all") {
        return new Set<GameEventCategory>(GAME_EVENT_CATEGORIES);
      }
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const timelineEvents = useMemo(() => (isGame ? canonicalizeGameEvents(allEvents) : allEvents), [allEvents, isGame]);

  // Filter events based on visible types
  const filteredEvents = useMemo(() => {
    return timelineEvents.filter((event: SessionEvent) =>
      isGame ? visibleGameCategories.has(getGameEventCategory(event)) : visibleEventTypes.has(event.type)
    );
  }, [isGame, timelineEvents, visibleEventTypes, visibleGameCategories]);

  const isIdentified = !!session.identified_user_id;

  return (
    <div className="px-4 bg-white dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-850">
      {isLoading ? (
        <SessionDetailsTimelineSkeleton
          itemCount={isGame ? session.game_actions : session.pageviews + session.events}
        />
      ) : error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{t("Error loading session details. Please try again.")}</AlertDescription>
        </Alert>
      ) : sessionDetailsData?.pages[0] ? (
        <Tabs defaultValue="timeline" className="mt-4">
          <div className="flex justify-between items-center mb-6">
            <TabsList>
              <TabsTrigger value="timeline">{isGame ? t("Actions") : t("Timeline")}</TabsTrigger>
              <TabsTrigger value="info">{isGame ? t("Play Session Info") : t("Session Info")}</TabsTrigger>
            </TabsList>
            {!userId && (
              <Link
                href={`/${site}/user/${encodeURIComponent(
                  isIdentified ? session.identified_user_id : session.user_id
                )}`}
              >
                <Button size={"sm"} variant={"success"}>
                  {isGame ? t("View Player") : t("View User")} <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>

          <TabsContent value="timeline">
            <TimelineTab
              highlightedEventTimestamp={highlightedEventTimestamp}
              allEvents={timelineEvents}
              filteredEvents={filteredEvents}
              visibleEventTypes={visibleEventTypes}
              onToggleEventType={toggleEventType}
              isGame={isGame}
              visibleGameCategories={visibleGameCategories}
              onToggleGameCategory={toggleGameCategory}
              sessionEnd={sessionDetails?.session_end}
              hasNextPage={hasNextPage ?? false}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
              totalEvents={isGame ? session.game_actions : (sessionDetailsData.pages[0]?.pagination?.total ?? 0)}
            />
          </TabsContent>

          <TabsContent value="info" className="mt-4">
            {sessionDetails && <SessionInfoTab session={session} sessionDetails={sessionDetails} />}
          </TabsContent>
        </Tabs>
      ) : (
        <div className="py-4 text-center text-neutral-400">{t("No data available")}</div>
      )}
    </div>
  );
}
