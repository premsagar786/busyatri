import crypto from "node:crypto";
import { findBusByTokenHash } from "../db/store";

const PEPPER = process.env.TOKEN_PEPPER || "dev-pepper-change-me";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(`${PEPPER}:${token}`).digest("hex");
}

export function makeToken(prefix = "bt"): string {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

export interface AuthedBus {
  id: number;
  bus_number: string;
}

export async function findBusByToken(token: string): Promise<AuthedBus | null> {
  const row = await findBusByTokenHash(hashToken(token));
  return row ?? null;
}
