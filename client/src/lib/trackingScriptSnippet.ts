export type TrackingScriptSiteConfig = {
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
  featureFlagsEnabled?: boolean;
};

export type TrackingScriptOptions = {
  debounceValue?: number;
  skipPatterns?: string[];
  maskPatterns?: string[];
};

export type TrackingScriptAttribute = [string, string];

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
  ["featureFlagsEnabled", "data-feature-flags-enabled", false],
];

// Use single quotes for attribute values that contain double quotes (JSON arrays).
export function formatTrackingScriptAttribute([key, value]: TrackingScriptAttribute) {
  return value.includes('"') ? `${key}='${value}'` : `${key}="${value}"`;
}

export function getTrackingScriptDataAttributes(
  siteConfig: TrackingScriptSiteConfig,
  { debounceValue = 500, skipPatterns = [], maskPatterns = [] }: TrackingScriptOptions = {}
): TrackingScriptAttribute[] {
  const siteId = siteConfig.id ?? siteConfig.siteId;
  const attributes: TrackingScriptAttribute[] = [
    ["data-site-id", String(siteId)],
    // This fork deliberately embeds the site settings in the snippet so the
    // tracker does not need a separate /site/tracking-config request.
    ["data-config-mode", "inline"],
    ...booleanAttributes.map(
      ([key, attributeName, defaultValue]) =>
        [attributeName, String(siteConfig[key] ?? defaultValue)] as TrackingScriptAttribute
    ),
  ];

  if (debounceValue !== 500) {
    attributes.push(["data-debounce", String(debounceValue)]);
  }
  if (skipPatterns.length > 0) {
    attributes.push(["data-skip-patterns", JSON.stringify(skipPatterns)]);
  }
  if (maskPatterns.length > 0) {
    attributes.push(["data-mask-patterns", JSON.stringify(maskPatterns)]);
  }

  return attributes;
}

export function buildTrackingScriptSnippet(
  siteConfig: TrackingScriptSiteConfig,
  { debounceValue = 500, skipPatterns = [], maskPatterns = [] }: TrackingScriptOptions = {}
) {
  const dataAttributes = getTrackingScriptDataAttributes(siteConfig, {
    debounceValue,
    skipPatterns,
    maskPatterns,
  });

  return `<script
    src="${globalThis.location.origin}/api/script.js"
${dataAttributes.map(attribute => `    ${formatTrackingScriptAttribute(attribute)}`).join("\n")}
    defer
></script>`;
}
