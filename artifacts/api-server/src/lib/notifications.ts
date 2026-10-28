import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  membersTable,
  notificationsTable,
  type notificationKindEnum,
} from "@workspace/db";

type NotificationKind =
  (typeof notificationKindEnum.enumValues)[number];
const connectors = new ReplitConnectors();
let warnedMissingSender = false;

async function sendEmail(to: string): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) {
    if (!warnedMissingSender) {
      console.warn(
        "Resend is connected, but RESEND_FROM_EMAIL is not configured; email alerts are paused.",
      );
      warnedMissingSender = true;
    }
    return;
  }
  try {
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: "Wema home operations update",
        text: "There is a new update in the Wema home operations workspace. Sign in to review it.",
        html: "<p>There is a new update in the Wema home operations workspace.</p><p>Sign in to review it.</p>",
      }),
    });
    if (!response.ok) {
      console.error(`Resend email delivery failed with status ${response.status}.`);
    }
  } catch (error) {
    console.error(
      "Resend email delivery failed.",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

export async function notifyUsers(
  userIds: string[],
  title: string,
  message: string,
  kind: NotificationKind,
  href: string,
): Promise<void> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;
  await db.insert(notificationsTable).values(
    uniqueIds.map((userId) => ({
      userId,
      title,
      message,
      kind,
      href,
    })),
  );
  const members = await db
    .select({ email: membersTable.email })
    .from(membersTable)
    .where(inArray(membersTable.userId, uniqueIds));
  await Promise.allSettled(
    members.map((member) => sendEmail(member.email)),
  );
}

export async function notifyRole(
  role: "ceo" | "manager",
  title: string,
  message: string,
  kind: NotificationKind,
  href: string,
  homeId?: string,
): Promise<void> {
  const members = await db
    .select({ userId: membersTable.userId })
    .from(membersTable)
    .where(
      and(
        eq(membersTable.role, role),
        isNotNull(membersTable.userId),
        ...(homeId ? [eq(membersTable.homeId, homeId)] : []),
      ),
    );
  await notifyUsers(
    members.map((member) => member.userId ?? ""),
    title,
    message,
    kind,
    href,
  );
}
