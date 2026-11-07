export type TrackingScriptSiteConfig = {
  id?: string | null;
  siteId?: string | number | null;
  sessionReplay?: boolean;
  webVitals?: boolean;
  trackErrors?: boolean;
  trackOutbound?: boolean;
  trackUrlParams?: boolean;
  trackUrlFragments?: boolean;
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

// The site ID travels in the script URL rather than a data attribute so that
// script optimizers which rebuild the tag (WP Rocket, Perfmatters, ...) can't
// strip it. Remaining options stay as data attributes.
export function getTrackingScriptUrl(siteConfig: TrackingScriptSiteConfig) {
  const siteId = siteConfig.id ?? siteConfig.siteId;
  return `${globalThis.location.origin}/api/script.js?siteId=${encodeURIComponent(String(siteId))}`;
}

export function getTrackingScriptDataAttributes(
  siteConfig: TrackingScriptSiteConfig,
  { debounceValue = 500, skipPatterns = [], maskPatterns = [] }: TrackingScriptOptions = {}
): TrackingScriptAttribute[] {
  const attributes: TrackingScriptAttribute[] = [
    ...booleanAttributes.map(
      ([key, attributeName, defaultValue]) =>
        [attributeName, String(siteConfig[key] ?? defaultValue)] as TrackingScriptAttribute
    ),
  ];

  // Off by default, so the attribute is only written when it changes something.
  if (siteConfig.trackUrlFragments) {
    attributes.push(["data-track-url-fragments", "true"]);
  }
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
    src="${getTrackingScriptUrl(siteConfig)}"
${dataAttributes.map(attribute => `    ${formatTrackingScriptAttribute(attribute)}`).join("\n")}
    defer
></script>`;
}
