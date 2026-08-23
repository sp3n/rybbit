import { DateTime } from "luxon";
import { ParsedPlausibleArchive, parsePlausibleArchive } from "./plausibleArchive";
import { PlausibleSyntheticEvent } from "./plausibleTypes";

const SECONDS_IN_DAY = 86400;
const DEFAULT_EVENT_GAP_SECONDS = 30;
const LEGACY_ROUTE = /^\/?L_([^/]+)\/(started|completed|failed)$/i;

export interface LegacyGameInspection {
  kind: "legacy_game_aggregate";
  firstDate: string;
  lastDate: string;
  days: number;
  sourceActions: number;
  sourceSessions: number;
  sourceVisitors: number;
  finalDayActions: number;
  importableActions: number;
  levelStarts: number;
  levelCompletions: number;
  levelFailures: number;
}

export type PlausibleArchiveInspection =
  | LegacyGameInspection
  | { kind: "standard" }
  | { kind: "unsupported"; reason: string };

export interface LegacyGameBuildOptions {
  earliestAllowedDate: string;
  latestAllowedDate: string;
  excludeLastDay?: boolean;
  hostname?: string;
}

export interface LegacyGameBuildSummary {
  sourceActions: number;
  importedActions: number;
  excludedActions: number;
  firstDate: string;
  lastDate: string;
  sessions: number;
  dailyVisitors: number;
  levelStarts: number;
  levelCompletions: number;
  levelFailures: number;
}

export interface LegacyGameBuildResult {
  events: PlausibleSyntheticEvent[];
  summary: LegacyGameBuildSummary;
}

interface CountedValue {
  value: string;
  count: number;
}

interface LegacyEventSeed {
  eventName: string;
  role: "started" | "completed" | "failed" | "action";
}

interface LegacyGroup {
  id: string;
  events: LegacyEventSeed[];
  level?: string;
  playSessionId?: string;
  startProps: Record<string, string>;
}

interface LegacySession {
  date: string;
  sessionId: string;
  userId: string;
  country: string;
  budget: number;
  remaining: number;
  startSeconds: number;
  perEventSeconds: number;
  groups: LegacyGroup[];
  commonProps: Record<string, unknown>;
}

interface LegacyDay {
  date: string;
  pageviews: number;
  visitors: number;
  visits: number;
  bounceRate: number;
  visitDuration: number;
  remaining: number;
  pairSlots: number;
  groups: LegacyGroup[];
  sessions: LegacySession[];
}

function toCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeRoute(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

function headersInclude(headers: string[], required: string[]) {
  const headerSet = new Set(headers.map(header => header.toLowerCase()));
  return required.every(header => headerSet.has(header));
}

function getRows(archive: ParsedPlausibleArchive, filename: string) {
  return archive.get(filename)?.rows ?? [];
}

export function inspectParsedPlausibleArchive(archive: ParsedPlausibleArchive): PlausibleArchiveInspection {
  const pagesFile = archive.get("pages.csv");
  const visitorsFile = archive.get("visitors.csv");
  const propsFile = archive.get("custom_props.csv");

  if (pagesFile && headersInclude(pagesFile.headers, ["date", "page", "hostname", "pageviews"])) {
    return { kind: "standard" };
  }

  const isLegacyGame =
    pagesFile &&
    visitorsFile &&
    propsFile &&
    headersInclude(pagesFile.headers, ["name", "visitors", "pageviews"]) &&
    headersInclude(visitorsFile.headers, ["date", "visitors", "pageviews", "visits"]) &&
    headersInclude(propsFile.headers, ["property", "value", "events"]) &&
    pagesFile.rows.some(row => LEGACY_ROUTE.test(row.name ?? ""));

  if (!isLegacyGame) {
    return {
      kind: "unsupported",
      reason: "This ZIP does not contain detailed Plausible page data or a recognised aggregate game export.",
    };
  }

  const days = visitorsFile.rows
    .filter(row => DateTime.fromISO(row.date ?? "", { zone: "utc" }).isValid)
    .toSorted((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  if (!days.length) {
    return { kind: "unsupported", reason: "The aggregate game export has no valid daily visitor rows." };
  }

  const finalDay = days.at(-1)!;
  const levelTotals = pagesFile.rows.reduce(
    (totals, row) => {
      const match = (row.name ?? "").match(LEGACY_ROUTE);
      if (!match) return totals;
      const count = toCount(row.pageviews);
      if (match[2].toLowerCase() === "started") totals.starts += count;
      if (match[2].toLowerCase() === "completed") totals.completions += count;
      if (match[2].toLowerCase() === "failed") totals.failures += count;
      return totals;
    },
    { starts: 0, completions: 0, failures: 0 }
  );

  return {
    kind: "legacy_game_aggregate",
    firstDate: days[0].date,
    lastDate: finalDay.date,
    days: days.length,
    sourceActions: days.reduce((sum, row) => sum + toCount(row.pageviews), 0),
    sourceSessions: days.reduce((sum, row) => sum + toCount(row.visits), 0),
    sourceVisitors:
      getRows(archive, "countries.csv").reduce((sum, row) => sum + toCount(row.visitors), 0) ||
      Math.max(...days.map(row => toCount(row.visitors))),
    finalDayActions: toCount(finalDay.pageviews),
    importableActions: days.reduce((sum, row) => sum + toCount(row.pageviews), 0) - toCount(finalDay.pageviews),
    levelStarts: levelTotals.starts,
    levelCompletions: levelTotals.completions,
    levelFailures: levelTotals.failures,
  };
}

export async function inspectPlausibleArchive(file: File): Promise<PlausibleArchiveInspection> {
  return inspectParsedPlausibleArchive(await parsePlausibleArchive(file));
}

function scaleCounts(values: CountedValue[], targetTotal: number): CountedValue[] {
  const sourceTotal = values.reduce((sum, item) => sum + item.count, 0);
  if (sourceTotal <= 0 || targetTotal <= 0) return [];

  const scaled = values.map(item => {
    const exact = (item.count * targetTotal) / sourceTotal;
    return { value: item.value, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = targetTotal - scaled.reduce((sum, item) => sum + item.count, 0);

  for (const item of scaled.toSorted((a, b) => b.remainder - a.remainder || a.value.localeCompare(b.value))) {
    if (remaining <= 0) break;
    item.count += 1;
    remaining -= 1;
  }

  return scaled.map(({ value, count }) => ({ value, count })).filter(item => item.count > 0);
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}

function generateUUID(seed1: number, seed2: number): string {
  const hex = (value: number) => ((value * 2654435761) >>> 0).toString(16).padStart(8, "0");
  const a = hex(seed1);
  const b = hex(seed2);
  const c = hex(seed1 + seed2);
  const d = hex(seed1 * 3 + seed2 * 7);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${c.slice(0, 4)}-${d}${c.slice(4, 8)}`.slice(0, 36);
}

function buildSessionBudgets(pageviews: number, visits: number, bounceRate: number): number[] {
  const sessionCount = Math.max(1, Math.min(pageviews, visits || Math.ceil(pageviews / 2)));
  const bounceCount = Math.min(sessionCount, Math.max(0, Math.round((sessionCount * bounceRate) / 100)));
  const budgets = Array.from({ length: sessionCount }, (_, index) => (index < bounceCount ? 1 : 0));
  let remaining = pageviews - bounceCount;
  const nonBounceIndices = budgets.map((_, index) => index).filter(index => index >= bounceCount);

  if (!nonBounceIndices.length) {
    for (let index = 0; index < remaining; index++) budgets[index % budgets.length] += 1;
    return budgets;
  }

  for (const index of nonBounceIndices) {
    budgets[index] = 1;
    remaining -= 1;
  }
  for (let index = 0; index < remaining; index++) {
    budgets[nonBounceIndices[index % nonBounceIndices.length]] += 1;
  }
  return budgets;
}

function countryNameMap() {
  const map = new Map<string, string>();
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      const name = displayNames.of(code);
      if (name && name !== code) map.set(name.toLowerCase(), code);
    }
  }
  map.set("united kingdom", "GB");
  map.set("united states", "US");
  map.set("russian federation", "RU");
  map.set("south korea", "KR");
  map.set("czechia", "CZ");
  return map;
}

function inferHostname(filename: string): string {
  const withoutExtension = filename.replace(/\.zip$/i, "");
  return withoutExtension.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i)?.[1]?.toLowerCase() ?? "legacy.plausible";
}

function platformFields(platformCode: string) {
  switch (platformCode) {
    case "XSX":
      return {
        browser: "",
        browserVersion: "",
        operatingSystem: "Xbox",
        operatingSystemVersion: "Series X",
        device: "Console",
      };
    case "XSS":
      return {
        browser: "",
        browserVersion: "",
        operatingSystem: "Xbox",
        operatingSystemVersion: "Series S",
        device: "Console",
      };
    case "PS5":
      return {
        browser: "",
        browserVersion: "",
        operatingSystem: "PlayStation",
        operatingSystemVersion: "5",
        device: "Console",
      };
    case "PS5Pro":
      return {
        browser: "",
        browserVersion: "",
        operatingSystem: "PlayStation",
        operatingSystemVersion: "5Pro",
        device: "Console",
      };
    case "Steam":
      return {
        browser: "Steam",
        browserVersion: "100",
        operatingSystem: "Windows",
        operatingSystemVersion: "",
        device: "Desktop",
      };
    case "SteamDeck":
      return {
        browser: "Steam",
        browserVersion: "101",
        operatingSystem: "Linux",
        operatingSystemVersion: "",
        device: "Handheld",
      };
    case "EGS":
      return {
        browser: "Epic Games",
        browserVersion: "102",
        operatingSystem: "Windows",
        operatingSystemVersion: "",
        device: "Desktop",
      };
    case "Editor":
      return {
        browser: "Editor",
        browserVersion: "900",
        operatingSystem: "Windows",
        operatingSystemVersion: "",
        device: "Desktop",
      };
    default:
      return { browser: "", browserVersion: "", operatingSystem: "", operatingSystemVersion: "", device: "" };
  }
}

function getPropertyDistribution(
  archive: ParsedPlausibleArchive,
  property: string,
  targetTotal: number,
  normalize: (value: string) => string = value => value
) {
  const values = getRows(archive, "custom_props.csv")
    .filter(row => row.property === property && row.value && row.value !== "(none)")
    .map(row => ({ value: normalize(row.value), count: toCount(row.events) }));

  const merged = new Map<string, number>();
  for (const item of values) merged.set(item.value, (merged.get(item.value) ?? 0) + item.count);
  return scaleCounts(
    Array.from(merged, ([value, count]) => ({ value, count })),
    targetTotal
  );
}

function assignValues<T>(targets: T[], distribution: CountedValue[], apply: (target: T, value: string) => void) {
  const values = distribution.flatMap(item => Array.from({ length: item.count }, () => item.value));
  if (!values.length) return;
  for (let index = 0; index < targets.length; index++) {
    apply(targets[index], values[(index * 7919) % values.length]);
  }
}

function assignWeightedSessionValues(
  sessions: LegacySession[],
  distribution: CountedValue[],
  property: string,
  chronological = false
) {
  if (!distribution.length) return;
  const remaining = distribution.map(item => ({ ...item }));
  const ordered = chronological
    ? remaining.toSorted((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: "base" }))
    : remaining;

  for (const session of sessions) {
    const available = chronological
      ? (ordered.find(item => item.count > 0) ?? ordered.at(-1)!)
      : ordered.toSorted((a, b) => b.count - a.count || a.value.localeCompare(b.value))[0];
    session.commonProps[property] = available.value;
    available.count -= session.budget;
  }
}

function formatTimestamp(date: string, secondsOfDay: number) {
  const seconds = Math.min(SECONDS_IN_DAY - 1, Math.max(0, Math.floor(secondsOfDay)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${date} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function buildLegacyAggregateGameImport(
  archive: ParsedPlausibleArchive,
  filename: string,
  options: LegacyGameBuildOptions
): LegacyGameBuildResult {
  const inspection = inspectParsedPlausibleArchive(archive);
  if (inspection.kind !== "legacy_game_aggregate") {
    throw new Error(inspection.kind === "unsupported" ? inspection.reason : "This is not an aggregate game export.");
  }

  const earliest = DateTime.fromISO(options.earliestAllowedDate, { zone: "utc" }).startOf("day");
  const latest = DateTime.fromISO(options.latestAllowedDate, { zone: "utc" }).endOf("day");
  const sourceDays = getRows(archive, "visitors.csv")
    .filter(row => {
      const date = DateTime.fromISO(row.date ?? "", { zone: "utc" });
      return date.isValid && date >= earliest && date <= latest;
    })
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const lastSourceDate = inspection.lastDate;
  const selectedDays = sourceDays.filter(row => !(options.excludeLastDay !== false && row.date === lastSourceDate));
  if (!selectedDays.length) throw new Error("No aggregate game data falls inside the allowed import range.");

  const countryRows = getRows(archive, "countries.csv");
  const countryCodes = countryNameMap();
  const countryPool = countryRows.flatMap(row => {
    const code = countryCodes.get((row.name ?? "").toLowerCase()) ?? "";
    return Array.from({ length: toCount(row.visitors) }, () => code);
  });
  const totalDailyVisitors = selectedDays.reduce((sum, row) => sum + toCount(row.visitors), 0);
  const globalUserCount = Math.max(1, Math.min(totalDailyVisitors, countryPool.length || totalDailyVisitors));
  const userPool = Array.from({ length: globalUserCount }, (_, index) =>
    generateUUID(hashText("legacy-plausible-users") + index, hashText(filename) + index * 31337)
  );
  const countryByUser = new Map(userPool.map((userId, index) => [userId, countryPool[index] ?? ""]));

  let userCursor = 0;
  const days: LegacyDay[] = selectedDays.map(row => {
    const pageviews = toCount(row.pageviews);
    const visits = toCount(row.visits);
    const visitors = Math.max(1, Math.min(visits || pageviews, toCount(row.visitors)));
    const budgets = buildSessionBudgets(pageviews, visits, Number.parseFloat(row.bounce_rate || "0") || 0);
    const dateSeed = hashText(row.date);
    const dayUsers = Array.from({ length: visitors }, (_, index) => userPool[(userCursor + index) % userPool.length]);
    userCursor = (userCursor + visitors) % userPool.length;
    const sessions = budgets.map((budget, index): LegacySession => {
      const userId = dayUsers[index % dayUsers.length];
      const startSeconds = Math.floor((index * SECONDS_IN_DAY) / budgets.length);
      const visitDuration = Number.parseFloat(row.visit_duration || "0") || 0;
      return {
        date: row.date,
        sessionId: generateUUID(dateSeed * 7 + index, dateSeed * 11 + index * 7919),
        userId,
        country: countryByUser.get(userId) ?? "",
        budget,
        remaining: budget,
        startSeconds,
        perEventSeconds:
          budget > 1 ? Math.max(1, Math.floor(visitDuration / (budget - 1)) || DEFAULT_EVENT_GAP_SECONDS) : 0,
        groups: [],
        commonProps: {},
      };
    });
    return {
      date: row.date,
      pageviews,
      visitors,
      visits: budgets.length,
      bounceRate: Number.parseFloat(row.bounce_rate || "0") || 0,
      visitDuration: Number.parseFloat(row.visit_duration || "0") || 0,
      remaining: pageviews,
      pairSlots: budgets.reduce((sum, budget) => sum + Math.floor(budget / 2), 0),
      groups: [],
      sessions,
    };
  });

  const targetActions = days.reduce((sum, day) => sum + day.pageviews, 0);
  const pageCounts = scaleCounts(
    getRows(archive, "pages.csv").map(row => ({
      value: normalizeRoute(row.name ?? ""),
      count: toCount(row.pageviews),
    })),
    targetActions
  );
  const pageCountMap = new Map(pageCounts.map(item => [item.value, item.count]));
  const groups: LegacyGroup[] = [];
  const consumedRoutes = new Set<string>();
  let groupIndex = 0;

  const levels = new Map<string, { started: number; completed: number; failed: number }>();
  for (const { value, count } of pageCounts) {
    const match = value.match(LEGACY_ROUTE);
    if (!match) continue;
    const level = match[1];
    const action = match[2].toLowerCase() as "started" | "completed" | "failed";
    const totals = levels.get(level) ?? { started: 0, completed: 0, failed: 0 };
    totals[action] = count;
    levels.set(level, totals);
    consumedRoutes.add(value);
  }

  for (const [level, totals] of levels) {
    if (totals.completed + totals.failed > totals.started) {
      throw new Error(`Legacy ${level} outcomes exceed its recorded starts.`);
    }
    for (let index = 0; index < totals.completed; index++) {
      const playSessionId = generateUUID(hashText(level) + index, hashText("completed") + index);
      groups.push({
        id: `attempt-${groupIndex++}`,
        level,
        playSessionId,
        startProps: {},
        events: [
          { eventName: `L_${level}/started`, role: "started" },
          { eventName: `L_${level}/completed`, role: "completed" },
        ],
      });
    }
    for (let index = 0; index < totals.failed; index++) {
      const playSessionId = generateUUID(hashText(level) + totals.completed + index, hashText("failed") + index);
      groups.push({
        id: `attempt-${groupIndex++}`,
        level,
        playSessionId,
        startProps: {},
        events: [
          { eventName: `L_${level}/started`, role: "started" },
          { eventName: `L_${level}/failed`, role: "failed" },
        ],
      });
    }
    for (let index = totals.completed + totals.failed; index < totals.started; index++) {
      groups.push({
        id: `attempt-${groupIndex++}`,
        level,
        playSessionId: generateUUID(hashText(level) + index, hashText("unobserved") + index),
        startProps: {},
        events: [{ eventName: `L_${level}/started`, role: "started" }],
      });
    }
  }

  for (const { value, count } of pageCounts) {
    if (consumedRoutes.has(value)) continue;
    for (let index = 0; index < count; index++) {
      groups.push({
        id: `action-${groupIndex++}`,
        startProps: {},
        events: [{ eventName: value, role: "action" }],
      });
    }
  }

  const groupsBySize = groups.toSorted((a, b) => b.events.length - a.events.length || a.id.localeCompare(b.id));
  for (const group of groupsBySize) {
    const size = group.events.length;
    const candidates = days.filter(day => day.remaining >= size && (size === 1 || day.pairSlots > 0));
    const day = candidates.toSorted(
      (a, b) => b.remaining / b.pageviews - a.remaining / a.pageviews || a.date.localeCompare(b.date)
    )[0];
    if (!day) throw new Error(`Could not place reconstructed group ${group.id} into a daily total.`);
    day.groups.push(group);
    day.remaining -= size;
    if (size === 2) day.pairSlots -= 1;
  }

  const sessions: LegacySession[] = [];
  for (const day of days) {
    const orderedGroups = day.groups.toSorted((a, b) => b.events.length - a.events.length || a.id.localeCompare(b.id));
    let cursor = 0;
    for (const group of orderedGroups) {
      const size = group.events.length;
      let selected: LegacySession | undefined;
      for (let offset = 0; offset < day.sessions.length; offset++) {
        const session = day.sessions[(cursor + offset) % day.sessions.length];
        if (session.remaining >= size) {
          selected = session;
          cursor = (cursor + offset + 1) % day.sessions.length;
          break;
        }
      }
      if (!selected) throw new Error(`Could not fit reconstructed group ${group.id} into a session budget.`);
      selected.groups.push(group);
      selected.remaining -= size;
    }
    sessions.push(...day.sessions);
  }

  const attemptGroups = groups.filter(group => group.level);
  assignValues(
    attemptGroups,
    getPropertyDistribution(archive, "local_play_mode", attemptGroups.length, value =>
      value.toLowerCase() === "singleplayer" ? "Solo" : value
    ),
    (group, value) => {
      group.startProps.play_mode = value;
    }
  );
  assignValues(attemptGroups, getPropertyDistribution(archive, "difficulty", attemptGroups.length), (group, value) => {
    group.startProps.difficulty = value;
  });

  const platformDistribution = getPropertyDistribution(archive, "platform", targetActions);
  const versionDistribution = getPropertyDistribution(archive, "version", targetActions);
  const loginDistribution = getPropertyDistribution(archive, "logged_in", targetActions);
  assignWeightedSessionValues(sessions, platformDistribution, "platform_code");
  assignWeightedSessionValues(sessions, versionDistribution, "build_version", true);
  assignWeightedSessionValues(sessions, loginDistribution, "logged_in");

  const hostname = options.hostname || inferHostname(filename);
  const marker = {
    legacy_source: "plausible",
    legacy_reconstructed: true,
    legacy_reconstruction: "aggregate",
    legacy_export_start: inspection.firstDate,
    legacy_export_end: inspection.lastDate,
  };
  const events: PlausibleSyntheticEvent[] = [];

  for (const session of sessions) {
    let eventOffset = 0;
    const platformCode = String(session.commonProps.platform_code ?? "");
    const platform = platformFields(platformCode);
    for (const group of session.groups) {
      for (const seed of group.events) {
        const props: Record<string, unknown> = {
          ...marker,
          ...session.commonProps,
          ...(seed.role === "started" ? group.startProps : {}),
          ...(group.playSessionId ? { play_session_id: group.playSessionId } : {}),
        };
        events.push({
          timestamp: formatTimestamp(session.date, session.startSeconds + eventOffset * session.perEventSeconds),
          session_id: session.sessionId,
          user_id: session.userId,
          hostname,
          pathname: seed.eventName,
          querystring: "",
          referrer: "",
          browser: platform.browser,
          browser_version: platform.browserVersion,
          operating_system: platform.operatingSystem,
          operating_system_version: platform.operatingSystemVersion,
          device_type: platform.device,
          country: session.country,
          region: "",
          city: "",
          type: "custom_event",
          event_name: seed.eventName,
          props: JSON.stringify(props),
        });
        eventOffset += 1;
      }
    }
  }

  const levelStarts = events.filter(event => event.event_name.endsWith("/started")).length;
  const levelCompletions = events.filter(event => event.event_name.endsWith("/completed")).length;
  const levelFailures = events.filter(event => event.event_name.endsWith("/failed")).length;
  if (events.length !== targetActions || pageCountMap.size !== pageCounts.length) {
    throw new Error("The reconstructed event totals did not reconcile with the selected daily totals.");
  }

  return {
    events: events.toSorted(
      (a, b) => a.timestamp.localeCompare(b.timestamp) || a.event_name.localeCompare(b.event_name)
    ),
    summary: {
      sourceActions: inspection.sourceActions,
      importedActions: events.length,
      excludedActions: inspection.sourceActions - events.length,
      firstDate: selectedDays[0].date,
      lastDate: selectedDays.at(-1)!.date,
      sessions: days.reduce((sum, day) => sum + day.sessions.length, 0),
      dailyVisitors: days.reduce((sum, day) => sum + day.visitors, 0),
      levelStarts,
      levelCompletions,
      levelFailures,
    },
  };
}
