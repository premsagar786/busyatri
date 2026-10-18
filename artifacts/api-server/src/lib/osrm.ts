/**
 * Road routing + stop geocoding for the student map layer.
 *
 * Road data comes from OSRM (Open Source Routing Machine). The URL is
 * configurable via `OSRM_URL` so the API can point at a self-hosted/local
 * instance (e.g. `OSRM_URL=http://localhost:5000`); it defaults to OSRM's
 * public router. When OSRM is unreachable the route layer degrades to a
 * straight-line estimate instead of failing the endpoint.
 *
 * Stop coordinates come from OpenStreetMap geocoding (Nominatim), cached in
 * the `route_stops_cache` table by the caller so each stop name is resolved
 * at most once.
 */

export type GeoPoint = { latitude: number; longitude: number };

const OSRM_BASE = process.env.OSRM_URL?.replace(/\/+$/, "") || "https://router.project-osrm.org";
const CAMPUS_REGION = process.env.CAMPUS_REGION || "Punjab, India";
const CAMPUS_COUNTRY = process.env.CAMPUS_COUNTRY || "in";
const USER_AGENT = "BusYatri-Campus-Tracker/1.0 (campus bus route + ETA)";
const REQUEST_TIMEOUT_MS = 9_000;

/** Politeness queue for Nominatim: gratis service, max ~1 request per second. */
let lastNominatimAt = 0;
async function throttledFetch(url: string, signal: AbortSignal): Promise<Response> {
  const wait = Math.max(0, lastNominatimAt + 1_100 - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal });
}

/** Stops that failed geocoding are skipped for 10 minutes (no cache entry, no flag). */
const geocodeBackoff = new Map<string, number>();
const GEOCODE_BACKOFF_MS = 10 * 60_000;

/** Nominatim result types worth trusting as a bus stop location. */
const PLACE_TYPES = new Set([
  "town", "city", "village", "hamlet", "suburb", "neighbourhood",
  "bus_stop", "bus_station", "station", "stop", "halt",
  "road", "junction", "gate", "peak", "locality",
]);

export type GeocodeBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

/** Expand known route points into a generous search rectangle for geocoding. */
export function corridorBounds(points: GeoPoint[]): GeocodeBounds | null {
  if (points.length === 0) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const point of points) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLon = Math.min(minLon, point.longitude);
    maxLon = Math.max(maxLon, point.longitude);
  }
  const padLat = 0.45;
  const padLon = 0.55;
  return {
    minLat: Math.max(-90, minLat - padLat),
    maxLat: Math.min(90, maxLat + padLat),
    minLon: Math.max(-180, minLon - padLon),
    maxLon: Math.min(180, maxLon + padLon),
  };
}

/**
 * Resolve a stop name into coordinates, preferring real place entries inside
 * the route's corridor over administrative-boundary centroids.
 */
export async function geocodeStop(name: string, bounds: GeocodeBounds | null): Promise<GeoPoint | null> {
  const key = `${name}::${bounds ? `${bounds.minLon.toFixed(0)},${bounds.minLat.toFixed(0)},${bounds.maxLon.toFixed(0)},${bounds.maxLat.toFixed(0)}` : "any"}`;
  const backoffUntil = geocodeBackoff.get(key);
  if (backoffUntil && Date.now() < backoffUntil) return null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", `${name}, ${CAMPUS_REGION}`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", CAMPUS_COUNTRY);
    if (bounds) {
      url.searchParams.set("viewbox", `${bounds.minLon},${bounds.maxLat},${bounds.maxLon},${bounds.minLat}`);
      url.searchParams.set("bounded", "1");
    }

    const response = await throttledFetch(url.toString(), AbortSignal.timeout(REQUEST_TIMEOUT_MS));
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    const rows = (await response.json()) as Array<{
      lat: string;
      lon: string;
      type?: string;
      latitudeComparable?: never;
    }>;

    const candidates = rows
      .map((row) => ({
        latitude: Number(row.lat),
        longitude: Number(row.lon),
        type: row.type ?? "",
      }))
      .filter((candidate) => Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude));
    const best =
      candidates.find((candidate) => PLACE_TYPES.has(candidate.type)) ?? candidates[0] ?? null;

    if (!best) {
      // A confident miss: remember it so polls don't hammer the geocoder.
      geocodeBackoff.set(key, Date.now() + GEOCODE_BACKOFF_MS);
      return null;
    }
    return { latitude: best.latitude, longitude: best.longitude };
  } catch {
    geocodeBackoff.set(key, Date.now() + GEOCODE_BACKOFF_MS);
    return null;
  }
}

export type OsrmRoute = {
  /** Road-following polyline as [lat, lon] pairs. */
  geometry: [number, number][];
  durationS: number;
  distanceM: number;
};

/** Follow real roads through the given points in order. Null when OSRM is down or the route is invalid. */
export async function osrmRoute(points: GeoPoint[]): Promise<OsrmRoute | null> {
  if (points.length < 2) return null;
  return osrmFetch<OsrmRoute>(`/route/v1/driving/${toCoords(points)}?overview=full&geometries=geojson&steps=false`, (data) => {
    const route = data?.routes?.[0];
    const coordinates = route?.geometry?.coordinates as [number, number][] | undefined;
    if (data?.code !== "Ok" || !Array.isArray(coordinates) || coordinates.length < 2) return null;
    return {
      geometry: coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
      durationS: Number(route.duration) || 0,
      distanceM: Number(route.distance) || 0,
    };
  });
}

export type OsrmTable = { durationsS: number[]; distancesM: number[] };

/** One-to-many road durations/distances from `source` to each target in a single OSRM call. */
export async function osrmTable(source: GeoPoint, targets: GeoPoint[]): Promise<OsrmTable | null> {
  if (targets.length === 0) return { durationsS: [], distancesM: [] };
  return osrmFetch<OsrmTable>(
    `/table/v1/driving/${toCoords([source, ...targets])}?sources=0&annotations=duration,distance`,
    (data) => {
      if (data?.code !== "Ok") return null;
      const durations = data?.durations?.[0] as number[] | undefined;
      const distances = data?.distances?.[0] as number[] | undefined;
      if (!Array.isArray(durations) || !Array.isArray(distances) || durations.length < 1) return null;
      // Index 0 is the source itself; the rest align with the targets.
      return { durationsS: durations.slice(1), distancesM: distances.slice(1) };
    },
  );
}

type Unwrap<T> = { value: T | null };

async function osrmFetch<T>(pathWithQuery: string, extract: (data: any) => T | null): Promise<T | null> {
  try {
    const response = await fetch(`${OSRM_BASE}${pathWithQuery}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const value: Unwrap<T> = { value: extract(data) };
    return value.value;
  } catch {
    return null;
  }
}

/** OSRM expects `lon,lat;lon,lat`. */
export function toCoords(points: GeoPoint[]): string {
  return points.map((point) => `${point.longitude},${point.latitude}`).join(";");
}

/** Great-circle distance in kilometres (straight-line fallback metric). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const radius = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}
