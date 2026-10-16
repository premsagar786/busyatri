# Campus Bus Tracker

Live college shuttle tracking with no hardware on the bus. A driver's phone shares
GPS while on duty; students see buses on a live map; an admin manages buses,
drivers, routes and manual map pins.

## Run locally

Prereqs: Node 22+, pnpm 9+, any Postgres (e.g. Supabase), a Clerk app, Expo Go
on a phone for driver GPS.

```powershell
corepack enable; corepack prepare pnpm@latest --activate
pnpm install
```

```powershell
# 1) env — copy .env.example values into your shell (never commit real values)
$env:DATABASE_URL="postgresql://user:pass@localhost:5432/bus_tracker"
$env:CLERK_PUBLISHABLE_KEY="pk_test_..."
$env:CLERK_SECRET_KEY="sk_test_..."
$env:PORT="5000"

# 2) database schema (dev)
pnpm --filter @workspace/db run push

# 3) backend (http://localhost:5000, health: /api/healthz)
pnpm --filter @workspace/api-server run build
node artifacts/api-server/dist/index.mjs

# 4) app — Expo dev server (scan QR with Expo Go, or press `w` for web)
pnpm --filter @workspace/campus-bus-tracker run dev
# web only:
pnpm --filter @workspace/campus-bus-tracker run dev:web
```

First-run bootstrap: open the app and **sign up the admin account first**
(it auto-becomes admin), then add buses + drivers before students sign in.

## Scripts

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node 22+, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`, base path `/api`)
- DB: PostgreSQL + Drizzle ORM (`lib/db`) — `DATABASE_URL` points at any Postgres
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval from `lib/api-spec/openapi.yaml`
- App: Expo Router, React Native + Web (`artifacts/campus-bus-tracker`)
- Auth: Clerk (`@clerk/expo` on client, `@clerk/express` on server)
- Maps: OpenStreetMap raster tiles (no API key)
- Realtime: HTTP polling (5s/10s), no WebSocket or push in current code

## Where things live

- DB schema source of truth → `lib/db/src/schema/buses.ts`
- API contract source of truth → `lib/api-spec/openapi.yaml`
- Role routing → `artifacts/campus-bus-tracker/app/(tabs)/index.tsx`
- Full design/ops manual → `SYSTEM_DESIGN.md`
