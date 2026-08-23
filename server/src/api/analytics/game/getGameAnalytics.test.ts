import { describe, expect, it } from "vitest";
import { buildSessionsQuery } from "../sessions/getSessions.js";
import { buildCanonicalGameEventsCte, buildGameBreakdownQueries, buildGameOverviewQuery } from "./getGameAnalytics.js";
import { buildGameLevelsQueries, buildLevelAttemptsCte } from "./getGameLevels.js";
import { buildGameReleaseQueries } from "./getGameReleases.js";

const timeWindow = {
  start_date: "2026-01-01T00:00:00.000Z",
  end_date: "2026-01-31T23:59:59.999Z",
  time_zone: "UTC",
  filters: "[]",
  page: 1,
  limit: 100,
};

describe("game analytics query builders", () => {
  it("folds legacy custom-event/pageview pairs into one canonical action", () => {
    const query = buildCanonicalGameEventsCte(timeWindow, 8);

    expect(query).toContain("if(event_name != '', event_name, pathname) AS game_event");
    expect(query).toContain("GROUP BY session_id, timestamp, game_event");
    expect(query).toContain("type IN ('custom_event', 'pageview')");
    expect(query).toContain("toUInt8(toString(props) != '{}')");
  });

  it("prefers explicit platform context and retains every legacy UA mapping", () => {
    const query = buildGameBreakdownQueries(timeWindow, 8).platforms;

    expect(query).toContain("platform_code");
    expect(query).toContain("platform");
    for (const code of [
      "PS5",
      "PS5Pro",
      "PS5Eco",
      "XSX",
      "XSS",
      "XboxPC",
      "XboxPCh",
      "Steam",
      "SteamDeck",
      "EGS",
      "Editor",
    ]) {
      expect(query).toContain(`'${code}'`);
    }
  });

  it("derives meaningful game outcomes rather than web-only metrics", () => {
    const query = buildGameOverviewQuery(timeWindow, 8);

    expect(query).toContain("AS players");
    expect(query).toContain("AS level_starts");
    expect(query).toContain("AS completion_rate");
    expect(query).toContain("median_session_duration");
    expect(query).not.toContain("page_title");
  });

  it("adds canonical game context to session rows without interpolating the site ID", () => {
    const spec = buildSessionsQuery(timeWindow, 8);

    expect(spec.query).toContain("AS game_platform");
    expect(spec.query).toContain("AS game_build_version");
    expect(spec.query).toContain("AS game_play_session_id");
    expect(spec.query).toContain("AS game_reconstructed");
    expect(spec.query).toContain("legacy_reconstructed");
    expect(spec.query).toContain("AS first_game_event");
    expect(spec.query).toContain("uniqExactIf");
    expect(spec.query).toContain("site_id = {siteId:Int32}");
    expect(spec.params?.siteId).toBe(8);
  });

  it("turns starts and their following outcomes into bounded level attempts", () => {
    const cte = buildLevelAttemptsCte(timeWindow, 8);
    const queries = buildGameLevelsQueries(timeWindow, 8);

    expect(cte).toContain("PARTITION BY play_session_id, level");
    expect(cte).toContain("AS attempt_number");
    expect(cte).toContain("'abandoned'");
    expect(cte).toContain("attempt_number > 0");
    expect(queries.summary).toContain("completions * 100.0 / attempts");
    expect(queries.summary).toContain("AS reconstructed_attempts");
    expect(queries.levels).toContain("attempts_per_player");
  });

  it("compares versioned releases while reporting legacy coverage honestly", () => {
    const queries = buildGameReleaseQueries(timeWindow, 8);

    expect(queries.summary).toContain("AS versioned_attempts");
    expect(queries.summary).toContain("AS coverage");
    expect(queries.summary).toContain("AS reconstructed_attempts");
    expect(queries.releases).toContain("median_session_seconds");
    expect(queries.releases).toContain("ReleaseAttemptRollup");
    expect(queries.platforms).toContain("PARTITION BY build_version");
  });
});
