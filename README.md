# BUSYATRI — College Bus Tracker (Brutalist Edition)

Live GPS for college buses. Driver's Android phone streams position → backend → brutalist dashboard.

```
[Driver app: Expo, SQLite queue, batch upload, backoff]
   | HTTPS gzip, 10s timeout, Bearer bus token
   v
[Backend: Node/Express + SQLite/Postgres, idempotent batches, WS hub]  (Fly bom / Render Singapore)
   | WebSocket bus.position + heartbeat/20s
   v
[Dashboard: static brutalist HTML + Leaflet/OSM]
```

## How users see the bus in real time

**Who:** students (and anyone with the link). No login, no app install — the
dashboard is a read-only web page. Drivers use the Android app; admins use the
same dashboard plus the ADD BUS form.

**What the user opens**

| Environment | URL the user opens |
|---|---|
| Local demo | `http://localhost:3000` (backend serves the dashboard itself) |
| Production | `https://<your-dashboard>.pages.dev` (static hosting, points at the API) |

The page auto-detects the backend: same-origin when served by the API,
`http(s)://<same-host>:3000` for static previews, `http://localhost:3000` for
`file://`. To override, press **⚙ API** and set the API + WS URLs (saved in
the browser).

**How "live" actually travels (every hop is real, push-driven)**

1. Driver taps **START TRIP** → phone records GPS every **10 s** into an
   on-device queue. The sync loop polls the queue every **2 s**, so each fix
   leaves the phone almost immediately (works through tunnels/signal drops —
   missed points drain in bulk on reconnect, duplicates impossible by design).
2. Backend accepts the batch and — only for genuinely **new** movement —
   pushes an enriched `bus.position` event (`bus_number`, route, speed, `seq`)
   over `/ws/live`, plus a `heartbeat` every 20 s. Pure-duplicate retries
   broadcast nothing: no phantom marker flapping.
3. The dashboard patches the marker and card **in place** the instant the
   event arrives (no refetch-per-ping); a 10 s REST poll reconciles anything
   the socket missed.
4. Admin adds a bus → server pushes `bus.created` + `routes.updated` → every
   open dashboard toasts it, spotlights the card with a blinking **NEW** badge
   (60 s), and draws the new route polyline. Zero refresh needed on anyone's
   screen.

**How the user knows it's fresh (not a stale screenshot)**

- Status chip per bus: **MOVING** (lime) / **STOPPED** (yellow) / **OFFLINE** (red, no point in 60 s).
- `UPDATED: 12s AGO` under each bus + speed in km/h.
- Footer `LAST SERVER UPDATE: <time>` and the top-right pill: **● ONLINE** vs **● OFFLINE**.
- Click a bus → map centers on it and draws its trip trail. **HISTORY** shows past trips. **FIT ALL** frames fleet + routes.

**Checklist before sharing the link** — backend up (`/health` → 200),
dashboard reachable, at least one bus on an active trip (driver app, or
`simulator/` replay for judging without phones).

**If a user reports a problem**

| They see | It means | Fix |
|---|---|---|
| Bus card OFFLINE / `UPDATED: 5m AGO` | no GPS for 60 s+ (trip not started, tunnel, dead battery) | driver starts trip / waits for signal; queue uploads on reconnect |
| `API UNREACHABLE @ …` + ● OFFLINE | dashboard can't reach backend | check URL, backend running, ⚙ API setting |
| `NO BUSES IN FLEET` | empty database | `npm run seed` in backend, or ADD BUS form |
| Marker jumps after reconnect | queued points arriving in bulk | normal — offline queue draining, zero duplicates by design |

## Ports & access — users, drivers, admin

One backend port serves **everything**: REST API + WebSocket (`/ws/live`) +
dashboard. No extra ports, ever — the dashboard derives its WS URL from the
API URL, so opening that single port opens the whole system.

| Role | What they open | Port needed | Direction |
|---|---|---|---|
| **Student (user)** | dashboard link in any browser. No login, no install | `443` (prod) / `3000` (local) | outbound to server |
| **Driver** | Android app (API URL baked in at build time) | `443` / `3000` outbound | phone → server |
| **Admin** | same dashboard + ADD BUS form + `X-ADMIN-KEY` | same as student | outbound to server |

Only the **server machine** ever opens an inbound port. Phones and laptops
just need outbound internet/Wi-Fi to it.

### Option A — shareable HTTPS tunnel (recommended for demos)

One command, no firewall rules, works even on college Wi-Fi with client
isolation (where phones can't see your laptop directly):

```bash
cloudflared tunnel --url http://localhost:3000
# → https://random-name.trycloudflare.com
```

- **Students:** open the `https://…` URL. Done.
- **Drivers:** set `EXPO_PUBLIC_API_URL=https://…` in `driver-app/.env`,
  restart the dev client (`npx expo start --dev-client`) — Expo bakes
  `EXPO_PUBLIC_*` vars in at build time, so the URL is fixed per build.
  For a road test, `eas build --profile preview` an APK with the tunnel
  (or final prod) URL baked in.
- **Admin:** same URL + the `ADMIN_KEY` in the ADD BUS form.
- WS rides the same tunnel (`wss://…/ws/live`), auto-derived — nothing else
  to configure. (`ngrok http 3000` works identically.)

### Option B — same Wi-Fi LAN (no internet needed)

1. The backend already binds `0.0.0.0:3000` (see `src/server.ts`), so it
   accepts LAN connections out of the box.
2. Allow it through Windows Firewall (admin PowerShell, once):
   ```powershell
   New-NetFirewallRule -DisplayName "BusYatri API" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```
3. Find this PC's IPv4 (`ipconfig` → `192.168.x.x`) and share
   `http://192.168.x.x:3000`. Phones, laptops, admin — same link. The
   dashboard auto-points API + WS at that host.
4. Caveats: Android **blocks cleartext `http://` by default**. For LAN demos
   either use Option A (https) or allow cleartext in `driver-app/app.json`
   via the `expo-build-properties` plugin:
   ```json
   ["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
   ```
   then rebuild the dev client. iOS is out of scope for the MVP.

### Option C — production (Fly + static hosting)

No ports to open — the platform terminates TLS on `443`:

- API: `fly deploy` (`fly.toml` already maps `internal_port 3000`, health
  check on `/health`, persistent volume, `min_machines_running = 1`).
  Set secrets: `TOKEN_PEPPER`, `ADMIN_KEY` (never the dev defaults).
- Dashboard: deploy `dashboard/` to Cloudflare Pages/Netlify, set its API
  URL to `https://bustracker-api.fly.dev`, and set backend
  `CORS_ORIGIN=https://<your-dashboard>.pages.dev` (not `*`).
- Drivers install the preview APK with `EXPO_PUBLIC_API_URL` pointing at
  the Fly URL; students/admins use the Pages URL.

### Pre-share checklist

- [ ] `GET <api>/health` returns 200 **from the phone's network** (mobile
      data / college Wi-Fi — not just your laptop).
- [ ] Driver app's baked-in URL matches the URL you're sharing (wrong build
      = silent failure; re-check `EXPO_PUBLIC_API_URL`).
- [ ] Admin key changed from `admin-dev-key` anywhere public.
- [ ] At least one bus on an active trip (or `simulator/` running) so the
      first visitor sees movement, not an empty fleet.

### If someone can't connect

| Symptom | Likely cause | Fix |
|---|---|---|
| Phone browser spins on `http://192.168…:3000` | firewall / client isolation / wrong IP | re-run `ipconfig`, check firewall rule, or switch to Option A tunnel |
| Driver app never syncs (stuck queued) | baked-in URL points elsewhere / cleartext blocked | rebuild with correct `EXPO_PUBLIC_API_URL`; https or cleartext flag |
| Dashboard ● OFFLINE but API works in curl | WS blocked by proxy | page still live-updates via 10 s REST poll; prefer https tunnel |
| Admin form `401 admin_only` | wrong `X-ADMIN-KEY` | match backend `ADMIN_KEY` (default `admin-dev-key` in dev) |

## Driver onboarding via QR (no typing)

Drivers never type tokens. The admin prints a QR per bus; the driver scans it
inside the app and lands signed in with bus, route, and server URL all set.

**Admin (dashboard):**
1. ADD BUS form → CREATE → **▣ SHOW QR FOR THIS TOKEN**. Print it (button in
   the QR modal) and stick it in the bus / depot register.
2. Already have a bus? Its card → **QR** → reissues a fresh token + QR
   (old token dies — driver re-scans; use when a printout leaks).

**Driver (Android app):**
1. Install the APK, open the app → **▣ SCAN BUS QR →**.
2. Allow camera once, hold the printout in the frame. The app verifies the
   token live (`/me`), saves bus + route + **server URL from the QR**, and
   jumps to permissions → START TRIP. Full features unlocked, nothing typed.
3. No camera / torn printout? Login screen → type bus + token manually.

**How it works:** QR payload is `{"v":1,"api":"https://…","bus":"BUS 01",
"token":"bt_…"}` — validated strictly (bad version/address/missing token =
plain-language error + retry). The embedded `api` overrides the baked-in
`EXPO_PUBLIC_API_URL` for *everything* (login, uploads, trip-end), so tunnel
URLs can change without rebuilding the app. A QR is a bearer credential:
treat printouts like passwords, reissue on leak.

## Quickstart (5 min demo, no phones)

```bash
# 1. backend (serves API + dashboard on one origin :3000)
cd backend
npm install
npm run dev        # :3000  →  / = dashboard, /api = API index
# new shell:
npm run seed       # prints BUS 01/02/03 tokens — COPY THEM

# 2. dashboard = http://localhost:3000 (served by backend, same origin —
#    no CORS, no separate hosting needed locally). Or open dashboard/
#    statically and point ⚙ API at the backend URL.

# 3. simulator (drives a bus along Amritsar → Campus through the real API)
cd ../simulator
TOKEN=bt_paste_from_seed API=http://localhost:3000 node replay.js
# dashboard → BUS marker moves within seconds, trail on click
```

## Repo layout

```
backend/     Express API + WS + SQLite (WAL, UNIQUE bus_id+point_id)
             …or Supabase Postgres when DATABASE_URL is set (same behavior)
dashboard/   Brutalist static site (index.html/app.js/styles.css, Leaflet CDN)
driver-app/  Expo Router driver app, brutalist UI (login/scan/permissions/home/trip/summary/settings)
simulator/   Node GPS replay (no phone needed for judging)
```

## Database: local SQLite → Supabase

**Local (default):** nothing to configure — the backend stores everything in
`backend/data/app.db`. `/health` reports `"db":"sqlite"`.

**Supabase (production / shared):** the app never talks to Supabase directly
from browsers or phones — only the backend holds the connection string, so
there are no RLS/anon-key concerns. The dashboard and driver app keep calling
the same API and behave identically on either store.

1. Create a project at supabase.com (free tier is plenty).
2. SQL editor → paste `backend/src/db/schema.pg.sql` → Run (once).
3. Connect → Transaction pooling → copy the `postgresql://…:6543/postgres` URL.
4. Backend env: `DATABASE_URL=<that-url>` (+ real `TOKEN_PEPPER`, `ADMIN_KEY`).
   On Fly: `fly secrets set DATABASE_URL=… TOKEN_PEPPER=… ADMIN_KEY=…`
5. `npm run seed` (creates the 3 AGC routes + BUS 01–03 and prints tokens).
6. Check `/health` → `"db":"supabase/postgres"`, then run the airplane-mode
   test once to confirm idempotent retries against Postgres.

Notes: batch ingestion uses one `INSERT … ON CONFLICT DO NOTHING` per batch
(plus `RETURNING`), so duplicate-safe semantics match SQLite exactly. Keep
Supabase and the API in nearby regions (Mumbai/Singapore ↔ ap-south-1 /
ap-southeast-1) to protect the 15 s phone→screen budget.

## API

- `POST /api/v1/positions/batch` — `Authorization: Bearer <bus_token>`, max 50 pts, idempotent (`INSERT OR IGNORE`)
- `GET /api/v1/buses` — bus + last position + Moving/Stopped/Offline
- `GET /api/v1/buses/me` — driver login verification (Bearer bus token → assigned bus profile)
- `GET /api/v1/routes` — seeded route polylines drawn on the dashboard map
- `GET /api/v1/buses/:id/trail?since=` — polyline for active trip
- `GET /api/v1/buses/:id/trips` — trip history
- `WS /ws/live` — `bus.position`, `bus.status`, `trip.end`, `routes.updated`, `heartbeat`
- `GET /health` — `{ ok, time, ws_clients }`
- `/` — serves the dashboard frontend (same origin); `/api` — API index
- `POST /api/v1/buses` (admin) — creates bus + token **and syncs the route**:
  new `route_name` creates the route row, an existing one is linked
  (`route_id`) — so the map polyline and ticker update automatically.
  Matching is tolerant (`-`, `→`, case, spacing all resolve to one route),
  an omitted `polyline` never wipes a stored one, and every change broadcasts
  `routes.updated` so all open dashboards redraw without refresh.

No mocks anywhere in product code: driver login is verified live via `/me`,
routes/buses/trails/history all come from the API, and the dashboard renders
empty states when the fleet is empty. (`simulator/` is a test tool required by
PRD §12 for judging without a phone — it sends real batches through the real API.)

## Brutalism rules used

Thick 3px black borders, hard 6px shadows, zero border-radius, Archivo-Black headers,
mono body, yellow `#FFDE00` + pink `#FF4D8D` + lime `#00E676` on paper `#F4F1EA`,
marquee ticker, uppercase everything. Same tokens in dashboard CSS and driver-app `src/ui/theme.ts`.

## Network resilience (tested)

Airplane-mode 5 min → queue drains, 0 duplicates · server down 2 min → backoff retries ·
app killed → foreground service survives · reboot → "Resume trip?" · 2 buses → separate trails.
See `DEPLOYMENT.md` §8 for the table.
