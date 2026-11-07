import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { CLAIM_EVENT_ID_LUA, EVENT_TIME_SESSION_LUA } from "./eventTimeSessionLua.js";

// sp3n/rybbit fork: behavioural tests for event-time sessions and event-id
// dedupe, executed for real by ioredis-mock's embedded Lua runtime.

const GAP_MS = 30 * 60 * 1000;
const RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

interface EventTimeMockRedis {
  eventTimeSession(key: string, candidateId: string, eventMs: number, gapMs: number, retentionMs: number): Promise<string>;
  claimEventId(key: string, retentionMs: number): Promise<number>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  flushall(): Promise<unknown>;
}

let redis: EventTimeMockRedis;
let candidates = 0;

/** Session id for one event at `iso` (+ offset minutes); each call offers a fresh candidate id. */
function sessionAt(key: string, iso: string, offsetMinutes = 0) {
  candidates += 1;
  return redis.eventTimeSession(key, `s${candidates}`, Date.parse(iso) + offsetMinutes * MINUTE, GAP_MS, RETENTION_MS);
}

// The keys a retail and a demo site would give the same identified player.
const RETAIL_ALICE = "event-time:session:1:identified-server:alice";
const DEMO_ALICE = "event-time:session:2:identified-server:alice";
const RETAIL_BOB = "event-time:session:1:identified-server:bob";

describe("eventTimeSession Lua script", () => {
  beforeEach(async () => {
    const client = new RedisMock();
    client.defineCommand("eventTimeSession", { numberOfKeys: 1, lua: EVENT_TIME_SESSION_LUA });
    client.defineCommand("claimEventId", { numberOfKeys: 1, lua: CLAIM_EVENT_ID_LUA });
    redis = client as unknown as EventTimeMockRedis;
    await redis.flushall();
    candidates = 0;
  });

  it("keeps events less than 30 minutes apart in one session, however late they arrive", async () => {
    // A two-hour play session replayed in one burst after an outage.
    const ids = [];
    for (let minute = 0; minute <= 120; minute += 10) {
      ids.push(await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z", minute));
    }

    expect(new Set(ids).size).toBe(1);
    expect(await redis.get(RETAIL_ALICE)).toBe(
      `${ids[0]}|${Date.parse("2026-11-07T08:00:00Z")}|${Date.parse("2026-11-07T10:00:00Z")}`
    );
  });

  it("splits at a gap longer than 30 minutes even when the events arrive together", async () => {
    const first = await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");
    const sameSession = await sessionAt(RETAIL_ALICE, "2026-11-07T08:30:00Z"); // exactly the gap
    const afterLongGap = await sessionAt(RETAIL_ALICE, "2026-11-07T09:00:01Z");
    const afterLongGapToo = await sessionAt(RETAIL_ALICE, "2026-11-07T09:10:00Z");

    expect(sameSession).toBe(first);
    expect(afterLongGap).not.toBe(first);
    expect(afterLongGapToo).toBe(afterLongGap);
  });

  it("splits a backlog by its own gaps, not by when it drains", async () => {
    // Evening and next-morning sessions, both delivered in the same second.
    const evening = [
      await sessionAt(RETAIL_ALICE, "2026-11-06T20:00:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-11-06T20:25:00Z"),
    ];
    const morning = [
      await sessionAt(RETAIL_ALICE, "2026-11-07T07:00:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-11-07T07:20:00Z"),
    ];

    expect(evening[0]).toBe(evening[1]);
    expect(morning[0]).toBe(morning[1]);
    expect(morning[0]).not.toBe(evening[0]);
  });

  it("keeps several players' interleaved events in their own sessions", async () => {
    const alice1 = await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");
    const bob1 = await sessionAt(RETAIL_BOB, "2026-11-07T08:01:00Z");
    const alice2 = await sessionAt(RETAIL_ALICE, "2026-11-07T08:05:00Z");
    const bob2 = await sessionAt(RETAIL_BOB, "2026-11-07T08:50:00Z"); // Bob's gap, not Alice's

    expect(alice2).toBe(alice1);
    expect(bob1).not.toBe(alice1);
    expect(bob2).not.toBe(bob1);
  });

  it("keeps one session across midnight UTC for an identified player", async () => {
    const before = await sessionAt(RETAIL_ALICE, "2026-11-06T23:50:00Z");
    const after = await sessionAt(RETAIL_ALICE, "2026-11-07T00:10:00Z");

    expect(after).toBe(before);
  });

  it("keeps the demo and retail sites apart for the same player", async () => {
    const retail = await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");
    const demo = await sessionAt(DEMO_ALICE, "2026-11-07T08:01:00Z");
    const retailAgain = await sessionAt(RETAIL_ALICE, "2026-11-07T08:02:00Z");

    expect(demo).not.toBe(retail);
    expect(retailAgain).toBe(retail);
  });

  it("joins a late, older event within the gap without moving the session's end backwards", async () => {
    const id = await sessionAt(RETAIL_ALICE, "2026-11-07T08:30:00Z");
    expect(await sessionAt(RETAIL_ALICE, "2026-11-07T08:10:00Z")).toBe(id);

    expect(await redis.get(RETAIL_ALICE)).toBe(
      `${id}|${Date.parse("2026-11-07T08:10:00Z")}|${Date.parse("2026-11-07T08:30:00Z")}`
    );
  });

  it("gives an event older than the stored session by more than the gap a session of its own", async () => {
    const current = await sessionAt(RETAIL_ALICE, "2026-11-07T10:00:00Z");
    const stray = await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");
    const next = await sessionAt(RETAIL_ALICE, "2026-11-07T10:05:00Z");

    expect(stray).not.toBe(current);
    expect(next).toBe(current);
  });

  it("keeps the key for the retention period, wall-clock", async () => {
    await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");

    const ttl = await redis.pttl(RETAIL_ALICE);
    expect(ttl).toBeGreaterThan(RETENTION_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(RETENTION_MS);
  });
});

describe("claimEventId Lua script", () => {
  beforeEach(async () => {
    const client = new RedisMock();
    client.defineCommand("claimEventId", { numberOfKeys: 1, lua: CLAIM_EVENT_ID_LUA });
    redis = client as unknown as EventTimeMockRedis;
    await redis.flushall();
  });

  it("claims an event id once", async () => {
    expect(await redis.claimEventId("event-id:1:env-1", RETENTION_MS)).toBe(1);
    expect(await redis.claimEventId("event-id:1:env-1", RETENTION_MS)).toBe(0);
  });

  it("scopes claims by site, so demo and retail never collide", async () => {
    expect(await redis.claimEventId("event-id:1:env-1", RETENTION_MS)).toBe(1);
    expect(await redis.claimEventId("event-id:2:env-1", RETENTION_MS)).toBe(1);
  });

  it("can be claimed again once released", async () => {
    await redis.claimEventId("event-id:1:env-1", RETENTION_MS);
    await redis.del("event-id:1:env-1");

    expect(await redis.claimEventId("event-id:1:env-1", RETENTION_MS)).toBe(1);
  });
});
