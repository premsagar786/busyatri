import "dotenv/config";
import express from "express";
import cors from "cors";
import compression from "compression";
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { dbOk } from "./db/store";
import { isPg } from "./db";
import { positions } from "./routes/positions";
import { buses } from "./routes/buses";
import { routes } from "./routes/routes";
import { attachWs, clientCount } from "./ws/hub";
import { generalLimiter } from "./utils/rateLimit";

const app = express();
const PORT = Number(process.env.PORT || 3000);

// gzip request bodies (driver app compresses batches > 1KB)
app.use((req, _res, next) => {
  if (req.headers["content-encoding"] === "gzip") {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const buf = zlib.gunzipSync(Buffer.concat(chunks));
        (req as unknown as { body: unknown }).body = JSON.parse(buf.toString("utf8"));
        next();
      } catch {
        (req as unknown as { body: unknown }).body = {};
        next();
      }
    });
    req.on("error", () => next());
  } else {
    next();
  }
});

app.use(compression());
app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN === "*" ? true : (process.env.CORS_ORIGIN || "").split(","),
    credentials: false,
  })
);
app.use(generalLimiter);

app.get("/health", async (_req, res) => {
  const ok = await dbOk();
  res.status(ok ? 200 : 503).json({ ok, db: isPg ? "supabase/postgres" : "sqlite", time: new Date().toISOString(), ws_clients: clientCount() });
});

app.use("/api/v1/positions", positions);
app.use("/api/v1/buses", buses);
app.use("/api/v1/routes", routes);

app.get("/api", (_req, res) => {
  res.json({
    name: "BusYatri API",
    version: "1.0.0",
    endpoints: ["GET /health", "GET /api/v1/buses", "GET /api/v1/buses/me", "GET /api/v1/routes", "GET /api/v1/buses/:id/trail", "POST /api/v1/positions/batch", "WS /ws/live"],
  });
});

// Serve the brutalist dashboard (frontend) from the same origin so one
// deploy covers API + UI. DASHBOARD_DIR defaults to ../dashboard in dev
// and /app/dashboard in Docker.
const dashboardDir =
  process.env.DASHBOARD_DIR ||
  (fs.existsSync(path.join(process.cwd(), "dashboard", "index.html"))
    ? path.join(process.cwd(), "dashboard")
    : path.join(__dirname, "..", "..", "dashboard"));
if (fs.existsSync(path.join(dashboardDir, "index.html"))) {
  app.use(express.static(dashboardDir));
  console.log(`[api] serving dashboard from ${dashboardDir}`);
  app.get("/", (_req, res) => res.sendFile(path.join(dashboardDir, "index.html")));
} else {
  console.log(`[api] dashboard not found at ${dashboardDir} (API-only mode)`);
  app.get("/", (_req, res) => res.redirect("/api"));
}

const server = http.createServer(app);
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;
server.keepAliveTimeout = 65_000;

attachWs(server);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[api] listening on :${PORT} env=${process.env.NODE_ENV || "development"}`);
  // Never fail silently on default secrets: they are public knowledge
  // (README, .env.example), so flag them loudly in every environment.
  if (!process.env.TOKEN_PEPPER) {
    console.warn("[SECURITY] TOKEN_PEPPER not set — using dev default. Set a long random value in production!");
  }
  if (!process.env.ADMIN_KEY) {
    console.warn("[SECURITY] ADMIN_KEY not set — using dev default 'admin-dev-key'. Set a secret in production!");
  }
});
