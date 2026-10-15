import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateBusBody,
  CreateBusResponse,
  CreateDriverBody,
  CreateDriverResponse,
  DeleteBusParams,
  DeleteDriverParams,
  ListAdminBusesResponse,
  ListDriversResponse,
  UpdateBusBody,
  UpdateBusParams,
  UpdateBusResponse,
  UpdateDriverBody,
  UpdateDriverParams,
  UpdateDriverResponse,
  UpdateDriverLocationBody,
  UpdateDriverLocationResponse,
  GetAdminOverviewResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  busLocationsTable,
  busesTable,
  db,
} from "@workspace/db";
import { requireRole, requireUser } from "../middlewares/currentUser";
import { loadBusSnapshot } from "./transport-data";

const router: IRouter = Router();

router.use("/admin", requireUser, requireRole("admin"));

router.get("/admin/overview", async (_req, res): Promise<void> => {
  const [buses, drivers, liveLocations, onDuty] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(busesTable),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appUsersTable)
      .where(eq(appUsersTable.role, "driver")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(busLocationsTable)
      .where(sql`${busLocationsTable.recordedAt} > now() - interval '2 minutes'`),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(appUsersTable)
      .where(and(eq(appUsersTable.role, "driver"), eq(appUsersTable.onDuty, true))),
  ]);
  const busesSnapshot = await loadBusSnapshot();
  res.json(
    GetAdminOverviewResponse.parse({
      totalBuses: buses[0]?.count ?? 0,
      activeBuses: busesSnapshot.filter((bus) => bus.active).length,
      busesSharingLocation: liveLocations[0]?.count ?? 0,
      totalDrivers: drivers[0]?.count ?? 0,
      driversOnDuty: onDuty[0]?.count ?? 0,
    }),
  );
});

router.get("/admin/buses", async (_req, res): Promise<void> => {
  res.json(ListAdminBusesResponse.parse(await loadBusSnapshot()));
});

router.put("/admin/buses/:id/location", async (req, res): Promise<void> => {
  const params = UpdateBusParams.safeParse(req.params);
  const parsed = UpdateDriverLocationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid bus location" });
    return;
  }
  if (
    parsed.data.latitude < -90 ||
    parsed.data.latitude > 90 ||
    parsed.data.longitude < -180 ||
    parsed.data.longitude > 180
  ) {
    res.status(400).json({ error: "Coordinates are outside valid bounds" });
    return;
  }
  const [bus] = await db
    .select({ id: busesTable.id })
    .from(busesTable)
    .where(eq(busesTable.id, params.data.id))
    .limit(1);
  if (!bus) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }
  const [location] = await db
    .insert(busLocationsTable)
    .values({
      busId: bus.id,
      ...parsed.data,
      recordedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: busLocationsTable.busId,
      set: { ...parsed.data, recordedAt: new Date() },
    })
    .returning();
  res.json(UpdateDriverLocationResponse.parse(location));
});

router.post("/admin/buses", async (req, res): Promise<void> => {
  const parsed = CreateBusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [bus] = await db
    .insert(busesTable)
    .values({
      ...parsed.data,
      busNumber: parsed.data.busNumber.trim(),
      routeName: parsed.data.routeName.trim(),
      routeStops: parsed.data.routeStops.map((stop) => stop.trim()).filter(Boolean),
    })
    .returning();
  const snapshot = (await loadBusSnapshot()).find((item) => item.id === bus?.id);
  if (!snapshot) {
    res.status(500).json({ error: "The bus could not be loaded after creation" });
    return;
  }
  res.status(201).json(CreateBusResponse.parse(snapshot));
});

router.patch("/admin/buses/:id", async (req, res): Promise<void> => {
  const params = UpdateBusParams.safeParse(req.params);
  const parsed = UpdateBusBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid bus update" });
    return;
  }
  const values = {
    ...parsed.data,
    ...(parsed.data.busNumber
      ? { busNumber: parsed.data.busNumber.trim() }
      : {}),
    ...(parsed.data.routeName
      ? { routeName: parsed.data.routeName.trim() }
      : {}),
    ...(parsed.data.routeStops
      ? {
          routeStops: parsed.data.routeStops
            .map((stop) => stop.trim())
            .filter(Boolean),
        }
      : {}),
  };
  const [updated] = await db
    .update(busesTable)
    .set(values)
    .where(eq(busesTable.id, params.data.id))
    .returning({ id: busesTable.id });
  if (!updated) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }
  const snapshot = (await loadBusSnapshot()).find(
    (item) => item.id === updated.id,
  );
  if (!snapshot) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }
  res.json(UpdateBusResponse.parse(snapshot));
});

router.delete("/admin/buses/:id", async (req, res): Promise<void> => {
  const params = DeleteBusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(busesTable)
    .where(eq(busesTable.id, params.data.id))
    .returning({ id: busesTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }
  res.sendStatus(204);
});

router.delete("/admin/buses/:id/location", async (req, res): Promise<void> => {
  const params = DeleteBusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [bus] = await db
    .select({ id: busesTable.id })
    .from(busesTable)
    .where(eq(busesTable.id, params.data.id))
    .limit(1);
  if (!bus) {
    res.status(404).json({ error: "Bus not found" });
    return;
  }
  await db
    .delete(busLocationsTable)
    .where(eq(busLocationsTable.busId, params.data.id));
  res.sendStatus(204);
});

router.get("/admin/drivers", async (_req, res): Promise<void> => {
  const drivers = await db
    .select({
      id: appUsersTable.id,
      name: appUsersTable.name,
      email: appUsersTable.email,
      busId: appUsersTable.assignedBusId,
      busNumber: busesTable.busNumber,
      onDuty: appUsersTable.onDuty,
    })
    .from(appUsersTable)
    .leftJoin(busesTable, eq(appUsersTable.assignedBusId, busesTable.id))
    .where(eq(appUsersTable.role, "driver"))
    .orderBy(appUsersTable.name);
  res.json(ListDriversResponse.parse(drivers));
});

router.post("/admin/drivers", async (req, res): Promise<void> => {
  const parsed = CreateDriverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const name = parsed.data.name.trim();
  const existing = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email))
    .limit(1);
  if (existing[0]?.role === "admin") {
    res.status(409).json({ error: "An administrator cannot be added as a driver" });
    return;
  }
  const [driver] = existing[0]
    ? await db
        .update(appUsersTable)
        .set({
          name,
          role: "driver",
          assignedBusId: parsed.data.busId ?? null,
        })
        .where(eq(appUsersTable.id, existing[0].id))
        .returning()
    : await db
        .insert(appUsersTable)
        .values({
          name,
          email,
          role: "driver",
          assignedBusId: parsed.data.busId ?? null,
        })
        .returning();

  const bus = driver.assignedBusId
    ? await db
        .select({ busNumber: busesTable.busNumber })
        .from(busesTable)
        .where(eq(busesTable.id, driver.assignedBusId))
        .limit(1)
    : [];
  res.status(201).json(
    CreateDriverResponse.parse({
      id: driver.id,
      name: driver.name,
      email: driver.email,
      busId: driver.assignedBusId,
      busNumber: bus[0]?.busNumber ?? null,
      onDuty: driver.onDuty,
    }),
  );
});

router.patch("/admin/drivers/:id", async (req, res): Promise<void> => {
  const params = UpdateDriverParams.safeParse(req.params);
  const parsed = UpdateDriverBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid driver update" });
    return;
  }
  const [driver] = await db
    .update(appUsersTable)
    .set({
      ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.email
        ? { email: parsed.data.email.trim().toLowerCase() }
        : {}),
      ...(parsed.data.busId !== undefined
        ? { assignedBusId: parsed.data.busId }
        : {}),
    })
    .where(
      and(
        eq(appUsersTable.id, params.data.id),
        eq(appUsersTable.role, "driver"),
      ),
    )
    .returning();
  if (!driver) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }
  const bus = driver.assignedBusId
    ? await db
        .select({ busNumber: busesTable.busNumber })
        .from(busesTable)
        .where(eq(busesTable.id, driver.assignedBusId))
        .limit(1)
    : [];
  res.json(
    UpdateDriverResponse.parse({
      id: driver.id,
      name: driver.name,
      email: driver.email,
      busId: driver.assignedBusId,
      busNumber: bus[0]?.busNumber ?? null,
      onDuty: driver.onDuty,
    }),
  );
});

router.delete("/admin/drivers/:id", async (req, res): Promise<void> => {
  const params = DeleteDriverParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(appUsersTable)
    .where(
      and(
        eq(appUsersTable.id, params.data.id),
        eq(appUsersTable.role, "driver"),
      ),
    )
    .returning({ id: appUsersTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
