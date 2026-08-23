import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { analyticsRoute, runAnalyticsQuery } from "../utils/analyticsQuery.js";
import { buildCanonicalGameEventsCte, platformCodeExpression, propertyString } from "./getGameAnalytics.js";

export type GameLevelSummaryRow = {
  players: number;
  attempts: number;
  completions: number;
  failures: number;
  quits: number;
  retries: number;
  abandoned: number;
  completion_rate: number;
  attempts_per_player: number;
  median_attempt_seconds: number | null;
  reconstructed_attempts: number;
};

export type GameLevelAttemptRow = {
  level: string;
  players: number;
  attempts: number;
  completions: number;
  failures: number;
  quits: number;
  retries: number;
  abandoned: number;
  completion_rate: number;
  attempts_per_player: number;
  median_attempt_seconds: number | null;
  first_seen: string;
  last_seen: string;
};

type GameLevelsRequest = {
  Params: { siteId: string };
  Querystring: FilterParams;
};

const propertyNumber = (property: string) =>
  `toFloat64OrNull(replaceRegexpAll(JSONExtractRaw(properties, '${property}'), '^"|"$', ''))`;

/**
 * Builds discrete level attempts from the action stream. A new `started`
 * action increments the attempt number inside a play session and level. Every
 * following action belongs to that attempt until the next start, which keeps
 * completions at or below the number of starts and avoids the misleading
 * event-count ratios produced by legacy duplicate and retry traffic.
 */
export function buildLevelAttemptsCte(params: FilterParams, siteId: number) {
  const canonical = buildCanonicalGameEventsCte(params, siteId);
  const eventParts = "splitByChar('/', replaceRegexpOne(game_event, '^/', ''))";

  return `${canonical},
LevelActions AS (
  SELECT
    session_id,
    coalesce(${propertyString("play_session_id")}, session_id) AS play_session_id,
    player_id,
    timestamp,
    game_event,
    properties,
    replaceRegexpOne(${eventParts}[1], '^L_', '') AS level,
    multiIf(
      has(${eventParts}, 'started'), 'started',
      has(${eventParts}, 'completed'), 'completed',
      has(${eventParts}, 'failed'), 'failed',
      has(${eventParts}, 'retry'), 'retry',
      has(${eventParts}, 'quit') OR has(${eventParts}, 'quitmenu') OR has(${eventParts}, 'leave'), 'quit',
      'action'
    ) AS level_action,
    ${propertyNumber("time_spent")} AS duration_hint,
    coalesce(${propertyString("build_version")}, ${propertyString("version")}) AS build_version,
    coalesce(${propertyString("play_mode")}, ${propertyString("local_play_mode")}) AS play_mode,
    ${propertyString("difficulty")} AS difficulty,
    ${platformCodeExpression} AS platform_code,
    lower(coalesce(${propertyString("legacy_reconstructed")}, 'false')) = 'true' AS reconstructed
  FROM CanonicalGameEvents
  WHERE match(game_event, '^/?L_[^/]+/')
),
NumberedLevelActions AS (
  SELECT
    *,
    sum(if(level_action = 'started', 1, 0)) OVER (
      PARTITION BY play_session_id, level
      ORDER BY timestamp, game_event
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS attempt_number
  FROM LevelActions
),
LevelAttempts AS (
  SELECT
    play_session_id,
    any(player_id) AS player_id,
    level,
    attempt_number,
    min(timestamp) AS started_at,
    max(timestamp) AS ended_at,
    if(
      argMaxIf(level_action, timestamp, level_action IN ('completed', 'failed', 'quit', 'retry')) = '',
      'abandoned',
      argMaxIf(level_action, timestamp, level_action IN ('completed', 'failed', 'quit', 'retry'))
    ) AS outcome,
    coalesce(
      argMaxIf(duration_hint, timestamp, isNotNull(duration_hint) AND level_action IN ('completed', 'failed', 'quit', 'retry')),
      toFloat64(dateDiff('second', min(timestamp), max(timestamp)))
    ) AS duration_seconds,
    argMaxIf(build_version, timestamp, build_version != '') AS build_version,
    argMaxIf(play_mode, timestamp, play_mode != '') AS play_mode,
    argMaxIf(difficulty, timestamp, difficulty != '') AS difficulty,
    argMaxIf(platform_code, timestamp, platform_code != '' AND platform_code != 'Unknown') AS platform_code,
    max(reconstructed) AS reconstructed
  FROM NumberedLevelActions
  WHERE attempt_number > 0
  GROUP BY play_session_id, level, attempt_number
)
`;
}

export function buildGameLevelsQueries(params: FilterParams, siteId: number) {
  const cte = buildLevelAttemptsCte(params, siteId);
  const summary = `
WITH ${cte}
SELECT
  uniqExactIf(player_id, player_id != '') AS players,
  count() AS attempts,
  countIf(outcome = 'completed') AS completions,
  countIf(outcome = 'failed') AS failures,
  countIf(outcome = 'quit') AS quits,
  countIf(outcome = 'retry') AS retries,
  countIf(outcome = 'abandoned') AS abandoned,
  countIf(reconstructed) AS reconstructed_attempts,
  round(if(attempts > 0, completions * 100.0 / attempts, 0), 1) AS completion_rate,
  round(if(players > 0, attempts / players, 0), 1) AS attempts_per_player,
  if(
    countIf(duration_seconds > 0) > 0,
    round(quantileExactIf(0.5)(duration_seconds, duration_seconds > 0), 1),
    NULL
  ) AS median_attempt_seconds
FROM LevelAttempts
`;

  const levels = `
WITH ${cte}
SELECT
  level,
  uniqExactIf(player_id, player_id != '') AS players,
  count() AS attempts,
  countIf(outcome = 'completed') AS completions,
  countIf(outcome = 'failed') AS failures,
  countIf(outcome = 'quit') AS quits,
  countIf(outcome = 'retry') AS retries,
  countIf(outcome = 'abandoned') AS abandoned,
  countIf(reconstructed) AS reconstructed_attempts,
  round(if(attempts > 0, completions * 100.0 / attempts, 0), 1) AS completion_rate,
  round(if(players > 0, attempts / players, 0), 1) AS attempts_per_player,
  if(
    countIf(duration_seconds > 0) > 0,
    round(quantileExactIf(0.5)(duration_seconds, duration_seconds > 0), 1),
    NULL
  ) AS median_attempt_seconds,
  min(started_at) AS first_seen,
  max(ended_at) AS last_seen
FROM LevelAttempts
WHERE level != ''
GROUP BY level
ORDER BY attempts DESC, first_seen ASC
LIMIT 50
`;

  return { summary, levels };
}

export const getGameLevels = analyticsRoute<GameLevelsRequest>(
  "game levels and attempts",
  async (req: FastifyRequest<GameLevelsRequest>, res: FastifyReply) => {
    const siteId = Number(req.params.siteId);
    const queries = buildGameLevelsQueries(req.query, siteId);
    const params = { siteId };
    const [summary, levels] = await Promise.all([
      runAnalyticsQuery<GameLevelSummaryRow>({ query: queries.summary, params }),
      runAnalyticsQuery<GameLevelAttemptRow>({ query: queries.levels, params }),
    ]);

    return res.send({ data: { summary: summary[0], levels } });
  }
);
