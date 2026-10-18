import { desc, eq } from "drizzle-orm";
import {
  appUsersTable,
  busLocationsTable,
  busRemarksTable,
  busesTable,
  db,
} from "@workspace/db";
import type { AppUser } from "../middlewares/currentUser";

export async function loadBusSnapshot() {
  const [buses, drivers, locations, remarks] = await Promise.all([
    db.select().from(busesTable).orderBy(busesTable.busNumber),
    db.select().from(appUsersTable).where(eq(appUsersTable.role, "driver")),
    db.select().from(busLocationsTable),
    db
      .select()
      .from(busRemarksTable)
      .orderBy(desc(busRemarksTable.createdAt)),
  ]);

  const driverByBus = new Map<number, (typeof drivers)[number]>();
  for (const driver of drivers) {
    if (driver.assignedBusId != null && !driverByBus.has(driver.assignedBusId)) {
      driverByBus.set(driver.assignedBusId, driver);
    }
  }

  const locationByBus = new Map(
    locations.map((location) => [location.busId, location]),
  );
  const latestRemarkByBus = new Map<number, (typeof remarks)[number]>();
  for (const remark of remarks) {
    if (!latestRemarkByBus.has(remark.busId)) {
      latestRemarkByBus.set(remark.busId, remark);
    }
  }

  return buses.map((bus) => {
    const driver = driverByBus.get(bus.id);
    const location = locationByBus.get(bus.id);
    const remark = latestRemarkByBus.get(bus.id);
    return {
      id: bus.id,
      busNumber: bus.busNumber,
      routeName: bus.routeName,
      routeStops: bus.routeStops,
      capacity: bus.capacity,
      active: bus.active,
      startLat: bus.startLat,
      startLon: bus.startLon,
      endLat: bus.endLat,
      endLon: bus.endLon,
      driverName: driver?.name ?? null,
      driverEmail: driver?.email ?? null,
      onDuty: driver?.onDuty ?? false,
      location: location
        ? {
            latitude: location.latitude,
            longitude: location.longitude,
            heading: location.heading,
            speed: location.speed,
            accuracy: location.accuracy,
            recordedAt: location.recordedAt,
          }
        : null,
      remark: remark
        ? {
            id: remark.id,
            busId: remark.busId,
            text: remark.text,
            place: remark.place,
            driverName: remark.driverName,
            createdAt: remark.createdAt,
          }
        : null,
    };
  });
}

export async function getProfile(user: AppUser) {
  let assignedBusNumber: string | null = null;
  if (user.assignedBusId != null) {
    const [bus] = await db
      .select({ busNumber: busesTable.busNumber })
      .from(busesTable)
      .where(eq(busesTable.id, user.assignedBusId))
      .limit(1);
    assignedBusNumber = bus?.busNumber ?? null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    assignedBusId: user.assignedBusId,
    assignedBusNumber,
    onDuty: user.onDuty,
  };
}
