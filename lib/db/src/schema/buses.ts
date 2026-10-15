import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const busesTable = pgTable("buses", {
  id: serial("id").primaryKey(),
  busNumber: text("bus_number").notNull().unique(),
  routeName: text("route_name").notNull(),
  routeStops: jsonb("route_stops").$type<string[]>().notNull().default([]),
  capacity: integer("capacity").notNull().default(40),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const appUsersTable = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    clerkId: text("clerk_id").unique(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role")
      .$type<"student" | "driver" | "admin">()
      .notNull()
      .default("student"),
    assignedBusId: integer("assigned_bus_id").references(() => busesTable.id, {
      onDelete: "set null",
    }),
    onDuty: boolean("on_duty").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("app_users_role_idx").on(table.role),
    uniqueIndex("app_users_single_admin_idx")
      .on(table.role)
      .where(sql`${table.role} = 'admin'`),
  ],
);

export const busLocationsTable = pgTable(
  "bus_locations",
  {
    id: serial("id").primaryKey(),
    busId: integer("bus_id")
      .notNull()
      .unique()
      .references(() => busesTable.id, { onDelete: "cascade" }),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    heading: doublePrecision("heading"),
    speed: doublePrecision("speed"),
    accuracy: doublePrecision("accuracy"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("bus_locations_recorded_at_idx").on(table.recordedAt)],
);

export const busRemarksTable = pgTable(
  "bus_remarks",
  {
    id: serial("id").primaryKey(),
    busId: integer("bus_id")
      .notNull()
      .references(() => busesTable.id, { onDelete: "cascade" }),
    driverId: integer("driver_id").references(() => appUsersTable.id, {
      onDelete: "set null",
    }),
    driverName: text("driver_name").notNull(),
    text: text("text").notNull(),
    place: text("place").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("bus_remarks_bus_created_idx").on(table.busId, table.createdAt),
  ],
);
