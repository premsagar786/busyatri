import { Router } from "express";
import { z } from "zod";
import { authBus } from "../auth/middleware";
import { broadcast } from "../ws/hub";
import { positionLimiter } from "../utils/rateLimit";
import { ensureTrip, bumpTripCount, insertPositions, getBusProfile } from "../db/store";
import type { ValidPoint } from "../db/store";

const Point = z.object({
  point_id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().nonnegative().optional(),
  speed_mps: z.number().nonnegative().optional(),
  recorded_at: z.string().datetime(),
});

const Batch = z.object({
  trip_id: z.string().min(1).max(120),
  source: z.enum(["phone", "device"]),
  points: z.array(Point).min(1).max(50),
});

export const positions = Router();

positions.post("/batch", positionLimiter, authBus, async (req, res) => {
  const parsed = Batch.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
  }

  const { trip_id, source, points } = parsed.data;
  const busId = req.busId!;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const rejected: { point_id: string; reason: string }[] = [];
  const valid: ValidPoint[] = [];

  for (const p of points) {
    const t = Date.parse(p.recorded_at);
    if (Number.isNaN(t)) { rejected.push({ point_id: p.point_id, reason: "bad_time" }); continue; }
    if (t < now - 24 * 3600_000) { rejected.push({ point_id: p.point_id, reason: "too_old" }); continue; }
    if (t > now + 5 * 60_000) { rejected.push({ point_id: p.point_id, reason: "in_future" }); continue; }
    valid.push({
      point_id: p.point_id, seq: p.seq, lat: p.lat, lng: p.lng,
      accuracy_m: p.accuracy_m ?? null, speed_mps: p.speed_mps ?? null, recorded_at: p.recorded_at,
    });
  }

  try {
    // Auto-create the trip row on first batch — keeps the driver app simple.
    await ensureTrip(trip_id, busId, source, nowIso);
    const { accepted, duplicates, fresh } = await insertPositions(busId, trip_id, source, valid, nowIso);
    await bumpTripCount(trip_id, accepted);

    // Push ONLY genuinely new movement. Pure-duplicate retries broadcast
    // nothing — no phantom "live" flapping.
    if (fresh.length > 0) {
      const last = fresh[fresh.length - 1];
      const profile = await getBusProfile(busId);
      broadcast({
        type: "bus.position",
        bus_id: busId,
        bus_number: profile?.bus_number ?? req.busNumber,
        route: profile?.route_name ?? null,
        destination: profile?.destination ?? null,
        trip_id,
        seq: last.seq,
        lat: last.lat,
        lng: last.lng,
        speed_mps: last.speed_mps,
        recorded_at: last.recorded_at,
        server_time: new Date().toISOString(),
      });
    }

    console.log(
      `[batch] bus=${req.busNumber} trip=${trip_id} accepted=${accepted} dups=${duplicates} rej=${rejected.length}`
    );
    res.json({ accepted, duplicates, rejected, server_time: new Date().toISOString() });
  } catch (err) {
    console.error("[positions] batch failed", err);
    res.status(500).json({ error: "db_error" });
  }
});
