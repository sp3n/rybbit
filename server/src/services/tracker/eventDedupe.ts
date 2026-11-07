import { claimEventId, completeEventId, releaseEventId } from "../../db/redis/redis.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { MAX_EVENT_AGE_MS } from "./eventTime.js";
import { RetryableIngestError } from "./ingestErrors.js";

const logger = createServiceLogger("event-dedupe");

/**
 * sp3n/rybbit fork: drop redelivered events from trusted callers.
 *
 * A queue in front of /api/track delivers at least once: an event can arrive
 * twice when the first response is lost, or while the first delivery is still
 * being recorded. The caller gives each event a stable `event_id`:
 *
 * - The first delivery claims it as pending, records the event, and only then
 *   marks it done (ingestEvent.ts waits for the ClickHouse insert).
 * - A delivery that finds it done is dropped as a duplicate (200).
 * - A delivery that finds it pending gets a retriable 503: the first one may
 *   still fail, and acknowledging this one would lose the event.
 * - If recording fails the claim is released; if the process dies the
 *   pending claim expires after CLAIM_PENDING_MS. Either way the retry records it.
 *
 * Redis being unreachable is retriable too, rather than recording without
 * dedupe: the caller's queue keeps the event until it can be done properly.
 */
const CLAIM_PENDING_MS = 5 * 60 * 1000;
const DONE_RETENTION_MS = MAX_EVENT_AGE_MS;

export type EventClaim =
  | { duplicate: true }
  | { duplicate: false; complete: () => Promise<void>; release: () => Promise<void> };

const NO_CLAIM: EventClaim = { duplicate: false, complete: async () => {}, release: async () => {} };

export function eventDedupeKey(siteId: number, eventId: string): string {
  return `event-id:${siteId}:${eventId}`;
}

export async function claimEvent(siteId: number, eventId: string | undefined): Promise<EventClaim> {
  if (!eventId) return NO_CLAIM;

  const key = eventDedupeKey(siteId, eventId);
  let state;
  try {
    state = await claimEventId(key, CLAIM_PENDING_MS);
  } catch (error) {
    logger.error(error as Error, "Redis event-id claim failed");
    throw new RetryableIngestError("event-id dedupe is unavailable");
  }

  if (state === "done") return { duplicate: true };
  if (state === "pending") throw new RetryableIngestError("another delivery of this event is being recorded");

  return {
    duplicate: false,
    complete: async () => {
      try {
        await completeEventId(key, DONE_RETENTION_MS);
      } catch (error) {
        // The event is stored; the pending claim expires and a later
        // redelivery would store it again. Logged so the duplicate is explicable.
        logger.error({ err: error, siteId, eventId }, "Could not mark an event id as recorded");
      }
    },
    release: async () => {
      try {
        await releaseEventId(key);
      } catch (error) {
        // The pending claim expires on its own; until then retries get a 503.
        logger.error({ err: error, siteId, eventId }, "Could not release an event-id claim after a failed ingest");
      }
    },
  };
}
