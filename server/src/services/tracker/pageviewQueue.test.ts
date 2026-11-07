import { ClickHouseError } from "@clickhouse/client";
import { PermanentIngestError } from "./ingestErrors.js";
import { Settings } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type UAParser from "ua-parser-js";
import type { TotalTrackingPayload } from "./utils.js";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  getLocation: vi.fn(),
  lookupAsn: vi.fn(),
  isDatacenterAsn: vi.fn(),
}));

vi.mock("../../db/clickhouse/clickhouse.js", () => ({
  clickhouse: { insert: mocks.insert },
}));

vi.mock("../../db/geolocation/geolocation.js", () => ({
  getLocation: mocks.getLocation,
}));

vi.mock("../../db/geolocation/asn.js", () => ({
  lookupAsn: mocks.lookupAsn,
}));

vi.mock("./botBlocking/datacenterAsns.js", () => ({
  isDatacenterAsn: mocks.isDatacenterAsn,
}));

vi.useFakeTimers();
const { pageviewQueue } = await import("./pageviewQueue.js");
const originalZone = Settings.defaultZone;

function makePayload(overrides: Partial<TotalTrackingPayload & { sessionId: string }> = {}) {
  return {
    site_id: 42,
    hostname: "example.com",
    pathname: "/",
    querystring: "",
    screenWidth: 1920,
    screenHeight: 1080,
    language: "en",
    page_title: "",
    referrer: "",
    type: "pageview",
    ipAddress: "203.0.113.10",
    timestamp: new Date().toISOString(),
    ua: { browser: {}, os: {}, device: {} } as UAParser.IResult,
    userAgent: "Mozilla/5.0",
    userId: "fingerprint-abc",
    identifiedUserId: "",
    sessionId: "session-abc",
    ...overrides,
  } as TotalTrackingPayload & { sessionId: string };
}

async function flush() {
  await pageviewQueue.add(makePayload());
  await vi.advanceTimersByTimeAsync(1000);
}

describe("pageviewQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocation.mockResolvedValue({});
    mocks.insert.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Settings.defaultZone = originalZone;
  });

  it("drain flushes everything buffered without waiting for the interval", async () => {
    for (let i = 0; i < 5001; i++) {
      await pageviewQueue.add(makePayload());
    }

    await pageviewQueue.drain();

    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insert.mock.calls[0][0].values).toHaveLength(5000);
    expect(mocks.insert.mock.calls[1][0].values).toHaveLength(1);
  });

  it("stores the ASN, org, and datacenter classification for a recognized IP", async () => {
    mocks.lookupAsn.mockReturnValue({ asn: 16509, organization: "AMAZON-02" });
    mocks.isDatacenterAsn.mockReturnValue(true);

    await flush();

    const row = mocks.insert.mock.calls[0][0].values[0];
    expect(row.asn).toBe(16509);
    expect(row.asn_org).toBe("AMAZON-02");
    expect(row.is_datacenter_asn).toBe(1);
  });

  it("defaults to null/empty/0 when the IP has no ASN match", async () => {
    mocks.lookupAsn.mockReturnValue(null);

    await flush();

    const row = mocks.insert.mock.calls[0][0].values[0];
    expect(row.asn).toBeNull();
    expect(row.asn_org).toBe("");
    expect(row.is_datacenter_asn).toBe(0);
  });

  it("marks residential ASNs as non-datacenter", async () => {
    mocks.lookupAsn.mockReturnValue({ asn: 7922, organization: "COMCAST-7922" });
    mocks.isDatacenterAsn.mockReturnValue(false);

    await flush();

    const row = mocks.insert.mock.calls[0][0].values[0];
    expect(row.is_datacenter_asn).toBe(0);
  });

  it("preserves the request's millisecond timestamp for event ordering", async () => {
    await pageviewQueue.add(makePayload({ timestamp: "2026-08-28T12:34:56.789Z" }));
    await vi.advanceTimersByTimeAsync(1000);

    const row = mocks.insert.mock.calls[0][0].values[0];
    expect(row.timestamp).toBe("2026-08-28T12:34:56.789Z");
    expect(row.timestamp_ms).toBe("2026-08-28T12:34:56.789Z");
  });

  it.each([
    ["UTC", "2026-09-15T12:57:22.789Z", "2026-09-15T12:57:22.789Z"],
    ["Europe/Berlin", "2026-09-15T14:57:22.789+02:00", "2026-09-15T12:57:22.789Z"],
    ["Asia/Shanghai", "2026-01-15T20:57:22.001+08:00", "2026-01-15T12:57:22.001Z"],
    ["America/New_York", "2026-01-15T07:57:22.000-05:00", "2026-01-15T12:57:22.000Z"],
  ])("sends explicit-UTC timestamps when the backend runs in %s", async (zone, timestamp, expected) => {
    Settings.defaultZone = zone;
    await pageviewQueue.add(makePayload({ timestamp }));
    await vi.advanceTimersByTimeAsync(1000);

    const row = mocks.insert.mock.calls[0][0].values[0];
    expect(row.timestamp).toBe(expected);
    expect(row.timestamp_ms).toBe(expected);
  });

  it.each([['"file.pdf"'], ["[1,2]"], ["123"], ["null"], ["not json"]])(
    "drops props that aren't a JSON object (%s) and keeps the event",
    async properties => {
      await pageviewQueue.add(makePayload({ type: "custom_event", event_name: "download", properties }));
      await pageviewQueue.add(makePayload({ type: "custom_event", event_name: "ok", properties: '{"plan":"pro"}' }));
      await vi.advanceTimersByTimeAsync(1000);

      const rows = mocks.insert.mock.calls[0][0].values;
      expect(rows).toHaveLength(2);
      expect(rows[0].props).toBeUndefined();
      expect(rows[1].props).toEqual({ plan: "pro" });
    }
  );

  // sp3n/rybbit fork: a trusted caller's geography (geoOverride.ts).
  it("stores a trusted geography override instead of the IP lookup", async () => {
    mocks.getLocation.mockResolvedValue({
      "203.0.113.10": {
        countryIso: "GB",
        region: "SCT",
        city: "Edinburgh",
        latitude: 55.95,
        longitude: -3.19,
        timeZone: "Europe/London",
      },
    });

    await pageviewQueue.add(
      makePayload({
        geoOverride: {
          country: "GB",
          region: "ENG",
          city: "London",
          latitude: 51.51,
          longitude: -0.13,
          timezone: "Europe/London",
        },
      })
    );
    await vi.advanceTimersByTimeAsync(1000);

    const row = mocks.insert.mock.calls[0][0].values[0];
    expect(row).toMatchObject({
      country: "GB",
      region: "GB-ENG",
      city: "London",
      lat: 51.51,
      lon: -0.13,
      timezone: "Europe/London",
    });
  });

  it("keeps the IP lookup geography when no override is sent", async () => {
    mocks.getLocation.mockResolvedValue({
      "203.0.113.10": {
        countryIso: "GB",
        region: "SCT",
        city: "Edinburgh",
        latitude: 55.95,
        longitude: -3.19,
        timeZone: "Europe/London",
      },
    });

    await flush();

    const row = mocks.insert.mock.calls[0][0].values[0];
    expect(row).toMatchObject({ country: "GB", region: "GB-SCT", city: "Edinburgh", lat: 55.95, lon: -3.19 });
  });

  // sp3n/rybbit fork: a trusted delivery waits for its batch to be stored.
  it("resolves a durable add once its batch is inserted", async () => {
    let settled = false;
    const durable = pageviewQueue.addDurable(makePayload()).then(() => (settled = true));

    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await durable;
    expect(settled).toBe(true);
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("rejects a durable add when its batch fails to insert", async () => {
    mocks.insert.mockRejectedValueOnce(new Error("clickhouse down"));

    const durable = pageviewQueue.addDurable(makePayload());
    const outcome = durable.then(
      () => "stored",
      error => (error as Error).message
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(await outcome).toBe("the event could not be stored");
  });

  it("stores the good rows and refuses only the row ClickHouse rejects", async () => {
    const refused = new ClickHouseError({ message: "Cannot parse input", code: "27", type: "CANNOT_PARSE_INPUT" });
    mocks.insert
      .mockRejectedValueOnce(refused) // the strict insert of both rows
      .mockResolvedValueOnce(undefined) // the good row alone
      .mockRejectedValueOnce(refused); // the bad row alone

    const good = pageviewQueue.addDurable(makePayload({ pathname: "/good" }));
    const bad = pageviewQueue.addDurable(makePayload({ pathname: "/bad" }));
    const outcomes = Promise.allSettled([good, bad]);
    await vi.advanceTimersByTimeAsync(1000);

    const [goodOutcome, badOutcome] = await outcomes;
    expect(goodOutcome.status).toBe("fulfilled");
    expect(badOutcome).toMatchObject({ status: "rejected", reason: expect.any(PermanentIngestError) });
  });

  it("inserts durable rows without the tolerance for skipped rows", async () => {
    const durable = pageviewQueue.addDurable(makePayload());
    await vi.advanceTimersByTimeAsync(1000);
    await durable;

    const settings = mocks.insert.mock.calls[0][0].clickhouse_settings;
    expect(settings.input_format_allow_errors_num).toBeUndefined();
  });

  it("settles a durable row the queue filter drops as handled, without an insert", async () => {
    const dropped = pageviewQueue.addDurable(makePayload({ site_id: 9133, screenWidth: 800, screenHeight: 600 }));
    await vi.advanceTimersByTimeAsync(1000);

    await expect(dropped).resolves.toBeUndefined();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("inserts with settings that keep one bad row from failing the batch", async () => {
    await flush();

    expect(mocks.insert.mock.calls[0][0].clickhouse_settings).toMatchObject({
      type_json_skip_duplicated_paths: 1,
      input_format_allow_errors_num: "100",
    });
  });

  it("keeps the repeated daylight-saving hour distinct", async () => {
    Settings.defaultZone = "Europe/Berlin";
    await pageviewQueue.add(makePayload({ timestamp: "2026-10-25T02:30:00.999+02:00" }));
    await pageviewQueue.add(makePayload({ timestamp: "2026-10-25T02:30:00.999+01:00" }));
    await vi.advanceTimersByTimeAsync(1000);

    const rows = mocks.insert.mock.calls[0][0].values;
    expect(rows.map((row: { timestamp_ms: string }) => row.timestamp_ms)).toEqual([
      "2026-10-25T00:30:00.999Z",
      "2026-10-25T01:30:00.999Z",
    ]);
  });
});
