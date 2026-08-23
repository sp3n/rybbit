import { CopyText } from "@/components/CopyText";
import { useGetSite } from "@/api/admin/hooks/useSites";
import { GameFormFactorIcon, GamePlatformIcon, getGamePlatformInfo } from "@/components/GamePlatform";
import { useExtracted } from "next-intl";
import { GetSessionsResponse } from "../../../api/analytics/endpoints";
import { Browser } from "../../../app/[site]/components/shared/icons/Browser";
import { CountryFlag } from "../../../app/[site]/components/shared/icons/CountryFlag";
import { OperatingSystem } from "../../../app/[site]/components/shared/icons/OperatingSystem";
import { useGetRegionName } from "../../../lib/geo";
import { getCountryName, getLanguageName } from "../../../lib/utils";
import { Avatar, generateName } from "../../Avatar";
import { IdentifiedBadge } from "../../IdentifiedBadge";
import { DeviceIcon } from "../../../app/[site]/components/shared/icons/Device";
import { ArchiveRestore } from "lucide-react";

interface SessionInfoTabProps {
  session: GetSessionsResponse[number];
  sessionDetails: {
    user_id?: string;
    language?: string;
    country?: string;
    region?: string;
    city?: string;
    device_type?: string;
    browser?: string;
    browser_version?: string;
    operating_system?: string;
    operating_system_version?: string;
    screen_width?: number;
    screen_height?: number;
    ip?: string;
    channel?: string;
    referrer?: string;
    entry_page?: string;
  };
}

export function SessionInfoTab({ session, sessionDetails }: SessionInfoTabProps) {
  const { getRegionName } = useGetRegionName();
  const t = useExtracted();
  const { data: siteMetadata } = useGetSite();
  const isGame = siteMetadata?.type === "game";
  const gamePlatform = getGamePlatformInfo(session.game_platform);
  const isIdentified = !!session.identified_user_id;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_auto_auto] gap-8 mb-6">
      {/* User Information */}
      <div>
        <h4 className="text-sm font-medium mb-3 text-neutral-600 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800 pb-2">
          {isGame ? t("Player Information") : t("User Information")}
        </h4>
        <div className="space-y-3">
          {sessionDetails?.user_id && (
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 bg-neutral-200 dark:bg-neutral-800 rounded-full flex items-center justify-center shrink-0">
                <Avatar size={40} id={isIdentified ? session.identified_user_id : sessionDetails.user_id} />
              </div>
              <div>
                <div className="text-sm text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
                  <span className="font-medium text-neutral-600 dark:text-neutral-300">
                    {isIdentified
                      ? (session.traits?.username as string) ||
                        (session.traits?.name as string) ||
                        session.identified_user_id
                      : generateName(sessionDetails.user_id)}
                  </span>
                  {isIdentified && <IdentifiedBadge traits={session.traits} userId={session.identified_user_id} />}
                </div>
                <div className="text-sm text-neutral-500 dark:text-neutral-400 flex items-center">
                  <span className="font-medium text-neutral-600 dark:text-neutral-300">
                    {isGame ? t("Player ID:") : t("User ID:")}
                  </span>
                  <CopyText
                    text={isIdentified ? session.identified_user_id : sessionDetails.user_id}
                    maxLength={24}
                    className="inline-flex ml-2"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {sessionDetails?.language && (
              <div className="text-sm flex items-center gap-2">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">
                  {t("Language:")}
                </span>
                <span className="text-neutral-500 dark:text-neutral-400">
                  {sessionDetails.language ? getLanguageName(sessionDetails.language) : t("N/A")}
                </span>
              </div>
            )}

            {sessionDetails?.country && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("Country:")}</span>
                <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <CountryFlag country={sessionDetails.country} />
                  <span>{getCountryName(sessionDetails.country)}</span>
                  {sessionDetails.region && <span>({sessionDetails.region})</span>}
                </div>
              </div>
            )}
            {sessionDetails?.region && getRegionName(sessionDetails.region) && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("Region:")}</span>
                <span className="text-neutral-500 dark:text-neutral-400">{getRegionName(sessionDetails.region)}</span>
              </div>
            )}
            {sessionDetails?.city && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("City:")}</span>
                <span className="text-neutral-500 dark:text-neutral-400">{sessionDetails.city}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Device or game platform information */}
      <div>
        <h4 className="text-sm font-medium mb-3 text-neutral-600 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800 pb-2">
          {isGame ? t("Platform Information") : t("Device Information")}
        </h4>
        <div className="space-y-3">
          {isGame ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">
                  {t("Platform:")}
                </span>
                <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                  <GamePlatformIcon code={session.game_platform} />
                  <span>{gamePlatform.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">
                  {t("Form factor:")}
                </span>
                <div className="flex items-center gap-1.5 capitalize text-neutral-500 dark:text-neutral-400">
                  <GameFormFactorIcon formFactor={gamePlatform.formFactor} />
                  <span>{gamePlatform.formFactor}</span>
                </div>
              </div>
              {session.game_build_version && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">{t("Build:")}</span>
                  <span className="text-neutral-500 dark:text-neutral-400">{session.game_build_version}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("Device:")}</span>
                <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                  <DeviceIcon deviceType={sessionDetails?.device_type || ""} />
                  <span>{sessionDetails?.device_type || t("Unknown")}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("Browser:")}</span>
                <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                  <Browser browser={sessionDetails?.browser || "Unknown"} />
                  <span>
                    {sessionDetails?.browser || t("Unknown")}
                    {sessionDetails?.browser_version && <span className="ml-1">v{sessionDetails.browser_version}</span>}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("OS:")}</span>
                <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
                  <OperatingSystem os={sessionDetails?.operating_system || ""} />
                  <span>
                    {sessionDetails?.operating_system || t("Unknown")}
                    {sessionDetails?.operating_system_version && (
                      <span className="ml-1">{sessionDetails.operating_system_version}</span>
                    )}
                  </span>
                </div>
              </div>
            </>
          )}

          {!isGame && sessionDetails?.screen_width && sessionDetails?.screen_height ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("Screen:")}</span>
              <span className="text-neutral-500 dark:text-neutral-400">
                {sessionDetails.screen_width} × {sessionDetails.screen_height}
              </span>
            </div>
          ) : null}
          {sessionDetails?.ip && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("IP:")}</span>
              <span className="text-neutral-500 dark:text-neutral-400">{sessionDetails.ip}</span>
            </div>
          )}
        </div>
      </div>

      {/* Web source or game play context */}
      <div>
        <h4 className="text-sm font-medium mb-3 text-neutral-600 dark:text-neutral-300 border-b border-neutral-100 dark:border-neutral-800 pb-2">
          {isGame ? t("Play Context") : t("Source Information")}
        </h4>
        <div className="space-y-3">
          {isGame ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">{t("Actions:")}</span>
                <span className="text-neutral-500 dark:text-neutral-400">{session.game_actions.toLocaleString()}</span>
              </div>
              {session.game_play_mode && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">{t("Mode:")}</span>
                  <span className="text-neutral-500 dark:text-neutral-400">{session.game_play_mode}</span>
                </div>
              )}
              {session.game_difficulty && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">
                    {t("Difficulty:")}
                  </span>
                  <span className="text-neutral-500 dark:text-neutral-400">{session.game_difficulty}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">
                  {t("First action:")}
                </span>
                <span className="truncate text-neutral-500 dark:text-neutral-400">
                  {session.first_game_event || t("None")}
                </span>
              </div>
              {session.game_play_session_id && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">
                    {t("Play ID:")}
                  </span>
                  <CopyText text={session.game_play_session_id} maxLength={24} />
                </div>
              )}
              {!!session.game_reconstructed && (
                <div className="flex items-start gap-2 text-sm">
                  <span className="min-w-[80px] font-medium text-neutral-600 dark:text-neutral-300">
                    {t("Source:")}
                  </span>
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <ArchiveRestore className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t("Reconstructed from aggregate Plausible data")}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">{t("Channel:")}</span>
                <span className="text-neutral-500 dark:text-neutral-400">{sessionDetails?.channel || t("None")}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">
                  {t("Referrer:")}
                </span>
                <span className="text-neutral-500 dark:text-neutral-400">{sessionDetails?.referrer || t("None")}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-neutral-600 dark:text-neutral-300 min-w-[80px]">
                  {t("Entry Page:")}
                </span>
                <span className="text-neutral-500 dark:text-neutral-400">
                  {sessionDetails?.entry_page || t("None")}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
