import type { FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveTrackingRequest: vi.fn(),
  ingestEvent: vi.fn(),
}));

vi.mock("./trackingRequest.js", () => ({
  resolveTrackingRequest: mocks.resolveTrackingRequest,
}));

vi.mock("./ingestEvent.js", () => ({
  ingestEvent: mocks.ingestEvent,
}));

import { PermanentIngestError, RateLimitedIngestError, RetryableIngestError } from "./ingestErrors.js";
import { trackEvent } from "./trackEvent.js";

const resolvedRequest = { payload: { site_id: "site_abc" }, site: { siteId: 42 } };

function requestWithBody(body: unknown): FastifyRequest {
  return { body, headers: {}, ip: "198.51.100.10" } as unknown as FastifyRequest;
}

function replyStub(): FastifyReply {
  const reply = {
    status: vi.fn(function (this: typeof reply) {
      return this;
    }),
    send: vi.fn(function (this: typeof reply) {
      return this;
    }),
    header: vi.fn(function (this: typeof reply) {
      return this;
    }),
  };
  return reply as unknown as FastifyReply;
}

describe("trackEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrackingRequest.mockResolvedValue(resolvedRequest);
    mocks.ingestEvent.mockResolvedValue({ status: "tracked", sessionId: "session-alice" });
  });

  it("rejects a payload that fails validation without resolving anything", async () => {
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview" }), reply);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(mocks.resolveTrackingRequest).not.toHaveBeenCalled();
    expect(mocks.ingestEvent).not.toHaveBeenCalled();
  });

  it("answers 404 when the Site is unknown", async () => {
    mocks.resolveTrackingRequest.mockResolvedValue(null);
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview", site_id: "nope" }), reply);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ success: false, error: "Site not found" });
    expect(mocks.ingestEvent).not.toHaveBeenCalled();
  });

  it("hands the resolved Tracking Request to ingestion and reports success", async () => {
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview", site_id: "site_abc" }), reply);

    expect(mocks.ingestEvent).toHaveBeenCalledWith(resolvedRequest);
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ success: true });
  });

  it("maps a Site Exclusion Decision to the event skip response", async () => {
    mocks.ingestEvent.mockResolvedValue({
      status: "excluded",
      exclusion: { excluded: true, reason: "path", label: "path", value: "/admin/users" },
    });
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview", site_id: "site_abc" }), reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({
      success: true,
      message: "Event not tracked - path excluded",
    });
  });

  it("reports the monthly limit without failing the request", async () => {
    mocks.ingestEvent.mockResolvedValue({ status: "over_limit" });
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview", site_id: "site_abc" }), reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith("Site over monthly limit, event not tracked");
  });

  it("reports a site with no plan without failing the request", async () => {
    mocks.ingestEvent.mockResolvedValue({ status: "no_plan" });
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview", site_id: "site_abc" }), reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith("Site has no plan, event not tracked");
  });

  it("answers a detected bot with the same success shape as a tracked event", async () => {
    mocks.ingestEvent.mockResolvedValue({ status: "bot" });
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview", site_id: "site_abc" }), reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ success: true });
  });

  it("turns an ingestion failure into a 500", async () => {
    mocks.ingestEvent.mockRejectedValue(new Error("ClickHouse unavailable"));
    const reply = replyStub();

    await trackEvent(requestWithBody({ type: "pageview", site_id: "site_abc" }), reply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ success: false, error: "Failed to track event" });
  });
});

// sp3n/rybbit fork: answers a queue-backed caller retries on.
describe("trackEvent retriable answers", () => {
  const validBody = { type: "pageview", site_id: "site_abc" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTrackingRequest.mockResolvedValue(resolvedRequest);
  });

  it("answers 503 with Retry-After when the event could not be recorded", async () => {
    mocks.ingestEvent.mockRejectedValue(new RetryableIngestError("the event could not be stored", 7));
    const reply = replyStub();

    await trackEvent(requestWithBody(validBody), reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.header).toHaveBeenCalledWith("retry-after", "7");
  });

  it("answers 429 with Retry-After for a rate-limited trusted caller", async () => {
    mocks.resolveTrackingRequest.mockRejectedValue(new RateLimitedIngestError(30));
    const reply = replyStub();

    await trackEvent(requestWithBody(validBody), reply);

    expect(reply.status).toHaveBeenCalledWith(429);
    expect(reply.header).toHaveBeenCalledWith("retry-after", "30");
  });

  it("answers 422 for an event that can never be stored", async () => {
    mocks.ingestEvent.mockRejectedValue(new PermanentIngestError("ClickHouse refused the event (27)"));
    const reply = replyStub();

    await trackEvent(requestWithBody(validBody), reply);

    expect(reply.status).toHaveBeenCalledWith(422);
  });

  it("answers a redelivered event as a duplicate", async () => {
    mocks.ingestEvent.mockResolvedValue({ status: "duplicate" });
    const reply = replyStub();

    await trackEvent(requestWithBody(validBody), reply);

    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ success: true, duplicate: true });
  });
});
