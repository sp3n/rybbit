import { describe, expect, it } from "vitest";
import { SessionEvent } from "@/api/analytics/endpoints";
import {
  canonicalizeGameEvents,
  formatGameEventName,
  getGameEventCategory,
  getGameEventProperties,
} from "./gameEvents";

function event(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    timestamp: "2026-08-22 12:00:00",
    pathname: "",
    hostname: "",
    querystring: "",
    page_title: "",
    referrer: "",
    type: "custom_event",
    ...overrides,
  };
}

describe("game session events", () => {
  it("classifies and formats progression, gameplay, menu, and system actions", () => {
    expect(getGameEventCategory(event({ event_name: "L_CrimsonDunes/completed" }))).toBe("progression");
    expect(getGameEventCategory(event({ event_name: "L_CrimsonDunes/built" }))).toBe("gameplay");
    expect(getGameEventCategory(event({ event_name: "menu/full" }))).toBe("menus");
    expect(getGameEventCategory(event({ event_name: "system/deactivate" }))).toBe("system");
    expect(formatGameEventName(event({ event_name: "L_CrimsonDunes/completed/quitmenu" }))).toBe(
      "Crimson Dunes · Completed · Quit to menu"
    );
  });

  it("folds pageview/custom-event pairs without losing repeated same-type actions", () => {
    const pageview = event({ type: "pageview", pathname: "L_Tutorial/built" });
    const custom = event({ type: "custom_event", event_name: "L_Tutorial/built", pathname: "L_Tutorial/built" });
    expect(canonicalizeGameEvents([pageview, custom])).toEqual([custom]);
    expect(canonicalizeGameEvents([custom, { ...custom }])).toHaveLength(2);
  });

  it("presents useful action properties and hides repeated transport context", () => {
    const properties = getGameEventProperties(
      event({
        event_name: "L_Tutorial/completed",
        props: {
          platform_code: "SteamDeck",
          telemetry_schema: 2,
          time_spent: "279",
          tower_name: "BP_Tower_Electric_C_2147473286",
          creeps_killed: "10",
        },
      })
    );
    expect(properties).toEqual([
      { key: "time_spent", label: "Duration", value: expect.stringMatching(/^4 mins?, 39 secs?$/) },
      { key: "creeps_killed", label: "Creeps killed", value: "10" },
      { key: "tower_name", label: "Tower", value: "Electric" },
    ]);
  });
});
