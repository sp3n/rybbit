import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CLAIM_EVENT_ID_LUA,
  COMPLETE_EVENT_ID_LUA,
  EVENT_TIME_SESSION_LUA,
  RELEASE_EVENT_ID_LUA,
} from "./eventTimeSessionLua.js";

// sp3n/rybbit fork: behavioural tests for event-time sessions and event-id
// dedupe, executed for real by ioredis-mock's embedded Lua runtime.

const GAP_MS = 30 * 60 * 1000;
const RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
const MAX_SPANS = 16;
const MINUTE = 60 * 1000;

interface EventTimeMockRedis {
  eventTimeSession(
    key: string,
    candidateId: string,
    eventMs: number,
    gapMs: number,
    retentionMs: number,
    maxSpans: number,
    nowMs: number
  ): Promise<string>;
  claimEventId(key: string, pendingMs: number, token: string): Promise<string>;
  releaseEventId(key: string, token: string): Promise<number>;
  completeEventId(key: string, token: string, retentionMs: number): Promise<number>;
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  flushall(): Promise<unknown>;
}

let redis: EventTimeMockRedis;
let candidates = 0;
// The wall clock the caller passes; each call is one millisecond later.
let now = 1_800_000_000_000;

/** Session id for one event at `iso` (+ offset minutes); each call offers a fresh candidate id. */
function sessionAt(key: string, iso: string, offsetMinutes = 0) {
  candidates += 1;
  return redis.eventTimeSession(
    key,
    `s${candidates}`,
    Date.parse(iso) + offsetMinutes * MINUTE,
    GAP_MS,
    RETENTION_MS,
    MAX_SPANS,
    (now += 1)
  );
}

/** A stored span without its last-used time. */
const span = (stored: string | null, index = 0) => stored!.split(";")[index]!.split("|").slice(0, 3).join("|");

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
    expect(span(await redis.get(RETAIL_ALICE))).toBe(
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

    expect(span(await redis.get(RETAIL_ALICE))).toBe(
      `${id}|${Date.parse("2026-11-07T08:10:00Z")}|${Date.parse("2026-11-07T08:30:00Z")}`
    );
  });

  it("gives an event older than every remembered session a session of its own, and keeps it", async () => {
    const current = await sessionAt(RETAIL_ALICE, "2026-11-07T10:00:00Z");
    const stray = await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");
    const strayAgain = await sessionAt(RETAIL_ALICE, "2026-11-07T08:20:00Z");
    const next = await sessionAt(RETAIL_ALICE, "2026-11-07T10:05:00Z");

    expect(stray).not.toBe(current);
    expect(strayAgain).toBe(stray);
    expect(next).toBe(current);
  });

  it("groups interleaved delivery of two sessions into exactly two sessions", async () => {
    // Concurrent consumers, or live traffic overtaking a backlog.
    const ids = [
      await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-11-07T10:00:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-11-07T08:10:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-11-07T08:20:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-11-07T10:15:00Z"),
    ];

    expect(new Set(ids).size).toBe(2);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[3]).toBe(ids[0]);
    expect(ids[4]).toBe(ids[1]);
  });

  it("joins the nearer of two sessions when an event falls between them", async () => {
    const early = await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");
    const late = await sessionAt(RETAIL_ALICE, "2026-11-07T09:30:00Z");

    // 25 minutes after the early session, 65 before the late one: early only.
    expect(await sessionAt(RETAIL_ALICE, "2026-11-07T08:25:00Z")).toBe(early);
    // 20 minutes before the late session, 45 after the early one: late only.
    expect(await sessionAt(RETAIL_ALICE, "2026-11-07T09:10:00Z")).toBe(late);
  });

  it("merges two sessions an event bridges, so every later event gets one id", async () => {
    // Delivered out of order: 08:00, 08:55, 08:26, 08:50 (gaps 26, 24 and 5 minutes).
    const a = await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");
    const b = await sessionAt(RETAIL_ALICE, "2026-11-07T08:55:00Z");
    const bridge = await sessionAt(RETAIL_ALICE, "2026-11-07T08:26:00Z");
    const after = await sessionAt(RETAIL_ALICE, "2026-11-07T08:50:00Z");

    expect(b).not.toBe(a); // already stored under its own id
    expect(bridge).toBe(a);
    expect(after).toBe(a);
    const stored = (await redis.get(RETAIL_ALICE))!.split(";");
    expect(stored).toHaveLength(1);
    expect(span(stored.join(";"))).toBe(
      `${a}|${Date.parse("2026-11-07T08:00:00Z")}|${Date.parse("2026-11-07T08:55:00Z")}`
    );
  });

  it("keeps an older session being replayed after the span limit is reached", async () => {
    for (let day = 0; day < MAX_SPANS; day += 1) {
      await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z", day * 24 * 60 * -1 + 0);
    }
    // A backlog from before all of them, delivered now.
    const ids = [
      await sessionAt(RETAIL_ALICE, "2026-10-20T08:00:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-10-20T08:10:00Z"),
      await sessionAt(RETAIL_ALICE, "2026-10-20T08:20:00Z"),
    ];

    expect(new Set(ids).size).toBe(1);
  });

  it("keeps the span it just used even when every span was used at the same instant", async () => {
    const sameInstant = 1_900_000_000_000;
    const at = (iso: string, candidate: string) =>
      redis.eventTimeSession(RETAIL_ALICE, candidate, Date.parse(iso), GAP_MS, RETENTION_MS, MAX_SPANS, sameInstant);
    for (let day = 0; day < MAX_SPANS; day += 1) {
      await at(new Date(Date.parse("2026-11-07T08:00:00Z") - day * 86_400_000).toISOString(), `d${day}`);
    }

    const replay = [
      await at("2026-10-01T08:00:00Z", "r1"),
      await at("2026-10-01T08:10:00Z", "r2"),
      await at("2026-10-01T08:20:00Z", "r3"),
    ];
    expect(replay).toEqual(["r1", "r1", "r1"]);
  });

  it("reads spans stored before last-used times were kept", async () => {
    const legacyId = "legacy-session";
    await redis.set(
      RETAIL_ALICE,
      `${legacyId}|${Date.parse("2026-11-07T08:00:00Z")}|${Date.parse("2026-11-07T08:10:00Z")}`
    );

    expect(await sessionAt(RETAIL_ALICE, "2026-11-07T08:20:00Z")).toBe(legacyId);
  });

  it("forgets the session used longest ago beyond the span limit", async () => {
    const first = await sessionAt(RETAIL_ALICE, "2026-11-01T00:00:00Z");
    for (let hour = 1; hour <= MAX_SPANS; hour += 1) {
      await sessionAt(RETAIL_ALICE, "2026-11-01T00:00:00Z", hour * 60);
    }

    const stored = (await redis.get(RETAIL_ALICE))!.split(";");
    expect(stored).toHaveLength(MAX_SPANS);
    expect(stored.some(span => span.startsWith(`${first}|`))).toBe(false);
  });

  it("keeps the key for the retention period, wall-clock", async () => {
    await sessionAt(RETAIL_ALICE, "2026-11-07T08:00:00Z");

    const ttl = await redis.pttl(RETAIL_ALICE);
    expect(ttl).toBeGreaterThan(RETENTION_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(RETENTION_MS);
  });
});

describe("claimEventId Lua script", () => {
  const PENDING_MS = 5 * 60 * 1000;

  beforeEach(async () => {
    const client = new RedisMock();
    client.defineCommand("claimEventId", { numberOfKeys: 1, lua: CLAIM_EVENT_ID_LUA });
    client.defineCommand("releaseEventId", { numberOfKeys: 1, lua: RELEASE_EVENT_ID_LUA });
    client.defineCommand("completeEventId", { numberOfKeys: 1, lua: COMPLETE_EVENT_ID_LUA });
    redis = client as unknown as EventTimeMockRedis;
    await redis.flushall();
  });

  it("claims an event id as pending, then reports it pending to a concurrent delivery", async () => {
    expect(await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1")).toBe("claimed");
    expect(await redis.get("event-id:1:env-1")).toBe("pending:t1");
    expect(await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1")).toBe("pending");
  });

  it("reports an event id marked done as a duplicate", async () => {
    await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1");
    await redis.set("event-id:1:env-1", "done");

    expect(await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1")).toBe("done");
  });

  it("lets a pending claim expire, so a delivery that died does not block its retry for long", async () => {
    await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1");
    const ttl = await redis.pttl("event-id:1:env-1");

    expect(ttl).toBeGreaterThan(PENDING_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(PENDING_MS);
  });

  it("releases only the claim made with the same token", async () => {
    await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1");

    expect(await redis.releaseEventId("event-id:1:env-1", "someone-else")).toBe(0);
    expect(await redis.get("event-id:1:env-1")).toBe("pending:t1");
  });

  it("never releases a recorded event", async () => {
    await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1");
    await redis.set("event-id:1:env-1", "done");

    expect(await redis.releaseEventId("event-id:1:env-1", "t1")).toBe(0);
    expect(await redis.get("event-id:1:env-1")).toBe("done");
  });

  it("marks its own claim done", async () => {
    await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1");

    expect(await redis.completeEventId("event-id:1:env-1", "t1", 60_000)).toBe(1);
    expect(await redis.get("event-id:1:env-1")).toBe("done");
  });

  it("does not overwrite a claim another delivery took over after this lease expired", async () => {
    await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1");
    await redis.set("event-id:1:env-1", "pending:t2"); // t1 expired; t2 claimed

    expect(await redis.completeEventId("event-id:1:env-1", "t1", 60_000)).toBe(0);
    expect(await redis.releaseEventId("event-id:1:env-1", "t1")).toBe(0);
    expect(await redis.get("event-id:1:env-1")).toBe("pending:t2");
  });

  it("scopes claims by site, so demo and retail never collide", async () => {
    expect(await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1")).toBe("claimed");
    expect(await redis.claimEventId("event-id:2:env-1", PENDING_MS, "t2")).toBe("claimed");
  });

  it("can be claimed again once released", async () => {
    await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1");
    expect(await redis.releaseEventId("event-id:1:env-1", "t1")).toBe(1);

    expect(await redis.claimEventId("event-id:1:env-1", PENDING_MS, "t1")).toBe("claimed");
  });
});
