import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, membersTable } from "@workspace/db";

export type AppRole = "ceo" | "manager" | "unassigned";

export interface Actor {
  userId: string;
  email: string;
  role: AppRole;
  homeId: string | null;
  memberId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

function primaryEmail(
  user: Awaited<ReturnType<typeof clerkClient.users.getUser>>,
): string | null {
  const primary = user.emailAddresses.find(
    (address) => address.id === user.primaryEmailAddressId,
  );
  return (primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null)
    ?.trim()
    .toLowerCase() ?? null;
}

export async function resolveActor(req: Request): Promise<Actor | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;

  const [byUserId] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.userId, userId))
    .limit(1);

  if (byUserId) {
    return {
      userId,
      email: byUserId.email,
      role: byUserId.role,
      homeId: byUserId.homeId,
      memberId: byUserId.id,
    };
  }

  const clerkUser = await clerkClient.users.getUser(userId);
  const email = primaryEmail(clerkUser);
  if (!email) {
    return {
      userId,
      email: "",
      role: "unassigned",
      homeId: null,
      memberId: null,
    };
  }

  const [byEmail] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.email, email))
    .limit(1);

  if (!byEmail || (byEmail.userId && byEmail.userId !== userId)) {
    return {
      userId,
      email,
      role: "unassigned",
      homeId: null,
      memberId: null,
    };
  }

  const [claimed] = await db
    .update(membersTable)
    .set({ userId })
    .where(
      and(
        eq(membersTable.id, byEmail.id),
        or(isNull(membersTable.userId), eq(membersTable.userId, userId)),
      ),
    )
    .returning();

  if (!claimed) {
    return {
      userId,
      email,
      role: "unassigned",
      homeId: null,
      memberId: null,
    };
  }

  return {
    userId,
    email: claimed.email,
    role: claimed.role,
    homeId: claimed.homeId,
    memberId: claimed.id,
  };
}

export async function requireMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = await resolveActor(req);
    if (!actor) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (actor.role === "unassigned") {
      res.status(403).json({
        error: "Your account has not been assigned to a home or organization.",
      });
      return;
    }
    req.actor = actor;
    next();
  } catch (error) {
    req.log.error({ err: error }, "Failed to resolve organization access");
    res.status(500).json({ error: "Unable to resolve organization access" });
  }
}

export function isCeo(actor: Actor): boolean {
  return actor.role === "ceo";
}

export function canAccessHome(actor: Actor, homeId: string): boolean {
  return actor.role === "ceo" || actor.homeId === homeId;
}

export function scopedHomeId(
  actor: Actor,
  requestedHomeId?: string,
): string | undefined {
  return actor.role === "manager" ? actor.homeId ?? undefined : requestedHomeId;
}
