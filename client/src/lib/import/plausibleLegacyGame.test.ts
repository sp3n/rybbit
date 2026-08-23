import { describe, expect, it } from "vitest";
import { ParsedPlausibleArchive } from "./plausibleArchive";
import { buildLegacyAggregateGameImport, inspectParsedPlausibleArchive } from "./plausibleLegacyGame";

function csv(headers: string[], rows: Record<string, string>[]) {
  return { headers, rows };
}

function legacyArchive(): ParsedPlausibleArchive {
  return new Map([
    [
      "pages.csv",
      csv(
        ["name", "visitors", "pageviews", "bounce_rate", "time_on_page", "scroll_depth"],
        [
          { name: "/L_Tutorial/started", visitors: "4", pageviews: "4" },
          { name: "/L_Tutorial/completed", visitors: "2", pageviews: "2" },
          { name: "/L_CrimsonDunes/started", visitors: "2", pageviews: "2" },
          { name: "/L_CrimsonDunes/failed", visitors: "1", pageviews: "1" },
          { name: "/menu/start", visitors: "3", pageviews: "3" },
        ]
      ),
    ],
    [
      "visitors.csv",
      csv(
        ["date", "visitors", "pageviews", "visits", "views_per_visit", "bounce_rate", "visit_duration"],
        [
          { date: "2025-07-28", visitors: "2", pageviews: "6", visits: "2", bounce_rate: "0", visit_duration: "120" },
          { date: "2025-07-29", visitors: "2", pageviews: "4", visits: "2", bounce_rate: "50", visit_duration: "60" },
          { date: "2025-07-30", visitors: "1", pageviews: "2", visits: "1", bounce_rate: "0", visit_duration: "30" },
        ]
      ),
    ],
    [
      "custom_props.csv",
      csv(
        ["property", "value", "visitors", "events", "percentage"],
        [
          { property: "platform", value: "XSX", events: "6" },
          { property: "platform", value: "XSS", events: "6" },
          { property: "version", value: "0.8.6.3", events: "6" },
          { property: "version", value: "0.8.7.0", events: "6" },
          { property: "local_play_mode", value: "Solo", events: "5" },
          { property: "local_play_mode", value: "Duet", events: "1" },
          { property: "local_play_mode", value: "(none)", events: "6" },
          { property: "difficulty", value: "3", events: "4" },
          { property: "difficulty", value: "2", events: "2" },
          { property: "difficulty", value: "(none)", events: "6" },
          { property: "logged_in", value: "true", events: "12" },
        ]
      ),
    ],
    [
      "countries.csv",
      csv(
        ["name", "visitors"],
        [
          { name: "United Kingdom", visitors: "3" },
          { name: "United States", visitors: "2" },
        ]
      ),
    ],
  ]);
}

describe("legacy aggregate Plausible game import", () => {
  it("detects the aggregate shape and reports the migration-day effect", () => {
    expect(inspectParsedPlausibleArchive(legacyArchive())).toEqual({
      kind: "legacy_game_aggregate",
      firstDate: "2025-07-28",
      lastDate: "2025-07-30",
      days: 3,
      sourceActions: 12,
      sourceSessions: 5,
      sourceVisitors: 5,
      finalDayActions: 2,
      importableActions: 10,
      levelStarts: 6,
      levelCompletions: 2,
      levelFailures: 1,
    });
  });

  it("preserves selected daily and event totals while marking reconstructed context", () => {
    const result = buildLegacyAggregateGameImport(legacyArchive(), "Plausible export demo.rhythmtowers.com.zip", {
      earliestAllowedDate: "2025-01-01",
      latestAllowedDate: "2025-12-31",
      excludeLastDay: true,
    });

    expect(result.summary).toMatchObject({
      sourceActions: 12,
      importedActions: 10,
      excludedActions: 2,
      firstDate: "2025-07-28",
      lastDate: "2025-07-29",
      sessions: 4,
      dailyVisitors: 4,
      levelStarts: 5,
      levelCompletions: 2,
      levelFailures: 1,
    });
    expect(result.events).toHaveLength(10);
    expect(new Set(result.events.map(event => event.session_id)).size).toBe(4);
    expect(result.events.every(event => event.type === "custom_event")).toBe(true);
    expect(result.events.every(event => !event.event_name.startsWith("/"))).toBe(true);
    expect(result.events.every(event => event.hostname === "demo.rhythmtowers.com")).toBe(true);
    expect(result.events.every(event => event.timestamp < "2025-07-30 00:00:00")).toBe(true);

    const counts = result.events.reduce<Record<string, number>>((acc, event) => {
      acc[event.event_name] = (acc[event.event_name] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      "L_CrimsonDunes/failed": 1,
      "L_CrimsonDunes/started": 2,
      "L_Tutorial/completed": 2,
      "L_Tutorial/started": 3,
      "menu/start": 2,
    });

    for (const event of result.events) {
      const props = JSON.parse(event.props);
      expect(props).toMatchObject({
        legacy_source: "plausible",
        legacy_reconstructed: true,
        legacy_reconstruction: "aggregate",
        logged_in: "true",
      });
      expect(["XSX", "XSS"]).toContain(props.platform_code);
      expect(["0.8.6.3", "0.8.7.0"]).toContain(props.build_version);
      expect(["GB", "US"]).toContain(event.country);
    }

    const starts = result.events.filter(event => event.event_name.endsWith("/started"));
    expect(starts.every(event => JSON.parse(event.props).play_mode)).toBe(true);
    expect(starts.every(event => JSON.parse(event.props).difficulty)).toBe(true);

    const terminals = result.events.filter(
      event => event.event_name.endsWith("/completed") || event.event_name.endsWith("/failed")
    );
    for (const terminal of terminals) {
      const playSessionId = JSON.parse(terminal.props).play_session_id;
      expect(
        starts.some(
          start => JSON.parse(start.props).play_session_id === playSessionId && start.session_id === terminal.session_id
        )
      ).toBe(true);
    }
  });

  it("can retain the final day when the sites did not overlap", () => {
    const result = buildLegacyAggregateGameImport(legacyArchive(), "Plausible export demo.rhythmtowers.com.zip", {
      earliestAllowedDate: "2025-01-01",
      latestAllowedDate: "2025-12-31",
      excludeLastDay: false,
    });

    expect(result.events).toHaveLength(12);
    expect(result.summary.excludedActions).toBe(0);
    expect(result.summary.lastDate).toBe("2025-07-30");
  });

  it("keeps detailed Plausible exports on the standard importer path", () => {
    const archive: ParsedPlausibleArchive = new Map([
      [
        "pages.csv",
        csv(
          ["date", "page", "hostname", "visitors", "pageviews", "visits"],
          [{ date: "2025-01-01", page: "/", hostname: "example.com", pageviews: "1" }]
        ),
      ],
    ]);

    expect(inspectParsedPlausibleArchive(archive)).toEqual({ kind: "standard" });
  });
});
