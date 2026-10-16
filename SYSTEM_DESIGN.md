# College / Campus Bus Tracker — System Design & Operations Manual

> Single-file reference: architecture, repo structure, user guides (Student / Driver / Admin),
> manual run, map source, hosting (DB / Auth / Notifications), web deployment, IoT extension plan.
> Generated 2026-10-15 from source inspection of this repo.

---

## 1. What this project is

**Campus Bus Tracker** is a live college shuttle tracking system with **no hardware on the bus**.
A driver's phone shares GPS while on duty; students see buses on a live map; an admin manages
buses, drivers, routes and manual map pins.

* Frontend: **Expo Router (React Native + Web)** — one codebase for Android / iOS / Web
  (`artifacts/campus-bus-tracker`).
* Backend: **Express 5 API** (`artifacts/api-server`), base path `/api`.
* Contract: **OpenAPI 3.1** (`lib/api-spec/openapi.yaml`) → codegen clients
  (`lib/api-client-react` = TanStack Query hooks, `lib/api-zod` = Zod schemas).
* DB: **PostgreSQL + Drizzle ORM** (`lib/db`), 4 tables.
* Auth: **Clerk** (`@clerk/expo` on client, `@clerk/express` on server).
* Maps: **OpenStreetMap raster tiles** — `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
  No Google Maps / Mapbox key. See §6.
* Realtime: **HTTP polling** (`refetchInterval` 5s/10s), **no WebSocket, no push notifications**
  in current code. See §7.

---

## 2. System architecture

```
┌──────────────┐      HTTPS /api (JSON + Clerk JWT)      ┌──────────────┐
│ Expo App     │ ──────────────────────────────────────▶ │ Express API  │
│ (Student /   │ ◀────────────────────────────────────── │ :5000 dev /  │
│  Driver /    │  polling: GET /campus every 5s          │  :8080 prod  │
│  Admin UI)   │                                         └──────┬───────┘
│  + OSM tiles │                                                 │ Drizzle (pg Pool)
└──────┬───────┘                                                 ▼
       │                                                 ┌──────────────┐
       │ OSM tiles (GET, no key)                         │ PostgreSQL   │
       └───────────────────────────────────────────────▶ │ buses,       │
                    tile.openstreetmap.org               │ app_users,   │
                                                         │ bus_locations│
       ┌──────────────┐                                  │ bus_remarks  │
       │ Clerk Cloud  │◀── auth (both app + API) ─────────└──────────────┘
       │ (hosted SaaS)│
       └──────────────┘
```

### 2.1 Request flow

1. User signs in/up in app (`app/sign-in.tsx`, `app/sign-up.tsx`) via **Clerk**.
2. Client calls `GET /api/me` → server (`middlewares/currentUser.ts`) resolves Clerk user →
   links `app_users` by `clerk_id`/`email`. **First-ever user becomes `admin`**, everyone else
   defaults to `student`. Admin promotes others to `driver` by creating driver records.
3. Role-based UI from `app/(tabs)/index.tsx`:
   `profile.role === 'admin'` → `AdminDashboard`, `'driver'` → `DriverDashboard`, else `StudentDashboard`.
4. Driver toggles **On duty** → `POST /api/driver/shift` → `expo-location.watchPositionAsync`
   (High accuracy, 5s / 10m) → `POST /api/driver/location` (upsert `bus_locations`) →
   Students poll `GET /api/campus` and render `BusMap`.
5. Driver remark → `POST /api/driver/remark` → stored in `bus_remarks`, latest one joined
   into campus snapshot and shown as "Driver note".

### 2.2 API surface (source: `lib/api-spec/openapi.yaml`)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/api/healthz` | public | health check |
| GET | `/api/me` | auth | current profile + role + assigned bus |
| GET | `/api/campus` | auth | `CampusResponse { collegeName, buses[] }` — buses + latest location + latest remark |
| POST | `/api/driver/location` | driver, onDuty, assigned bus | upsert GPS `{lat, lon, heading?, speed?, accuracy?}` |
| POST | `/api/driver/remark` | driver | `{text ≤180, place ≤100}` campus parking note |
| POST | `/api/driver/shift` | driver | `{onDuty: bool}` |
| GET | `/api/admin/overview` | admin | `{totalBuses, activeBuses, busesSharingLocation, totalDrivers, driversOnDuty}`; "fresh" = `recordedAt > now() - 2 min` |
| GET/POST | `/api/admin/buses` | admin | list / create `{busNumber, routeName, routeStops[], capacity}` |
| PATCH/DELETE | `/api/admin/buses/{id}` | admin | update / remove bus (cascade deletes locations + remarks) |
| PUT/DELETE | `/api/admin/buses/{id}/location` | admin | manual map pin set / clear (driver GPS overwrites it later) |
| GET/POST | `/api/admin/drivers` | admin | list / invite `{name, email, busId?}` |
| PATCH/DELETE | `/api/admin/drivers/{id}` | admin | reassign / remove driver |

Auth errors: `401` not signed in, `403` wrong role, `404` unknown id.

### 2.3 Frontend polling (not sockets)

`app/(tabs)/index.tsx`:

* `useGetCampus(..., { refetchInterval: 5000 })`
* `useGetAdminOverview`, `useListAdminBuses` → 5s; `useListDrivers` → 10s
* Freshness for UI badge: `Date.now() - recordedAt < 90_000` → `● LIVE` else `NOT SHARING`.
* Server "sharing" count uses stricter 2-minute window.

No `socket.io`, `ws`, SSE, FCM/APNs code exists today.

---

## 3. Repository structure

```
College-Bus-Tracker/                  # repo root (pnpm workspace, Node 22+, TS 5.9)
├── package.json                      # workspace root: build/typecheck scripts
├── pnpm-workspace.yaml / pnpm-lock.yaml / .npmrc
├── tsconfig.base.json / tsconfig.json
├── scripts/                          # workspace scripts
├── lib/                              # shared packages
│   ├── api-spec/openapi.yaml         # ★ source of truth: API contract
│   │   ├── orval.config.ts / package.json  # codegen
│   ├── api-client-react/src/         # Orval-generated TanStack Query hooks
│   │   ├── generated/api.ts / api.schemas.ts
│   │   └── custom-fetch.ts / index.ts
│   ├── api-zod/src/generated/        # Orval-generated Zod schemas
│   └── db/                           # ★ source of truth: DB schema
│       ├── drizzle.config.ts         # needs DATABASE_URL
│       └── src/schema/buses.ts       # buses, app_users, bus_locations, bus_remarks
│       └── src/index.ts              # pg Pool + drizzle(db)
├── artifacts/
│   ├── api-server/                   # Express backend
│   │   ├── src/index.ts / app.ts     # entry, Clerk + CORS + /api mount
│   │   ├── src/routes/               # health, campus, driver, admin, transport-data, index
│   │   ├── src/middlewares/          # currentUser (requireUser/requireRole), clerkProxyMiddleware
│   │   ├── build.mjs / package.json  # esbuild bundle → dist/index.mjs
│   ├── campus-bus-tracker/           # ★ Expo app (Student+Driver+Admin in one app)
│   │   ├── app/_layout.tsx           # ClerkProvider + QueryClient + Expo Router
│   │   ├── app/sign-in.tsx / sign-up.tsx / +not-found.tsx
│   │   ├── app/(tabs)/_layout.tsx / (tabs)/index.tsx  # ★ all 3 dashboards (~814 lines)
│   │   ├── components/BusMap.tsx / BusMap.native.tsx / BusMap.web.tsx
│   │   ├── hooks/useColors.ts / constants/colors.ts
│   │   ├── app.json / package.json / metro.config.js
│   │   ├── scripts/build.js          # Expo static export → static-build/
│   │   ├── server/serve.js           # zero-dep Node static server (prod web)
│   └── mockup-sandbox/               # Vite + shadcn UI preview host (no maps, no app logic)
└── SYSTEM_DESIGN.md                  # this file
```

Key source-of-truth files:

* DB schema → `lib/db/src/schema/buses.ts`
* API contract → `lib/api-spec/openapi.yaml`
* Role routing → `artifacts/campus-bus-tracker/app/(tabs)/index.tsx:52-82`
* GPS sharing → same file, `DriverDashboard` lines ~285-303
* Admin CRUD → same file, `AdminDashboard` lines ~383-618

---

## 4. Database design (PostgreSQL, Drizzle)

Connection: `process.env.DATABASE_URL` → `pg.Pool` → `drizzle(pool)` (`lib/db/src/index.ts`,
`drizzle.config.ts`). Bring your own Postgres (managed or local); no host is hardcoded.
Migrations: `pnpm --filter @workspace/db run push` (dev only).

```sql
-- buses: one row per physical bus
buses(id SERIAL PK, bus_number TEXT UNIQUE NOT NULL, route_name TEXT NOT NULL,
      route_stops JSONB DEFAULT '[]', capacity INT DEFAULT 40,
      active BOOL DEFAULT true, created_at TIMESTAMPTZ DEFAULT now());

-- app_users: Clerk-linked accounts; role drives the whole UI
app_users(id SERIAL PK, clerk_id TEXT UNIQUE, email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL, role TEXT DEFAULT 'student', -- student|driver|admin
          assigned_bus_id INT REFERENCES buses(id) ON DELETE SET NULL,
          on_duty BOOL DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
-- partial unique index guarantees max 1 admin: app_users_single_admin_idx WHERE role='admin'
-- NOTE: this means multi-admin colleges need a schema change (see §11).

-- bus_locations: exactly one latest pin per bus (bus_id UNIQUE), overwritten each update
bus_locations(id SERIAL PK, bus_id INT UNIQUE NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
              latitude DOUBLE NOT NULL, longitude DOUBLE NOT NULL,
              heading DOUBLE, speed DOUBLE, accuracy DOUBLE,
              recorded_at TIMESTAMPTZ DEFAULT now());

-- bus_remarks: append-only driver notes; latest per bus shown to students
bus_remarks(id SERIAL PK, bus_id INT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
            driver_id INT REFERENCES app_users(id) ON DELETE SET NULL,
            driver_name TEXT NOT NULL, text TEXT NOT NULL, place TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now());
```

ER: `buses 1—0..1 bus_locations`, `buses 1—n bus_remarks`, `buses 1—n app_users(drivers)`,
`app_users 1—n bus_remarks`.

Snapshot query (`routes/transport-data.ts: loadBusSnapshot()`): left-join buses → drivers →
locations → latest remark (`ORDER BY createdAt DESC LIMIT 1` per bus).

---

## 5. How to use — role guides

All roles use the **same app**; the home screen switches after `GET /me`.

### 5.1 Student — "Find your bus"

1. Open app/web → **Create a college account** (college email) or **Sign in**.
2. Home = **Find your bus / CAMPUS SHUTTLE**.
3. Banner shows `N buses live now` (onDuty + fresh <90s).
4. **Live map**: select bus card → map centers, `● LIVE` or `NOT SHARING`, driver note
   card (`DRIVER NOTE · place`, text, driver + time).
5. **Choose a bus** horizontal cards: `Location live` / `Updated Xm ago` / `Waiting for driver`.
6. **Route stops** timeline for selected bus.
7. Pull/retry on connection error. Student view auto-refreshes every 5s — no action needed.

### 5.2 Driver — "Share my bus"

Prerequisite: admin has added you via **Drivers tab** with your exact college email + assigned bus.

1. Sign in with that email → you land on **Driver dashboard / YOUR SHIFT**.
2. Header shows `BUS <number>` + route. If `Waiting for your college admin`, stop — ask admin
   to assign a bus (toggle is disabled without one).
3. **On duty switch**:
   * Native (Android/iOS): grants foreground location → `watchPositionAsync` starts →
     posts GPS every ~5s / 10m to `POST /driver/location`. Switch off stops sharing.
   * Web: blocked by design — notice says *"Open this app on your phone to share GPS"*.
4. **Campus parking note**: `Where did you park?` + `What should students know?` →
   **Share note with students** (`POST /driver/remark`). Latest note shows to students and
   under the form as `Last note`.
5. Notices (`notice` state) surface permission / network errors inline.

### 5.3 Admin — "Run transport"

Prerequisite: **first account to ever sign in becomes admin** (single-admin constraint).

1. Sign in → **Transport admin / CAMPUS OPERATIONS**. Live fleet header
   `busesSharingLocation / activeBuses` + stat cards (Buses, Drivers, On duty).
2. Tabs:
   * **Overview → Fleet locations**: each bus `Live now` / `Updated …` / `No location yet`.
     📍 icon = **Set map pin** (decimal lat/lon form; driver GPS replaces it later);
     🗑 = **Clear location** (students lose the pin).
   * **Buses → Add/Edit**: bus number, route name, comma-separated stops, capacity.
     List rows support edit (✎) / remove (🗑, cascades history).
   * **Drivers → Add/Edit**: name + college email + bus assignment chips (or Unassigned).
     *"They can sign in with this email"* — driver role activates on next sign-in.
3. All lists poll (5–10s) so multi-admin/multi-driver changes appear without reload.

---

## 6. Map source — OpenStreetMap (not Google)

| Platform | Implementation | File |
|---|---|---|
| Android/iOS | `react-native-maps` `MapView` + `<UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19}>` + `<Marker>` per bus | `components/BusMap.native.tsx` |
| Web | Custom tile math (ZOOM 16, 256px) fetching same OSM URLs into an `<Image>`/canvas grid + HTML marker | `components/BusMap.web.tsx` |
| Selector | `BusMap.tsx` re-exports `.web`; Metro resolves `.native` on device | `components/BusMap.tsx` |

* **Provider: OpenStreetMap tile server.** Free, no API key, attribution required
  (app already renders an OSM attribution label).
* GPS input: `expo-location` (High accuracy) on device; admin manual lat/lon fallback.
* Limits: public `tile.openstreetmap.org` enforces fair-use (bulk / production-heavy use
  should self-host or use a paid tile provider — same `UrlTile` template swaps in).
* No offline tiles, no routing/ETA engine, no geofencing today (see IoT/future §10).

---

## 7. Hosting — where DB, notifications, and everything else live

| Concern | Current implementation | Hosted on |
|---|---|---|
| **Postgres DB** | `DATABASE_URL` + `pg` Pool + Drizzle; `drizzle-kit push` | **Managed Postgres** (Supabase / Neon / RDS / self-hosted) — only `DATABASE_URL` changes |
| **Auth + sessions** | Clerk (`@clerk/expo` + `@clerk/express`, proxy `/api/__clerk` via `clerkProxyMiddleware`) | **Clerk Cloud (SaaS)** — keys via `CLERK_PUBLISHABLE_KEY` / `EXPO_PUBLIC_CLERK_*` |
| **API server** | Express, `cors`, `pino`, esbuild bundle | **Any Node host** (VPS, Render, Railway, Fly.io); locally `localhost:5000` |
| **Web + mobile bundle** | Expo static export (`scripts/build.js` → `static-build/`) served by `server/serve.js` (plain Node `http`, no deps) | **Any static host** (Vercel, Netlify, Nginx) + `node server/serve.js`; locally Metro/Expo dev server |
| **Maps tiles** | OSM raster over HTTPS | **OpenStreetMap public tile servers** (third-party, keyless) |
| **Notifications (push/SMS/email)** | **None implemented** — no `expo-notifications`, no FCM/APNs, no `expo-server-sdk`, no email/SMS lib; in-app only via polling + driver-note cards + `notice` text | — (add per §10 if needed) |
| **Realtime channel** | **Polling only** (TanStack Query intervals) | Same API server; no WS/SSE infra |
| **File uploads / storage** | None (no bus photos, no CDN) | — |
| **Logs** | `pino` + `pino-http` (pretty in dev) | stdout (host logs / terminal) |

Required env (see `.env.example`; never commit real values):

```
DATABASE_URL=postgres://...            # Postgres connection string
CLERK_PUBLISHABLE_KEY=pk_...           # server
CLERK_SECRET_KEY=sk_...                # server (via Clerk dashboard)
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...  # client
PORT=5000                              # api-server
BASE_PATH=/campus-bus-tracker          # web prod sub-path (if served under one)
```

---

## 8. Start the project manually (local)

Prereqs: **Node 22+, pnpm 9+, Postgres 14+, Clerk account** (publishable + secret key),
**Expo Go** app on phone (for driver GPS; web cannot share location).

```powershell
# 0) one-time: install pnpm + clone deps (Windows PowerShell shown; same on macOS/Linux with sh)
corepack enable; corepack prepare pnpm@latest --activate
cd College-Bus-Tracker
pnpm install

# 1) env — create .env where needed (never commit)
# lib/db + artifacts/api-server need:
$env:DATABASE_URL="postgres://user:pass@localhost:5432/bus_tracker"
$env:CLERK_PUBLISHABLE_KEY="pk_test_..."
$env:CLERK_SECRET_KEY="sk_test_..."
$env:PORT="5000"

# 2) database schema (dev)
pnpm --filter @workspace/db run push

# 3) regenerate API clients after editing openapi.yaml (optional)
pnpm --filter @workspace/api-spec run codegen

# 4) start backend (terminal 1) — serves on http://localhost:5000, api at /api/*
pnpm --filter @workspace/api-server run build
node artifacts/api-server/dist/index.mjs

# 5) start app (terminal 2) — Expo dev server; scan QR with Expo Go, or press `w` for web
pnpm --filter @workspace/campus-bus-tracker run dev
# web only:
#   pnpm --filter @workspace/campus-bus-tracker run dev:web

# 6) typecheck / build
pnpm run typecheck
pnpm run build
```

First-run bootstrap: open the app, **sign up the admin account first** (it auto-becomes admin),
then as admin add buses + drivers before students sign in. Driver GPS requires a real phone
with location permission; admin manual pins work from web.

Common gotchas:

* Wrong package manager → root `preinstall` aborts unless pnpm is used.
* Missing `DATABASE_URL` → `drizzle.config.ts` / `lib/db/src/index.ts` throw on boot.
* Driver toggle does nothing on web — by design; use a phone.
* Single-admin unique index blocks a second admin — change schema if multi-admin needed.
* OSM tiles need internet; offline dev shows empty map frame.

---

## 9. Deployment

* **API** (any Node host — Render, Railway, Fly.io, VPS):
  `pnpm --filter @workspace/api-server run build` → `node artifacts/api-server/dist/index.mjs`
  with `DATABASE_URL, CLERK_*, PORT, NODE_ENV=production` behind HTTPS; point app's
  `custom-fetch.ts` base URL at it.
* **Web frontend** (Vercel, Netlify, Nginx):
  `pnpm --filter @workspace/campus-bus-tracker run build` → deploy `static-build/` +
  run `node server/serve.js` with `PORT + BASE_PATH` (or any static host; keep sub-path
  routing consistent with API CORS).
* **DB**: managed Postgres (Neon / Supabase / RDS / self-hosted) — only `DATABASE_URL` changes.
* **Native apps**: `eas build` (no `eas.json` exists yet — run `eas init`) for Play Store / App Store;
  OTA via `eas update`.
* Checklist: HTTPS everywhere (Clerk + geolocation require secure context), CORS `origin`
  locked down (currently `origin: true` = reflect — tighten in prod), OSM usage policy
  or self-hosted tiles, `single admin` decision, backups for Postgres.

---

## 10. IoT extension — put a GPS device on the bus

Today GPS comes from the driver's phone. Adding a dedicated tracker removes phone dependence,
works if the driver forgets the app, and enables engine/door/fuel telemetry.

### 10.1 Recommended hardware (cheap, proven)

| Option | BOM | Pros | Cons |
|---|---|---|---|
| **A: ESP32 + NEO-6M GPS + SIM800L/4G (e.g. SIM7600)** | ~₹2,500–4,500 / bus | cheapest, full control, deep-sleep | needs wiring + SIM data plan |
| **B: Teltonika / Concox / Queclink OBD tracker** | ~₹5,000–9,000 / bus | rugged, vendor cloud + backup | pricier, less hackable |
| **C: Android burner phone, locked to app** | ~₹6,000 | zero firmware work | theft-prone, battery care |

Pick **A** for a college project; **B** for production fleet.

### 10.2 Architecture (minimal change to backend)

```
[GPS device] --MQTT/HTTPS (every 5-10s)--> [ingest: same Express API, new route]
        {deviceId, lat, lon, speed, heading, ignition}   |
        + HMAC/API-key auth                              v
                                              bus_locations (upsert by bus_id)
                                              + bus_telemetry (new table, history)
                                                         |
                                              existing GET /campus polling unchanged
```

* Map `deviceId → bus_id` via new `devices` table (admin pairs once, QR code on device).
* Keep phone GPS as fallback; **device wins** when both fresh (server picks `max(recordedAt)`).
* No app change needed for students — map keeps polling `GET /campus`.

### 10.3 Backend changes (concrete)

1. New tables in `lib/db/src/schema/buses.ts`:
   `devices(id, device_key_hash, bus_id UNIQUE, name, last_seen_at)`,
   `bus_telemetry(id, bus_id, lat, lon, speed, heading, ignition, fuel?, recorded_at)` (history, indexed).
2. New route `POST /api/ingest/location` (separate from Clerk auth — use per-device API key
   in `Authorization: Device <key>` + allowlist + rate-limit ~1 req/3s/device). Validate with
   existing `LocationInput` Zod schema + `busId` lookup.
3. Reuse upsert into `bus_locations` so student/admin UI works untouched; insert history row
   into `bus_telemetry` (retention job: delete >90 days).
4. Extend `GET /api/admin/overview` with `devicesOnline` count; add `Devices` section to
   `AdminDashboard` (pair/unpair, last-seen).
5. Regenerate clients: edit `openapi.yaml` → `pnpm --filter @workspace/api-spec run codegen`.

### 10.4 Firmware sketch (ESP32 + Arduino)

```cpp
// every 10s: read GPS, POST JSON to https://api.yourcollege.edu/api/ingest/location
// headers: Authorization: Device <DEVICE_KEY>, Content-Type: application/json
// body: {"latitude":19.0760,"longitude":72.8777,"speed":8.3,"heading":90.0,"ignition":true}
#include <TinyGPS++.h>
#include <HTTPClient.h>
// ... GPS on Serial2, modem via PPP; deep-sleep between fixes to save power.
```

Prefer **MQTT** (HiveMQ/Mosquitto on server) over HTTPS if >20 buses — lower battery/data;
bridge MQTT → Express ingest internally.

### 10.5 Notifications to add with IoT (currently missing)

* `expo-notifications` + `expo-server-sdk` (server) for: "Bus 43 entering campus",
  "Bus delayed >10 min", driver SOS button.
* Geofence check in ingest (Haversine vs campus polygon) → push via Expo Push Tickets.
* SMS fallback (Twilio/MSG91) for non-app parents; email digests via Resend.

### 10.6 Cost/ops notes

* Data: 1 fix/10s JSON ≈ 150 bytes → ~35 MB/bus/month — cheapest M2M SIM suffices.
* Power: hardwire to 12/24V via buck converter + backup Li-ion; fuse the tap.
* Security: per-device keys (rotate from admin UI), TLS only, no Clerk tokens on devices.

---

## 11. Gaps, risks & suggested fixes

1. **Single-admin lock** (`app_users_single_admin_idx`) — blocks multi-admin colleges.
   Fix: drop partial unique index, add `admin` role freely or RBAC table.
2. **Polling cost** — every client hits `/campus` every 5s. Fine <500 users; beyond that add
   ETag/`If-Modified-Since`, SSE, or WS fan-out.
3. **No push/SMS** — breakdown/delay alerts are manual remarks only. Add §10.5.
4. **CORS `origin: true`** reflects any origin — restrict to app domains in prod.
5. **OSM fair-use** — self-host tiles or vendor (MapTiler/Stadia) before scaling; keep attribution.
6. **No telemetry history** — `bus_locations` keeps one row; add `bus_telemetry` for routes/analytics.
7. **No tests** — no unit/e2e found; add Vitest (API) + Maestro/Detox (Expo) before prod.
8. **`mockup-sandbox`** is a shadcn preview host, not shipped — safe to ignore in deploy.

---

## 12. Quick command cheat-sheet

```bash
pnpm install                                        # install all workspaces
pnpm --filter @workspace/db run push                # push Drizzle schema (needs DATABASE_URL)
pnpm --filter @workspace/api-server run build      # build API
node artifacts/api-server/dist/index.mjs            # API :5000 (needs DATABASE_URL, CLERK_*, PORT)
pnpm --filter @workspace/campus-bus-tracker run dev # Expo dev (QR + web)
pnpm --filter @workspace/api-spec run codegen       # regen clients from openapi.yaml
pnpm run typecheck                                   # full TS check
pnpm run build                                      # typecheck + build all
```

---

*End of SYSTEM_DESIGN.md — one file covering design, structure, role guides, manual start,
map source (OpenStreetMap), hosting (managed Postgres + Clerk Cloud + any Node host, no
notification server today), web deployment, and IoT plan.*
