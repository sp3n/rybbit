import type { FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidatedTrackingPayload } from "./trackingPayload.js";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  checkApiKey: vi.fn(),
  lookupAsn: vi.fn(),
}));

vi.mock("../../lib/siteConfig.js", () => ({
  siteConfig: { getConfig: mocks.getConfig },
}));

vi.mock("../../lib/auth-utils.js", () => ({
  checkApiKey: mocks.checkApiKey,
}));

// The memoising factory is the real one, wired to a fake reader — these tests
// exercise the shipped memoisation, not a stand-in for it.
vi.mock("../../db/geolocation/asn.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../db/geolocation/asn.js")>();
  return {
    ...actual,
    lookupAsn: mocks.lookupAsn,
    createAsnLookup: (lookup = mocks.lookupAsn) => actual.createAsnLookup(lookup),
  };
});

import { EventTimeError } from "./eventTime.js";
import { resolveTrackingRequest } from "./trackingRequest.js";

const site = {
  id: "site_abc",
  siteId: 42,
  firstPartyProxy: false,
  saltUserIds: false,
};

function request(headers: Record<string, string | string[]>, ip = "198.51.100.10"): FastifyRequest {
  return { headers, ip } as unknown as FastifyRequest;
}

const payload = (overrides: Record<string, unknown> = {}) =>
  ({ type: "pageview", site_id: "site_abc", ...overrides }) as ValidatedTrackingPayload;

describe("resolveTrackingRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockResolvedValue(site);
    mocks.lookupAsn.mockReturnValue(null);
  });

  it("returns null for an unknown Site", async () => {
    mocks.getConfig.mockResolvedValue(undefined);

    expect(await resolveTrackingRequest(request({}), payload())).toBeNull();
  });

  it("reads the Site Configuration once for the whole request", async () => {
    await resolveTrackingRequest(request({}), payload());

    expect(mocks.getConfig).toHaveBeenCalledOnce();
    expect(mocks.getConfig).toHaveBeenCalledWith("site_abc");
  });

  it("ignores public payload IP and user-agent overrides", async () => {
    const resolved = await resolveTrackingRequest(
      request({
        "user-agent": "Mozilla/5.0 Chrome/120 Safari/537.36",
        "x-forwarded-for": "198.51.100.20, 10.0.0.1",
      }),
      payload({ ip_address: "203.0.113.10", user_agent: "SpoofedBot/1.0" })
    );

    expect(resolved).toMatchObject({
      ipAddress: "198.51.100.20",
      userAgent: "Mozilla/5.0 Chrome/120 Safari/537.36",
      trustedServerSideIngestion: false,
      // Exclusion candidates still include everything the request presented.
      candidateIps: ["198.51.100.20", "10.0.0.1", "198.51.100.10"],
    });
  });

  it("allows payload IP and user-agent overrides for trusted server-side ingestion", async () => {
    mocks.checkApiKey.mockResolvedValue({
      valid: true,
      statements: { ingest: ["write"] },
    });

    const resolved = await resolveTrackingRequest(
      request({
        authorization: "Bearer sk_test",
        "user-agent": "ServerSDK/1.0",
        "x-forwarded-for": "198.51.100.20",
      }),
      payload({ ip_address: "203.0.113.10", user_agent: "Mozilla/5.0 Chrome/120 Safari/537.36" })
    );

    expect(resolved).toMatchObject({
      ipAddress: "203.0.113.10",
      userAgent: "Mozilla/5.0 Chrome/120 Safari/537.36",
      trustedServerSideIngestion: true,
      candidateIps: ["203.0.113.10", "198.51.100.20", "198.51.100.10"],
    });
  });

  it("degrades an under-scoped bearer to untrusted client-side traffic", async () => {
    mocks.checkApiKey.mockResolvedValue({
      valid: true,
      statements: { site: ["read"] },
    });

    const resolved = await resolveTrackingRequest(
      request({ authorization: "Bearer sk_test", "user-agent": "ServerSDK/1.0" }),
      payload({ ip_address: "203.0.113.10" })
    );

    expect(resolved).toMatchObject({
      ipAddress: "198.51.100.10",
      trustedServerSideIngestion: false,
    });
  });

  it("carries an ASN resolver that answers each IP once per request", async () => {
    mocks.lookupAsn.mockReturnValue({ asn: 13335, organization: "Cloudflare" });

    const resolved = await resolveTrackingRequest(request({}), payload());
    mocks.lookupAsn.mockClear();

    expect(resolved!.lookupAsn("203.0.113.7")).toEqual({ asn: 13335, organization: "Cloudflare" });
    expect(resolved!.lookupAsn("203.0.113.7")).toEqual({ asn: 13335, organization: "Cloudflare" });
    expect(mocks.lookupAsn).toHaveBeenCalledOnce();
  });

  it("resolves the client IP through the same request-scoped ASN resolver", async () => {
    // A datacenter edge IP means a first-party proxy is in front, so the
    // forwarded visitor IP wins over the Cloudflare edge IP.
    mocks.lookupAsn.mockImplementation((ip: string) =>
      ip === "203.0.113.99" ? { asn: 16509, organization: "AMAZON-02" } : null
    );

    const resolved = await resolveTrackingRequest(
      request({ "cf-connecting-ip": "203.0.113.99", "x-forwarded-for": "198.51.100.20" }),
      payload()
    );

    expect(resolved!.ipAddress).toBe("198.51.100.20");
  });
});

// sp3n/rybbit fork: a trusted bridge supplies each event's own time and id.
describe("resolveTrackingRequest event time and id", () => {
  const trusted = () =>
    mocks.checkApiKey.mockResolvedValue({ valid: true, statements: { ingest: ["write"] } });
  const bearer = () => request({ authorization: "Bearer sk_test" });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
    mocks.getConfig.mockResolvedValue(site);
    mocks.lookupAsn.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a trusted caller's event time instead of the arrival time", async () => {
    trusted();

    const resolved = await resolveTrackingRequest(
      bearer(),
      payload({ timestamp: "2026-11-07T10:15:30.250Z", event_id: "env-1" })
    );

    expect(resolved!.receivedAt.toISOString()).toBe("2026-11-07T10:15:30.250Z");
    expect(resolved!.eventTimeSupplied).toBe(true);
    expect(resolved!.eventId).toBe("env-1");
  });

  it("ignores an untrusted caller's timestamp and event id", async () => {
    const resolved = await resolveTrackingRequest(
      request({}),
      payload({ timestamp: "2026-11-01T00:00:00.000Z", event_id: "env-1" })
    );

    expect(resolved!.receivedAt.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(resolved!.eventTimeSupplied).toBe(false);
    expect(resolved!.eventId).toBeUndefined();
  });

  it("ignores the timestamp of a bearer without ingest:write", async () => {
    mocks.checkApiKey.mockResolvedValue({ valid: true, statements: { site: ["read"] } });

    const resolved = await resolveTrackingRequest(bearer(), payload({ timestamp: "2026-11-01T00:00:00.000Z" }));

    expect(resolved!.receivedAt.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(resolved!.eventTimeSupplied).toBe(false);
  });

  it("refuses a trusted timestamp out of bounds", async () => {
    trusted();

    await expect(
      resolveTrackingRequest(bearer(), payload({ timestamp: "2026-11-07T12:10:00.000Z" }))
    ).rejects.toBeInstanceOf(EventTimeError);
    await expect(
      resolveTrackingRequest(bearer(), payload({ timestamp: "2026-10-22T11:59:00.000Z" }))
    ).rejects.toBeInstanceOf(EventTimeError);
  });

  it("keeps the arrival time when a trusted caller sends no timestamp", async () => {
    trusted();

    const resolved = await resolveTrackingRequest(bearer(), payload());

    expect(resolved!.receivedAt.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(resolved!.eventTimeSupplied).toBe(false);
  });
});
