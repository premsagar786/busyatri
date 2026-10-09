# PRD: College Bus Tracker — Driver App (Expo, Android First) and Live Backend

Version: 1.0
Status: Draft for hackathon build
Owner: Prem
Platform priority: Android (Expo / React Native), then iOS later

---

## 1. Problem

College buses move across routes such as Amritsar → Campus and Beas → Campus. Students and admins cannot see where each bus is, when it will arrive, or whether it has left its route. The existing process relies on phone calls and guesses.

## 2. Goal

Give every college bus a live position on a shared dashboard, using the driver's Android phone as the first tracker. The same backend will later accept data from a low-cost ESP32 + 4G device without any change to the dashboard.

## 3. Success Metrics (hackathon scope)

| Metric | Target |
|---|---|
| Position updates reach the server while a trip is active | ≥ 95% of expected pings during a 30-minute test drive |
| Time from GPS fix to dashboard update | ≤ 15 seconds on a normal 4G connection |
| Recovery after a network drop | 100% of points captured offline are delivered once network returns |
| Duplicate positions in the database | 0 |
| Driver can start and end a trip in under 3 taps | Yes |

## 4. Users

- **Driver:** Starts a trip for their assigned bus, keeps the app running, ends the trip. Uses a low-end or mid-range Android phone, often with weak signal and a limited data plan.
- **Admin:** Creates buses, routes, and driver accounts. Views the live dashboard and trip history.
- **Student:** Views live bus position, route, destination, and status. Read-only.

## 5. Scope

### In scope (MVP)
1. Driver login with a driver code or phone-based OTP (see §8 for the simplest option).
2. Assigned bus shown after login (e.g. BUS 01 → Amritsar → Campus).
3. Start Trip / End Trip button.
4. Background GPS tracking during an active trip, with a visible notification.
5. Position upload every 10 seconds (configurable), with an offline queue.
6. Connection status indicator: Online, Syncing (N queued), Offline.
7. Backend ingestion API that accepts both phone and device payloads.
8. Live dashboard (web) showing bus number, current location, destination, route, and status.

### Out of scope (MVP, planned later)
- iOS build
- ETA, geofencing, deviation alerts, fuel estimation (listed as stretch goals in §13)
- Passenger login or push notifications
- Driver payroll or attendance
- Hardware device firmware (covered in a separate document)

## 6. Functional Requirements

### 6.1 Driver App

| ID | Requirement | Priority |
|---|---|---|
| D-1 | Driver signs in and sees only their assigned bus | Must |
| D-2 | "Start Trip" requests foreground and background location permission with a clear explanation screen first | Must |
| D-3 | Tracking runs as an Android foreground service with a persistent notification "Bus 01 trip active" | Must |
| D-4 | Position is captured every 10 s while trip is active (GPS accuracy: balanced or high) | Must |
| D-5 | Each point gets a client-generated ID and a sequence number, stored locally before upload | Must |
| D-6 | Upload runs in batches of up to 50 points, with retry and exponential backoff | Must |
| D-7 | If there is no network, points stay in the local queue and upload when network returns | Must |
| D-8 | Points with poor accuracy (> 50 m horizontal) are flagged but still stored | Should |
| D-9 | Driver sees current speed, last sync time, and queue size | Should |
| D-10 | "End Trip" stops tracking, flushes the queue, then shows a summary (distance, duration) | Must |
| D-11 | If the app is killed or the phone restarts mid-trip, the trip resumes or asks the driver to resume | Should |
| D-12 | Works in Android with battery optimization exemption prompt | Should |

### 6.2 Backend

| ID | Requirement | Priority |
|---|---|---|
| B-1 | `POST /api/v1/positions/batch` accepts up to 50 points and is idempotent | Must |
| B-2 | Duplicate points (same `device_id` + `point_id`) are ignored, not rejected | Must |
| B-3 | Points older than 24 hours or more than 5 minutes in the future are rejected with a reason | Must |
| B-4 | Each request is authenticated with a per-bus or per-driver token | Must |
| B-5 | Server pushes live updates to dashboard clients over WebSocket | Must |
| B-6 | `GET /api/v1/buses` returns bus number, route, destination, last position, status | Must |
| B-7 | Status is computed: Moving, Stopped, Offline (no point in last 60 s), Deviated (stretch) | Must |
| B-8 | `GET /api/v1/buses/:id/trail?since=` returns the travelled route for the current trip | Should |
| B-9 | `GET /health` returns 200 and database status for uptime checks | Must |
| B-10 | Rate limit per token to prevent flooding | Should |

### 6.3 Admin Dashboard

| ID | Requirement | Priority |
|---|---|---|
| A-1 | Live table: Bus Number → Current Location → Destination → Route → Status → Last update | Must |
| A-2 | Map (Leaflet + OpenStreetMap) shows each bus marker and its route polyline | Must |
| A-3 | Clicking a bus centers the map and shows its trail for the active trip | Should |
| A-4 | Admin can create buses, routes, and driver tokens | Should |
| A-5 | Stale buses (Offline) are visually highlighted | Must |

## 7. Non-Functional Requirements: Connectivity and Network Strength

These requirements exist because the driver's network will be unreliable. They are the main reason the app must be built carefully.

| ID | Requirement |
|---|---|
| N-1 | Every GPS point is written to local storage before any upload attempt. A crash or signal loss must not lose data. |
| N-2 | Upload uses exponential backoff with jitter: 2 s, 4 s, 8 s … capped at 60 s. |
| N-3 | Uploads are batched (up to 50 points) to reduce request count on weak signals. |
| N-4 | The app monitors network type and reachability (NetInfo). When it changes from offline to online, it triggers a sync immediately. |
| N-5 | Requests use HTTPS with a 10 s timeout. Timed-out requests are retried, not dropped. |
| N-6 | Payloads are gzip-compressed when larger than 1 KB. |
| N-7 | The backend is hosted in an Indian or Singapore region to keep latency low for Punjab. |
| N-8 | The backend is idempotent so retries never create duplicates. |
| N-9 | The server sends a heartbeat every 20 s to dashboard clients. Dashboards show "Connection lost" after 30 s without one. |
| N-10 | The local queue has a cap of 10,000 points (about 27 hours at 10 s). Oldest synced points are removed first. Unsynced points are never deleted silently. |
| N-11 | The app works in airplane mode and in a basement or tunnel without crashing. |
| N-12 | Battery use: under 8% per hour of active tracking on a mid-range phone (target, measured in testing). |
| N-13 | Logs contain no personal data beyond bus ID, driver ID, and coordinates. Location data is retained for 90 days, then deleted. |

## 8. Authentication (MVP)

Simplest secure option for a hackathon:
- Each bus has a **device token** created by the admin. The driver enters the bus number and the token once; the app stores it in `expo-secure-store`.
- The token is sent in the `Authorization: Bearer` header.
- Tokens can be revoked by the admin.

Later: driver accounts with phone OTP, using Supabase Auth or Firebase Auth.

## 9. Data Model

```
buses(id, bus_number, route_id, status, token_hash, created_at)
routes(id, name, origin, destination, polyline_geojson)
trips(id, bus_id, driver_name, started_at, ended_at, distance_m, source)
positions(
  id,            -- server id
  bus_id,
  trip_id,
  point_id,      -- client UUID, unique with bus_id
  seq,           -- client sequence number
  lat, lng,
  accuracy_m,
  speed_mps,
  recorded_at,   -- device timestamp (UTC)
  received_at,   -- server timestamp
  source         -- 'phone' | 'device'
)
UNIQUE (bus_id, point_id)
```

## 10. API Contract

### POST /api/v1/positions/batch
Headers: `Authorization: Bearer <bus_token>`, `Content-Type: application/json`, optional `Content-Encoding: gzip`

Request:
```json
{
  "trip_id": "trip_20261009_01",
  "source": "phone",
  "points": [
    {
      "point_id": "9b1c2a3e-...",
      "seq": 1042,
      "lat": 30.9010,
      "lng": 75.8573,
      "accuracy_m": 8.5,
      "speed_mps": 9.2,
      "recorded_at": "2026-10-09T07:15:10Z"
    }
  ]
}
```

Response (200):
```json
{
  "accepted": 48,
  "duplicates": 2,
  "rejected": [{"point_id": "...", "reason": "too_old"}],
  "server_time": "2026-10-09T07:15:12Z"
}
```

Errors: `401` invalid token, `413` batch too large, `429` rate limited (retry with backoff), `5xx` retry.

### WebSocket /ws/live
Server events: `bus.position`, `bus.status`, `heartbeat` (every 20 s).

### GET /api/v1/buses
Returns array of buses with `bus_number`, `route`, `destination`, `last_position`, `status`, `last_seen`.

## 11. Screens (Driver App)

1. **Login:** Bus number and token fields. Shows assigned route after success.
2. **Permissions explainer:** Why location is needed, background permission, notification explanation.
3. **Home:** Bus card (BUS 01, Amritsar → Campus). Large Start Trip / End Trip button. Status chip (Online / Syncing 12 / Offline). Last sync time.
4. **Trip active:** Speed, accuracy, points queued, points sent, elapsed time.
5. **Trip summary:** Distance, duration, points sent, points still queued.
6. **Settings:** Upload interval, GPS accuracy mode, sign out.

## 12. Acceptance Criteria (MVP)

- [ ] Driver can start a trip and the dashboard shows the bus moving within 15 s.
- [ ] Turning on airplane mode for 5 minutes, then turning it off, uploads all missed points with no duplicates in the database.
- [ ] Killing the app from recents does not stop tracking (foreground service keeps it alive).
- [ ] Restarting the backend during a trip causes no data loss.
- [ ] Two buses tracked at once show correctly on the dashboard, each with its own route.
- [ ] A bus with no data for 60 s shows Offline.
- [ ] Simulator replay of a recorded GPS trace works without a phone (for judging).

## 13. Stretch Goals

- ETA based on remaining route distance and rolling average speed
- Geofence arrival notifications at stops
- Route deviation alerts (point more than 150 m from polyline for 60 s)
- Trip history and distance travelled
- Fuel cost estimate (distance ÷ mileage × fuel price)
- Snap-to-road for cleaner trails

## 14. Milestones

| Day | Deliverable |
|---|---|
| 1 | Expo project running on Android dev build. Permissions and login screens. |
| 2 | Background tracking with foreground service. Local SQLite queue. |
| 3 | Batch upload with retry, backoff, and NetInfo sync. Backend ingestion endpoint and database. |
| 4 | Live dashboard with map, bus table, and WebSocket updates. |
| 5 | Network test (airplane mode, drop, restart). Simulator for demo. Deployment. |
| 6 | Polish, demo video, documentation. |

## 15. Risks

| Risk | Mitigation |
|---|---|
| Android kills background tracking on some phones (Xiaomi, Realme, Oppo) | Foreground service, battery optimization exemption prompt, test on at least two brands |
| Driver forgets to start trip | Daily reminder notification, admin sees "not started" status |
| Weak data signal in parts of route | Offline queue, batching, backoff |
| Google Play policy rejection for background location | Clear in-app explanation and privacy policy. For the hackathon, sideload the APK instead |
| Expo Go does not support background location | Use an EAS development build |
| Battery drain | Balanced accuracy mode, 10 s interval, measured in testing |

## 16. Open Questions

1. Will the driver use a personal phone or a college-provided phone?
2. Which Android versions and brands must be supported for testing?
3. Is the admin dashboard public to students, or behind login?
4. Is there a fixed route list, or will routes change per trip?
