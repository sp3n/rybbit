"use client";

import { useExtracted } from "next-intl";
import { useGetEventNames } from "@/api/analytics/hooks/events/useGetEventNames";
import { CardLoader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EventList } from "../../../events/components/EventList";
import { TabbedSectionCard, type TabbedSectionItem } from "../../../components/shared/TabbedSectionCard";

export function GameEvents() {
  const t = useExtracted();
  const { data, isLoading } = useGetEventNames();
  const tabs: TabbedSectionItem<"actions">[] = [
    {
      value: "actions",
      label: t("Game Events"),
      content: (
        <div className="relative pr-2">
          {isLoading && <CardLoader />}
          <div className="mb-2 flex justify-between pr-1 text-xs text-muted-foreground">
            <span>{t("Action")}</span>
            <span>{t("Count")}</span>
          </div>
          <ScrollArea className="h-[314px]" viewportClassName="[&>div]:!block">
            <EventList events={data || []} isLoading={isLoading} />
          </ScrollArea>
        </div>
      ),
    },
  ];

  return <TabbedSectionCard defaultValue="actions" tabs={tabs} />;
}
