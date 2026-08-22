import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/postgres/postgres.js", () => ({ db: {} }));

import { buildEventPropertyMetricQueries } from "./getEventPropertyMetric.js";

describe("buildEventPropertyMetricQueries", () => {
  it("uses bound parameters for the Memon event and property filters", () => {
    const queries = buildEventPropertyMetricQueries(
      {
        property: "score",
        event_name_like: "L_%/completed",
        property_value: "2500",
        start_date: "2026-08-01",
        end_date: "2026-08-22",
        time_zone: "UTC",
        filters: "",
        limit: 8,
        page: 2,
      },
      42
    );

    expect(queries.dataQuery).toContain("event_name LIKE {eventNameLike:String}");
    expect(queries.dataQuery).toContain("{propertyValue:String}");
    expect(queries.dataQuery).toContain("LIMIT 8 OFFSET 8");
    expect(queries.dataQuery).not.toContain("L_%/completed");
    expect(queries.queryParams).toMatchObject({
      siteId: 42,
      property: "score",
      eventNameLike: "L_%/completed",
      propertyValue: "2500",
    });
  });

  it("clamps pagination to a bounded positive range", () => {
    const queries = buildEventPropertyMetricQueries(
      {
        property: "tower_name",
        start_date: "",
        end_date: "",
        time_zone: "",
        filters: "",
        limit: 50_000,
        page: -10,
      },
      42
    );

    expect(queries.dataQuery).toContain("LIMIT 500 OFFSET 0");
    expect(queries.countQuery).not.toContain("LIMIT 500");
  });
});
