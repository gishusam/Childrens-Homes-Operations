import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  homesTable,
  notificationsTable,
  weeklyReportsTable,
} from "@workspace/db";
import * as api from "@workspace/api-zod";
import { canAccessHome, isCeo } from "../lib/access";
import { notifyRole } from "../lib/notifications";

const router: IRouter = Router();

router.get("/reports", async (req, res): Promise<void> => {
  const actor = req.actor!;
  if (actor.role === "manager" && !actor.homeId) {
    res.json([]);
    return;
  }
  const rows = await db
    .select()
    .from(weeklyReportsTable)
    .where(
      actor.role === "manager"
        ? eq(weeklyReportsTable.homeId, actor.homeId!)
        : undefined,
    )
    .orderBy(desc(weeklyReportsTable.weekStarting));
  const homeIds = [...new Set(rows.map((row) => row.homeId))];
  const homes = homeIds.length
    ? await db
        .select({ id: homesTable.id, name: homesTable.name })
        .from(homesTable)
        .where(inArray(homesTable.id, homeIds))
    : [];
  const homeNames = new Map(homes.map((home) => [home.id, home.name]));
  res.json(
    api.ListReportsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        homeId: row.homeId,
        homeName: homeNames.get(row.homeId) ?? "Home",
        weekStarting: row.weekStarting,
        summary: row.summary,
        highlights: row.highlights,
        needsSupport: row.needsSupport,
        submittedBy: row.submittedBy,
        submittedAt: row.submittedAt.toISOString(),
      })),
    ),
  );
});

router.post("/reports", async (req, res): Promise<void> => {
  const parsed = api.SubmitWeeklyReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!canAccessHome(req.actor!, parsed.data.homeId)) {
    res.status(403).json({ error: "You cannot submit a report for this home" });
    return;
  }
  const [home] = await db
    .select({ name: homesTable.name })
    .from(homesTable)
    .where(eq(homesTable.id, parsed.data.homeId))
    .limit(1);
  if (!home) {
    res.status(404).json({ error: "Home not found" });
    return;
  }
  const [report] = await db
    .insert(weeklyReportsTable)
    .values({
      ...parsed.data,
      submittedBy: req.actor!.email,
      submittedByUserId: req.actor!.userId,
    })
    .onConflictDoUpdate({
      target: [weeklyReportsTable.homeId, weeklyReportsTable.weekStarting],
      set: {
        summary: parsed.data.summary,
        highlights: parsed.data.highlights,
        needsSupport: parsed.data.needsSupport,
        submittedBy: req.actor!.email,
        submittedByUserId: req.actor!.userId,
        submittedAt: new Date(),
      },
    })
    .returning();
  await notifyRole(
    "ceo",
    "Weekly report submitted",
    `${home.name} has submitted its weekly update.`,
    "report",
    "/reports",
  );
  res.status(201).json(
    api.SubmitWeeklyReportResponse.parse({
      id: report.id,
      homeId: report.homeId,
      homeName: home.name,
      weekStarting: report.weekStarting,
      summary: report.summary,
      highlights: report.highlights,
      needsSupport: report.needsSupport,
      submittedBy: report.submittedBy,
      submittedAt: report.submittedAt.toISOString(),
    }),
  );
});

router.get("/notifications", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.actor!.userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(
    api.ListNotificationsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        kind: row.kind,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
        href: row.href,
      })),
    ),
  );
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const params = api.MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.id, params.data.id),
        eq(notificationsTable.userId, req.actor!.userId),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(
    api.MarkNotificationReadResponse.parse({
      id: row.id,
      title: row.title,
      message: row.message,
      kind: row.kind,
      read: true,
      createdAt: row.createdAt.toISOString(),
      href: row.href,
    }),
  );
});

export default router;
