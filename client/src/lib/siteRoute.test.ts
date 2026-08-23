import { describe, expect, it } from "vitest";
import { getSiteRouteContext, isSyncedAnalyticsRoute } from "./siteRoute";

describe("site analytics routes", () => {
  it.each(["levels", "releases"])("hydrates dashboard state from the URL on the %s route", route => {
    expect(isSyncedAnalyticsRoute(route)).toBe(true);
  });

  it("recognizes game routes behind a private-link key", () => {
    expect(getSiteRouteContext("/8/a1b2c3d4e5f6/levels")).toEqual({
      siteId: "8",
      privateKey: "a1b2c3d4e5f6",
      route: "levels",
    });
  });
});
