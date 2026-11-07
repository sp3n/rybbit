import { describe, expect, it } from "vitest";
import { MAX_EVENT_AGE_MS, MAX_EVENT_TIME_FUTURE_SKEW_MS, resolveEventTime } from "./eventTime.js";

const arrivedAt = new Date("2026-11-07T12:00:00.000Z");
const at = (offsetMs: number) => new Date(arrivedAt.getTime() + offsetMs).toISOString();

describe("resolveEventTime", () => {
  it("uses the arrival time when no timestamp is supplied", () => {
    expect(resolveEventTime(undefined, true, arrivedAt)).toEqual({ ok: true, eventTime: arrivedAt, supplied: false });
  });

  it("ignores an untrusted caller's timestamp, however plausible", () => {
    expect(resolveEventTime(at(-60_000), false, arrivedAt)).toEqual({
      ok: true,
      eventTime: arrivedAt,
      supplied: false,
    });
  });

  it("uses a trusted timestamp inside the bounds, to the millisecond", () => {
    const result = resolveEventTime("2026-11-07T11:00:00.123+00:00", true, arrivedAt);
    expect(result).toEqual({ ok: true, eventTime: new Date("2026-11-07T11:00:00.123Z"), supplied: true });
  });

  it("accepts the exact bounds", () => {
    expect(resolveEventTime(at(MAX_EVENT_TIME_FUTURE_SKEW_MS), true, arrivedAt).ok).toBe(true);
    expect(resolveEventTime(at(-MAX_EVENT_AGE_MS), true, arrivedAt).ok).toBe(true);
  });

  it("refuses a trusted timestamp more than 5 minutes ahead", () => {
    expect(resolveEventTime(at(MAX_EVENT_TIME_FUTURE_SKEW_MS + 1), true, arrivedAt)).toMatchObject({ ok: false });
  });

  it("refuses a trusted timestamp more than 15 days old", () => {
    expect(resolveEventTime(at(-MAX_EVENT_AGE_MS - 1), true, arrivedAt)).toMatchObject({ ok: false });
  });

  it("refuses an unparseable trusted timestamp", () => {
    expect(resolveEventTime("not a date", true, arrivedAt)).toMatchObject({ ok: false });
  });
});
