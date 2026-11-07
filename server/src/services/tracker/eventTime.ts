/**
 * sp3n/rybbit fork: caller-supplied event time for trusted server-side ingestion.
 *
 * A server-side bridge that queues events (for example a Cloudflare Queue in
 * front of /api/track) can deliver them minutes or days after they happened.
 * Stamping them with the arrival time would move a whole outage's backlog to
 * the moment it drained, and merge it into one session. A bearer with
 * `ingest:write` for the site may therefore say when the event happened.
 *
 * The time is bounded: no more than MAX_EVENT_TIME_FUTURE_SKEW_MS ahead of the
 * arrival time (clock skew), and no older than MAX_EVENT_AGE_MS (beyond the
 * 14-day retention of the queue that motivates this). Untrusted callers cannot
 * supply a time at all: their `timestamp` is ignored, as their `ip_address`
 * and `user_agent` already are.
 */

export const MAX_EVENT_TIME_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_EVENT_AGE_MS = 15 * 24 * 60 * 60 * 1000;

/** A trusted caller supplied an event time out of bounds; the HTTP layer answers 400. */
export class EventTimeError extends Error {
  readonly statusCode = 400;
}

export type EventTimeResolution =
  | { ok: true; eventTime: Date; supplied: boolean }
  | { ok: false; error: string };

/**
 * The time an event is recorded at.
 *
 * Returns the arrival time unless a trusted caller supplied a timestamp, in
 * which case the supplied time is used when it is in bounds and refused when it
 * is not. Refusing (rather than silently using the arrival time) keeps a bad
 * bridge clock visible: the bridge sees a 400 and can dead-letter the event.
 */
export function resolveEventTime(
  suppliedTimestamp: string | undefined,
  trusted: boolean,
  arrivedAt: Date
): EventTimeResolution {
  if (!trusted || suppliedTimestamp === undefined) {
    return { ok: true, eventTime: arrivedAt, supplied: false };
  }

  const eventMs = Date.parse(suppliedTimestamp);
  if (!Number.isFinite(eventMs)) {
    return { ok: false, error: "timestamp is not a valid ISO 8601 date-time" };
  }

  const arrivedMs = arrivedAt.getTime();
  if (eventMs > arrivedMs + MAX_EVENT_TIME_FUTURE_SKEW_MS) {
    return { ok: false, error: "timestamp is more than 5 minutes in the future" };
  }
  if (eventMs < arrivedMs - MAX_EVENT_AGE_MS) {
    return { ok: false, error: "timestamp is more than 15 days in the past" };
  }

  return { ok: true, eventTime: new Date(eventMs), supplied: true };
}
