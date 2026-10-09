import { Router } from "express";
import { listRoutes } from "../db/store";

export const routes = Router();

// Real route polylines for the dashboard map + driver app. Seeded in src/db/seed.ts.
routes.get("/", async (_req, res) => {
  try {
    res.json(await listRoutes());
  } catch (err) {
    console.error("[routes] list failed", err);
    res.status(500).json({ error: "db_error" });
  }
});
