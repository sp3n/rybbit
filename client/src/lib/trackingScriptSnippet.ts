type TrackingScriptSiteConfig = {
  id?: string | null;
  siteId?: string | number | null;
  sessionReplay?: boolean;
  webVitals?: boolean;
  trackErrors?: boolean;
  trackOutbound?: boolean;
  trackUrlParams?: boolean;
  trackInitialPageView?: boolean;
  trackSpaNavigation?: boolean;
  trackButtonClicks?: boolean;
  trackCopy?: boolean;
  trackFormInteractions?: boolean;
};

type TrackingScriptOptions = {
  debounceValue?: number;
  skipPatterns?: string[];
  maskPatterns?: string[];
};

const booleanAttributes: Array<[keyof TrackingScriptSiteConfig, string, boolean]> = [
  ["sessionReplay", "data-session-replay", false],
  ["webVitals", "data-web-vitals", false],
  ["trackErrors", "data-track-errors", false],
  ["trackOutbound", "data-track-outbound", true],
  ["trackUrlParams", "data-track-url-params", true],
  ["trackInitialPageView", "data-track-initial-pageview", true],
  ["trackSpaNavigation", "data-track-spa-navigation", true],
  ["trackButtonClicks", "data-track-button-clicks", false],
  ["trackCopy", "data-track-copy", false],
  ["trackFormInteractions", "data-track-form-interactions", false],
];

function booleanAttributeLines(siteConfig: TrackingScriptSiteConfig) {
  return booleanAttributes
    .map(([key, attributeName, defaultValue]) => {
      const value = siteConfig[key] ?? defaultValue;
      return `    ${attributeName}="${value}"`;
    })
    .join("\n");
}

export function buildTrackingScriptSnippet(
  siteConfig: TrackingScriptSiteConfig,
  { debounceValue = 500, skipPatterns = [], maskPatterns = [] }: TrackingScriptOptions = {}
) {
  const siteId = siteConfig.id ?? siteConfig.siteId;

  return `<script
    src="${globalThis.location.origin}/api/script.js"
    data-site-id="${siteId}"
${booleanAttributeLines(siteConfig)}${
    debounceValue !== 500
      ? `
    data-debounce="${debounceValue}"`
      : ""
  }${
    skipPatterns.length > 0
      ? `
    data-skip-patterns='${JSON.stringify(skipPatterns)}'`
      : ""
  }${
    maskPatterns.length > 0
      ? `
    data-mask-patterns='${JSON.stringify(maskPatterns)}'`
      : ""
  }
    defer
></script>`;
}
