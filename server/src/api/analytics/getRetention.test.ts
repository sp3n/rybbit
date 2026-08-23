import { describe, expect, it } from "vitest";
import { buildRetentionQuery } from "./getRetention.js";

describe("buildRetentionQuery", () => {
  it("excludes aggregate reconstructed events from cohorts and activity", () => {
    const query = buildRetentionQuery("week");

    expect(query.match(/!= 'true'/g)).toHaveLength(2);
    expect(query).toContain("legacy_reconstructed");
    expect(query).toContain("toString(props)");
  });
});
