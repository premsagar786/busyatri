import { Request, Response, NextFunction } from "express";
import { findBusByToken } from "./tokens";

declare global {
  namespace Express {
    interface Request {
      busId?: number;
      busNumber?: string;
    }
  }
}

export async function authBus(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "missing_token" });
  try {
    const bus = await findBusByToken(token);
    if (!bus) return res.status(401).json({ error: "invalid_token" });
    req.busId = bus.id;
    req.busNumber = bus.bus_number;
    next();
  } catch (err) {
    console.error("[auth] lookup failed", err);
    return res.status(500).json({ error: "auth_error" });
  }
}

export function authAdmin(req: Request, res: Response, next: NextFunction) {
  const adminKey = process.env.ADMIN_KEY || "admin-dev-key";
  const got = (req.headers["x-admin-key"] as string) || "";
  if (got !== adminKey) return res.status(401).json({ error: "admin_only" });
  next();
}
