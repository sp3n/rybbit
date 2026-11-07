import { ClickHouseError } from "@clickhouse/client";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { toClickHouseDateTime } from "../../db/clickhouse/dateTime.js";
import { lookupAsn } from "../../db/geolocation/asn.js";
import { getLocation } from "../../db/geolocation/geolocation.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { getDeviceType } from "../../utils.js";
import { isDatacenterAsn } from "./botBlocking/datacenterAsns.js";
import { getChannel } from "./getChannel.js";
import { resolveLocation } from "./geoOverride.js";
import { PermanentIngestError, RetryableIngestError } from "./ingestErrors.js";
import {
  clearSelfReferrer,
  EVENTS_INSERT_SETTINGS,
  getAllUrlParams,
  parseEventProperties,
  TotalTrackingPayload,
} from "./utils.js";

type TotalPayload = TotalTrackingPayload & {
  sessionId: string;
};

// sp3n/rybbit fork: durable rows are inserted without upstream's tolerance
// for skipped rows, so a row ClickHouse refuses is never reported as stored.
const { input_format_allow_errors_num: _allowErrors, ...STRICT_INSERT_SETTINGS } = EVENTS_INSERT_SETTINGS;

const PAGEVIEW_BATCH_SIZE = 5000;
const PAGEVIEW_FLUSH_INTERVAL_MS = 1000;

class PageviewQueue {
  private queue: TotalPayload[] = [];
  private batchSize = PAGEVIEW_BATCH_SIZE;
  private interval = PAGEVIEW_FLUSH_INTERVAL_MS;
  private processing = false;
  private logger = createServiceLogger("pageview-queue");
  // sp3n/rybbit fork: callers waiting for their event to reach ClickHouse (addDurable).
  private waiters = new WeakMap<TotalPayload, { resolve: () => void; reject: (error: unknown) => void }>();

  constructor() {
    // Start processing interval
    setInterval(() => this.processQueue(), this.interval);
  }

  async add(pageview: TotalPayload) {
    this.queue.push(pageview);
  }

  /**
   * sp3n/rybbit fork: queue an event and resolve once its own row is in
   * ClickHouse (or was deliberately dropped by the queue's filter); reject if
   * it was not stored.
   *
   * `add` returns as soon as the event is buffered, a failed insert is only
   * logged, and ClickHouse may skip up to 100 bad rows of a batch, so a
   * queue-backed caller that acknowledged its delivery on our 200 could lose
   * the event. Trusted deliveries with an `event_id` wait for this instead
   * (ingestEvent.ts bounds the wait). A row ClickHouse refuses as data rejects
   * with PermanentIngestError; any other failure with RetryableIngestError.
   */
  addDurable(pageview: TotalPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiters.set(pageview, { resolve, reject });
      this.queue.push(pageview);
    });
  }

  private settle(batch: TotalPayload[], error?: unknown) {
    for (const pageview of batch) {
      const waiter = this.waiters.get(pageview);
      if (!waiter) continue;
      this.waiters.delete(pageview);
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  }

  private insertRows(values: unknown[], settings: typeof STRICT_INSERT_SETTINGS | typeof EVENTS_INSERT_SETTINGS) {
    return clickhouse.insert({ table: "events", values, format: "JSONEachRow", clickhouse_settings: settings });
  }

  /**
   * sp3n/rybbit fork: store the rows deliveries are waiting on, each settled by
   * its own outcome. One strict insert for all of them; if ClickHouse refuses
   * the data, each row alone, so one bad row neither fails the others nor
   * passes as stored.
   */
  private async insertDurable(entries: { pageview: TotalPayload; row: unknown }[]) {
    if (entries.length === 0) return;
    try {
      await this.insertRows(
        entries.map(entry => entry.row),
        STRICT_INSERT_SETTINGS
      );
      this.settle(entries.map(entry => entry.pageview));
      return;
    } catch (error) {
      if (!(error instanceof ClickHouseError)) {
        this.logger.error({ err: error }, "Error storing trusted events");
        this.settle(
          entries.map(entry => entry.pageview),
          new RetryableIngestError("the event could not be stored")
        );
        return;
      }
    }

    for (const entry of entries) {
      try {
        await this.insertRows([entry.row], STRICT_INSERT_SETTINGS);
        this.settle([entry.pageview]);
      } catch (error) {
        this.logger.error({ err: error, siteId: entry.pageview.site_id }, "ClickHouse refused a trusted event");
        this.settle(
          [entry.pageview],
          error instanceof ClickHouseError
            ? new PermanentIngestError(`ClickHouse refused the event (${error.code})`)
            : new RetryableIngestError("the event could not be stored")
        );
      }
    }
  }

  /**
   * Flushes everything still buffered. Only for shutdown: process exit would
   * otherwise drop up to a flush interval of events on every deploy.
   */
  async drain(): Promise<void> {
    while (this.processing || this.queue.length > 0) {
      if (this.processing) {
        await new Promise(resolve => setTimeout(resolve, 50));
      } else {
        await this.processQueue();
      }
    }
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    // Get batch of pageviews
    const batch = this.queue.splice(0, this.batchSize);
    try {
      const ips = [...new Set(batch.map(pv => pv.ipAddress))];

      const geoData = await getLocation(ips);

      // Process each pageview with its geo data
      const kept = batch.filter(pv => {
        if (pv.site_id == 9133 && pv.screenWidth == 800 && pv.screenHeight == 600) {
          return false;
        }
        return true;
      });
      // sp3n/rybbit fork: a delivery whose row the filter dropped was handled
      // deliberately, like an excluded event; it is not waiting on an insert.
      this.settle(batch.filter(pv => !kept.includes(pv)));
      const processedPageviews = kept.map(pv => {
        // sp3n/rybbit fork: a trusted caller's geography wins over the IP
        // lookup, field by field (geoOverride.ts).
        const location = resolveLocation(pv.geoOverride, geoData?.[pv.ipAddress]);

        const countryCode = location.countryIso;
        const regionCode = location.region;
        const latitude = location.latitude;
        const longitude = location.longitude;
        const city = location.city;
        const timezone = location.timeZone;

        // Same MaxMind lookup already used to decide identity bucketing
        // (bucketIpForIdentity) and bot-detection eligibility; stored here purely
        // for debugging identity-splitting reports, treated like geo data
        // (independent of storeIp) since it identifies a network, not a device.
        const asnInfo = lookupAsn(pv.ipAddress);

        // Check if referrer is from the same domain and clear it if so
        let referrer = clearSelfReferrer(pv.referrer || "", pv.hostname || "");

        // Get all URL parameters for the url_parameters map
        const allUrlParams = getAllUrlParams(pv.querystring || "");
        const receivedAt = toClickHouseDateTime(pv.timestamp);

        return {
          site_id: pv.site_id,
          // Keep the original DateTime column for the MergeTree key and
          // whole-second time filters; timestamp_ms preserves arrival order
          // for funnels and entry/exit attribution.
          // Both get the same explicit-UTC instant; the DateTime column
          // truncates to the second on its own.
          timestamp: receivedAt,
          timestamp_ms: receivedAt,
          session_id: pv.sessionId,
          user_id: pv.userId, // Always the device fingerprint
          identified_user_id: pv.identifiedUserId || "", // Custom user ID when identified
          hostname: pv.hostname || "",
          pathname: pv.pathname || "",
          querystring: pv.querystring || "",
          page_title: pv.page_title || "",
          referrer: referrer,
          channel: getChannel(referrer, pv.querystring, pv.hostname),
          browser: pv.ua.browser.name || "",
          browser_version: pv.ua.browser.major || "",
          operating_system: pv.ua.os.name || "",
          operating_system_version: pv.ua.os.version || "",
          language: pv.language || "",
          screen_width: pv.screenWidth || 0,
          screen_height: pv.screenHeight || 0,
          device_type: getDeviceType(pv.screenWidth, pv.screenHeight, pv.ua),
          country: countryCode,
          region: countryCode && regionCode ? countryCode + "-" + regionCode : "",
          city: city || "",
          lat: latitude || 0,
          lon: longitude || 0,
          type: pv.type || "pageview",
          event_name: pv.event_name || "",
          props: parseEventProperties(pv.properties),
          url_parameters: allUrlParams,
          // Performance metrics (only included for performance events).
          // ?? not ||: 0 is a legitimate measurement (a perfect CLS score is 0)
          // and must not be coerced to NULL, which would skew percentiles.
          lcp: pv.lcp ?? null,
          cls: pv.cls ?? null,
          inp: pv.inp ?? null,
          fcp: pv.fcp ?? null,
          ttfb: pv.ttfb ?? null,
          ip: pv.storeIp ? pv.ipAddress : null,
          timezone: timezone,
          tag: pv.tag || "",
          feature_flags: pv.feature_flags || {},
          visitor_id: pv.visitor_id || "",
          import_id: null,
          asn: asnInfo?.asn ?? null,
          asn_org: asnInfo?.organization || "",
          is_datacenter_asn: asnInfo && isDatacenterAsn(asnInfo.asn) ? 1 : 0,
        };
      });

      // sp3n/rybbit fork: rows a delivery waits on are stored strictly and
      // settled one by one; the rest go in upstream's tolerant bulk insert.
      const ordinary: unknown[] = [];
      const durable: { pageview: TotalPayload; row: unknown }[] = [];
      kept.forEach((pageview, index) => {
        const row = processedPageviews[index];
        if (this.waiters.has(pageview)) durable.push({ pageview, row });
        else ordinary.push(row);
      });

      // this.logger.info({ count: processedPageviews.length }, "Bulk insert to ClickHouse");
      // Bulk insert into database
      await Promise.all([
        ordinary.length > 0
          ? this.insertRows(ordinary, EVENTS_INSERT_SETTINGS).catch(error =>
              this.logger.error({ err: error }, "Error processing pageview queue")
            )
          : undefined,
        this.insertDurable(durable),
      ]);
    } catch (error) {
      this.logger.error({ err: error }, "Error processing pageview queue");
      this.settle(batch, new RetryableIngestError("the event could not be stored"));
    } finally {
      this.processing = false;
    }
  }
}

// Create singleton instance
export const pageviewQueue = new PageviewQueue();
