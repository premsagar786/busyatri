import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Readiness probe: verifies the API can actually reach Postgres.
// Public (no auth) so hosts and developers can diagnose DB wiring.
router.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json(HealthCheckResponse.parse({ status: "ok" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(503).json({ status: "error", detail: "database unreachable", message });
  }
});

export default router;
