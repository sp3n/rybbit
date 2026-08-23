export type GameOverviewResponse = {
  players: number;
  sessions: number;
  actions: number;
  level_starts: number;
  level_completions: number;
  completion_rate: number;
  actions_per_session: number;
  median_session_duration: number;
};

export type GameOverviewBucketedResponse = {
  time: string;
  players: number;
  sessions: number;
  actions: number;
  level_starts: number;
  level_completions: number;
}[];

export type GameBreakdownItem = {
  value: string;
  actions: number;
  players: number;
  percentage: number;
};

export type GameLevelItem = GameBreakdownItem & {
  starts: number;
  completions: number;
  failures: number;
  quits: number;
  retries: number;
  completion_rate: number;
  median_completion_seconds: number | null;
};

export type GameBreakdownsResponse = {
  platforms: GameBreakdownItem[];
  versions: GameBreakdownItem[];
  modes: GameBreakdownItem[];
  difficulties: GameBreakdownItem[];
  levels: GameLevelItem[];
};

export type GameLevelSummary = {
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

export type GameLevelAttempt = Omit<GameLevelSummary, "players"> & {
  level: string;
  players: number;
  first_seen: string;
  last_seen: string;
};

export type GameLevelsResponse = {
  summary: GameLevelSummary;
  levels: GameLevelAttempt[];
};

export type GameReleaseSummary = {
  releases: number;
  versioned_attempts: number;
  total_attempts: number;
  coverage: number;
  latest_build: string;
  latest_seen: string;
  reconstructed_attempts: number;
};

export type GameRelease = {
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

export type GameReleasePlatform = {
  build_version: string;
  platform_code: string;
  players: number;
  sessions: number;
  attempts: number;
  percentage: number;
  last_seen: string;
};

export type GameReleasesResponse = {
  summary: GameReleaseSummary;
  releases: GameRelease[];
  platforms: GameReleasePlatform[];
};
