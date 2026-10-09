import { Router } from "express";
import { z } from "zod";
import { authAdmin, authBus } from "../auth/middleware";
import { hashToken, makeToken } from "../auth/tokens";
import { broadcast } from "../ws/hub";
import {
  getBusProfile, listFleet, getTrail, createBus, rotateBusToken,
  getTrip, getTripPoints, endTrip as finishTrip, listTrips, upsertRoute,
  ensureTrip,
} from "../db/store";

export const buses = Router();

function computeStatus(lastSeenMs: number | null): string {
  if (lastSeenMs === null) return "Offline";
  const age = Date.now() - lastSeenMs;
  if (age > 60_000) return "Offline";
  return "Live";
}

// Driver login verification: proves the token is valid and returns the
// assigned bus profile (bus number, route, destination). No mocks.
buses.get("/me", authBus, async (req, res) => {
  try {
    const row = await getBusProfile(req.busId!);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ id: row.id, bus_number: row.bus_number, route: row.route_name, destination: row.destination });
  } catch (err) {
    console.error("[buses] me failed", err);
    res.status(500).json({ error: "db_error" });
  }
});

buses.get("/", async (_req, res) => {
  try {
    const rows = await listFleet();
    const out = rows.map((r) => {
      const lastMs = r.last_seen ? Date.parse(r.last_seen) : null;
      let status = computeStatus(Number.isNaN(lastMs as number) ? null : lastMs);
      if (status === "Live" && r.speed_mps !== null) {
        status = r.speed_mps > 1.5 ? "Moving" : "Stopped";
      } else if (status === "Live") {
        status = "Moving";
      }
      // Trip announced but no GPS yet (cold fix, first upload in flight):
      // show STARTING for 10 min so admins see intent, not silence.
      const tripStartMs = r.active_trip_started_at ? Date.parse(r.active_trip_started_at) : null;
      if (status === "Offline" && tripStartMs !== null && !Number.isNaN(tripStartMs) && Date.now() - tripStartMs < 10 * 60_000) {
        status = "Starting";
      }
      return {
        id: r.id,
        bus_number: r.bus_number,
        route: r.route_name,
        destination: r.destination,
        status,
        active_trip: r.active_trip_id ? { trip_id: r.active_trip_id, started_at: r.active_trip_started_at } : null,
        last_position:
          r.lat !== null && r.lng !== null
            ? { lat: r.lat, lng: r.lng, speed_mps: r.speed_mps, recorded_at: r.last_seen, trip_id: r.trip_id }
            : null,
        last_seen: r.last_seen,
      };
    });
    res.json(out);
  } catch (err) {
    console.error("[buses] list failed", err);
    res.status(500).json({ error: "db_error" });
  }
});

buses.get("/:id/trail", async (req, res) => {
  const since = (req.query.since as string) || new Date(Date.now() - 6 * 3600_000).toISOString();
  try {
    const { trail } = await getTrail(Number(req.params.id), since);
    res.json({ bus_id: Number(req.params.id), since, count: trail.length, trail });
  } catch (err) {
    console.error("[trail] failed", err);
    res.status(500).json({ error: "db_error" });
  }
});

// ---- admin ----
const LatLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

const CreateBus = z.object({
  bus_number: z.string().min(1).max(20),
  route_name: z.string().max(120).optional().default(""),
  destination: z.string().max(120).optional().default(""),
  origin: z.string().max(120).optional().default(""),
  // Optional route geometry. When supplied with ≥2 points the route's
  // polyline is (re)drawn on the dashboard; when omitted an existing
  // route's polyline is NEVER wiped — the bus just links to it.
  polyline: z.array(LatLng).min(2).max(500).optional(),
});

buses.post("/", authAdmin, async (req, res) => {
  const parsed = CreateBus.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const token = makeToken();
  const hash = hashToken(token);
  try {
    // Route is updated first so bus + route stay in sync: a brand-new
    // route_name creates the route row, an existing one just gets linked
    // (and optionally refreshed with a new polyline).
    let routeId: number | null = null;
    let routeCreated = false;
    const name = parsed.data.route_name.trim();
    if (name) {
      const parts = name.split(/\s*(?:→|⇒|➜|➔|->|=>|–|—|-)\s*/);
      const originIn = parsed.data.origin.trim();
      const destIn = parsed.data.destination.trim();
      const r = await upsertRoute({
        name,
        origin: originIn || parts[0]?.trim() || "",
        destination: destIn || parts[1]?.trim() || "",
        originExplicit: originIn !== "",
        destExplicit: destIn !== "",
        polyline: parsed.data.polyline,
      });
      routeId = r.id;
      routeCreated = r.created;
    }
    const id = await createBus({
      busNumber: parsed.data.bus_number,
      routeId,
      routeName: parsed.data.route_name,
      destination: parsed.data.destination,
      tokenHash: hash,
    });
    broadcast({ type: "bus.status", bus_number: parsed.data.bus_number, status: "Offline" });
    broadcast({
      type: "bus.created",
      bus_id: id,
      bus_number: parsed.data.bus_number,
      route: parsed.data.route_name,
      destination: parsed.data.destination,
      route_id: routeId,
      route_created: routeCreated,
    });
    if (routeId !== null) broadcast({ type: "routes.updated" });
    res.status(201).json({
      id,
      bus_number: parsed.data.bus_number,
      token,
      route_id: routeId,
      route_created: routeCreated,
    });
  } catch (err: unknown) {
    if (String((err as Error)?.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "bus_exists" });
    }
    console.error("[buses] create failed", err);
    res.status(500).json({ error: "db_error" });
  }
});

buses.post("/:busNumber/rotate-token", authAdmin, async (req, res) => {
  const token = makeToken();
  const hash = hashToken(token);
  try {
    const ok = await rotateBusToken(req.params.busNumber, hash);
    if (!ok) return res.status(404).json({ error: "not_found" });
    res.json({ bus_number: req.params.busNumber, token });
  } catch (err) {
    console.error("[buses] rotate failed", err);
    res.status(500).json({ error: "db_error" });
  }
});

// Driver announces START instantly (before first GPS fix uploads), so the
// dashboard shows STARTING within a second instead of silence. Fire-and-forget
// safe: first batch would create the trip anyway; this just makes it instant.
buses.post("/trips/start", authBus, async (req, res) => {
  const parsed = z.object({ trip_id: z.string().min(1).max(120) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  try {
    await ensureTrip(parsed.data.trip_id, req.busId!, "phone", new Date().toISOString());
    broadcast({ type: "trip.start", bus_id: req.busId, bus_number: req.busNumber, trip_id: parsed.data.trip_id });
    res.json({ ok: true, trip_id: parsed.data.trip_id });
  } catch (err) {
    console.error("[buses] trip-start failed", err);
    res.status(500).json({ error: "db_error" });
  }
});

buses.post("/trips/:tripCode/end", async (req, res) => {
  const header = req.headers.authorization || "";
  const adminKey = process.env.ADMIN_KEY || "admin-dev-key";
  const isAdmin = (req.headers["x-admin-key"] as string) === adminKey;
  if (!isAdmin && !header.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  try {
    const row = await getTrip(req.params.tripCode);
    if (!row) return res.status(404).json({ error: "trip_not_found" });
    const endedAt = new Date().toISOString();
    const pts = await getTripPoints(req.params.tripCode);
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i]);
    await finishTrip(req.params.tripCode, endedAt, Math.round(dist));
    broadcast({ type: "trip.end", trip_id: req.params.tripCode, distance_m: Math.round(dist) });
    res.json({ trip_id: req.params.tripCode, ended_at: endedAt, distance_m: Math.round(dist), points: pts.length });
  } catch (err) {
    console.error("[buses] end-trip failed", err);
    res.status(500).json({ error: "db_error" });
  }
});

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLng / 2);
  const aa = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}

// Trip history
buses.get("/:id/trips", async (req, res) => {
  try {
    res.json(await listTrips(Number(req.params.id)));
  } catch (err) {
    console.error("[buses] trips failed", err);
    res.status(500).json({ error: "db_error" });
  }
});
