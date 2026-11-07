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
