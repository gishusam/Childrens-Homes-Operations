import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  homesTable,
  issueCommentsTable,
  issuesTable,
  storageUploadsTable,
} from "@workspace/db";
import * as api from "@workspace/api-zod";
import { canAccessHome, isCeo } from "../lib/access";
import { notifyRole, notifyUsers } from "../lib/notifications";

const router: IRouter = Router();

async function issueHomeName(homeId: string): Promise<string> {
  const [home] = await db
    .select({ name: homesTable.name })
    .from(homesTable)
    .where(eq(homesTable.id, homeId))
    .limit(1);
  return home?.name ?? "Home";
}

async function commentsByIssue(issueIds: string[]) {
  if (issueIds.length === 0) return new Map<string, typeof issueCommentsTable.$inferSelect[]>();
  const rows = await db
    .select()
    .from(issueCommentsTable)
    .where(inArray(issueCommentsTable.issueId, issueIds))
    .orderBy(issueCommentsTable.createdAt);
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const comments = grouped.get(row.issueId) ?? [];
    comments.push(row);
    grouped.set(row.issueId, comments);
  }
  return grouped;
}

function mapIssue(
  row: typeof issuesTable.$inferSelect,
  homeName: string,
  comments: typeof issueCommentsTable.$inferSelect[],
) {
  return api.ListIssuesResponseItem.parse({
    id: row.id,
    homeId: row.homeId,
    homeName,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    deadline: row.deadline,
    assignedTo: row.assignedTo,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    attachments: row.attachments,
    comments: comments.map((comment) => ({
      id: comment.id,
      issueId: comment.issueId,
      author: comment.author,
      message: comment.message,
      createdAt: comment.createdAt.toISOString(),
    })),
  });
}

router.get("/issues", async (req, res): Promise<void> => {
  const actor = req.actor!;
  if (actor.role === "manager" && !actor.homeId) {
    res.json([]);
    return;
  }
  const rows = await db
    .select()
    .from(issuesTable)
    .where(
      actor.role === "manager"
        ? eq(issuesTable.homeId, actor.homeId!)
        : undefined,
    )
    .orderBy(desc(issuesTable.createdAt));
  const comments = await commentsByIssue(rows.map((row) => row.id));
  const names = new Map<string, string>();
  await Promise.all(
    rows.map(async (row) => {
      names.set(row.homeId, await issueHomeName(row.homeId));
    }),
  );
  res.json(
    api.ListIssuesResponse.parse(
      rows.map((row) =>
        mapIssue(row, names.get(row.homeId) ?? "Home", comments.get(row.id) ?? []),
      ),
    ),
  );
});

router.post("/issues", async (req, res): Promise<void> => {
  const parsed = api.CreateIssueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!canAccessHome(req.actor!, parsed.data.homeId)) {
    res.status(403).json({ error: "You cannot raise an issue for this home" });
    return;
  }
  const [home] = await db
    .select()
    .from(homesTable)
    .where(eq(homesTable.id, parsed.data.homeId))
    .limit(1);
  if (!home) {
    res.status(404).json({ error: "Home not found" });
    return;
  }

  const attachments = parsed.data.attachments ?? [];
  const paths = attachments.map((file) => file.objectPath);
  if (new Set(paths).size !== paths.length) {
    res.status(400).json({ error: "An attachment was included more than once" });
    return;
  }
  const uploads = paths.length
    ? await db
        .select()
        .from(storageUploadsTable)
        .where(inArray(storageUploadsTable.objectPath, paths))
    : [];
  if (
    uploads.length !== paths.length ||
    uploads.some(
      (upload) =>
        upload.ownerUserId !== req.actor!.userId ||
        upload.issueId !== null ||
        (upload.homeId !== parsed.data.homeId &&
          !(isCeo(req.actor!) && upload.homeId === null)),
    )
  ) {
    res.status(403).json({ error: "An attachment is not available to this account" });
    return;
  }

  const issue = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(issuesTable)
      .values({
        homeId: parsed.data.homeId,
        title: parsed.data.title,
        description: parsed.data.description,
        priority: parsed.data.priority,
        deadline: parsed.data.deadline ?? null,
        createdBy: req.actor!.email,
        createdByUserId: req.actor!.userId,
        attachments,
      })
      .returning();
    if (paths.length > 0) {
      await tx
        .update(storageUploadsTable)
        .set({ issueId: created.id })
        .where(
          and(
            inArray(storageUploadsTable.objectPath, paths),
            eq(storageUploadsTable.ownerUserId, req.actor!.userId),
          ),
        );
    }
    return created;
  });
  const comments: typeof issueCommentsTable.$inferSelect[] = [];
  const response = mapIssue(issue, home.name, comments);
  const notificationTitle =
    issue.priority === "urgent" ? "Urgent issue raised" : "New home issue";
  const notificationMessage = `${home.name}: ${issue.title}`;
  await notifyRole(
    isCeo(req.actor!) ? "manager" : "ceo",
    notificationTitle,
    notificationMessage,
    "issue",
    "/issues",
    isCeo(req.actor!) ? issue.homeId : undefined,
  );
  res.status(201).json(api.CreateIssueResponse.parse(response));
});

router.patch("/issues/:id", async (req, res): Promise<void> => {
  const params = api.UpdateIssueParams.safeParse(req.params);
  const parsed = api.UpdateIssueBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Provide issue details to update" });
    return;
  }
  if (req.actor!.role !== "ceo" && parsed.data.assignedTo !== undefined) {
    res.status(403).json({ error: "Only the CEO can change issue assignments" });
    return;
  }
  const [existing] = await db
    .select()
    .from(issuesTable)
    .where(eq(issuesTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!canAccessHome(req.actor!, existing.homeId)) {
    res.status(403).json({ error: "You cannot update this issue" });
    return;
  }
  const [issue] = await db
    .update(issuesTable)
    .set({
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority !== undefined
        ? { priority: parsed.data.priority }
        : {}),
      ...(parsed.data.deadline !== undefined
        ? { deadline: parsed.data.deadline }
        : {}),
      ...(parsed.data.assignedTo !== undefined
        ? { assignedTo: parsed.data.assignedTo }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(issuesTable.id, existing.id))
    .returning();
  const [homeName, comments] = await Promise.all([
    issueHomeName(issue.homeId),
    commentsByIssue([issue.id]),
  ]);
  await notifyRole(
    isCeo(req.actor!) ? "manager" : "ceo",
    "Issue updated",
    `${homeName}: ${issue.title} needs follow-through.`,
    "issue",
    "/issues",
    isCeo(req.actor!) ? issue.homeId : undefined,
  );
  res.json(
    api.UpdateIssueResponse.parse(
      mapIssue(issue, homeName, comments.get(issue.id) ?? []),
    ),
  );
});

router.post("/issues/:id/comments", async (req, res): Promise<void> => {
  const params = api.AddIssueCommentParams.safeParse(req.params);
  const parsed = api.AddIssueCommentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [issue] = await db
    .select()
    .from(issuesTable)
    .where(eq(issuesTable.id, params.data.id))
    .limit(1);
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  if (!canAccessHome(req.actor!, issue.homeId)) {
    res.status(403).json({ error: "You cannot comment on this issue" });
    return;
  }
  const [comment] = await db
    .insert(issueCommentsTable)
    .values({
      issueId: issue.id,
      author: req.actor!.email,
      message: parsed.data.message,
    })
    .returning();
  if (isCeo(req.actor!)) {
    await notifyRole(
      "manager",
      "Issue update",
      `${issue.title}: a new comment was added.`,
      "issue",
      "/issues",
      issue.homeId,
    );
    await notifyUsers(
      [issue.createdByUserId],
      "Issue update",
      `${issue.title}: a new comment was added.`,
      "issue",
      "/issues",
    );
  } else {
    await notifyRole(
      "ceo",
      "Issue comment added",
      `${issue.title}: a new comment was added.`,
      "issue",
      "/issues",
    );
  }
  res.status(201).json(
    api.AddIssueCommentResponse.parse({
      id: comment.id,
      issueId: comment.issueId,
      author: comment.author,
      message: comment.message,
      createdAt: comment.createdAt.toISOString(),
    }),
  );
});

export default router;
