// Provider-aware data layer. SQLite (local, zero-config) and Postgres
// (Supabase, via DATABASE_URL) implement the same async interface, so route
// handlers never touch a driver directly.
import { getSqlite, isPg } from "./index";
import { requirePg } from "./pg";

export interface BusProfile {
  id: number;
  bus_number: string;
  route_id: number | null;
  route_name: string | null;
  destination: string | null;
}

export interface FleetRow {
  id: number;
  bus_number: string;
  route_name: string | null;
  destination: string | null;
  lat: number | null;
  lng: number | null;
  speed_mps: number | null;
  last_seen: string | null;
  trip_id: string | null;
}

export interface TrailPoint {
  lat: number;
  lng: number;
  recorded_at: string;
  speed_mps: number | null;
  seq: number;
  trip_id: string;
}

export interface TripRow {
  trip_code: string;
  started_at: string | null;
  ended_at: string | null;
  distance_m: number;
  points_count: number;
  active: boolean;
}

export interface RouteRow {
  id: number;
  name: string;
  origin: string;
  destination: string;
  polyline: Array<[number, number]>;
}

export interface ValidPoint {
  point_id: string;
  seq: number;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  recorded_at: string; // ISO
}

export interface FreshPoint {
  seq: number;
  lat: number;
  lng: number;
  speed_mps: number | null;
  recorded_at: string;
}

const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
};

const isoReq = (v: unknown): string => iso(v) ?? "";

function parsePolyline(raw: unknown): Array<[number, number]> {
  try {
    const p = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (Array.isArray(p)) return p as Array<[number, number]>;
  } catch { /* fall through */ }
  return [];
}

// Tolerant route-name matching shared by both providers.
export function normRouteName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s*(?:→|⇒|➜|➔|->|=>|–|—|-)\s*/g, " → ")
    .replace(/\s+/g, " ");
}

export async function dbOk(): Promise<boolean> {
  try {
    if (isPg) {
      await requirePg()`SELECT 1`;
    } else {
      getSqlite().prepare("SELECT 1").get();
    }
    return true;
  } catch {
    return false;
  }
}

// ---------- buses ----------

export async function findBusByTokenHash(hash: string): Promise<{ id: number; bus_number: string } | undefined> {
  if (isPg) {
    const rows = await requirePg()`SELECT id, bus_number FROM buses WHERE token_hash = ${hash}`;
    return (rows[0] as { id: number; bus_number: string } | undefined) ?? undefined;
  }
  const row = getSqlite().prepare("SELECT id, bus_number FROM buses WHERE token_hash = ?").get(hash) as
    | { id: number; bus_number: string } | undefined;
  return row ?? undefined;
}

export async function getBusProfile(busId: number): Promise<BusProfile | undefined> {
  if (isPg) {
    const rows = await requirePg()`SELECT id, bus_number, route_id, route_name, destination FROM buses WHERE id = ${busId}`;
    return (rows[0] as BusProfile | undefined) ?? undefined;
  }
  const row = getSqlite()
    .prepare("SELECT id, bus_number, route_id, route_name, destination FROM buses WHERE id = ?")
    .get(busId) as BusProfile | undefined;
  return row ?? undefined;
}

const FLEET_SQL = `
  SELECT b.id, b.bus_number, b.route_name, b.destination,
    (SELECT lat FROM positions WHERE bus_id = b.id ORDER BY recorded_at DESC LIMIT 1) AS lat,
    (SELECT lng FROM positions WHERE bus_id = b.id ORDER BY recorded_at DESC LIMIT 1) AS lng,
    (SELECT speed_mps FROM positions WHERE bus_id = b.id ORDER BY recorded_at DESC LIMIT 1) AS speed_mps,
    (SELECT recorded_at FROM positions WHERE bus_id = b.id ORDER BY recorded_at DESC LIMIT 1) AS last_seen,
    (SELECT trip_id FROM positions WHERE bus_id = b.id ORDER BY recorded_at DESC LIMIT 1) AS trip_id
  FROM buses b ORDER BY b.bus_number`;

export async function listFleet(): Promise<FleetRow[]> {
  if (isPg) {
    const rows = await requirePg().unsafe(FLEET_SQL);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as number,
      bus_number: r.bus_number as string,
      route_name: (r.route_name as string | null) ?? null,
      destination: (r.destination as string | null) ?? null,
      lat: (r.lat as number | null) ?? null,
      lng: (r.lng as number | null) ?? null,
      speed_mps: (r.speed_mps as number | null) ?? null,
      last_seen: iso(r.last_seen),
      trip_id: (r.trip_id as string | null) ?? null,
    }));
  }
  const rows = getSqlite().prepare(FLEET_SQL).all() as FleetRow[];
  return rows;
}

export async function getTrail(busId: number, sinceIso: string): Promise<{ trail: TrailPoint[] }> {
  if (isPg) {
    const rows = await requirePg()`
      SELECT lat, lng, recorded_at, speed_mps, seq, trip_id FROM positions
      WHERE bus_id = ${busId} AND recorded_at >= ${sinceIso}::timestamptz
      ORDER BY recorded_at ASC LIMIT 2000`;
    return {
      trail: (rows as Array<Record<string, unknown>>).map((r) => ({
        lat: r.lat as number,
        lng: r.lng as number,
        recorded_at: isoReq(r.recorded_at),
        speed_mps: (r.speed_mps as number | null) ?? null,
        seq: r.seq as number,
        trip_id: r.trip_id as string,
      })),
    };
  }
  const rows = getSqlite()
    .prepare(
      `SELECT lat, lng, recorded_at, speed_mps, seq, trip_id FROM positions
       WHERE bus_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC LIMIT 2000`
    )
    .all(busId, sinceIso) as TrailPoint[];
  return { trail: rows };
}

export async function createBus(input: {
  busNumber: string; routeId: number | null; routeName: string; destination: string; tokenHash: string;
}): Promise<number> {
  if (isPg) {
    const rows = await requirePg()`
      INSERT INTO buses (bus_number, route_id, route_name, destination, token_hash)
      VALUES (${input.busNumber}, ${input.routeId}, ${input.routeName}, ${input.destination}, ${input.tokenHash})
      RETURNING id`;
    return (rows[0] as { id: number }).id;
  }
  const info = getSqlite()
    .prepare("INSERT INTO buses (bus_number, route_id, route_name, destination, token_hash) VALUES (?, ?, ?, ?, ?)")
    .run(input.busNumber, input.routeId, input.routeName, input.destination, input.tokenHash);
  return Number(info.lastInsertRowid);
}
export async function rotateBusToken(busNumber: string, hash: string): Promise<boolean> {
  if (isPg) {
    const res = await requirePg()`UPDATE buses SET token_hash = ${hash} WHERE bus_number = ${busNumber}`;
    return res.count > 0;
  }
  const info = getSqlite().prepare("UPDATE buses SET token_hash = ? WHERE bus_number = ?").run(hash, busNumber);
  return info.changes > 0;
}

export async function findBusByNumber(busNumber: string): Promise<BusProfile | undefined> {
  if (isPg) {
    const rows = await requirePg()`SELECT id, bus_number, route_id, route_name, destination FROM buses WHERE bus_number = ${busNumber}`;
    return (rows[0] as BusProfile | undefined) ?? undefined;
  }
  const row = getSqlite()
    .prepare("SELECT id, bus_number, route_id, route_name, destination FROM buses WHERE bus_number = ?")
    .get(busNumber) as BusProfile | undefined;
  return row ?? undefined;
}

export async function updateBusSeed(
  busNumber: string, patch: { routeId: number | null; routeName: string; destination: string; tokenHash: string }
): Promise<void> {
  if (isPg) {
    await requirePg()`UPDATE buses SET route_id = ${patch.routeId}, route_name = ${patch.routeName},
      destination = ${patch.destination}, token_hash = ${patch.tokenHash} WHERE bus_number = ${busNumber}`;
    return;
  }
  getSqlite()
    .prepare("UPDATE buses SET route_id = ?, route_name = ?, destination = ?, token_hash = ? WHERE bus_number = ?")
    .run(patch.routeId, patch.routeName, patch.destination, patch.tokenHash, busNumber);
}

// ---------- trips & positions ----------

export async function ensureTrip(tripCode: string, busId: number, source: string, startedAtIso: string): Promise<void> {
  if (isPg) {
    await requirePg()`INSERT INTO trips (trip_code, bus_id, started_at, source, active)
      VALUES (${tripCode}, ${busId}, ${startedAtIso}::timestamptz, ${source}, TRUE)
      ON CONFLICT (trip_code) DO NOTHING`;
    return;
  }
  const db = getSqlite();
  const row = db.prepare("SELECT trip_code FROM trips WHERE trip_code = ?").get(tripCode) as
    | { trip_code: string } | undefined;
  if (!row) {
    try {
      db.prepare("INSERT INTO trips (trip_code, bus_id, started_at, source, active) VALUES (?, ?, ?, ?, 1)").run(
        tripCode, busId, startedAtIso, source
      );
    } catch { /* race — ignore */ }
  }
}

export async function bumpTripCount(tripCode: string, n: number): Promise<void> {
  if (n === 0) return;
  if (isPg) {
    await requirePg()`UPDATE trips SET points_count = points_count + ${n} WHERE trip_code = ${tripCode}`;
    return;
  }
  getSqlite().prepare("UPDATE trips SET points_count = points_count + ? WHERE trip_code = ?").run(n, tripCode);
}

export async function insertPositions(
  busId: number, tripCode: string, source: string, points: ValidPoint[], receivedAtIso: string
): Promise<{ accepted: number; duplicates: number; fresh: FreshPoint[] }> {
  if (isPg) {
    const sql = requirePg();
    const values = points.map((p) => ({
      bus_id: busId,
      trip_id: tripCode,
      point_id: p.point_id,
      seq: p.seq,
      lat: p.lat,
      lng: p.lng,
      accuracy_m: p.accuracy_m,
      speed_mps: p.speed_mps,
      recorded_at: new Date(p.recorded_at),
      received_at: new Date(receivedAtIso),
      source,
    }));
    const rows = await sql`
      INSERT INTO positions ${sql(values)}
      ON CONFLICT (bus_id, point_id) DO NOTHING
      RETURNING seq, lat, lng, speed_mps, recorded_at`;
    const fresh = (rows as Array<Record<string, unknown>>)
      .map((r) => ({
        seq: r.seq as number,
        lat: r.lat as number,
        lng: r.lng as number,
        speed_mps: (r.speed_mps as number | null) ?? null,
        recorded_at: isoReq(r.recorded_at),
      }))
      .sort((a, b) => a.seq - b.seq);
    return { accepted: fresh.length, duplicates: points.length - fresh.length, fresh };
  }
  const db = getSqlite();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO positions
      (bus_id, trip_id, point_id, seq, lat, lng, accuracy_m, speed_mps, recorded_at, received_at, source)
    VALUES (@bus_id, @trip_id, @point_id, @seq, @lat, @lng, @accuracy_m, @speed_mps, @recorded_at, @received_at, @source)`);
  let accepted = 0;
  let duplicates = 0;
  const fresh: FreshPoint[] = [];
  const tx = db.transaction(() => {
    for (const p of points) {
      const info = stmt.run({
        bus_id: busId, trip_id: tripCode, point_id: p.point_id, seq: p.seq,
        lat: p.lat, lng: p.lng, accuracy_m: p.accuracy_m, speed_mps: p.speed_mps,
        recorded_at: p.recorded_at, received_at: receivedAtIso, source,
      });
      if (info.changes === 1) {
        accepted++;
        fresh.push({ seq: p.seq, lat: p.lat, lng: p.lng, speed_mps: p.speed_mps, recorded_at: p.recorded_at });
      } else duplicates++;
    }
  });
  tx();
  return { accepted, duplicates, fresh };
}

export async function getTrip(tripCode: string): Promise<{ trip_code: string } | undefined> {
  if (isPg) {
    const rows = await requirePg()`SELECT trip_code FROM trips WHERE trip_code = ${tripCode}`;
    return (rows[0] as { trip_code: string } | undefined) ?? undefined;
  }
  const row = getSqlite().prepare("SELECT trip_code FROM trips WHERE trip_code = ?").get(tripCode) as
    | { trip_code: string } | undefined;
  return row ?? undefined;
}

export async function getTripPoints(tripCode: string): Promise<Array<{ lat: number; lng: number }>> {
  if (isPg) {
    const rows = await requirePg()`SELECT lat, lng FROM positions WHERE trip_id = ${tripCode} ORDER BY seq ASC`;
    return rows as unknown as Array<{ lat: number; lng: number }>;
  }
  return getSqlite()
    .prepare("SELECT lat, lng FROM positions WHERE trip_id = ? ORDER BY seq ASC")
    .all(tripCode) as Array<{ lat: number; lng: number }>;
}

export async function endTrip(tripCode: string, endedAtIso: string, distanceM: number): Promise<void> {
  if (isPg) {
    await requirePg()`UPDATE trips SET active = FALSE, ended_at = ${endedAtIso}::timestamptz, distance_m = ${distanceM} WHERE trip_code = ${tripCode}`;
    return;
  }
  const db = getSqlite();
  db.prepare("UPDATE trips SET active = 0, ended_at = ? WHERE trip_code = ?").run(endedAtIso, tripCode);
  db.prepare("UPDATE trips SET distance_m = ? WHERE trip_code = ?").run(distanceM, tripCode);
}

export async function listTrips(busId: number): Promise<TripRow[]> {
  if (isPg) {
    const rows = await requirePg()`SELECT trip_code, started_at, ended_at, distance_m, points_count, active
      FROM trips WHERE bus_id = ${busId} ORDER BY started_at DESC LIMIT 50`;
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      trip_code: r.trip_code as string,
      started_at: iso(r.started_at),
      ended_at: iso(r.ended_at),
      distance_m: Number(r.distance_m ?? 0),
      points_count: Number(r.points_count ?? 0),
      active: (r.active as boolean) === true,
    }));
  }
  return (getSqlite()
    .prepare("SELECT trip_code, started_at, ended_at, distance_m, points_count, active FROM trips WHERE bus_id = ? ORDER BY started_at DESC LIMIT 50")
    .all(busId) as Array<Record<string, unknown>>).map((r) => ({
    trip_code: r.trip_code as string,
    started_at: (r.started_at as string | null) ?? null,
    ended_at: (r.ended_at as string | null) ?? null,
    distance_m: Number(r.distance_m ?? 0),
    points_count: Number(r.points_count ?? 0),
    active: Number(r.active ?? 0) === 1,
  }));
}

// ---------- routes ----------

export interface RouteCandidate { id: number; name: string; origin: string; destination: string }

export async function listRouteCandidates(): Promise<RouteCandidate[]> {
  if (isPg) {
    const rows = await requirePg()`SELECT id, name, origin, destination FROM routes`;
    return rows as unknown as RouteCandidate[];
  }
  return getSqlite().prepare("SELECT id, name, origin, destination FROM routes").all() as RouteCandidate[];
}

export async function createRoute(input: { name: string; origin: string; destination: string; polyline: Array<[number, number]> }): Promise<number> {
  if (isPg) {
    const rows = await requirePg()`INSERT INTO routes (name, origin, destination, polyline_geojson)
      VALUES (${input.name}, ${input.origin}, ${input.destination}, ${JSON.stringify(input.polyline)})
      RETURNING id`;
    return (rows[0] as { id: number }).id;
  }
  const info = getSqlite()
    .prepare("INSERT INTO routes (name, origin, destination, polyline_geojson) VALUES (?, ?, ?, ?)")
    .run(input.name, input.origin, input.destination, JSON.stringify(input.polyline));
  return Number(info.lastInsertRowid);
}

export async function updateRoute(
  id: number, patch: { polyline?: Array<[number, number]>; origin?: string; destination?: string }
): Promise<void> {
  if (isPg) {
    const sql = requirePg();
    if (patch.polyline) await sql`UPDATE routes SET polyline_geojson = ${JSON.stringify(patch.polyline)} WHERE id = ${id}`;
    if (patch.origin !== undefined) await sql`UPDATE routes SET origin = ${patch.origin} WHERE id = ${id}`;
    if (patch.destination !== undefined) await sql`UPDATE routes SET destination = ${patch.destination} WHERE id = ${id}`;
    return;
  }
  const db = getSqlite();
  if (patch.polyline) db.prepare("UPDATE routes SET polyline_geojson = ? WHERE id = ?").run(JSON.stringify(patch.polyline), id);
  if (patch.origin !== undefined) db.prepare("UPDATE routes SET origin = ? WHERE id = ?").run(patch.origin, id);
  if (patch.destination !== undefined) db.prepare("UPDATE routes SET destination = ? WHERE id = ?").run(patch.destination, id);
}

export async function listRoutes(): Promise<RouteRow[]> {
  if (isPg) {
    const rows = await requirePg()`SELECT id, name, origin, destination, polyline_geojson FROM routes ORDER BY name`;
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as number,
      name: r.name as string,
      origin: r.origin as string,
      destination: r.destination as string,
      polyline: parsePolyline(r.polyline_geojson),
    }));
  }
  const rows = getSqlite()
    .prepare("SELECT id, name, origin, destination, polyline_geojson FROM routes ORDER BY name")
    .all() as Array<{ id: number; name: string; origin: string; destination: string; polyline_geojson: string }>;
  return rows.map((r) => ({
    id: r.id, name: r.name, origin: r.origin, destination: r.destination, polyline: parsePolyline(r.polyline_geojson),
  }));
}

// Upsert shared by both providers (tolerant name match, merge rules).
export async function upsertRoute(opts: {
  name: string; origin: string; destination: string;
  originExplicit: boolean; destExplicit: boolean;
  polyline?: Array<[number, number]>;
}): Promise<{ id: number; created: boolean }> {
  const existing = (await listRouteCandidates()).find((r) => normRouteName(r.name) === normRouteName(opts.name));
  if (!existing) {
    const id = await createRoute({ name: opts.name, origin: opts.origin, destination: opts.destination, polyline: opts.polyline ?? [] });
    return { id, created: true };
  }
  const patch: { polyline?: Array<[number, number]>; origin?: string; destination?: string } = {};
  if (opts.polyline) patch.polyline = opts.polyline;
  if (opts.origin && (opts.originExplicit || !existing.origin)) patch.origin = opts.origin;
  if (opts.destination && (opts.destExplicit || !existing.destination)) patch.destination = opts.destination;
  if (patch.polyline || patch.origin !== undefined || patch.destination !== undefined) {
    await updateRoute(existing.id, patch);
  }
  return { id: existing.id, created: false };
}
