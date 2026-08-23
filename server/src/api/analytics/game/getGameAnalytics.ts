import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { TimeBucket } from "../types.js";
import { analyticsRoute, runAnalyticsQuery } from "../utils/analyticsQuery.js";
import { getFilterStatement } from "../utils/getFilterStatement.js";
import { getTimeStatement, resolveTimeWindow } from "../utils/timeWindow.js";

export type GameOverviewRow = {
  players: number;
  sessions: number;
  actions: number;
  level_starts: number;
  level_completions: number;
  completion_rate: number;
  actions_per_session: number;
  median_session_duration: number;
};

export type GameOverviewBucketedRow = {
  time: string;
  players: number;
  sessions: number;
  actions: number;
  level_starts: number;
  level_completions: number;
};

export type GameBreakdownRow = {
  value: string;
  actions: number;
  players: number;
  percentage: number;
};

export type GameLevelRow = GameBreakdownRow & {
  starts: number;
  completions: number;
  failures: number;
  quits: number;
  retries: number;
  completion_rate: number;
  median_completion_seconds: number | null;
};

type GameAnalyticsRequest<TQuery extends Record<string, unknown> = Record<string, never>> = {
  Params: { siteId: string };
  Querystring: FilterParams<TQuery>;
};

export const propertyString = (property: string) => `
  coalesce(
    nullIf(JSONExtractString(properties, '${property}'), ''),
    nullIf(replaceRegexpAll(JSONExtractRaw(properties, '${property}'), '^"|"$', ''), '')
  )`;

export const platformCodeExpression = `
  coalesce(
    ${propertyString("platform_code")},
    ${propertyString("platform")},
    multiIf(
      operating_system = 'PlayStation' AND operating_system_version = '5Pro', 'PS5Pro',
      operating_system = 'PlayStation' AND operating_system_version = '5Eco', 'PS5Eco',
      operating_system = 'PlayStation' AND operating_system_version = '5', 'PS5',
      operating_system = 'Xbox' AND operating_system_version = 'Series X', 'XSX',
      operating_system = 'Xbox' AND operating_system_version = 'Series S', 'XSS',
      browser_version = '402', 'XboxPC',
      browser_version = '403', 'XboxPCh',
      browser_version = '100', 'Steam',
      browser_version = '101', 'SteamDeck',
      browser_version = '102', 'EGS',
      browser_version = '900', 'Editor',
      'Unknown'
    )
  )`;

/**
 * Game integrations historically sent many actions as both a custom event and
 * a pageview. Grouping by session, timestamp and normalized event name folds
 * those pairs into one canonical action while retaining pageview-only legacy
 * outcomes such as quitmenu, retry and leave.
 */
export function buildCanonicalGameEventsCte(params: FilterParams, siteId: number) {
  const timeStatement = getTimeStatement(params);
  const filterStatement = getFilterStatement(params.filters, siteId, timeStatement);

  return `
CanonicalGameEvents AS (
  SELECT
    session_id,
    timestamp,
    if(event_name != '', event_name, pathname) AS game_event,
    coalesce(
      nullIf(argMax(identified_user_id, identified_user_id != ''), ''),
      argMax(user_id, type = 'custom_event')
    ) AS player_id,
    argMax(
      toString(props),
      tuple(toUInt8(toString(props) != '{}'), toUInt8(type = 'custom_event'))
    ) AS properties,
    argMax(operating_system, timestamp) AS operating_system,
    argMax(operating_system_version, timestamp) AS operating_system_version,
    argMax(browser_version, timestamp) AS browser_version,
    argMax(device_type, timestamp) AS device_type
  FROM events
  WHERE
    site_id = {siteId:Int32}
    AND type IN ('custom_event', 'pageview')
    ${filterStatement}
    ${timeStatement}
  GROUP BY session_id, timestamp, game_event
),
GameSessions AS (
  SELECT
    session_id,
    any(player_id) AS player_id,
    dateDiff('second', min(timestamp), max(timestamp)) AS duration,
    count() AS actions
  FROM CanonicalGameEvents
  GROUP BY session_id
)
`;
}

export function buildGameOverviewQuery(params: FilterParams, siteId: number) {
  const cte = buildCanonicalGameEventsCte(params, siteId);
  return `
WITH ${cte}
SELECT
  uniqExact(player_id) AS players,
  uniqExact(session_id) AS sessions,
  count() AS actions,
  countIf(has(splitByChar('/', game_event), 'started')) AS level_starts,
  countIf(has(splitByChar('/', game_event), 'completed')) AS level_completions,
  round(if(level_starts > 0, level_completions * 100.0 / level_starts, 0), 1) AS completion_rate,
  round(if(sessions > 0, actions / sessions, 0), 1) AS actions_per_session,
  (SELECT quantileExact(0.5)(duration) FROM GameSessions WHERE actions > 1) AS median_session_duration
FROM CanonicalGameEvents
`;
}

export function buildGameOverviewBucketedQuery(params: FilterParams<{ bucket: TimeBucket }>, siteId: number) {
  const bucket = params.bucket ?? "hour";
  const window = resolveTimeWindow(params);
  const fillClause = window.fill(bucket);
  const cte = buildCanonicalGameEventsCte(params, siteId);

  return `
WITH ${cte}
SELECT
  ${window.bucketed("timestamp", bucket)} AS time,
  uniqExact(player_id) AS players,
  uniqExact(session_id) AS sessions,
  count() AS actions,
  countIf(has(splitByChar('/', game_event), 'started')) AS level_starts,
  countIf(has(splitByChar('/', game_event), 'completed')) AS level_completions
FROM CanonicalGameEvents
GROUP BY time
ORDER BY time ${fillClause}
`;
}

export function buildGameBreakdownQueries(params: FilterParams, siteId: number) {
  const cte = buildCanonicalGameEventsCte(params, siteId);
  const breakdownQuery = (valueExpression: string) => `
WITH ${cte},
DimensionEvents AS (
  SELECT ${valueExpression} AS value, player_id
  FROM CanonicalGameEvents
)
SELECT
  value,
  count() AS actions,
  uniqExact(player_id) AS players,
  round(count() * 100.0 / sum(count()) OVER (), 1) AS percentage
FROM DimensionEvents
WHERE value IS NOT NULL AND value != '' AND value != 'Unknown'
GROUP BY value
ORDER BY actions DESC
LIMIT 20
`;

  const levels = `
WITH ${cte},
LevelEvents AS (
  SELECT
    replaceRegexpOne(splitByChar('/', replaceRegexpOne(game_event, '^/', ''))[1], '^L_', '') AS value,
    splitByChar('/', game_event) AS event_parts,
    player_id,
    toFloat64OrNull(replaceRegexpAll(JSONExtractRaw(properties, 'time_spent'), '^"|"$', '')) AS time_spent
  FROM CanonicalGameEvents
  WHERE match(game_event, '^/?L_[^/]+/')
)
SELECT
  value,
  count() AS actions,
  uniqExact(player_id) AS players,
  round(count() * 100.0 / sum(count()) OVER (), 1) AS percentage,
  countIf(has(event_parts, 'started')) AS starts,
  countIf(has(event_parts, 'completed')) AS completions,
  countIf(has(event_parts, 'failed')) AS failures,
  countIf(has(event_parts, 'quit') OR has(event_parts, 'quitmenu') OR has(event_parts, 'leave')) AS quits,
  countIf(has(event_parts, 'retry')) AS retries,
  round(if(starts > 0, completions * 100.0 / starts, 0), 1) AS completion_rate,
  if(
    countIf(has(event_parts, 'completed') AND isNotNull(time_spent)) > 0,
    round(quantileExactIf(0.5)(time_spent, has(event_parts, 'completed') AND isNotNull(time_spent)), 1),
    NULL
  ) AS median_completion_seconds
FROM LevelEvents
WHERE value != ''
GROUP BY value
ORDER BY starts DESC, actions DESC
LIMIT 20
`;

  return {
    platforms: breakdownQuery(platformCodeExpression),
    versions: breakdownQuery(`coalesce(${propertyString("build_version")}, ${propertyString("version")})`),
    modes: breakdownQuery(`coalesce(${propertyString("play_mode")}, ${propertyString("local_play_mode")})`),
    difficulties: breakdownQuery(propertyString("difficulty")),
    levels,
  };
}

export const getGameOverview = analyticsRoute<GameAnalyticsRequest>(
  "game overview",
  async (req: FastifyRequest<GameAnalyticsRequest>, res: FastifyReply) => {
    const siteId = Number(req.params.siteId);
    const rows = await runAnalyticsQuery<GameOverviewRow>({
      query: buildGameOverviewQuery(req.query, siteId),
      params: { siteId },
    });
    return res.send({ data: rows[0] });
  }
);

type GameBucketedRequest = GameAnalyticsRequest<{ bucket: TimeBucket }>;

export const getGameOverviewBucketed = analyticsRoute<GameBucketedRequest>(
  "game overview time series",
  async (req: FastifyRequest<GameBucketedRequest>, res: FastifyReply) => {
    const siteId = Number(req.params.siteId);
    const data = await runAnalyticsQuery<GameOverviewBucketedRow>({
      query: buildGameOverviewBucketedQuery(req.query, siteId),
      params: { siteId },
    });
    return res.send({ data });
  }
);

export const getGameBreakdowns = analyticsRoute<GameAnalyticsRequest>(
  "game breakdowns",
  async (req: FastifyRequest<GameAnalyticsRequest>, res: FastifyReply) => {
    const siteId = Number(req.params.siteId);
    const queries = buildGameBreakdownQueries(req.query, siteId);
    const params = { siteId };
    const [platforms, versions, modes, difficulties, levels] = await Promise.all([
      runAnalyticsQuery<GameBreakdownRow>({ query: queries.platforms, params }),
      runAnalyticsQuery<GameBreakdownRow>({ query: queries.versions, params }),
      runAnalyticsQuery<GameBreakdownRow>({ query: queries.modes, params }),
      runAnalyticsQuery<GameBreakdownRow>({ query: queries.difficulties, params }),
      runAnalyticsQuery<GameLevelRow>({ query: queries.levels, params }),
    ]);

    return res.send({ data: { platforms, versions, modes, difficulties, levels } });
  }
);
