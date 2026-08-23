import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { analyticsRoute, runAnalyticsQuery } from "../utils/analyticsQuery.js";
import { buildCanonicalGameEventsCte, platformCodeExpression, propertyString } from "./getGameAnalytics.js";
import { buildLevelAttemptsCte } from "./getGameLevels.js";

export type GameReleaseSummaryRow = {
  releases: number;
  versioned_attempts: number;
  total_attempts: number;
  coverage: number;
  latest_build: string;
  latest_seen: string;
  reconstructed_attempts: number;
};

export type GameReleaseRow = {
  build_version: string;
  players: number;
  sessions: number;
  attempts: number;
  completions: number;
  completion_rate: number;
  median_session_seconds: number | null;
  first_seen: string;
  last_seen: string;
  platforms: string[];
};

export type GameReleasePlatformRow = {
  build_version: string;
  platform_code: string;
  players: number;
  sessions: number;
  attempts: number;
  percentage: number;
  last_seen: string;
};

type GameReleasesRequest = {
  Params: { siteId: string };
  Querystring: FilterParams;
};

export function buildGameReleaseQueries(params: FilterParams, siteId: number) {
  const attempts = buildLevelAttemptsCte(params, siteId);
  const buildExpression = `coalesce(${propertyString("build_version")}, ${propertyString("version")})`;

  const summary = `
WITH ${attempts}
SELECT
  uniqExactIf(build_version, build_version != '') AS releases,
  countIf(build_version != '') AS versioned_attempts,
  count() AS total_attempts,
  countIf(reconstructed) AS reconstructed_attempts,
  round(if(total_attempts > 0, versioned_attempts * 100.0 / total_attempts, 0), 1) AS coverage,
  argMaxIf(build_version, started_at, build_version != '') AS latest_build,
  maxIf(started_at, build_version != '') AS latest_seen
FROM LevelAttempts
`;

  const releases = `
WITH ${attempts},
ReleaseEvents AS (
  SELECT
    coalesce(${propertyString("build_version")}, ${propertyString("version")}) AS build_version,
    ${platformCodeExpression} AS platform_code,
    session_id,
    player_id,
    timestamp
  FROM CanonicalGameEvents
),
ReleaseRollup AS (
  SELECT
    build_version,
    uniqExactIf(player_id, player_id != '') AS players,
    uniqExact(session_id) AS sessions,
    min(timestamp) AS first_seen,
    max(timestamp) AS last_seen,
    arrayFilter(
      platform -> platform != '' AND platform != 'Unknown',
      groupUniqArray(12)(platform_code)
    ) AS platforms
  FROM ReleaseEvents
  WHERE build_version != ''
  GROUP BY build_version
),
ReleaseSessions AS (
  SELECT
    session_id,
    count() AS actions,
    dateDiff('second', min(timestamp), max(timestamp)) AS duration_seconds
  FROM CanonicalGameEvents
  GROUP BY session_id
),
ReleaseSessionMembership AS (
  SELECT DISTINCT build_version, session_id
  FROM ReleaseEvents
  WHERE build_version != ''
),
ReleaseSessionRollup AS (
  SELECT
    membership.build_version AS build_version,
    if(
      countIf(sessions.actions > 1 AND sessions.duration_seconds > 0) > 0,
      round(quantileExactIf(0.5)(sessions.duration_seconds, sessions.actions > 1 AND sessions.duration_seconds > 0), 1),
      NULL
    ) AS median_session_seconds
  FROM ReleaseSessionMembership AS membership
  INNER JOIN ReleaseSessions AS sessions USING (session_id)
  GROUP BY membership.build_version
),
ReleaseAttemptRollup AS (
  SELECT
    build_version,
    count() AS attempts,
    countIf(outcome = 'completed') AS completions,
    round(if(attempts > 0, completions * 100.0 / attempts, 0), 1) AS completion_rate
  FROM LevelAttempts
  WHERE build_version != ''
  GROUP BY build_version
)
SELECT
  rollup.build_version AS build_version,
  rollup.players AS players,
  rollup.sessions AS sessions,
  coalesce(attempts.attempts, 0) AS attempts,
  coalesce(attempts.completions, 0) AS completions,
  coalesce(attempts.completion_rate, 0) AS completion_rate,
  sessions.median_session_seconds AS median_session_seconds,
  rollup.first_seen AS first_seen,
  rollup.last_seen AS last_seen,
  rollup.platforms AS platforms
FROM ReleaseRollup AS rollup
LEFT JOIN ReleaseSessionRollup AS sessions USING (build_version)
LEFT JOIN ReleaseAttemptRollup AS attempts USING (build_version)
ORDER BY last_seen DESC, attempts DESC
LIMIT 30
`;

  const platforms = `
WITH ${attempts}
SELECT
  build_version,
  platform_code,
  uniqExactIf(player_id, player_id != '') AS players,
  uniqExact(play_session_id) AS sessions,
  count() AS attempts,
  round(attempts * 100.0 / sum(attempts) OVER (PARTITION BY build_version), 1) AS percentage,
  max(started_at) AS last_seen
FROM LevelAttempts
WHERE build_version != '' AND platform_code != '' AND platform_code != 'Unknown'
GROUP BY build_version, platform_code
ORDER BY last_seen DESC, build_version DESC, attempts DESC
LIMIT 100
`;

  return { summary, releases, platforms };
}

export const getGameReleases = analyticsRoute<GameReleasesRequest>(
  "game releases",
  async (req: FastifyRequest<GameReleasesRequest>, res: FastifyReply) => {
    const siteId = Number(req.params.siteId);
    const queries = buildGameReleaseQueries(req.query, siteId);
    const queryParams = { siteId };
    const [summary, releases, platforms] = await Promise.all([
      runAnalyticsQuery<GameReleaseSummaryRow>({ query: queries.summary, params: queryParams }),
      runAnalyticsQuery<GameReleaseRow>({ query: queries.releases, params: queryParams }),
      runAnalyticsQuery<GameReleasePlatformRow>({ query: queries.platforms, params: queryParams }),
    ]);

    return res.send({ data: { summary: summary[0], releases, platforms } });
  }
);
