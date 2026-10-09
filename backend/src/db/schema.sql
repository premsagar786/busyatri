PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  polyline_geojson TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS buses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bus_number TEXT UNIQUE NOT NULL,
  route_id INTEGER REFERENCES routes(id),
  route_name TEXT,
  destination TEXT,
  status TEXT NOT NULL DEFAULT 'Offline',
  token_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_code TEXT UNIQUE NOT NULL,
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  driver_name TEXT DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  distance_m REAL DEFAULT 0,
  points_count INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'phone',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trips_bus_active ON trips (bus_id, active);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  UNIQUE (bus_id, point_id)
);
CREATE INDEX IF NOT EXISTS idx_positions_bus_time ON positions (bus_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_positions_trip ON positions (trip_id, seq);
