import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, appUsersTable } from "@workspace/db";

export type AppUser = typeof appUsersTable.$inferSelect;

declare global {
  namespace Express {
    interface Request {
      currentUser?: AppUser;
    }
  }
}

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }

  try {
    const [byClerkId] = await db
      .select()
      .from(appUsersTable)
      .where(eq(appUsersTable.clerkId, userId))
      .limit(1);
    if (byClerkId) {
      req.currentUser = byClerkId;
      next();
      return;
    }

    const clerkUser = await clerkClient.users.getUser(userId);
    const primaryEmail =
      clerkUser.emailAddresses.find(
        (address) => address.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
    if (!primaryEmail) {
      res.status(400).json({ error: "Your account needs a verified email" });
      return;
    }

    const email = primaryEmail.trim().toLowerCase();
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      email.split("@")[0] ||
      "Campus member";

    const [invitation] = await db
      .select()
      .from(appUsersTable)
      .where(and(eq(appUsersTable.email, email), isNull(appUsersTable.clerkId)))
      .limit(1);

    if (invitation) {
      const [linked] = await db
        .update(appUsersTable)
        .set({ clerkId: userId, name })
        .where(eq(appUsersTable.id, invitation.id))
        .returning();
      if (linked) {
        req.currentUser = linked;
        next();
        return;
      }
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appUsersTable)
      .where(eq(appUsersTable.role, "admin"));
    const role = count === 0 ? "admin" : "student";

    let [created] = await db
      .insert(appUsersTable)
      .values({ clerkId: userId, email, name, role })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const [existing] = await db
        .select()
        .from(appUsersTable)
        .where(eq(appUsersTable.clerkId, userId))
        .limit(1);
      if (existing) {
        req.currentUser = existing;
        next();
        return;
      }
      [created] = await db
        .insert(appUsersTable)
        .values({ clerkId: userId, email, name, role: "student" })
        .onConflictDoNothing()
        .returning();
    }
    if (!created) {
      res.status(409).json({ error: "Your account is already registered" });
      return;
    }
    req.currentUser = created;
    next();
  } catch (error) {
    req.log?.error({ error, userId }, "Unable to resolve the signed-in user");
    res.status(500).json({ error: "Unable to load your account" });
  }
}

export function requireRole(...roles: AppUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      res.status(401).json({ error: "Sign in to continue" });
      return;
    }
    if (!roles.includes(req.currentUser.role)) {
      res.status(403).json({ error: "You do not have access to this feature" });
      return;
    }
    next();
  };
}
