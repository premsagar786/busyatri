-- BusYatri schema for Postgres (Supabase). Run once in the Supabase SQL editor.
-- Local dev keeps using SQLite (schema.sql); set DATABASE_URL to use this.

CREATE TABLE IF NOT EXISTS routes (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  origin TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  polyline_geojson TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS buses (
  id SERIAL PRIMARY KEY,
  bus_number TEXT UNIQUE NOT NULL,
  route_id INTEGER REFERENCES routes(id),
  route_name TEXT,
  destination TEXT,
  status TEXT NOT NULL DEFAULT 'Offline',
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  trip_code TEXT UNIQUE NOT NULL,
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  driver_name TEXT DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  distance_m DOUBLE PRECISION DEFAULT 0,
  points_count INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'phone',
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_trips_bus_active ON trips (bus_id, active);

CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  trip_id TEXT NOT NULL,
  point_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  speed_mps DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  UNIQUE (bus_id, point_id)            -- makes retries safe
);
CREATE INDEX IF NOT EXISTS idx_positions_bus_time ON positions (bus_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_positions_trip ON positions (trip_id, seq);
