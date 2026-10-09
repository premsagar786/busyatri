# BUSYATRI — Judges' Brief

**One line:** every college bus, live on one brutalist dashboard — tracked by the
driver's Android phone, with zero lost points on dead networks.

**College:** Amritsar Group of Colleges (AGC), 12 Km Stone, NH-3 GT Road, Meharbanpur.
**Routes live today:** Amritsar → AGC Campus (13.1 km) · Beas → AGC Campus (33.8 km) ·
Jalandhar → AGC Campus (70.7 km) — all drawn as true road geometry (OSRM over
OpenStreetMap), ending at the AGC gate (31.6040, 74.9756).

---

## 1. The problem

Buses run Amritsar → Campus, Beas → Campus, Jalandhar → Campus daily. Students
and admins cannot see where a bus is, when it will arrive, or whether it left
at all. The current system is phone calls and guesses.

## 2. The solution (3 parts, all built and running)

| # | Part | What it is | Status |
|---|---|---|---|
| 1 | **Driver app** (Expo, Android-first) | Bus login via QR scan or token, START/END TRIP, background GPS every 10 s with foreground-service notification, offline SQLite queue, batch upload with backoff | Built, runs on Metro; needs EAS APK + phone for road test |
| 2 | **Backend** (Node + Express + WebSocket) | Idempotent batch ingestion, live push hub, fleet/trail/trip APIs, admin bus+route management | Live on Supabase Postgres |
| 3 | **Dashboard** (static, brutalist) | Leaflet/OSM map, fleet cards, trip trails + history, per-bus QR printing, admin panel | Live, served by the backend |

## 3. How "live" actually travels (the demo backbone)

```
DRIVER PHONE (GPS fix every 10 s)
  → on-device SQLite queue (never lose a point)
  → batch upload, ≤50 pts, gzip, 10 s timeout, Bearer bus token
  → BACKEND accepts, dedupes (UNIQUE bus_id+point_id), broadcasts bus.position
  → DASHBOARD patches marker + card in place over WebSocket (<1 s)
  → 10 s REST poll reconciles anything the socket missed
```

Phone → screen in ~15 s on 4G. Pure-duplicate retries broadcast nothing, so
markers never flap. A bus silent for 60 s flips to OFFLINE automatically.

## 4. User journeys (what judges can click right now)

**Student (no login, no install):** opens the dashboard link → sees every bus
as MOVING / STOPPED / OFFLINE with `UPDATED: Xs AGO` + speed → clicks a bus →
map centers, yellow trail draws over the pink route line → HISTORY shows past
trips. The `NEW` badge spotlights buses added mid-session; the ticker and
`LAST SERVER UPDATE` footer prove freshness.

**Driver:** installs APK → **SCAN BUS QR** (camera, one tap) → token verified
live, bus + route + server URL saved → permissions explainer → START TRIP →
status chip (ONLINE / SYNCING N / OFFLINE+N queued), speed, last sync. Kills
the app? Foreground service keeps tracking. Reboots? "Resume trip?" on launch.

**Admin:** same dashboard → ADD BUS (name + route + optional road polyline) →
token issued once + printable QR. New route names **create** the route (map +
ticker update on every open screen via push); existing names **link** to it —
`-`, `→`, case and spacing all resolve to one route, never duplicates. QR
button per bus reissues token + QR (old one dies on scan-leak).

## 5. Engineering decisions worth points

1. **Phone holds the truth.** Every GPS point is written to SQLite *before* any
   network attempt. Airplane mode for 5 minutes → all points arrive later, zero
   duplicates (verified: 2 accepted → retry counted 2 duplicates, 0 new rows).
2. **Idempotent ingestion.** `INSERT … ON CONFLICT DO NOTHING` + per-batch
   `RETURNING` on Postgres (identical semantics on SQLite). Retries are safe by
   construction — this is what makes the offline queue possible.
3. **Push-driven UI, poll as backup.** Dashboards patch markers from WS events
   with full context (route, speed, seq) — no refetch-per-ping. REST polling
   stays as the self-healing reconciler.
4. **Route sync on bus creation.** Adding a bus upserts + links its route
   (`route_id`), broadcasts `routes.updated` + `bus.created`; every screen
   redraws with zero refresh.
5. **QR = whole onboarding.** Payload `{v, api, bus, token}` carries the server
   URL too, so tunnel/prod URL changes never need an app rebuild. Strict
   validation with plain-language errors.
6. **Dual database, one API.** SQLite locally (zero-config), Supabase Postgres
   in production via `DATABASE_URL` — same endpoints, same behavior, health
   endpoint reports which store is live. Phones/browsers never touch Supabase
   directly (no RLS exposure).

## 6. Tech stack

Backend: Node 20/22, Express, `ws`, Zod, `better-sqlite3` / `postgres` driver,
per-token rate limiting, gzip request bodies, Fly.io Mumbai profile ready.
Dashboard: zero-build static HTML/CSS/JS, Leaflet + OpenStreetMap (CDN),
qrcodejs for printing. Driver: Expo SDK 51, Expo Router, expo-location
(foreground service) + TaskManager, expo-sqlite, SecureStore, NetInfo,
Zustand, expo-camera. Data: Supabase Postgres (Tokyo pooler; Mumbai/Singapore
recommended for production latency).

## 7. Resilience tests (all executed against the running backend)

| Test | Result |
|---|---|
| Duplicate batch retry | 0 new rows, counted as duplicates |
| Stale point (>24 h) | rejected with reason `too_old` |
| Bad token | 401, driver app shows "ask admin" |
| Trail + trip end | 2 pts returned, 1174 m computed |
| Two live sources at once | separate markers + trails |
| WS contract | enriched `bus.position`, `bus.created`, `routes.updated`, 20 s heartbeat |
| Offline >60 s | status flips to OFFLINE |

Remaining for road day: airplane-mode drive, app-killed-from-recents,
reboot-resume, server-down queue drain (procedures in DEPLOYMENT.md §8).

## 8. Suggested 5-minute judging demo

1. **(0:00)** Open the dashboard — BUS 22 is already Moving on the Beas road.
   Point out UPDATED-ago, speed, footer freshness. *(No setup, it's live.)*
2. **(1:00)** Click BUS 22 → trail draws over the route. HISTORY → past trips.
   FIT ALL → whole fleet + 3 road routes.
3. **(2:30)** Admin adds a bus live (e.g. BUS 30, new route) → toast + NEW
   badge + route appears on everyone's screen with zero refresh. SHOW QR →
   print modal.
4. **(3:30)** Driver app on a real phone: SCAN the printed QR → START TRIP →
   second live marker joins the map within ~15 s.
5. **(4:30)** Resilience pitch: enable airplane mode on the phone for 2 min,
   disable → queued points flood in, zero duplicates (show `duplicates` count
   in server logs). Backup: recorded screen video if the hall Wi-Fi dies.

## 9. Honest scope notes

- **Done and real:** everything above runs against Supabase right now.
- **Not yet road-proven:** driver app needs the EAS APK + physical phone
  (`eas build --profile preview`); all phone-side resilience tests await it.
- **Stretch (in PRD §13, not built):** ETA, geofence arrival alerts,
  route-deviation alerts, fuel estimates.
- **Security posture:** per-bus bearer tokens (SHA-256 + pepper), admin key
  gate, dev-default warnings at boot. QR printouts are bearer credentials —
  reissue on leak. Production needs real `TOKEN_PEPPER`/`ADMIN_KEY` secrets
  and `CORS_ORIGIN` locked to the dashboard domain.

## 10. Run it

```bash
# backend (needs DATABASE_URL in backend/.env for Supabase, else local SQLite)
cd backend && npm install && npm run dev        # :3000 = API + dashboard
npm run seed                                     # routes + BUS 01–03 + tokens
# simulator (a live bus with no phone)
cd ../simulator && TOKEN=<bus-token> API=http://localhost:3000 node replay.js
# driver app (needs EAS build + Android phone)
cd ../driver-app && npm install && npx expo start --dev-client
```

Repo: `github.com/premsagar786/busyatri` (private). PRD in `PRD.md`, network +
deploy notes in `DEPLOYMENT.md`, port/access guide + QR onboarding in `README.md`.
