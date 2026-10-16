import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createHash, randomBytes } from "node:crypto";
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
  driverUploadTokensTable,
} from "@workspace/db";
import { requireRole, requireUser } from "../middlewares/currentUser";
import { getProfile } from "./transport-data";

const UPLOAD_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function hashUploadToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Resolves the calling driver from EITHER a Clerk session (foreground app)
// OR a single-purpose upload token (background GPS task, no Clerk session).
// Rejects with 401 when neither is valid. Role is always checked.
async function resolveDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (userId) {
    const [user] = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.clerkId, userId))
      .limit(1);
    if (user && user.role === "driver") {
      req.currentUser = user;
      next();
      return;
    }
  }

  const header = req.headers.authorization;
  const raw = header?.startsWith("Upload ")
    ? header.slice("Upload ".length).trim()
    : null;
  if (raw) {
    const [token] = await db
      .select()
      .from(driverUploadTokensTable)
      .where(eq(driverUploadTokensTable.tokenHash, hashUploadToken(raw)))
      .limit(1);
    if (token && token.expiresAt.getTime() > Date.now()) {
      const [user] = await db
        .select()
        .from(appUsersTable)
        .where(eq(appUsersTable.id, token.driverId))
        .limit(1);
      if (user && user.role === "driver") {
        req.currentUser = user;
        next();
        return;
      }
    }
  }

  res.status(401).json({ error: "Sign in to continue" });
}

const router: IRouter = Router();

router.post("/driver/location", resolveDriver, async (req, res): Promise<void> => {
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

// Issues a 12-hour single-purpose token for background GPS uploads.
// Called by the foreground app when a shift starts (Clerk auth required).
// Only one active token per driver: issuing rotates the previous one out.
router.post("/driver/upload-token", requireUser, requireRole("driver"), async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user?.assignedBusId) {
    res.status(403).json({ error: "Ask your college admin to assign your bus" });
    return;
  }
  await db
    .delete(driverUploadTokensTable)
    .where(eq(driverUploadTokensTable.driverId, user.id));
  const raw = randomBytes(32).toString("hex");
  const [row] = await db
    .insert(driverUploadTokensTable)
    .values({
      driverId: user.id,
      tokenHash: hashUploadToken(raw),
      expiresAt: new Date(Date.now() + UPLOAD_TOKEN_TTL_MS),
    })
    .returning();
  res.status(201).json({ token: raw, expiresAt: row.expiresAt.toISOString() });
});

// Revokes the driver's upload token. Called when a shift ends.
router.delete("/driver/upload-token", requireUser, requireRole("driver"), async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (user) {
    await db
      .delete(driverUploadTokensTable)
      .where(eq(driverUploadTokensTable.driverId, user.id));
  }
  res.status(204).end();
});

export default router;
