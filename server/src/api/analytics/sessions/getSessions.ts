import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { getFilterStatement } from "../utils/getFilterStatement.js";
import { SESSION_CHANNEL_AGG, SESSION_REFERRER_AGG } from "../utils/sessionAttribution.js";
import { enrichWithTraits } from "../utils/utils.js";
import { getTimeStatement } from "../utils/timeWindow.js";
import { analyticsRoute, runAnalyticsQuery, QuerySpec } from "../utils/analyticsQuery.js";
import { matchesUser } from "../utils/effectiveUserId.js";

export type GetSessionsResponse = {
  session_id: string;
  user_id: string; // Device fingerprint
  identified_user_id: string; // Custom user ID when identified, empty string otherwise
  traits: Record<string, unknown> | null;
  country: string;
  region: string;
  city: string;
  language: string;
  device_type: string;
  browser: string;
  browser_version: string;
  operating_system: string;
  operating_system_version: string;
  screen_width: number;
  screen_height: number;
  referrer: string;
  channel: string;
  hostname: string;
  page_title: string;
  querystring: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  session_end: string;
  session_start: string;
  session_duration: number;
  entry_page: string;
  exit_page: string;
  pageviews: number;
  events: number;
  errors: number;
  outbound: number;
  button_clicks: number;
  copies: number;
  form_submits: number;
  input_changes: number;
  ip: string;
  lat: number;
  lon: number;
  has_replay: number;
  game_platform: string;
  game_build_version: string;
  game_play_mode: string;
  game_difficulty: string;
  game_play_session_id: string;
  game_actions: number;
  game_reconstructed: number;
  first_game_event: string;
  last_game_event: string;
}[];

export interface GetSessionsRequest {
  Params: {
    siteId: string;
  };
  Querystring: FilterParams<{
    limit: number;
    page: number;
    user_id?: string;
    session_id?: string;
    identified_only?: string;
    min_pageviews?: string;
    min_events?: string;
    min_game_actions?: string;
    min_duration?: string;
  }>;
}

// Field mappings for the CTE which extracts UTM params as separate columns
const SESSION_FIELD_MAPPINGS = {
  "url_parameters['utm_source']": "utm_source",
  "url_parameters['utm_medium']": "utm_medium",
  "url_parameters['utm_campaign']": "utm_campaign",
  "url_parameters['utm_term']": "utm_term",
  "url_parameters['utm_content']": "utm_content",
};

const gamePropertyString = (property: string) => `
  coalesce(
    nullIf(JSONExtractString(toString(props), '${property}'), ''),
    nullIf(replaceRegexpAll(JSONExtractRaw(toString(props), '${property}'), '^"|"$', ''), '')
  )`;

const explicitGamePlatform = `coalesce(${gamePropertyString("platform_code")}, ${gamePropertyString("platform")})`;

/**
 * Prefer the explicit game context emitted by current integrations, then decode
 * the synthetic UA versions used by legacy RybbitHole releases. Keeping the
 * fallback here lets production exports become useful immediately, without a
 * destructive telemetry backfill.
 */
export const buildGameSessionContextSelect = () => `
          nullIf(argMaxIf(${explicitGamePlatform}, timestamp, type IN ('custom_event', 'pageview')), '') AS game_platform_explicit,
          coalesce(
            nullIf(argMaxIf(${gamePropertyString("build_version")}, timestamp, type IN ('custom_event', 'pageview')), ''),
            nullIf(argMaxIf(${gamePropertyString("version")}, timestamp, type IN ('custom_event', 'pageview')), ''),
            ''
          ) AS game_build_version,
          coalesce(
            nullIf(argMaxIf(${gamePropertyString("play_mode")}, timestamp, type IN ('custom_event', 'pageview')), ''),
            nullIf(argMaxIf(${gamePropertyString("local_play_mode")}, timestamp, type IN ('custom_event', 'pageview')), ''),
            ''
          ) AS game_play_mode,
          coalesce(nullIf(argMaxIf(${gamePropertyString("difficulty")}, timestamp, type IN ('custom_event', 'pageview')), ''), '') AS game_difficulty,
          coalesce(nullIf(argMaxIf(${gamePropertyString("play_session_id")}, timestamp, type IN ('custom_event', 'pageview')), ''), '') AS game_play_session_id,
          uniqExactIf(
            tuple(timestamp, if(event_name != '', event_name, pathname)),
            type IN ('custom_event', 'pageview')
          ) AS game_actions,
          toUInt8(
            countIf(
              type IN ('custom_event', 'pageview')
              AND lower(coalesce(${gamePropertyString("legacy_reconstructed")}, 'false')) = 'true'
            ) > 0
          ) AS game_reconstructed,
          argMinIf(if(event_name != '', event_name, pathname), timestamp, type IN ('custom_event', 'pageview')) AS first_game_event,
          argMaxIf(if(event_name != '', event_name, pathname), timestamp, type IN ('custom_event', 'pageview')) AS last_game_event`;

const buildResolvedGamePlatformSelect = () => `
      coalesce(
        game_platform_explicit,
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
      ) AS game_platform`;

export const buildSessionsQuery = (query: GetSessionsRequest["Querystring"], siteId: number): QuerySpec => {
  const {
    filters,
    page = 1,
    user_id: userId,
    session_id: sessionId,
    limit = 100,
    identified_only: identifiedOnly = "false",
    min_pageviews: minPageviewsStr,
    min_events: minEventsStr,
    min_game_actions: minGameActionsStr,
    min_duration: minDurationStr,
  } = query;
  const filterIdentified = identifiedOnly === "true";
  const minPageviews = minPageviewsStr ? parseInt(minPageviewsStr, 10) : undefined;
  const minEvents = minEventsStr ? parseInt(minEventsStr, 10) : undefined;
  const minGameActions = minGameActionsStr ? parseInt(minGameActionsStr, 10) : undefined;
  const minDuration = minDurationStr ? parseInt(minDurationStr, 10) : undefined;

  const timeStatement = getTimeStatement(query);

  // Use composable filter options:
  // - sessionLevelParams: per-event fields filter at session level (finds sessions
  //   containing a matching event) — required for any parameter the aggregated CTE
  //   below doesn't project, otherwise the outer WHERE hits an unknown identifier
  // - fieldMappings: CTE extracts UTM params as separate columns, so we need to map the field names
  const filterStatement = getFilterStatement(filters, siteId, timeStatement, {
    sessionLevelParams: ["event_name", "pathname", "page_title", "querystring", "channel"],
    fieldMappings: SESSION_FIELD_MAPPINGS,
  });

  const querySQL = `
  WITH AggregatedSessions AS (
      SELECT
          session_id,
          argMax(user_id, timestamp) AS user_id,
          argMax(identified_user_id, timestamp) AS identified_user_id,
          argMax(country, timestamp) AS country,
          argMax(region, timestamp) AS region,
          argMax(city, timestamp) AS city,
          argMax(language, timestamp) AS language,
          argMax(device_type, timestamp) AS device_type,
          argMax(browser, timestamp) AS browser,
          argMax(browser_version, timestamp) AS browser_version,
          argMax(operating_system, timestamp) AS operating_system,
          argMax(operating_system_version, timestamp) AS operating_system_version,
          argMax(screen_width, timestamp) AS screen_width,
          argMax(screen_height, timestamp) AS screen_height,
          ${SESSION_REFERRER_AGG} AS referrer,
          ${SESSION_CHANNEL_AGG} AS channel,
          argMin(hostname, timestamp) AS hostname,
          argMin(url_parameters, timestamp)['utm_source'] AS utm_source,
          argMin(url_parameters, timestamp)['utm_medium'] AS utm_medium,
          argMin(url_parameters, timestamp)['utm_campaign'] AS utm_campaign,
          argMin(url_parameters, timestamp)['utm_term'] AS utm_term,
          argMin(url_parameters, timestamp)['utm_content'] AS utm_content,
          MAX(timestamp) AS session_end,
          MIN(timestamp) AS session_start,
          dateDiff('second', MIN(timestamp), MAX(timestamp)) AS session_duration,
          argMinIf(pathname, timestamp, type = 'pageview') AS entry_page,
          argMaxIf(pathname, timestamp, type = 'pageview') AS exit_page,
          countIf(type = 'pageview') AS pageviews,
          countIf(type = 'custom_event') AS events,
          countIf(type = 'error') AS errors,
          countIf(type = 'outbound') AS outbound,
          countIf(type = 'button_click') AS button_clicks,
          countIf(type = 'copy') AS copies,
          countIf(type = 'form_submit') AS form_submits,
          countIf(type = 'input_change') AS input_changes,
          argMax(ip, timestamp) AS ip,
          argMax(lat, timestamp) AS lat,
          argMax(lon, timestamp) AS lon,
          argMax(tag, timestamp) AS tag,
          argMax(timezone, timestamp) AS timezone,
          ${buildGameSessionContextSelect()}
      FROM events
      WHERE
          site_id = {siteId:Int32}
          ${userId ? ` AND ${matchesUser("{user_id:String}", "events")}` : ""}
          ${sessionId ? ` AND events.session_id = {session_id:String}` : ""}
          ${timeStatement}
      GROUP BY
          session_id
      ORDER BY session_end DESC
  ),
  GameContextSessions AS (
      SELECT
          a.*,
          ${buildResolvedGamePlatformSelect()}
      FROM AggregatedSessions a
  ),
  ReplaySessions AS (
      SELECT DISTINCT session_id
      FROM session_replay_metadata_v2
      FINAL
      WHERE site_id = {siteId:Int32}
        AND event_count >= 2
  )
  SELECT
      a.*,
      if(r.session_id != '', 1, 0) AS has_replay
  FROM GameContextSessions a
  LEFT JOIN ReplaySessions r ON a.session_id = r.session_id
  WHERE 1 = 1 ${filterStatement}
  ${filterIdentified ? "AND a.identified_user_id != ''" : ""}
  ${minPageviews !== undefined ? "AND a.pageviews >= {minPageviews:Int32}" : ""}
  ${minEvents !== undefined ? "AND a.events >= {minEvents:Int32}" : ""}
  ${minGameActions !== undefined ? "AND a.game_actions >= {minGameActions:Int32}" : ""}
  ${minDuration !== undefined ? "AND a.session_duration >= {minDuration:Int32}" : ""}
  LIMIT {limit:Int32} OFFSET {offset:Int32}
  `;

  return {
    query: querySQL,
    params: {
      siteId,
      user_id: userId,
      session_id: sessionId,
      limit: limit || 100,
      offset: (page - 1) * (limit || 100),
      minPageviews: minPageviews ?? 0,
      minEvents: minEvents ?? 0,
      minGameActions: minGameActions ?? 0,
      minDuration: minDuration ?? 0,
    },
  };
};

export const getSessions = analyticsRoute<GetSessionsRequest>(
  "sessions",
  async (req: FastifyRequest<GetSessionsRequest>, res: FastifyReply) => {
    const site = req.params.siteId;

    const data = await runAnalyticsQuery<Omit<GetSessionsResponse[number], "traits">>(
      buildSessionsQuery(req.query, Number(site))
    );

    // Enrich with traits from Postgres
    const dataWithTraits = await enrichWithTraits(data, Number(site));

    return res.send({ data: dataWithTraits });
  }
);
