import { ScriptConfig } from "./types.js";
import { parseJsonSafely } from "./utils.js";

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

  const siteId = scriptTag.getAttribute("data-site-id") || scriptTag.getAttribute("site-id");
  if (!siteId) {
    console.error("Please provide a valid site ID using the data-site-id attribute");
    return null;
  }

  const namespace = scriptTag.getAttribute("data-namespace") || "rybbit";

  const parseBooleanAttribute = (name: string, defaultValue: boolean) => {
    const value = scriptTag.getAttribute(name);
    return value === null ? defaultValue : value !== "false";
  };

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

  return {
    namespace,
    analyticsHost,
    siteId,
    debounceDuration,
    sessionReplayBatchSize,
    sessionReplayBatchInterval,
    sessionReplayMaskTextSelectors,
    skipPatterns,
    maskPatterns,
    autoTrackPageview: parseBooleanAttribute("data-track-initial-pageview", true),
    autoTrackSpa: parseBooleanAttribute("data-track-spa-navigation", true),
    trackQuerystring: parseBooleanAttribute("data-track-url-params", true),
    trackOutbound: parseBooleanAttribute("data-track-outbound", true),
    enableWebVitals: parseBooleanAttribute("data-web-vitals", false),
    trackErrors: parseBooleanAttribute("data-track-errors", false),
    enableSessionReplay: parseBooleanAttribute("data-session-replay", false),
    trackButtonClicks: parseBooleanAttribute("data-track-button-clicks", false),
    trackCopy: parseBooleanAttribute("data-track-copy", false),
    trackFormInteractions: parseBooleanAttribute("data-track-form-interactions", false),
    tag,
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
}
