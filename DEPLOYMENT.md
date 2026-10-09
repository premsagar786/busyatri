# Deployment and Network Resilience

This document covers how to deploy the backend and dashboard so buses can stay connected on weak networks, and how the Android app and server cooperate to avoid losing data.

---

## 1. Architecture Overview

```
[Driver phone: Expo app]
    | local SQLite queue, batch upload, retry with backoff
    v  HTTPS (gzip, 10 s timeout)
[Edge: Fly.io region bom (Mumbai)  or  Render Singapore]
    | Node.js / Express API + WebSocket server
    | SQLite (volume) for hackathon, Postgres later
    v  WebSocket (heartbeat every 20 s)
[Admin dashboard: static site, Leaflet + OSM]
```

Why this shape:
- The phone, not the server, holds the data until it is confirmed. This is the main protection against network loss.
- Batching and idempotency mean retries are safe.
- The server sits in an Indian or Singapore region, so round-trip latency from Punjab stays low.
- The dashboard is a static build, so it loads even when the API is slow.

---

## 2. Backend: Repository Layout

```
backend/
  src/
    server.ts          (Express app, WebSocket, health route)
    routes/positions.ts
    routes/buses.ts
    routes/routes.ts
    db/schema.sql      (SQLite, local default)
    db/schema.pg.sql   (Supabase/Postgres — run once in SQL editor)
    db/index.ts        (SQLite handle, lazy)
    db/pg.ts           (Postgres pool; active when DATABASE_URL is set)
    db/store.ts        (async DAL used by all routes — both providers)
    db/seed.ts         (routes + buses, works on both providers)
    auth/tokens.ts     (bearer token check, hashed with SHA-256)
    ws/hub.ts          (broadcast to dashboards, heartbeat)
    utils/rateLimit.ts
  Dockerfile
  fly.toml
  package.json
  .env.example
dashboard/
  index.html
  src/
  Dockerfile         (optional, or deploy as static)
```

---

## 3. Backend Code: Key Pieces

### 3.1 Idempotent batch ingestion (`routes/positions.ts`)

```ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { authBus } from "../auth/tokens";
import { broadcast } from "../ws/hub";

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
  trip_id: z.string().min(1),
  source: z.enum(["phone", "device"]),
  points: z.array(Point).min(1).max(50),
});

const insert = db.prepare(`
  INSERT OR IGNORE INTO positions
    (bus_id, trip_id, point_id, seq, lat, lng, accuracy_m, speed_mps, recorded_at, received_at, source)
  VALUES (@bus_id, @trip_id, @point_id, @seq, @lat, @lng, @accuracy_m, @speed_mps, @recorded_at, @received_at, @source)
`);

export const positions = Router();

positions.post("/batch", authBus, (req, res) => {
  const parsed = Batch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });

  const { trip_id, source, points } = parsed.data;
  const busId = req.busId!;
  const now = Date.now();
  const rejected: { point_id: string; reason: string }[] = [];
  let accepted = 0;
  let duplicates = 0;

  const tx = db.transaction(() => {
    for (const p of points) {
      const t = Date.parse(p.recorded_at);
      if (t < now - 24 * 3600_000) { rejected.push({ point_id: p.point_id, reason: "too_old" }); continue; }
      if (t > now + 5 * 60_000)    { rejected.push({ point_id: p.point_id, reason: "in_future" }); continue; }

      const info = insert.run({
        bus_id: busId, trip_id, point_id: p.point_id, seq: p.seq,
        lat: p.lat, lng: p.lng, accuracy_m: p.accuracy_m ?? null,
        speed_mps: p.speed_mps ?? null, recorded_at: p.recorded_at,
        received_at: new Date(now).toISOString(), source,
      });
      if (info.changes === 1) accepted++; else duplicates++;
    }
  });
  tx();

  // Push only the newest accepted point to dashboards
  const last = points[points.length - 1];
  broadcast({ type: "bus.position", bus_id: busId, lat: last.lat, lng: last.lng, recorded_at: last.recorded_at });

  res.json({ accepted, duplicates, rejected, server_time: new Date().toISOString() });
});
```

### 3.2 Schema with the unique constraint (`db/schema.sql`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;   -- safe with WAL, faster writes on flaky volumes

CREATE TABLE IF NOT EXISTS buses (
  id INTEGER PRIMARY KEY,
  bus_number TEXT UNIQUE NOT NULL,
  route_name TEXT,
  destination TEXT,
  token_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY,
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  trip_id TEXT NOT NULL,
  point_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy_m REAL,
  speed_mps REAL,
  recorded_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL,
  UNIQUE (bus_id, point_id)            -- makes retries safe
);

CREATE INDEX IF NOT EXISTS idx_positions_bus_time ON positions (bus_id, recorded_at);
```

### 3.3 Health check (`server.ts`, excerpt)

```ts
app.get("/health", (_req, res) => {
  let dbOk = true;
  try { db.prepare("SELECT 1").get(); } catch { dbOk = false; }
  res.status(dbOk ? 200 : 503).json({ ok: dbOk, time: new Date().toISOString() });
});
```

### 3.4 WebSocket heartbeat (`ws/hub.ts`)

```ts
import { WebSocketServer, WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function attachWs(server: import("http").Server) {
  const wss = new WebSocketServer({ server, path: "/ws/live" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("pong", () => ((ws as any).alive = true));
    (ws as any).alive = true;
  });

  // Heartbeat every 20 s: drop dead connections, tell live clients the server is up
  setInterval(() => {
    for (const ws of clients) {
      if ((ws as any).alive === false) { ws.terminate(); clients.delete(ws); continue; }
      (ws as any).alive = false;
      ws.ping();
      ws.send(JSON.stringify({ type: "heartbeat", t: Date.now() }));
    }
  }, 20_000);
}

export function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}
```

### 3.5 Rate limit per bus token (`utils/rateLimit.ts`)

```ts
import rateLimit from "express-rate-limit";

export const positionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,                       // 30 batches per minute per IP, at most ~1,500 points
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});
```

Apply with `app.use("/api/v1/positions", positionLimiter, positionsRouter)`. For per-bus limits, key the limiter on the bus token instead of IP.

---

## 4. Hosting

### Option A: Fly.io (recommended, Mumbai region)

`fly.toml`:
```toml
app = "bustracker-api"
primary_region = "bom"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  DB_PATH = "/data/app.db"

[mounts]
  source = "bustracker_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false      # keep the machine warm during a trip
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "10s"
    interval = "15s"
    method = "GET"
    path = "/health"
    timeout = "3s"
```

Commands:
```bash
fly launch --no-deploy
fly volumes create bustracker_data --region bom --size 1
fly secrets set TOKEN_PEPPER=$(openssl rand -hex 32)
fly deploy
```

Important: a SQLite database needs a persistent volume, and the volume must be in the same region as the machine. Keep `min_machines_running = 1` so the server never sleeps during a bus trip.

### Option B: Render (Singapore)

`render.yaml`:
```yaml
services:
  - type: web
    name: bustracker-api
    runtime: node
    region: singapore
    plan: starter
    buildCommand: npm ci && npm run build
    startCommand: node dist/server.js
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DB_PATH
        value: /var/data/app.db
    disk:
      name: data
      mountPath: /var/data
      sizeGB: 1
```

Note: Render's free instances sleep after inactivity, which breaks live tracking. Use a paid instance for the demo.

### Dockerfile (both options)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/schema.sql ./dist/db/schema.sql
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Dashboard hosting

Build as static files and host on Cloudflare Pages or Netlify (both have free tiers and CDN edges in India). The dashboard reads `VITE_API_URL` at build time, so keep it pointed at the HTTPS API URL.

---

## 5. Network Strength: What to Configure

### 5.1 TLS and proxy
- Always HTTPS. Fly and Render terminate TLS for you.
- Enable HTTP/2 (default on both platforms). It reduces overhead for frequent small requests.
- Keep-alive is on by default. Do not set `Connection: close` in the app.

### 5.2 Timeouts that match a weak network
Set these on the server so slow clients are not held open forever:
```ts
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;
server.keepAliveTimeout = 65_000;   // above the load balancer's 60 s idle timeout
```

### 5.3 Compression
Enable gzip for responses on the server, and accept gzip on requests:
```ts
import compression from "compression";
import express from "express";

app.use(compression());
app.use(express.json({ limit: "64kb" }));         // 50 points is well under 64 KB
app.use((req, _res, next) => {
  if (req.headers["content-encoding"] === "gzip") {
    // use zlib.gunzip middleware or a body parser that handles gzip
  }
  next();
});
```
Use the `body-parser` gzip support or a small `zlib.gunzipSync` middleware to read gzip request bodies.

### 5.4 Client-side settings (the Expo app)
These are the values the app should use. Put them in `src/api/config.ts`:

```ts
export const NET = {
  requestTimeoutMs: 10_000,
  batchSize: 50,
  gzipThresholdBytes: 1024,
  backoff: { baseMs: 2_000, capMs: 60_000, jitter: 0.3 },
  heartbeatTimeoutMs: 30_000,
  maxQueuedPoints: 10_000,
  uploadIntervalMs: 10_000,
};
```

### 5.5 Backoff helper (`utils/backoff.ts`)

```ts
export function nextDelay(attempt: number, base = 2000, cap = 60000, jitter = 0.3) {
  const exp = Math.min(cap, base * 2 ** attempt);
  const spread = exp * jitter;
  return Math.round(exp - spread + Math.random() * 2 * spread);
}
```

### 5.6 Sync loop sketch (`queue/sync.ts`)

```ts
export async function syncLoop(signal: AbortSignal) {
  let attempt = 0;
  while (!signal.aborted) {
    const online = await isOnline();           // from NetInfo
    if (!online) { await waitForNetwork(signal); attempt = 0; continue; }

    const batch = await db.nextUnsynced(NET.batchSize);
    if (batch.length === 0) { await sleep(NET.uploadIntervalMs, signal); continue; }

    try {
      const res = await api.postBatch(batch);  // 10 s timeout, gzip, bearer token
      await db.markSynced(batch.map(p => p.point_id));
      attempt = 0;
    } catch (err) {
      if (isFatalAuth(err)) { notifyTokenInvalid(); return; }
      if (isPayloadTooLarge(err)) { NET.batchSize = Math.max(10, NET.batchSize / 2); continue; }
      await sleep(nextDelay(attempt++, NET.backoff.baseMs, NET.backoff.capMs, NET.backoff.jitter), signal);
    }
  }
}
```

### 5.7 Reconnect behaviour
- Subscribe to NetInfo. When `isConnected` goes from false to true, reset `attempt = 0` and wake the sync loop immediately.
- Prefer Wi-Fi for bulk uploads when it's available, but do not block uploads on Wi-Fi. Use cellular if needed.

---

## 6. Environment Variables

Backend (`.env.example`):
```
PORT=3000
DB_PATH=./data/app.db
TOKEN_PEPPER=change-me-to-a-long-random-string
CORS_ORIGIN=https://your-dashboard.pages.dev
NODE_ENV=development
```

Expo app (`.env.example`):
```
EXPO_PUBLIC_API_URL=https://bustracker-api.fly.dev
EXPO_PUBLIC_DEBUG=false
```

Dashboard:
```
VITE_API_URL=https://bustracker-api.fly.dev
VITE_WS_URL=wss://bustracker-api.fly.dev/ws/live
```

---

## 7. Android Build and Distribution

```bash
# one-time
npm install -g eas-cli
eas login
eas build:configure

# development build for background location testing
eas build --profile development --platform android

# installable APK for drivers (sideload, no Play Store needed for the demo)
eas build --profile preview --platform android
```

`eas.json` (excerpt):
```json
{
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "android": { "buildType": "apk" } },
    "preview":     { "distribution": "internal", "android": { "buildType": "apk" } },
    "production":  { "android": { "buildType": "app-bundle" } }
  }
}
```

Sideloading: send the APK link to the driver's phone, enable "Install unknown apps" for the browser, and install. Background location still needs the user to grant "Allow all the time" when prompted.

---

## 8. Testing Network Resilience

Run these before the demo. Record the results.

| Test | Steps | Pass condition |
|---|---|---|
| Airplane mode | Start trip, enable airplane mode 5 min, disable | All points uploaded, zero duplicates in DB |
| Server down | Stop the Fly machine for 2 min during a trip | Queue grows, then drains once server returns |
| App killed | Swipe app from recents mid-trip | Foreground service keeps tracking, points continue |
| Phone restart | Reboot mid-trip, open app | "Resume trip?" prompt, tracking resumes |
| Slow network | Use Android developer option "network throttling" or a 2G-like profile | No crash, timeouts retry with backoff |
| Duplicate retry | Force a retry of an already accepted batch | `duplicates` count goes up, DB row count unchanged |
| Two buses | Run two simulated trips | Each bus shows separately on dashboard |

Verify DB integrity after tests:
```bash
fly ssh console -C "sqlite3 /data/app.db 'SELECT bus_id, COUNT(*), COUNT(DISTINCT point_id) FROM positions GROUP BY bus_id;'"
```
The two counts must match for every bus.

---

## 9. Monitoring

- Uptime: point UptimeRobot (free) at `https://<api>/health` every 5 minutes, with alerts to your email.
- Logs: `fly logs` during the demo. Log each batch with `bus_id`, `accepted`, `duplicates`, and `rejected` counts, but never log raw coordinates in production.
- Dashboard: show a "Last server update" timestamp in the footer so judges can see freshness.

---

## 10. Pre-Demo Checklist

- [ ] Backend deployed in bom (Fly) or Singapore (Render), `min_machines_running = 1`
- [ ] `/health` returns 200 from a phone on mobile data, not only on Wi-Fi
- [ ] HTTPS only, CORS set to the dashboard origin
- [ ] Persistent volume attached and survives a redeploy (test by redeploying once)
- [ ] Development APK installed on two Android phones of different brands
- [ ] Battery optimization exemption granted on each phone
- [ ] Simulator replay tested for BUS 01 and BUS 02
- [ ] Airplane-mode test passed with zero duplicates
- [ ] Backup: recorded screen video of a full successful trip in case the live demo fails
