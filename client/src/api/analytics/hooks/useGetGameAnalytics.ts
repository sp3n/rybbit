import { TimeBucket } from "@rybbit/shared";
import {
  GameBreakdownsResponse,
  GameLevelsResponse,
  GameOverviewBucketedResponse,
  GameOverviewResponse,
  GameReleasesResponse,
} from "../endpoints/game";
import { useAnalyticsQuery } from "../useAnalyticsQuery";

type PeriodTime = "current" | "previous";

export function useGetGameOverview({ periodTime }: { periodTime?: PeriodTime } = {}) {
  return useAnalyticsQuery<GameOverviewResponse>({
    key: "game-overview",
    path: "game/overview",
    periodTime,
  });
}

export function useGetGameOverviewBucketed({ bucket, periodTime }: { bucket: TimeBucket; periodTime?: PeriodTime }) {
  return useAnalyticsQuery<GameOverviewBucketedResponse>({
    key: "game-overview-bucketed",
    path: "game/overview/time-series",
    periodTime,
    params: { bucket },
  });
}

export function useGetGameBreakdowns() {
  return useAnalyticsQuery<GameBreakdownsResponse>({
    key: "game-breakdowns",
    path: "game/breakdowns",
  });
}

export function useGetGameLevels() {
  return useAnalyticsQuery<GameLevelsResponse>({
    key: "game-levels",
    path: "game/levels",
  });
}

export function useGetGameReleases() {
  return useAnalyticsQuery<GameReleasesResponse>({
    key: "game-releases",
    path: "game/releases",
  });
}
