import { SessionEvent } from "@/api/analytics/endpoints";
import { formatDuration } from "@/lib/dateTimeUtils";

export const GAME_EVENT_CATEGORIES = ["progression", "gameplay", "menus", "system", "other"] as const;

export type GameEventCategory = (typeof GAME_EVENT_CATEGORIES)[number];

const PROGRESSION_ACTIONS = new Set([
  "start",
  "started",
  "completed",
  "failed",
  "retry",
  "restart",
  "quit",
  "quitmenu",
  "leave",
  "progress",
  "skip",
  "trophy",
]);

const GAMEPLAY_ACTIONS = new Set(["built", "upgraded", "destroyed", "pause", "resume", "activity"]);

const INTERNAL_GAME_PROPERTIES = new Set([
  "telemetry_schema",
  "source_endpoint",
  "platform_code",
  "platform_family",
  "platform_model",
  "storefront",
  "form_factor",
  "play_session_id",
  "telemetry_test",
  "legacy_source",
  "legacy_reconstructed",
  "legacy_reconstruction",
  "legacy_export_start",
  "legacy_export_end",
]);

const PROPERTY_LABELS: Record<string, string> = {
  active_towers: "Active towers",
  build_version: "Build",
  creeps_killed: "Creeps killed",
  difficulty: "Difficulty",
  lives_remaining: "Lives remaining",
  local_play_mode: "Play mode",
  logged_in: "Logged in",
  loggedin: "Logged in",
  play_mode: "Play mode",
  player1_combo: "Player 1 combo",
  player1_score: "Player 1 score",
  player2_combo: "Player 2 combo",
  player2_score: "Player 2 score",
  time_spent: "Duration",
  tower_level: "Tower level",
  tower_name: "Tower",
  tower_plot: "Plot",
  tower_strength: "Tower strength",
  version: "Build",
  wave_number: "Wave",
};

const PROPERTY_PRIORITY = [
  "time_spent",
  "difficulty",
  "play_mode",
  "local_play_mode",
  "build_version",
  "version",
  "wave_number",
  "creeps_killed",
  "lives_remaining",
  "active_towers",
  "tower_name",
  "tower_level",
  "tower_plot",
  "tower_strength",
  "player1_score",
  "player1_combo",
  "player2_score",
  "player2_combo",
  "logged_in",
  "loggedin",
];

const ACTION_LABELS: Record<string, string> = {
  activity: "Activity",
  built: "Tower built",
  completed: "Completed",
  destroyed: "Tower destroyed",
  failed: "Failed",
  foreground: "Foregrounded",
  background: "Backgrounded",
  home: "Returned home",
  deactivate: "Deactivated",
  leave: "Left",
  pause: "Paused",
  progress: "Progressed",
  quit: "Quit",
  quitmenu: "Quit to menu",
  ready: "Ready",
  restart: "Restarted",
  resume: "Resumed",
  retry: "Retried",
  skip: "Skipped",
  skiplogin: "Skipped login",
  start: "Started",
  started: "Started",
  terminate: "Terminated",
  trophy: "Trophy earned",
  upgraded: "Tower upgraded",
};

export function getGameEventName(event: SessionEvent) {
  return event.event_name?.trim() || event.pathname?.trim() || "Unknown action";
}

function splitIdentifier(value: string) {
  return value
    .replace(/^L_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

export function getGameEventActionTokens(event: SessionEvent) {
  return getGameEventName(event)
    .replace(/^\/+/, "")
    .split("/")
    .slice(1)
    .filter(Boolean)
    .map(part => part.toLowerCase());
}

export function getGameEventCategory(event: SessionEvent): GameEventCategory {
  const parts = getGameEventName(event).replace(/^\/+/, "").split("/").filter(Boolean);
  const root = parts[0]?.toLowerCase() ?? "";
  const actions = parts.slice(1).map(part => part.toLowerCase());

  if (root === "system") return "system";
  if (root === "menu") return "menus";
  if (actions.some(action => GAMEPLAY_ACTIONS.has(action))) return "gameplay";
  if (actions.some(action => PROGRESSION_ACTIONS.has(action))) return "progression";
  return "other";
}

export function formatGameEventName(event: SessionEvent) {
  const parts = getGameEventName(event).replace(/^\/+/, "").split("/").filter(Boolean);
  const context = splitIdentifier(parts[0] || "Unknown");
  const actions = parts.slice(1).map(part => ACTION_LABELS[part.toLowerCase()] || splitIdentifier(part));
  return actions.length > 0 ? `${context} · ${actions.join(" · ")}` : context;
}

/**
 * Legacy RybbitHole builds sent the same action as a pageview and custom event.
 * Pair only those two representations, preserving legitimate repeated actions
 * of the same type that happened within the same timestamp bucket.
 */
export function canonicalizeGameEvents(events: SessionEvent[]) {
  const groups = new Map<string, { event: SessionEvent; index: number }[]>();

  events.forEach((event, index) => {
    const key = `${event.timestamp}\u0000${getGameEventName(event)}`;
    const group = groups.get(key) ?? [];
    group.push({ event, index });
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .flatMap(group => {
      const customEvents = group.filter(({ event }) => event.type === "custom_event");
      const pageviews = group.filter(({ event }) => event.type === "pageview");
      const otherEvents = group.filter(({ event }) => event.type !== "custom_event" && event.type !== "pageview");

      if (customEvents.length === 0 || pageviews.length === 0) return group;
      return [...customEvents, ...pageviews.slice(customEvents.length), ...otherEvents];
    })
    .sort((a, b) => a.index - b.index)
    .map(({ event }) => event);
}

function humanizePropertyName(key: string) {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function cleanTowerName(value: unknown) {
  return String(value)
    .replace(/^BP_Tower_/, "")
    .replace(/_C_\d+$/, "")
    .replace(/_/g, " ");
}

function cleanPlotName(value: unknown) {
  return String(value)
    .replace(/^BP_Plot(?:_C)?_?/, "Plot ")
    .replace(/_/g, " ")
    .trim();
}

function formatPropertyValue(key: string, value: unknown) {
  if (key === "time_spent" && Number.isFinite(Number(value))) return formatDuration(Number(value));
  if (key === "tower_name") return cleanTowerName(value);
  if (key === "tower_plot") return cleanPlotName(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "logged_in" || key === "loggedin") return String(value).toLowerCase() === "true" ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getGameEventProperties(event: SessionEvent) {
  const props = event.props ?? {};
  const entries = Object.entries(props).filter(([key, value]) => {
    if (INTERNAL_GAME_PROPERTIES.has(key) || value === undefined || value === null || value === "") return false;
    if (key === "version" && props.build_version !== undefined) return false;
    if (key === "local_play_mode" && props.play_mode !== undefined) return false;
    return true;
  });

  return entries
    .sort(([left], [right]) => {
      const leftPriority = PROPERTY_PRIORITY.indexOf(left);
      const rightPriority = PROPERTY_PRIORITY.indexOf(right);
      return (leftPriority === -1 ? 999 : leftPriority) - (rightPriority === -1 ? 999 : rightPriority);
    })
    .map(([key, value]) => ({
      key,
      label: PROPERTY_LABELS[key] || humanizePropertyName(key),
      value: formatPropertyValue(key, value),
    }));
}
