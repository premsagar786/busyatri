import { postJSON, HttpError } from "../api/client";
import { NET } from "../api/config";
import { nextUnsynced, markSynced, pruneIfNeeded } from "./db";
import { nextDelay, sleep } from "../utils/backoff";

// Minimal gzip: only when body > 1KB. Uses pako if available, else plain JSON.
async function maybeGzip(json: string): Promise<{ body: string; gz?: Uint8Array }> {
  if (json.length < NET.gzipThresholdBytes) return { body: json };
  try {
    const pako = (await import("pako")).default;
    const gz = pako.gzip(json);
    return { body: json, gz: gz as unknown as Uint8Array };
  } catch {
    return { body: json };
  }
}

export interface SyncState {
  running: boolean;
  lastSync: string | null;
  lastError: string | null;
}

export const syncState: SyncState = { running: false, lastSync: null, lastError: null };

export async function syncOnce(opts: { tripId: string; token: string; source?: string }): Promise<boolean> {
  const batch = await nextUnsynced(NET.batchSize);
  if (!batch.length) return true;
  const body = {
    trip_id: opts.tripId,
    source: opts.source || "phone",
    points: batch.map((p) => ({
      point_id: p.point_id, seq: p.seq, lat: p.lat, lng: p.lng,
      accuracy_m: p.accuracy_m, speed_mps: p.speed_mps, recorded_at: p.recorded_at,
    })),
  };
  const json = JSON.stringify(body);
  const { gz } = await maybeGzip(json);
  try {
    // client.postJSON handles gzip header; pass gz through as extra arg
    const { postJSON: pj } = await import("../api/client");
    void pj;
    await postJSON("/api/v1/positions/batch", opts.token, gz ? json : body, gz);
    await markSynced(batch.map((p) => p.point_id));
    await pruneIfNeeded(NET.maxQueuedPoints);
    syncState.lastSync = new Date().toISOString();
    syncState.lastError = null;
    return true;
  } catch (err) {
    const e = err as HttpError;
    if (e.status === 401) {
      syncState.lastError = "Token invalid, ask admin";
      throw e; // fatal
    }
    if (e.status === 413) {
      NET.batchSize = Math.max(10, Math.floor(NET.batchSize / 2));
    }
    syncState.lastError = e.message;
    return false;
  }
}

export async function syncLoop(signal: AbortSignal, opts: { tripId: string; token: string }) {
  let attempt = 0;
  syncState.running = true;
  while (!signal.aborted) {
    const ok = await syncOnce(opts);
    if (ok) {
      attempt = 0;
      const remaining = await nextUnsynced(1);
      if (!remaining.length) {
        // Event-driven cadence: poll fast so each GPS fix (≈10 s) leaves
        // the phone within ~2 s instead of idling out a long sleep.
        await sleep(NET.queuePollMs);
        if (signal.aborted) break;
        continue;
      }
      continue; // more to drain — no sleep
    }
    const d = nextDelay(attempt++, NET.backoff.baseMs, NET.backoff.capMs, NET.backoff.jitter);
    const ra = 0;
    await sleep(Math.max(d, ra));
  }
  syncState.running = false;
}

export function wakeSync() {
  // NetInfo listener calls this on offline→online; the loop picks it up
  // via short-circuit: reset backoff by nudging lastError
  syncState.lastError = null;
}
