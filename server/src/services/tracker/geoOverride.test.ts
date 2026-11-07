import { describe, expect, it } from "vitest";
import { geoOverrideSchema, resolveLocation } from "./geoOverride.js";

// A London player whose IP GeoLite2 places elsewhere in the UK.
const ipLookup = {
  countryIso: "GB",
  region: "SCT",
  city: "Edinburgh",
  latitude: 55.95,
  longitude: -3.19,
  timeZone: "Europe/London",
};

describe("resolveLocation", () => {
  it("uses the IP lookup when there is no override", () => {
    expect(resolveLocation(undefined, ipLookup)).toEqual({
      countryIso: "GB",
      region: "SCT",
      city: "Edinburgh",
      latitude: 55.95,
      longitude: -3.19,
      timeZone: "Europe/London",
    });
  });

  it("lets a full trusted override win over the IP lookup", () => {
    const override = {
      country: "GB",
      region: "ENG",
      city: "London",
      latitude: 51.51,
      longitude: -0.13,
      timezone: "Europe/London",
    };

    expect(resolveLocation(override, ipLookup)).toEqual({
      countryIso: "GB",
      region: "ENG",
      city: "London",
      latitude: 51.51,
      longitude: -0.13,
      timeZone: "Europe/London",
    });
  });

  it("falls back to the IP lookup field by field when the countries agree", () => {
    expect(resolveLocation({ country: "gb", city: "London" }, ipLookup)).toEqual({
      countryIso: "GB",
      region: "SCT",
      city: "London",
      latitude: 55.95,
      longitude: -3.19,
      timeZone: "Europe/London",
    });
  });

  it("does not mix the IP lookup's region, city or coordinates into a different country", () => {
    expect(resolveLocation({ country: "FR" }, ipLookup)).toEqual({
      countryIso: "FR",
      region: "",
      city: "",
      latitude: 0,
      longitude: 0,
      timeZone: "",
    });
  });

  it("takes coordinates as a pair", () => {
    expect(resolveLocation({ country: "GB", latitude: 51.51 }, ipLookup)).toMatchObject({
      latitude: 55.95,
      longitude: -3.19,
    });
  });

  it("works without an IP lookup result", () => {
    expect(resolveLocation({ country: "JP", region: "13", timezone: "Asia/Tokyo" }, null)).toEqual({
      countryIso: "JP",
      region: "13",
      city: "",
      latitude: 0,
      longitude: 0,
      timeZone: "Asia/Tokyo",
    });
  });
});

describe("geoOverrideSchema", () => {
  it("accepts Cloudflare request.cf values", () => {
    expect(
      geoOverrideSchema.safeParse({
        country: "GB",
        region: "ENG",
        city: "London",
        latitude: 51.5074,
        longitude: -0.1278,
        timezone: "Europe/London",
      }).success
    ).toBe(true);
  });

  it("rejects malformed values and unknown keys", () => {
    expect(geoOverrideSchema.safeParse({ country: "GBR" }).success).toBe(false);
    expect(geoOverrideSchema.safeParse({ region: "GB-ENG" }).success).toBe(false);
    expect(geoOverrideSchema.safeParse({ latitude: 91 }).success).toBe(false);
    expect(geoOverrideSchema.safeParse({ timezone: "Europe/London; DROP" }).success).toBe(false);
    expect(geoOverrideSchema.safeParse({ postalCode: "SW1A" }).success).toBe(false);
  });
});
