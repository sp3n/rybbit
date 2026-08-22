import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTrackingScriptSnippet, getTrackingScriptDataAttributes } from "./trackingScriptSnippet";

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

    expect(attributes).toMatchObject({
      "data-site-id": "site_abc",
      "data-config-mode": "inline",
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

  it("includes optional runtime settings in every generated snippet", () => {
    vi.stubGlobal("location", { origin: "https://analytics.example.com" });
    const snippet = buildTrackingScriptSnippet(
      { siteId: 42 },
      { debounceValue: 750, skipPatterns: ["/admin/**"], maskPatterns: ["/orders/**"] }
    );

    expect(snippet).toContain('data-config-mode="inline"');
    expect(snippet).toContain('data-debounce="750"');
    expect(snippet).toContain("data-skip-patterns='[\"/admin/**\"]'");
    expect(snippet).toContain("data-mask-patterns='[\"/orders/**\"]'");
  });
});
