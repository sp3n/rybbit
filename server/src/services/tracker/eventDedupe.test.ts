import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimEventId: vi.fn(),
  completeEventId: vi.fn(),
  releaseEventId: vi.fn(),
}));

vi.mock("../../db/redis/redis.js", () => ({
  claimEventId: mocks.claimEventId,
  completeEventId: mocks.completeEventId,
  releaseEventId: mocks.releaseEventId,
}));

import { claimEvent } from "./eventDedupe.js";
import { RetryableIngestError } from "./ingestErrors.js";

describe("claimEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeEventId.mockResolvedValue(undefined);
    mocks.releaseEventId.mockResolvedValue(undefined);
  });

  it("does nothing without an event id", async () => {
    const claim = await claimEvent(1, undefined);

    expect(claim.duplicate).toBe(false);
    expect(mocks.claimEventId).not.toHaveBeenCalled();
  });

  it("claims, then marks done for the 15-day dedupe window", async () => {
    mocks.claimEventId.mockResolvedValue("claimed");

    const claim = await claimEvent(1, "env-1");
    expect(claim.duplicate).toBe(false);
    expect(mocks.claimEventId).toHaveBeenCalledWith("event-id:1:env-1", 5 * 60 * 1000);

    if (!claim.duplicate) await claim.complete();
    expect(mocks.completeEventId).toHaveBeenCalledWith("event-id:1:env-1", 15 * 24 * 60 * 60 * 1000);
  });

  it("reports an already recorded event as a duplicate", async () => {
    mocks.claimEventId.mockResolvedValue("done");

    expect(await claimEvent(1, "env-1")).toEqual({ duplicate: true });
  });

  it("asks a concurrent delivery to retry rather than acknowledging it", async () => {
    mocks.claimEventId.mockResolvedValue("pending");

    await expect(claimEvent(1, "env-1")).rejects.toBeInstanceOf(RetryableIngestError);
  });

  it("asks for a retry when Redis is unreachable, rather than recording without dedupe", async () => {
    mocks.claimEventId.mockRejectedValue(new Error("redis down"));

    await expect(claimEvent(1, "env-1")).rejects.toBeInstanceOf(RetryableIngestError);
  });

  it("releases a claim after a failed ingest", async () => {
    mocks.claimEventId.mockResolvedValue("claimed");

    const claim = await claimEvent(1, "env-1");
    if (!claim.duplicate) await claim.release();
    expect(mocks.releaseEventId).toHaveBeenCalledWith("event-id:1:env-1");
  });
});
