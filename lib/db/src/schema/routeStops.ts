import { doublePrecision, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { busesTable } from "./buses";

/**
 * Geocoded coordinates for a bus's route stops (resolved once, then cached).
 *
 * Admins add stops as plain names ("GURDASPUR", "VERKA"); the API geocodes
 * them against OpenStreetMap (Nominatim) so the student map can place a flag
 * per stop and OSRM can draw roads + ETA. Persisted so every app / every
 * student benefits from the first lookup.
 */
export const routeStopsCacheTable = pgTable(
  "route_stops_cache",
  {
    id: serial("id").primaryKey(),
    busId: integer("bus_id")
      .notNull()
      .references(() => busesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    geocodedAt: timestamp("geocoded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("route_stops_cache_bus_idx").on(table.busId),
    uniqueIndex("route_stops_cache_bus_name_idx").on(table.busId, table.name),
  ],
);
