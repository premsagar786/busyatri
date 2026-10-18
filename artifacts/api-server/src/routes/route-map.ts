import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { GetRouteMapResponse } from "@workspace/api-zod";
import { busLocationsTable, busesTable, db, routeStopsCacheTable } from "@workspace/db";
import { requireUser } from "../middlewares/currentUser";
import {
  corridorBounds,
  geocodeStop,
  haversineKm,
  osrmRoute,
  osrmTable,
  type GeoPoint,
} from "../lib/osrm";

const router: IRouter = Router();

/** Fresh enough to reason about ETAs; older/absent locations leave ETAs empty. */
const LOCATION_FRESH_MS = 20 * 60_000;
/** Live bus within this many metres of a stop counts it as reached. */
const REACHED_M = 120;
/** Geocode only a few missing stops per request; the client's next poll fills the rest. */
const GEOCODE_BUDGET_PER_REQUEST = 4;
/** Estimated average speed for the straight-line fallback ETA. */
const FALLBACK_SPEED_KMH = 28;
/** Minutes the bus dwells at each intermediate stop (fallback estimate only). */
const FALLBACK_DWELL_MIN = 2;

type CacheEntry = { at: number; payload: unknown };
/** Short-lived cache so student polling stays cheap even with OSRM at work. */
const responseCache = new Map<number, CacheEntry>();
const RESPONSE_CACHE_MS = 30_000;

type ChainEntry = {
  name: string | null;
  role: "start" | "mid" | "end";
  coord: GeoPoint | null;
};

type StopRowLike = {
  name: string;
  sequence: number;
  latitude: number | null;
  longitude: number | null;
  etaMin: number | null;
  distanceKm: number | null;
  reached: boolean;
};

router.get("/route-map/:busId", requireUser, async (req, res): Promise<void> => {
  const rawBusId = req.params.busId;
  const busId = Number.parseInt(Array.isArray(rawBusId) ? (rawBusId[0] ?? "") : rawBusId, 10);
  if (!Number.isInteger(busId) || busId < 1) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }

  const cached = responseCache.get(busId);
  if (cached && Date.now() - cached.at < RESPONSE_CACHE_MS) {
    res.json(cached.payload);
    return;
  }

  const [bus] = await db.select().from(busesTable).where(eq(busesTable.id, busId)).limit(1);
  if (!bus) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }

  const payload = await buildRouteMap(bus, busId);
  responseCache.set(busId, { at: Date.now(), payload });
  res.json(GetRouteMapResponse.parse(payload));
});

async function buildRouteMap(
  bus: typeof busesTable.$inferSelect,
  busId: number,
): Promise<unknown> {
  const [cacheRows, locationRows] = await Promise.all([
    db.select().from(routeStopsCacheTable).where(eq(routeStopsCacheTable.busId, busId)),
    db.select().from(busLocationsTable).where(eq(busLocationsTable.busId, busId)).limit(1),
  ]);

  const coordByName = new Map<string, GeoPoint>(
    cacheRows.map((row) => [row.name.toUpperCase(), { latitude: row.lat, longitude: row.lon }]),
  );

  const stopNames = (bus.routeStops ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 30);

  const adminStart: GeoPoint | null =
    bus.startLat != null && bus.startLon != null ? { latitude: bus.startLat, longitude: bus.startLon } : null;
  const adminEnd: GeoPoint | null =
    bus.endLat != null && bus.endLon != null ? { latitude: bus.endLat, longitude: bus.endLon } : null;

  // Build the ordered stop chain. Admin start/end coordinates override the
  // route's first/last stop; intermediate stops come from the geocode cache.
  const chain: ChainEntry[] = [];
  if (stopNames.length >= 2) {
    chain.push({ name: stopNames[0], role: "start", coord: adminStart ?? coordByName.get(stopNames[0].toUpperCase()) ?? null });
    for (const name of stopNames.slice(1, -1)) {
      chain.push({ name, role: "mid", coord: coordByName.get(name.toUpperCase()) ?? null });
    }
    chain.push({
      name: stopNames[stopNames.length - 1],
      role: "end",
      coord: adminEnd ?? coordByName.get(stopNames[stopNames.length - 1].toUpperCase()) ?? null,
    });
  } else if (stopNames.length === 1) {
    chain.push({ name: stopNames[0], role: "start", coord: adminStart ?? coordByName.get(stopNames[0].toUpperCase()) ?? null });
    if (adminEnd) chain.push({ name: null, role: "end", coord: adminEnd });
  } else {
    if (adminStart) chain.push({ name: null, role: "start", coord: adminStart });
    if (adminEnd) chain.push({ name: null, role: "end", coord: adminEnd });
  }

  // Resolve missing coordinates against the geocoder, corridor-biased and
  // bounded so one request stays quick even when every stop is missing.
  const knownPoints = [...coordByName.values(), ...(adminStart ? [adminStart] : []), ...(adminEnd ? [adminEnd] : [])];
  const bounds = corridorBounds(knownPoints);
  let geocodeBudget = GEOCODE_BUDGET_PER_REQUEST;
  for (const entry of chain) {
    if (entry.coord || !entry.name) continue;
    if (geocodeBudget <= 0) break;
    geocodeBudget--;
    const resolved = await geocodeStop(entry.name, bounds);
    if (!resolved) continue;
    entry.coord = resolved;
    knownPoints.push(resolved);
    await db
      .insert(routeStopsCacheTable)
      .values({ busId, name: entry.name.toUpperCase(), lat: resolved.latitude, lon: resolved.longitude })
      .onConflictDoNothing();
    coordByName.set(entry.name.toUpperCase(), resolved);
  }

  const coordIndexOf = new Map<number, number>();
  const chainCoords: GeoPoint[] = [];
  chain.forEach((entry, index) => {
    if (entry.coord) {
      coordIndexOf.set(index, chainCoords.length);
      chainCoords.push(entry.coord);
    }
  });

  const location = locationRows[0];
  const busPin: GeoPoint | null =
    location && Date.now() - location.recordedAt.getTime() <= LOCATION_FRESH_MS
      ? { latitude: location.latitude, longitude: location.longitude }
      : null;

  // Per-stop road ETA from the live pin — one OSRM table call.
  const table = busPin && chainCoords.length >= 1 ? await osrmTable(busPin, chainCoords) : null;
  // Road-following polyline through the stop chain.
  const route = chainCoords.length >= 2 ? await osrmRoute(chainCoords) : null;

  const reachedByIndex: boolean[] = [];
  const etaByIndex: (number | null)[] = [];
  const distanceByIndex: (number | null)[] = [];
  let destinationEtaMin: number | null = null;
  let destinationDistanceKm: number | null = null;

  const lastIndex = chain.length - 1;
  const lastIndexCoord = coordIndexOf.get(lastIndex);
  const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

  if (table) {
    chain.forEach((entry, index) => {
      const coordIndex = coordIndexOf.get(index);
      const durationS = coordIndex == null ? undefined : table.durationsS[coordIndex];
      const distanceM = coordIndex == null ? undefined : table.distancesM[coordIndex];
      if (durationS == null || distanceM == null) {
        reachedByIndex[index] = false;
        etaByIndex[index] = null;
        distanceByIndex[index] = null;
        return;
      }
      const reached = distanceM <= REACHED_M;
      reachedByIndex[index] = reached;
      etaByIndex[index] = reached ? 0 : minutes(durationS);
      distanceByIndex[index] = Math.round((distanceM / 1000) * 10) / 10;
    });
  } else if (busPin) {
    // Straight-line fallback so the portal still shows something when OSRM is down.
    for (let index = chain.length - 1; index >= 0; index--) {
      const coord = chain[index].coord;
      if (!coord) {
        reachedByIndex[index] = false;
        etaByIndex[index] = null;
        distanceByIndex[index] = null;
        continue;
      }
      const km = haversineKm(busPin, coord);
      const stopsAhead = chain
        .slice(index + 1)
        .filter((entry) => entry.coord).length;
      const reached = km * 1000 <= REACHED_M;
      reachedByIndex[index] = reached;
      distanceByIndex[index] = Math.round(km * 10) / 10;
      etaByIndex[index] = reached ? 0 : Math.round((km * 60) / FALLBACK_SPEED_KMH + stopsAhead * FALLBACK_DWELL_MIN);
    }
  } else {
    for (let index = 0; index < chain.length; index++) {
      reachedByIndex[index] = false;
      etaByIndex[index] = null;
      distanceByIndex[index] = null;
    }
  }

  if (lastIndexCoord != null) {
    destinationEtaMin = etaByIndex[lastIndex] ?? null;
    destinationDistanceKm = distanceByIndex[lastIndex] ?? null;
  }

  // Geometry: OSRM road polyline; else straight segments between known stops.
  let geometry: [number, number][] = [];
  let source: "osrm" | "estimate" | "none" = "none";
  if (route) {
    geometry = route.geometry;
    source = "osrm";
  } else if (chainCoords.length >= 2) {
    geometry = chainCoords.map((point) => [point.latitude, point.longitude] as [number, number]);
    source = "estimate";
  }

  const stopRows: StopRowLike[] = chain.map((entry, index) => ({
    name: entry.name ?? "",
    sequence: index,
    latitude: entry.coord?.latitude ?? null,
    longitude: entry.coord?.longitude ?? null,
    etaMin: etaByIndex[index] ?? null,
    distanceKm: distanceByIndex[index] ?? null,
    reached: reachedByIndex[index] ?? false,
  }));

  const totalDistanceKm =
    route != null
      ? Math.round((route.distanceM / 1000) * 10) / 10
      : source === "estimate"
        ? Math.round(
            chainCoords
              .slice(1)
              .reduce((sum, point, index) => sum + haversineKm(chainCoords[index], point), 0),
          )
        : null;

  return {
    busId,
    stops: stopRows,
    geometry,
    destinationEtaMin,
    destinationDistanceKm,
    totalDistanceKm,
    source,
  };
}

export default router;
