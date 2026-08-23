const eventPropertyString = (property: string) => `
  coalesce(
    nullIf(JSONExtractString(toString(props), '${property}'), ''),
    nullIf(replaceRegexpAll(JSONExtractRaw(toString(props), '${property}'), '^"|"$', ''), '')
  )`;

/** Aggregate Plausible history cannot provide factual users, sessions, or sequences. */
export const excludeLegacyReconstructedEvents = `
  AND lower(coalesce(${eventPropertyString("legacy_reconstructed")}, 'false')) != 'true'
`;
