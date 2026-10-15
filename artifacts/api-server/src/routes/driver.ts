import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateDriverRemarkBody,
  CreateDriverRemarkResponse,
  UpdateDriverLocationBody,
  UpdateDriverLocationResponse,
  UpdateDriverShiftBody,
  UpdateDriverShiftResponse,
} from "@workspace/api-zod";
import {
  appUsersTable,
  busLocationsTable,
  busRemarksTable,
  db,
} from "@workspace/db";
import { requireRole, requireUser } from "../middlewares/currentUser";
import { getProfile } from "./transport-data";

const router: IRouter = Router();

router.post("/driver/location", requireUser, requireRole("driver"), async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user?.assignedBusId) {
    res.status(403).json({ error: "Ask your college admin to assign your bus" });
    return;
  }
  if (!user.onDuty) {
    res.status(403).json({ error: "Start your shift before sharing location" });
    return;
  }
  const parsed = UpdateDriverLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [location] = await db
    .insert(busLocationsTable)
    .values({ busId: user.assignedBusId, ...parsed.data, recordedAt: new Date() })
    .onConflictDoUpdate({
      target: busLocationsTable.busId,
      set: { ...parsed.data, recordedAt: new Date() },
    })
    .returning();

  res.json(UpdateDriverLocationResponse.parse(location));
});

router.post("/driver/remark", requireUser, requireRole("driver"), async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user?.assignedBusId) {
    res.status(403).json({ error: "Ask your college admin to assign your bus" });
    return;
  }
  const parsed = CreateDriverRemarkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [remark] = await db
    .insert(busRemarksTable)
    .values({
      busId: user.assignedBusId,
      driverId: user.id,
      driverName: user.name,
      text: parsed.data.text.trim(),
      place: parsed.data.place.trim(),
    })
    .returning();

  res.status(201).json(CreateDriverRemarkResponse.parse(remark));
});

router.post("/driver/shift", requireUser, requireRole("driver"), async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  const parsed = UpdateDriverShiftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.onDuty && !user.assignedBusId) {
    res.status(403).json({ error: "Ask your college admin to assign your bus" });
    return;
  }

  const [updated] = await db
    .update(appUsersTable)
    .set({ onDuty: parsed.data.onDuty })
    .where(and(eq(appUsersTable.id, user.id), eq(appUsersTable.role, "driver")))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Driver account not found" });
    return;
  }
  res.json(UpdateDriverShiftResponse.parse(await getProfile(updated)));
});

export default router;
