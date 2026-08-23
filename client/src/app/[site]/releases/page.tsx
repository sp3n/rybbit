"use client";

import { GameRelease } from "@/api/analytics/endpoints";
import { useGetGameReleases } from "@/api/analytics/hooks/useGetGameAnalytics";
import { ErrorState } from "@/components/ErrorState";
import { GamePlatformIcon, getGamePlatformInfo } from "@/components/GamePlatform";
import { NothingFound } from "@/components/NothingFound";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardLoader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDateTimeFormat } from "@/hooks/useDateTimeFormat";
import { useSetPageTitle } from "@/hooks/useSetPageTitle";
import { formatSecondsAsMinutesAndSeconds } from "@/lib/utils";
import { DateTime } from "luxon";
import { PackageSearch } from "lucide-react";
import { useExtracted } from "next-intl";
import { useMemo, useState } from "react";
import { GameAnalysisHeader, GameSummaryStrip, ReconstructedDataNotice } from "../components/game/GameAnalysisLayout";
import { SubHeader } from "../components/SubHeader/SubHeader";

function sortReleases(releases: GameRelease[]) {
  return [...releases].sort((a, b) =>
    b.build_version.localeCompare(a.build_version, undefined, { numeric: true, sensitivity: "base" })
  );
}

function ReleasesSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[1, 2, 3, 4].map(row => (
        <Skeleton key={row} className="h-11 w-full rounded-md" />
      ))}
    </div>
  );
}

export default function GameReleasesPage() {
  const t = useExtracted();
  const { data, isLoading, isFetching, error } = useGetGameReleases();
  const { formatRelative } = useDateTimeFormat();
  const [requestedBuild, setRequestedBuild] = useState("");
  useSetPageTitle("Releases");

  const releases = useMemo(() => sortReleases(data?.releases ?? []), [data?.releases]);
  const latestBuild = data?.summary.latest_build || releases[0]?.build_version || "";
  const selectedBuild = requestedBuild || latestBuild;
  const platformRows = (data?.platforms ?? [])
    .filter(row => row.build_version === selectedBuild)
    .sort((a, b) => b.attempts - a.attempts);
  const unversionedAttempts = Math.max(
    Number(data?.summary.total_attempts ?? 0) - Number(data?.summary.versioned_attempts ?? 0),
    0
  );

  return (
    <div className="mx-auto max-w-[1300px] space-y-3 p-2 md:p-4">
      <SubHeader />
      <GameAnalysisHeader
        title={t("Releases")}
        description={t("Compare build adoption, player outcomes, session length, and platform coverage.")}
      />
      <GameSummaryStrip
        isLoading={isLoading}
        items={[
          { label: t("Reported Builds"), value: (data?.summary.releases ?? 0).toLocaleString() },
          { label: t("Latest Build"), value: latestBuild || t("Not available") },
          { label: t("Attempt Coverage"), value: `${Number(data?.summary.coverage ?? 0).toFixed(1)}%` },
          { label: t("Versioned Attempts"), value: (data?.summary.versioned_attempts ?? 0).toLocaleString() },
          { label: t("Unversioned Attempts"), value: unversionedAttempts.toLocaleString(), detail: t("Legacy data") },
        ]}
      />
      <ReconstructedDataNotice attempts={data?.summary.reconstructed_attempts ?? 0} />

      <Card>
        {isFetching && <CardLoader />}
        <CardHeader className="pb-3">
          <CardTitle>{t("Build comparison")}</CardTitle>
          <CardDescription>
            {t("Success is attempt-based. Builds with fewer than 50 attempts are marked as low sample.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <ReleasesSkeleton />
          ) : error ? (
            <ErrorState
              title={t("Failed to load releases")}
              message={t("There was a problem fetching release data. Please try again later.")}
            />
          ) : !releases.length ? (
            <NothingFound
              icon={<PackageSearch className="h-10 w-10" />}
              title={t("No versioned attempts in this period")}
              description={t("Send build_version with level starts to compare releases.")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">{t("Build")}</TableHead>
                  <TableHead>{t("Last seen")}</TableHead>
                  <TableHead className="text-right">{t("Players")}</TableHead>
                  <TableHead className="text-right">{t("Sessions")}</TableHead>
                  <TableHead className="text-right">{t("Attempts")}</TableHead>
                  <TableHead className="text-right">{t("Success")}</TableHead>
                  <TableHead className="text-right">{t("Median session")}</TableHead>
                  <TableHead className="pr-4">{t("Platforms")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {releases.map(release => (
                  <TableRow key={release.build_version}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">{release.build_version}</span>
                        {release.build_version === latestBuild && <Badge variant="success">{t("Latest")}</Badge>}
                        {release.attempts < 50 && <Badge variant="warning">{t("Low sample")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelative(DateTime.fromSQL(release.last_seen, { zone: "utc" }))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{release.players.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{release.sessions.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{release.attempts.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {release.completion_rate.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {release.median_session_seconds
                        ? formatSecondsAsMinutesAndSeconds(release.median_session_seconds)
                        : "–"}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center gap-1.5">
                        {release.platforms.slice(0, 6).map(platform => (
                          <span
                            key={platform}
                            className="text-muted-foreground"
                            title={getGamePlatformInfo(platform).label}
                          >
                            <GamePlatformIcon code={platform} />
                          </span>
                        ))}
                        {release.platforms.length > 6 && (
                          <span className="text-xs text-muted-foreground">+{release.platforms.length - 6}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!!releases.length && (
        <Card>
          <CardHeader className="gap-3 pb-3 md:flex-row md:items-start md:justify-between md:space-y-0">
            <div className="space-y-1.5">
              <CardTitle>{t("Platform mix")}</CardTitle>
              <CardDescription>{t("Share of recorded level attempts for the selected build.")}</CardDescription>
            </div>
            <Select value={selectedBuild} onValueChange={setRequestedBuild}>
              <SelectTrigger className="w-[150px]" aria-label={t("Select build")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {releases.map(release => (
                  <SelectItem key={release.build_version} value={release.build_version}>
                    {release.build_version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {!platformRows.length ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("No platform context")}</div>
            ) : (
              <div className="space-y-1.5">
                {platformRows.map(row => {
                  const platform = getGamePlatformInfo(row.platform_code);
                  return (
                    <div key={row.platform_code} className="relative overflow-hidden rounded-md px-2 py-2.5">
                      <div
                        className="absolute inset-y-0 left-0 bg-neutral-100 dark:bg-neutral-850"
                        style={{ width: `${row.percentage}%` }}
                      />
                      <div className="relative flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                          <GamePlatformIcon code={row.platform_code} />
                          <span className="truncate">{platform.label}</span>
                        </div>
                        <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {row.attempts.toLocaleString()} {row.attempts === 1 ? t("attempt") : t("attempts")} ·{" "}
                          {row.percentage.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
