import * as SecureStore from "expo-secure-store";
import { openDatabaseSync } from "expo-sqlite";
import { PointSchema, QueuedPoint } from "../types/position";

const db = openDatabaseSync("busyatri.db");

export async function initQueue() {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS pending_points (
      point_id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL,
      accuracy_m REAL, speed_mps REAL,
      recorded_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pending_trip ON pending_points (trip_id, seq);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `);
}

export async function enqueue(tripId: string, raw: unknown): Promise<boolean> {
  const parsed = PointSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[queue] invalid point", parsed.error.flatten());
    return false;
  }
  const p = parsed.data;
  const flagged = p.accuracy_m != null && p.accuracy_m > 50 ? 1 : 0;
  try {
    await db.runAsync(
      "INSERT OR IGNORE INTO pending_points (point_id, trip_id, seq, lat, lng, accuracy_m, speed_mps, recorded_at, synced, flagged) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
      [p.point_id, tripId, p.seq, p.lat, p.lng, p.accuracy_m ?? null, p.speed_mps ?? null, p.recorded_at, flagged]
    );
    return true;
  } catch (err) {
    console.error("[queue] enqueue failed", err);
    return false;
  }
}

export async function nextUnsynced(limit: number): Promise<QueuedPoint[]> {
  try {
    const rows = await db.getAllAsync<QueuedPoint>(
      "SELECT * FROM pending_points WHERE synced = 0 ORDER BY seq ASC LIMIT ?",
      [limit]
    );
    return rows;
  } catch (err) {
    console.error("[queue] read failed", err);
    return [];
  }
}

export async function markSynced(ids: string[]) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  try {
    await db.runAsync(`UPDATE pending_points SET synced = 1 WHERE point_id IN (${placeholders})`, ids);
  } catch (err) {
    console.error("[queue] markSynced failed", err);
  }
}

export async function countQueued(): Promise<{ queued: number; sent: number }> {
  try {
    const q = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM pending_points WHERE synced = 0"))?.n ?? 0;
    const s = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM pending_points WHERE synced = 1"))?.n ?? 0;
    return { queued: q, sent: s };
  } catch {
    return { queued: 0, sent: 0 };
  }
}

export async function pruneIfNeeded(max = 10_000) {
  try {
    const total = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM pending_points"))?.n ?? 0;
    if (total > max) {
      const excess = total - max;
      await db.runAsync("DELETE FROM pending_points WHERE rowid IN (SELECT rowid FROM pending_points WHERE synced = 1 ORDER BY seq ASC LIMIT ?)", [excess]);
    }
  } catch (err) {
    console.error("[queue] prune failed", err);
  }
}

export async function getSeq(): Promise<number> {
  try {
    const row = await db.getFirstAsync<{ v: string }>("SELECT v FROM meta WHERE k = 'seq'");
    return row ? Number(row.v) : 0;
  } catch {
    return 0;
  }
}

export async function bumpSeq(): Promise<number> {
  const n = (await getSeq()) + 1;
  await db.runAsync("INSERT INTO meta (k, v) VALUES ('seq', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [String(n)]);
  return n;
}

export async function saveSession(key: string, val: string) {
  try { await SecureStore.setItemAsync(key, val); } catch (err) { console.error("[secure] save failed", err); }
}
export async function loadSession(key: string) {
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}
export async function clearSession(key: string) {
  try { await SecureStore.deleteItemAsync(key); } catch { /* noop */ }
}
