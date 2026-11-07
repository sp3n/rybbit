import { ScriptConfig } from "./types.js";
import { parseJsonSafely } from "./utils.js";
import { getTrackedPathname } from "./url.js";

const FEATURE_FLAG_REQUEST_TIMEOUT_MS = 2000;

type FeatureFlagFetchResult = {
  enabled: boolean;
  flags: ScriptConfig["featureFlags"];
};

function getBooleanAttribute(scriptTag: HTMLScriptElement, name: string, defaultValue: boolean): boolean {
  const value = scriptTag.getAttribute(name);
  return value === null ? defaultValue : value !== "false";
}

function createVisitorId(): string {
  try {
    if (crypto?.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (e) {
    // crypto may be unavailable in older browsers
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Matches the server's visitor_id limit: a longer stored id would get every event rejected.
const MAX_VISITOR_ID_LENGTH = 64;

function getOrCreateVisitorId(namespace: string): string {
  const key = `${namespace}-visitor-id`;

  try {
    const stored = localStorage.getItem(key);
    if (stored && stored.length <= MAX_VISITOR_ID_LENGTH) return stored;

    const visitorId = createVisitorId();
    localStorage.setItem(key, visitorId);
    return visitorId;
  } catch (e) {
    return createVisitorId();
  }
}

function getIdentifiedUserId(namespace: string): string | undefined {
  try {
    return localStorage.getItem(`${namespace}-user-id`) || undefined;
  } catch (e) {
    return undefined;
  }
}

async function fetchFeatureFlags(
  analyticsHost: string,
  siteId: string,
  namespace: string,
  visitorId: string,
  trackUrlFragments: boolean
): Promise<FeatureFlagFetchResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FEATURE_FLAG_REQUEST_TIMEOUT_MS);

  try {
    const url = new URL(window.location.href);
    const response = await fetch(`${analyticsHost}/site/${siteId}/feature-flags/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "omit",
      signal: controller.signal,
      body: JSON.stringify({
        anonymousId: visitorId,
        identifiedUserId: getIdentifiedUserId(namespace),
        hostname: url.hostname,
        pathname: getTrackedPathname(url, trackUrlFragments),
        querystring: url.search,
        query: Object.fromEntries(url.searchParams.entries()),
        referrer: document.referrer,
        language: navigator.language,
        screenWidth: screen.width,
        screenHeight: screen.height,
      }),
    });

    if (!response.ok) {
      return { enabled: true, flags: {} };
    }

    const data = await response.json();
    return {
      enabled: data?.featureFlagsEnabled !== false,
      flags: data?.flags && typeof data.flags === "object" ? data.flags : {},
    };
  } catch (e) {
    return { enabled: true, flags: {} };
  } finally {
    window.clearTimeout(timeout);
  }
}

function getSiteIdFromSrc(src: string): string | null {
  try {
    const url = new URL(src, window.location.href);
    return url.searchParams.get("siteId") || url.searchParams.get("site-id") || url.searchParams.get("site_id");
  } catch (e) {
    return null;
  }
}

/**
 * Parse minimal script configuration from the script tag attributes
 * Configuration is intentionally self-contained so the tracking script does
 * not need an extra request before it can start tracking.
 */
export async function parseScriptConfig(scriptTag: HTMLScriptElement): Promise<ScriptConfig | null> {
  const src = scriptTag.getAttribute("src");
  if (!src) {
    console.error("Script src attribute is missing");
    return null;
  }

  const analyticsHost = src.split("/script.js")[0];
  if (!analyticsHost) {
    console.error("Please provide a valid analytics host");
    return null;
  }

  // Prefer the site ID from the script URL (`/script.js?siteId=...`). Script
  // optimizers such as WP Rocket, Perfmatters, and FlyingPress recreate the
  // tag from `data-src` and drop every other `data-*` attribute, but they keep
  // the URL intact. The attributes remain supported for existing installs.
  const siteId = getSiteIdFromSrc(src) || scriptTag.getAttribute("data-site-id") || scriptTag.getAttribute("site-id");
  if (!siteId) {
    console.error("Please provide a valid site ID using the ?siteId= query parameter or the data-site-id attribute");
    return null;
  }

  const namespace = scriptTag.getAttribute("data-namespace") || "rybbit";
  // In-memory until the site is known to use feature flags, so plain analytics
  // installs never touch localStorage (which would require consent in the EU).
  const visitorId = createVisitorId();

  // These can be overridden via data attributes for testing/debugging
  const skipPatterns = parseJsonSafely<string[]>(scriptTag.getAttribute("data-skip-patterns"), []);
  const maskPatterns = parseJsonSafely<string[]>(scriptTag.getAttribute("data-mask-patterns"), []);
  const sessionReplayMaskTextSelectors = parseJsonSafely<string[]>(
    scriptTag.getAttribute("data-replay-mask-text-selectors"),
    []
  );

  const debounceDuration = scriptTag.getAttribute("data-debounce")
    ? Math.max(0, parseInt(scriptTag.getAttribute("data-debounce")!))
    : 500;

  const sessionReplayBatchSize = scriptTag.getAttribute("data-replay-batch-size")
    ? Math.max(1, parseInt(scriptTag.getAttribute("data-replay-batch-size")!))
    : 250;

  const sessionReplayBatchInterval = scriptTag.getAttribute("data-replay-batch-interval")
    ? Math.max(1000, parseInt(scriptTag.getAttribute("data-replay-batch-interval")!))
    : 5000;

  // Parse rrweb session replay options
  const sessionReplayBlockClass = scriptTag.getAttribute("data-replay-block-class") || undefined;
  const sessionReplayBlockSelector = scriptTag.getAttribute("data-replay-block-selector") || undefined;
  const sessionReplayIgnoreClass = scriptTag.getAttribute("data-replay-ignore-class") || undefined;
  const sessionReplayIgnoreSelector = scriptTag.getAttribute("data-replay-ignore-selector") || undefined;
  const sessionReplayMaskTextClass = scriptTag.getAttribute("data-replay-mask-text-class") || undefined;

  const maskAllInputsAttr = scriptTag.getAttribute("data-replay-mask-all-inputs");
  const sessionReplayMaskAllInputs = maskAllInputsAttr !== null ? maskAllInputsAttr !== "false" : undefined;

  const maskInputOptionsAttr = scriptTag.getAttribute("data-replay-mask-input-options");
  const sessionReplayMaskInputOptions = maskInputOptionsAttr
    ? parseJsonSafely<Record<string, boolean>>(maskInputOptionsAttr, { password: true, email: true })
    : undefined;

  const collectFontsAttr = scriptTag.getAttribute("data-replay-collect-fonts");
  const sessionReplayCollectFonts = collectFontsAttr !== null ? collectFontsAttr !== "false" : undefined;

  const samplingAttr = scriptTag.getAttribute("data-replay-sampling");
  const sessionReplaySampling = samplingAttr ? parseJsonSafely<Record<string, any>>(samplingAttr, {}) : undefined;

  const slimDOMAttr = scriptTag.getAttribute("data-replay-slim-dom-options");
  const sessionReplaySlimDOMOptions = slimDOMAttr
    ? parseJsonSafely<Record<string, boolean> | boolean>(slimDOMAttr, {})
    : undefined;

  const sampleRateAttr = scriptTag.getAttribute("data-replay-sample-rate");
  const sessionReplaySampleRate = sampleRateAttr ? Math.min(100, Math.max(0, parseInt(sampleRateAttr, 10))) : undefined;

  const tag = scriptTag.getAttribute("data-tag") || "";

  const resolvedConfig: ScriptConfig = {
    namespace,
    analyticsHost,
    siteId,
    visitorId,
    debounceDuration,
    sessionReplayBatchSize,
    sessionReplayBatchInterval,
    sessionReplayMaskTextSelectors,
    skipPatterns,
    maskPatterns,
    autoTrackPageview: getBooleanAttribute(scriptTag, "data-track-initial-pageview", true),
    autoTrackSpa: getBooleanAttribute(scriptTag, "data-track-spa-navigation", true),
    trackQuerystring: getBooleanAttribute(scriptTag, "data-track-url-params", true),
    trackUrlFragments: getBooleanAttribute(scriptTag, "data-track-url-fragments", false),
    trackOutbound: getBooleanAttribute(scriptTag, "data-track-outbound", true),
    enableWebVitals: getBooleanAttribute(scriptTag, "data-web-vitals", false),
    trackErrors: getBooleanAttribute(scriptTag, "data-track-errors", false),
    enableSessionReplay: getBooleanAttribute(scriptTag, "data-session-replay", false),
    trackButtonClicks: getBooleanAttribute(scriptTag, "data-track-button-clicks", false),
    trackCopy: getBooleanAttribute(scriptTag, "data-track-copy", false),
    trackFormInteractions: getBooleanAttribute(scriptTag, "data-track-form-interactions", false),
    tag,
    featureFlagsEnabled: getBooleanAttribute(scriptTag, "data-feature-flags-enabled", false),
    featureFlags: {},
    // rrweb session replay options (undefined means use rrweb defaults)
    sessionReplayBlockClass,
    sessionReplayBlockSelector,
    sessionReplayIgnoreClass,
    sessionReplayIgnoreSelector,
    sessionReplayMaskTextClass,
    sessionReplayMaskAllInputs,
    sessionReplayMaskInputOptions,
    sessionReplayCollectFonts,
    sessionReplaySampling,
    sessionReplaySlimDOMOptions,
    sessionReplaySampleRate,
  };

  if (resolvedConfig.featureFlagsEnabled) {
    // Percentage rollouts bucket on this ID, so persist it across page loads.
    resolvedConfig.visitorId = getOrCreateVisitorId(namespace);
    const result = await fetchFeatureFlags(
      analyticsHost,
      siteId,
      namespace,
      resolvedConfig.visitorId,
      resolvedConfig.trackUrlFragments
    );
    resolvedConfig.featureFlagsEnabled = result.enabled;
    resolvedConfig.featureFlags = result.flags;
  }
  return resolvedConfig;
}
