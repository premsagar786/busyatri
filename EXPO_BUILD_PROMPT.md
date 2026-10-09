# Build Prompt: Expo Driver App for College Bus Tracker (Android First)

Paste everything below the line into Claude Code, Cursor, or another coding assistant. Attach PRD.md alongside it.

---

You are a senior React Native engineer. Build an Android-first Expo app called **BusTracker Driver** according to the attached PRD.md. Follow every requirement marked Must. Ask me before adding anything not in the PRD.

## Stack (use exactly these)

- Expo SDK (latest stable), TypeScript, Expo Router for navigation
- Development build via EAS (NOT Expo Go, because background location does not work in Expo Go)
- `expo-location` for GPS, with `startLocationUpdatesAsync` and the `foregroundService` option for background tracking
- `expo-task-manager` for the background location task
- `expo-sqlite` for the local queue (table `pending_points`)
- `@react-native-community/netinfo` for connectivity detection
- `expo-secure-store` for storing the bus token
- `expo-notifications` for the reminder and foreground service text if needed
- Zustand for app state
- Zod for validating points before they go into the queue
- No Redux, no Firebase in this version

## Project structure

```
app/
  _layout.tsx
  login.tsx
  permissions.tsx
  index.tsx          (home: bus card, start/end trip, status chip)
  trip.tsx           (active trip stats)
  summary.tsx
  settings.tsx
src/
  api/client.ts      (fetch wrapper, timeouts, gzip, auth header)
  api/positions.ts   (batch upload)
  tracking/task.ts   (TaskManager location task, writes to queue)
  tracking/session.ts (start/stop trip, resume after restart)
  queue/db.ts        (SQLite schema and CRUD)
  queue/sync.ts      (batch sync loop with retry and backoff)
  network/status.ts  (NetInfo listener, triggers sync on reconnect)
  store/tripStore.ts
  types/position.ts
  utils/backoff.ts
  utils/format.ts
```

## Behaviour requirements

**Tracking**
- Start Trip shows the permission explainer first, then requests foreground location, then background location.
- Tracking uses a foreground service with notification title "BusTracker: Trip active" and body "Bus {busNumber} is sending location".
- Interval: 10 seconds. Accuracy: `Location.Accuracy.Balanced` by default, switchable to High in Settings.
- Each point is validated with Zod, given `point_id = uuid v4`, and a monotonically increasing `seq` stored in SQLite before any network call.
- Points with `accuracy > 50` are stored with `flagged = 1`, not discarded.

**Queue and sync**
- Never delete a point that has not been acknowledged by the server.
- Batch size 50. Send oldest first.
- Retry policy: exponential backoff with jitter, base 2 s, cap 60 s, reset on success.
- Timeout 10 s per request. Treat timeouts and 5xx as retryable. Treat 401 as fatal: stop sync, show "Token invalid, ask admin".
- Treat 413 by halving the batch size. Treat 429 by honouring Retry-After if present.
- Gzip the body when it is over 1 KB (use `pako` or a small gzip helper).
- On NetInfo change from offline to online, trigger sync immediately.
- After each successful batch, mark the acknowledged `point_id`s as synced, then delete them only if the queue is above 10,000 rows (oldest synced first).
- Cap: 10,000 rows. If the cap is hit with unsynced points, keep them and show a warning. Never drop unsynced data.

**Status UI**
- Chip states: Online (green), Syncing N (amber), Offline with N queued (red).
- Show last successful sync time in relative format ("12 s ago").

**Resilience**
- On app launch, if a trip was active, show "Resume trip?" and restart tracking if the driver confirms.
- Show a battery optimization explainer on the first trip, with a button that opens Android battery settings for the app.
- Do not crash when airplane mode is on or when the server is unreachable.

## API contract

Base URL comes from `EXPO_PUBLIC_API_URL`.
`POST /api/v1/positions/batch` with headers `Authorization: Bearer <token>` and `Content-Type: application/json`.
Body: `{ trip_id, source: "phone", points: [{ point_id, seq, lat, lng, accuracy_m, speed_mps, recorded_at }] }`.
Expect: `{ accepted, duplicates, rejected, server_time }`.

## Quality bar

- TypeScript strict mode. No `any`.
- Every network and database call wrapped in try/catch with a logged, human-readable error.
- Unit tests for `backoff.ts`, the Zod point schema, and the sync batching logic (use Jest).
- A `SIMULATE_GPS=true` env flag that replays points from `src/tracking/fixtures/route.json` so the app can be tested indoors.
- No hardcoded API URLs, tokens, or bus numbers.

## Deliverables

1. Full project tree with all files.
2. `app.json` with Android package name `com.yourname.bustracker.driver` and the permissions:
   `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `INTERNET`, `ACCESS_NETWORK_STATE`.
3. `eas.json` with `development`, `preview` (APK for sideloading), and `production` profiles.
4. `.env.example` with `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_DEBUG`.
5. README with steps: install, `npx expo prebuild`, `eas build --profile development --platform android`, install the APK, sign in, run a test trip.
6. A short test plan covering: airplane mode for 5 minutes, app killed from recents, phone restarted mid-trip, server down for 2 minutes, two-bus test.

Start by listing the files you will create and any assumptions you are making, then write the code.
