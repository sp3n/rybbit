import { claimEventId, releaseEventId } from "../../db/redis/redis.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { MAX_EVENT_AGE_MS } from "./eventTime.js";

const logger = createServiceLogger("event-dedupe");

/**
 * sp3n/rybbit fork: drop redelivered events from trusted callers.
 *
 * A queue in front of /api/track delivers at least once: an event can arrive
 * twice when the first response is lost. The caller gives each event a stable
 * `event_id`, and the first delivery claims it for as long as an event may be
 * delivered at all (MAX_EVENT_AGE_MS), so every later delivery is dropped.
 *
 * Fails open: if Redis cannot be reached the event is recorded, because a
 * possible duplicate is a smaller loss than a dropped event.
 */
const DEDUPE_RETENTION_MS = MAX_EVENT_AGE_MS;

export type EventClaim = { duplicate: true } | { duplicate: false; release: () => Promise<void> };

const NO_CLAIM: EventClaim = { duplicate: false, release: async () => {} };

export function eventDedupeKey(siteId: number, eventId: string): string {
  return `event-id:${siteId}:${eventId}`;
}

export async function claimEvent(siteId: number, eventId: string | undefined): Promise<EventClaim> {
  if (!eventId) return NO_CLAIM;

  const key = eventDedupeKey(siteId, eventId);
  try {
    if (!(await claimEventId(key, DEDUPE_RETENTION_MS))) {
      return { duplicate: true };
    }
  } catch (error) {
    logger.error(error as Error, "Redis event-id claim failed; recording the event without dedupe");
    return NO_CLAIM;
  }

  return {
    duplicate: false,
    release: async () => {
      try {
        await releaseEventId(key);
      } catch (error) {
        // The claim stays until it expires, and a retry of this event would be
        // dropped as a duplicate. Logged so the loss is visible.
        logger.error({ err: error, siteId, eventId }, "Could not release an event-id claim after a failed ingest");
      }
    },
  };
}
