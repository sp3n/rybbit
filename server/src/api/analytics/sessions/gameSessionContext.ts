/**
 * sp3n/rybbit fork: per-session game context for "game" sites.
 *
 * The aggregated columns come from buildGameSessionContextSelect inside the
 * AggregatedSessions CTE; the resolved platform needs those aggregates, so it
 * is selected over the CTE by buildResolvedGamePlatformSelect.
 */
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

export const buildResolvedGamePlatformSelect = () => `
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
