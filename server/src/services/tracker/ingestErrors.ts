/**
 * sp3n/rybbit fork: failures a queue-backed trusted caller should retry.
 *
 * A bridge that sends `event_id` and `timestamp` (see eventTime.ts and
 * eventDedupe.ts) holds each event in a durable queue until /api/track
 * accepts it. When this server cannot record the event correctly right now,
 * answering with a retriable status keeps it in that queue. Degrading
 * silently (arrival time instead of event time, no dedupe) would record it
 * wrongly and let the bridge acknowledge it.
 */

/** Answer 503 with Retry-After: the event was not recorded; send it again later. */
export class RetryableIngestError extends Error {
  readonly statusCode = 503;
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds = 5) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Answer 429 with Retry-After: the trusted credential is over its rate limit. */
export class RateLimitedIngestError extends Error {
  readonly statusCode = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 60) {
    super("The bearer credential is rate limited");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Answer 422: this event can never be stored as sent (ClickHouse refused its
 * row). Retrying would only repeat the failure; the caller should dead-letter it.
 */
export class PermanentIngestError extends Error {
  readonly statusCode = 422;
}

/**
 * Answer 403: a bearer sent fields only an ingest:write key may send
 * (timestamp, event_id, geo), but its key is invalid, revoked or lacks
 * ingest:write. Requests without a bearer still have those fields ignored.
 */
export class UntrustedBearerError extends Error {
  readonly statusCode = 403;

  constructor() {
    super("This key may not send timestamp, event_id or geo: it needs ingest:write on the site");
  }
}
