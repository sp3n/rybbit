import { describe, expect, it } from "vitest";
import { buildJourneysQuery } from "./getJourneys.js";

describe("buildJourneysQuery", () => {
  it("excludes aggregate reconstructed events from paths and the percentage denominator", () => {
    const query = buildJourneysQuery(
      {
        start_date: "2025-07-28",
        end_date: "2026-08-23",
        time_zone: "UTC",
        filters: "",
      },
      8,
      {}
    );

    expect(query.match(/!= 'true'/g)).toHaveLength(2);
    expect(query).toContain("legacy_reconstructed");
    expect(query).toContain("toString(props)");
  });
});
