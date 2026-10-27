import { and, eq, isNotNull } from "drizzle-orm";
import {
  db,
  membersTable,
  notificationsTable,
  type notificationKindEnum,
} from "@workspace/db";

type NotificationKind =
  (typeof notificationKindEnum.enumValues)[number];

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
