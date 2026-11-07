import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { toClickHouseDateTime } from "../../db/clickhouse/dateTime.js";
import { lookupAsn } from "../../db/geolocation/asn.js";
import { getLocation } from "../../db/geolocation/geolocation.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { getDeviceType } from "../../utils.js";
import { isDatacenterAsn } from "./botBlocking/datacenterAsns.js";
import { getChannel } from "./getChannel.js";
import { resolveLocation } from "./geoOverride.js";
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
   * sp3n/rybbit fork: queue an event and resolve once the batch holding it has
   * been inserted into ClickHouse; reject if that insert fails.
   *
   * `add` returns as soon as the event is buffered, and a failed insert is only
   * logged, so a queue-backed caller that acknowledged its delivery on our 200
   * would lose the event. Trusted deliveries with an `event_id` wait for this
   * instead (ingestEvent.ts), at the cost of up to one flush interval.
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
      const processedPageviews = batch
        .filter(pv => {
          if (pv.site_id == 9133 && pv.screenWidth == 800 && pv.screenHeight == 600) {
            return false;
          }
          return true;
        })
        .map(pv => {
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

      // this.logger.info({ count: processedPageviews.length }, "Bulk insert to ClickHouse");
      // Bulk insert into database
      await clickhouse.insert({
        table: "events",
        values: processedPageviews,
        format: "JSONEachRow",
        clickhouse_settings: EVENTS_INSERT_SETTINGS,
      });
      this.settle(batch);
    } catch (error) {
      this.logger.error({ err: error }, "Error processing pageview queue");
      this.settle(batch, error);
    } finally {
      this.processing = false;
    }
  }
}

// Create singleton instance
export const pageviewQueue = new PageviewQueue();
