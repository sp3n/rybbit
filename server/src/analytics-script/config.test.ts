import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseScriptConfig } from "./config.js";

// Mock fetch globally to prove config parsing stays self-contained. Feature
// flag evaluation may still use fetch when explicitly enabled.
global.fetch = vi.fn();

describe("parseScriptConfig", () => {
  let mockScriptTag: HTMLScriptElement;
  let consoleSpy: any;

  beforeEach(() => {
    mockScriptTag = document.createElement("script");
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("parses script attributes without requesting tracking config", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-session-replay", "true");
    mockScriptTag.setAttribute("data-web-vitals", "true");
    mockScriptTag.setAttribute("data-track-url-params", "false");
    mockScriptTag.setAttribute("data-track-spa-navigation", "false");

    const config = await parseScriptConfig(mockScriptTag);

    expect(config).toMatchObject({
      namespace: "rybbit",
      analyticsHost: "https://analytics.example.com",
      siteId: "123",
      visitorId: expect.any(String),
      autoTrackPageview: true,
      autoTrackSpa: false,
      trackQuerystring: false,
      trackOutbound: true,
      enableWebVitals: true,
      trackErrors: false,
      enableSessionReplay: true,
      featureFlagsEnabled: false,
      featureFlags: {},
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses explicit settings without requesting tracking config", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-session-replay", "true");
    mockScriptTag.setAttribute("data-web-vitals", "true");
    mockScriptTag.setAttribute("data-track-errors", "true");
    mockScriptTag.setAttribute("data-track-outbound", "false");
    mockScriptTag.setAttribute("data-track-url-params", "false");
    mockScriptTag.setAttribute("data-track-initial-pageview", "false");
    mockScriptTag.setAttribute("data-track-spa-navigation", "false");
    mockScriptTag.setAttribute("data-track-button-clicks", "true");
    mockScriptTag.setAttribute("data-track-copy", "true");
    mockScriptTag.setAttribute("data-track-form-interactions", "true");
    mockScriptTag.setAttribute("data-feature-flags-enabled", "false");

    const config = await parseScriptConfig(mockScriptTag);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(config).toMatchObject({
      enableSessionReplay: true,
      enableWebVitals: true,
      trackErrors: true,
      trackOutbound: false,
      trackQuerystring: false,
      autoTrackPageview: false,
      autoTrackSpa: false,
      trackButtonClicks: true,
      trackCopy: true,
      trackFormInteractions: true,
      featureFlagsEnabled: false,
    });
  });

  it("keeps legacy full-settings snippets request-free", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    for (const attribute of [
      "data-session-replay",
      "data-web-vitals",
      "data-track-errors",
      "data-track-outbound",
      "data-track-url-params",
      "data-track-initial-pageview",
      "data-track-spa-navigation",
      "data-track-button-clicks",
      "data-track-copy",
      "data-track-form-interactions",
    ]) {
      mockScriptTag.setAttribute(attribute, "false");
    }

    const config = await parseScriptConfig(mockScriptTag);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(config?.autoTrackPageview).toBe(false);
    expect(config?.enableSessionReplay).toBe(false);
  });

  it("evaluates feature flags using opted-in checkout fragments", async () => {
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "https://example.com/checkout/#shipping" },
    });
    try {
      mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
      mockScriptTag.setAttribute("data-site-id", "123");
      // sp3n/rybbit fork: the site's settings arrive as data attributes, not a config request.
      mockScriptTag.setAttribute("data-feature-flags-enabled", "true");
      mockScriptTag.setAttribute("data-track-url-fragments", "true");
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ flags: {} }) } as Response);

      await parseScriptConfig(mockScriptTag);

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
      expect(body.pathname).toBe("/checkout/#shipping");
    } finally {
      if (originalLocation) Object.defineProperty(window, "location", originalLocation);
    }
  });

  it("reuses a stored visitor id, but replaces one longer than the server accepts", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    // sp3n/rybbit fork: flags are enabled by data attribute, so only the evaluation is fetched.
    mockScriptTag.setAttribute("data-feature-flags-enabled", "true");
    const mockFlagsEnabled = () =>
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ flags: {} }) } as Response);

    localStorage.setItem("rybbit-visitor-id", "stored-visitor");
    mockFlagsEnabled();
    expect((await parseScriptConfig(mockScriptTag))?.visitorId).toBe("stored-visitor");

    localStorage.setItem("rybbit-visitor-id", "x".repeat(65));
    mockFlagsEnabled();
    const { visitorId } = (await parseScriptConfig(mockScriptTag))!;
    expect(visitorId).not.toBe("x".repeat(65));
    expect(visitorId!.length).toBeLessThanOrEqual(64);
    expect(localStorage.getItem("rybbit-visitor-id")).toBe(visitorId);
  });

  it("stops future evaluation when flags are deleted between configuration and evaluation", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-feature-flags-enabled", "true");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ featureFlagsEnabled: false, flags: {} }),
    });

    const config = await parseScriptConfig(mockScriptTag);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://analytics.example.com/site/123/feature-flags/evaluate",
      expect.objectContaining({ method: "POST" })
    );
    expect(config?.featureFlagsEnabled).toBe(false);
    expect(config?.featureFlags).toEqual({});
  });

  it("uses defaults without making a tracking config request", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

    const config = await parseScriptConfig(mockScriptTag);

    expect(config).toMatchObject({
      autoTrackPageview: true,
      autoTrackSpa: true,
      trackQuerystring: true,
      trackUrlFragments: false,
      trackOutbound: true,
      enableWebVitals: false,
      trackErrors: false,
      enableSessionReplay: false,
      trackButtonClicks: false,
      trackCopy: false,
      trackFormInteractions: false,
      featureFlagsEnabled: false,
      featureFlags: {},
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should handle missing src attribute", async () => {
    const config = await parseScriptConfig(mockScriptTag);
    expect(config).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith("Script src attribute is missing");
  });

  it("should handle invalid analytics host", async () => {
    mockScriptTag.setAttribute("src", "/script.js"); // No host part
    const config = await parseScriptConfig(mockScriptTag);
    expect(config).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith("Please provide a valid analytics host");
  });

  it("should handle missing site ID", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    const config = await parseScriptConfig(mockScriptTag);
    expect(config).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Please provide a valid site ID using the ?siteId= query parameter or the data-site-id attribute"
    );
  });

  it("should parse non-numeric site ID", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "my-site");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessionReplay: false,
        webVitals: false,
        trackErrors: false,
        trackOutbound: true,
        trackUrlParams: true,
        trackInitialPageView: true,
        trackSpaNavigation: true,
      }),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.siteId).toBe("my-site");
  });

  it("should parse custom debounce duration", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-debounce", "1000");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.debounceDuration).toBe(1000);
  });

  it("should handle negative debounce duration", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-debounce", "-100");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.debounceDuration).toBe(0);
  });

  it("should parse tracking settings from data attributes", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-skip-patterns", '["/admin/**"]');
    mockScriptTag.setAttribute("data-mask-patterns", '["/user/**"]');
    mockScriptTag.setAttribute("data-session-replay", "true");
    mockScriptTag.setAttribute("data-web-vitals", "true");
    mockScriptTag.setAttribute("data-track-errors", "true");
    mockScriptTag.setAttribute("data-track-outbound", "false");
    mockScriptTag.setAttribute("data-track-url-params", "false");
    mockScriptTag.setAttribute("data-track-initial-pageview", "false");
    mockScriptTag.setAttribute("data-track-spa-navigation", "false");

    const config = await parseScriptConfig(mockScriptTag);

    expect(config?.skipPatterns).toEqual(["/admin/**"]);
    expect(config?.maskPatterns).toEqual(["/user/**"]);
    expect(config?.enableSessionReplay).toBe(true);
    expect(config?.enableWebVitals).toBe(true);
    expect(config?.trackErrors).toBe(true);
    expect(config?.trackOutbound).toBe(false);
    expect(config?.trackQuerystring).toBe(false);
    expect(config?.autoTrackPageview).toBe(false);
    expect(config?.autoTrackSpa).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should parse skip patterns", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-skip-patterns", '["/admin/**", "/api/**"]');

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.skipPatterns).toEqual(["/admin/**", "/api/**"]);
  });

  it("should parse mask patterns", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-mask-patterns", '["/user/*/profile", "/post/*"]');

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.maskPatterns).toEqual(["/user/*/profile", "/post/*"]);
  });

  it("should handle invalid JSON in patterns gracefully", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-skip-patterns", "invalid-json");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.skipPatterns).toEqual([]);
  });

  it("should read the site ID from the script URL", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js?siteId=789");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.siteId).toBe("789");
    expect(config?.analyticsHost).toBe("https://analytics.example.com");
  });

  it("should prefer the URL site ID over the data attribute", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js?siteId=from-url");
    mockScriptTag.setAttribute("data-site-id", "from-attr");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.siteId).toBe("from-url");
  });

  it("should read the site ID from a relative proxied script URL", async () => {
    mockScriptTag.setAttribute("src", "/analytics/script.js?siteId=proxied");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.siteId).toBe("proxied");
    expect(config?.analyticsHost).toBe("/analytics");
  });

  it("should support legacy site-id attribute", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("site-id", "456");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.siteId).toBe("456");
  });

  it("should parse session replay batch settings", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-batch-size", "500");
    mockScriptTag.setAttribute("data-replay-batch-interval", "10000");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayBatchSize).toBe(500);
    expect(config?.sessionReplayBatchInterval).toBe(10000);
  });

  it("should parse session replay mask text selectors", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute(
      "data-replay-mask-text-selectors",
      '[".user-name", ".email-address", "[data-sensitive]"]'
    );

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayMaskTextSelectors).toEqual([".user-name", ".email-address", "[data-sensitive]"]);
  });

  it("should parse rrweb block and ignore options", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-block-class", "my-block-class");
    mockScriptTag.setAttribute("data-replay-block-selector", ".sensitive-content");
    mockScriptTag.setAttribute("data-replay-ignore-class", "my-ignore-class");
    mockScriptTag.setAttribute("data-replay-ignore-selector", "input[type='password']");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayBlockClass).toBe("my-block-class");
    expect(config?.sessionReplayBlockSelector).toBe(".sensitive-content");
    expect(config?.sessionReplayIgnoreClass).toBe("my-ignore-class");
    expect(config?.sessionReplayIgnoreSelector).toBe("input[type='password']");
  });

  it("should parse rrweb mask text class option", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-mask-text-class", "custom-mask-class");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayMaskTextClass).toBe("custom-mask-class");
  });

  it("should parse rrweb maskAllInputs option", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-mask-all-inputs", "true");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayMaskAllInputs).toBe(true);
  });

  it("should parse rrweb maskAllInputs as false", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-mask-all-inputs", "false");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayMaskAllInputs).toBe(false);
  });

  it("should parse rrweb maskInputOptions", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-mask-input-options", '{"password":true,"email":true,"tel":true}');

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayMaskInputOptions).toEqual({ password: true, email: true, tel: true });
  });

  it("should parse rrweb collectFonts option", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-collect-fonts", "false");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplayCollectFonts).toBe(false);
  });

  it("should parse rrweb sampling options", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-sampling", '{"mousemove":100,"scroll":200}');

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplaySampling).toEqual({ mousemove: 100, scroll: 200 });
  });

  it("should parse rrweb slimDOMOptions as object", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-slim-dom-options", '{"script":true,"comment":true}');

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplaySlimDOMOptions).toEqual({ script: true, comment: true });
  });

  it("should parse rrweb slimDOMOptions as boolean", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-slim-dom-options", "true");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    expect(config?.sessionReplaySlimDOMOptions).toBe(true);
  });

  it("should handle invalid JSON in rrweb options gracefully", async () => {
    mockScriptTag.setAttribute("src", "https://analytics.example.com/script.js");
    mockScriptTag.setAttribute("data-site-id", "123");
    mockScriptTag.setAttribute("data-replay-sampling", "invalid-json");

    // Mock successful API response
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const config = await parseScriptConfig(mockScriptTag);
    // Should fallback to empty object for invalid JSON
    expect(config?.sessionReplaySampling).toEqual({});
  });
});
