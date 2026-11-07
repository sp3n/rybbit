import { z } from "zod";

/**
 * sp3n/rybbit fork: geography supplied by a trusted server-side caller.
 *
 * A bridge that forwards events from an edge (for example a Cloudflare Worker
 * reading `request.cf`) knows the player's location more accurately than the
 * GeoLite2 database baked into this image, which is the free tier and as old
 * as the build. A bearer with `ingest:write` may therefore send it. Untrusted
 * callers' `geo` is ignored, as their `ip_address` is.
 *
 * The caller still forwards the player's IP: identity (the anonymous user id
 * hashes IP, user agent and the daily salt) and IP storage (the site's trackIp
 * setting) are unchanged. Only the location columns come from here.
 */
export const geoOverrideSchema = z
  .object({
    /** ISO 3166-1 alpha-2, e.g. "GB". */
    country: z.string().regex(/^[A-Za-z]{2}$/),
    /** ISO 3166-2 subdivision code without the country prefix, e.g. "ENG" (Cloudflare's `regionCode`). */
    region: z.string().regex(/^[A-Za-z0-9]{1,3}$/),
    city: z.string().min(1).max(128),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** IANA time zone, e.g. "Europe/London". */
    timezone: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_+\-/]+$/),
  })
  .partial()
  .strict()
  // Finer fields are only meaningful with the country they belong to; without
  // it they could be stored beside the IP lookup's country.
  .refine(geo => geo.country !== undefined || Object.keys(geo).length === 0, {
    message: "geo needs country whenever it has any other field",
  });

export type GeoOverride = z.infer<typeof geoOverrideSchema>;

/** The location fields the IP lookup provides (db/geolocation/geolocation.ts). */
export type IpLocation =
  | {
      countryIso?: string;
      region?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
      timeZone?: string;
    }
  | null
  | undefined;

export type ResolvedLocation = {
  countryIso: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  timeZone: string;
};

/**
 * The location stored with an event: the trusted override where it has a
 * field, the IP lookup where it does not.
 *
 * The IP's finer fields (region, city, coordinates, time zone) are only used
 * when the IP lookup agrees with the override's country, so a row never mixes
 * two countries. Coordinates fall back as a pair.
 */
export function resolveLocation(override: GeoOverride | undefined, ip: IpLocation): ResolvedLocation {
  const ipCountry = ip?.countryIso?.toUpperCase() || "";
  const overrideCountry = override?.country?.toUpperCase();
  const countryIso = overrideCountry || ipCountry;
  const ipFine = !overrideCountry || overrideCountry === ipCountry ? ip : undefined;

  const hasOverrideCoordinates = override?.latitude !== undefined && override?.longitude !== undefined;

  return {
    countryIso,
    region: override?.region?.toUpperCase() || ipFine?.region || "",
    city: override?.city || ipFine?.city || "",
    latitude: hasOverrideCoordinates ? override!.latitude! : ipFine?.latitude || 0,
    longitude: hasOverrideCoordinates ? override!.longitude! : ipFine?.longitude || 0,
    timeZone: override?.timezone || ipFine?.timeZone || "",
  };
}
