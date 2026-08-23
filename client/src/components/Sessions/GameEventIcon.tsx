import {
  ArrowUpCircle,
  CircleX,
  Gamepad2,
  Hammer,
  LogOut,
  PanelsTopLeft,
  Play,
  Power,
  RotateCcw,
  Trash2,
  Trophy,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SessionEvent } from "@/api/analytics/endpoints";
import { formatGameEventName, getGameEventActionTokens, getGameEventCategory } from "./gameEvents";

export function GameEventIcon({ event, className }: { event: SessionEvent; className?: string }) {
  const actions = getGameEventActionTokens(event);
  const category = getGameEventCategory(event);
  let Icon = Gamepad2;
  let color = "text-neutral-500";

  if (actions.includes("completed") || actions.includes("trophy")) {
    Icon = Trophy;
    color = "text-emerald-500";
  } else if (actions.includes("failed")) {
    Icon = CircleX;
    color = "text-red-500";
  } else if (actions.some(action => ["quit", "quitmenu", "leave"].includes(action))) {
    Icon = LogOut;
    color = "text-orange-500";
  } else if (actions.some(action => ["retry", "restart"].includes(action))) {
    Icon = RotateCcw;
    color = "text-amber-500";
  } else if (actions.some(action => ["started", "start"].includes(action))) {
    Icon = Play;
    color = "text-cyan-500";
  } else if (actions.includes("built")) {
    Icon = Hammer;
    color = "text-violet-500";
  } else if (actions.includes("upgraded")) {
    Icon = ArrowUpCircle;
    color = "text-blue-500";
  } else if (actions.includes("destroyed")) {
    Icon = Trash2;
    color = "text-rose-500";
  } else if (category === "menus") {
    Icon = PanelsTopLeft;
    color = "text-fuchsia-500";
  } else if (category === "system") {
    Icon = Power;
    color = "text-sky-500";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Icon className={cn("h-4 w-4", color, className)} />
      </TooltipTrigger>
      <TooltipContent>{formatGameEventName(event)}</TooltipContent>
    </Tooltip>
  );
}
