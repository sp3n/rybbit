import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTrackingScriptSnippet,
  getTrackingScriptDataAttributes,
  getTrackingScriptUrl,
} from "./trackingScriptSnippet";

describe("trackingScriptSnippet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("embeds a complete request-free tracking configuration", () => {
    const attributes = Object.fromEntries(
      getTrackingScriptDataAttributes({
        id: "site_abc",
        sessionReplay: true,
        webVitals: true,
        trackErrors: true,
        trackOutbound: false,
        trackUrlParams: false,
        trackInitialPageView: false,
        trackSpaNavigation: false,
        trackButtonClicks: true,
        trackCopy: true,
        trackFormInteractions: true,
        featureFlagsEnabled: false,
      })
    );

    expect(attributes).not.toHaveProperty("data-site-id");
    expect(attributes).toMatchObject({
      "data-session-replay": "true",
      "data-web-vitals": "true",
      "data-track-errors": "true",
      "data-track-outbound": "false",
      "data-track-url-params": "false",
      "data-track-initial-pageview": "false",
      "data-track-spa-navigation": "false",
      "data-track-button-clicks": "true",
      "data-track-copy": "true",
      "data-track-form-interactions": "true",
      "data-feature-flags-enabled": "false",
    });
  });

  it("writes the URL-fragment attribute only when fragment tracking is on", () => {
    expect(Object.fromEntries(getTrackingScriptDataAttributes({ siteId: 1 }))).not.toHaveProperty(
      "data-track-url-fragments"
    );
    expect(Object.fromEntries(getTrackingScriptDataAttributes({ siteId: 1, trackUrlFragments: true }))).toMatchObject({
      "data-track-url-fragments": "true",
    });
  });

  it("passes the site ID in the script URL", () => {
    vi.stubGlobal("location", { origin: "https://analytics.example.com" });
    expect(getTrackingScriptUrl({ id: "site abc" })).toBe("https://analytics.example.com/api/script.js?siteId=site%20abc");
    expect(getTrackingScriptUrl({ siteId: 7 })).toBe("https://analytics.example.com/api/script.js?siteId=7");
  });

  it("includes optional runtime settings in every generated snippet", () => {
    vi.stubGlobal("location", { origin: "https://analytics.example.com" });
    const snippet = buildTrackingScriptSnippet(
      { siteId: 42 },
      { debounceValue: 750, skipPatterns: ["/admin/**"], maskPatterns: ["/orders/**"] }
    );

    expect(snippet).toContain('src="https://analytics.example.com/api/script.js?siteId=42"');
    expect(snippet).not.toContain("data-site-id");
    expect(snippet).toContain('data-debounce="750"');
    expect(snippet).toContain("data-skip-patterns='[\"/admin/**\"]'");
    expect(snippet).toContain("data-mask-patterns='[\"/orders/**\"]'");
  });
});
