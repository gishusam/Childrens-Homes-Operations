import { Router, type IRouter } from "express";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
} from "drizzle-orm";
import {
  db,
  billsTable,
  expensesTable,
  homesTable,
  inventoryItemsTable,
  issuesTable,
  membersTable,
  organizationSettingsTable,
  weeklyReportsTable,
} from "@workspace/db";
import * as api from "@workspace/api-zod";
import {
  canAccessHome,
  isCeo,
  requireMember,
  resolveActor,
  scopedHomeId,
} from "../lib/access";
import { notifyRole, notifyUsers } from "../lib/notifications";

const router: IRouter = Router();
const currency = (value: string | number | null | undefined): number =>
  Number(value ?? 0);
const today = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

function monthStart(monthOffset = 0): string {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - monthOffset);
  return date.toISOString().slice(0, 10);
}

function weekStart(): string {
  const date = new Date(`${today()}T00:00:00Z`);
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
}

function dateAfter(days: number): string {
  const date = new Date(`${today()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function ensureSettings() {
  await db
    .insert(organizationSettingsTable)
    .values({ id: "default" })
    .onConflictDoNothing();
  const [settings] = await db
    .select()
    .from(organizationSettingsTable)
    .where(eq(organizationSettingsTable.id, "default"))
    .limit(1);
  return settings;
}

function homeStatus({
  spend,
  budget,
  reportSubmitted,
  lowStock,
  urgentIssue,
}: {
  spend: number;
  budget: number;
  reportSubmitted: boolean;
  lowStock: boolean;
  urgentIssue: boolean;
}): "good" | "attention" | "urgent" {
  if (urgentIssue) return "urgent";
  if (
    !reportSubmitted ||
    lowStock ||
    (budget > 0 && spend / budget >= 0.8)
  ) {
    return "attention";
  }
  return "good";
}

async function listHomeCards(actor: NonNullable<Express.Request["actor"]>) {
  if (actor.role === "manager" && !actor.homeId) return [];
  const homes = await db
    .select()
    .from(homesTable)
    .where(
      actor.role === "manager"
        ? eq(homesTable.id, actor.homeId!)
        : undefined,
    )
    .orderBy(homesTable.name);

  if (homes.length === 0) return [];
  const ids = homes.map((home) => home.id);
  const start = monthStart();
  const currentWeek = weekStart();
  const [expenses, reports, inventory, issues] = await Promise.all([
    db
      .select({
        homeId: expensesTable.homeId,
        amount: expensesTable.amount,
      })
      .from(expensesTable)
      .where(
        and(
          inArray(expensesTable.homeId, ids),
          gte(expensesTable.date, start),
          ne(expensesTable.status, "rejected"),
        ),
      ),
    db
      .select({ homeId: weeklyReportsTable.homeId })
      .from(weeklyReportsTable)
      .where(
        and(
          inArray(weeklyReportsTable.homeId, ids),
          eq(weeklyReportsTable.weekStarting, currentWeek),
        ),
      ),
    db
      .select({
        homeId: inventoryItemsTable.homeId,
        quantity: inventoryItemsTable.quantity,
        lowStockAt: inventoryItemsTable.lowStockAt,
      })
      .from(inventoryItemsTable)
      .where(inArray(inventoryItemsTable.homeId, ids)),
    db
      .select({
        homeId: issuesTable.homeId,
        priority: issuesTable.priority,
        status: issuesTable.status,
      })
      .from(issuesTable)
      .where(
        and(
          inArray(issuesTable.homeId, ids),
          ne(issuesTable.status, "resolved"),
        ),
      ),
  ]);

  const spendByHome = new Map<string, number>();
  for (const expense of expenses) {
    spendByHome.set(
      expense.homeId,
      (spendByHome.get(expense.homeId) ?? 0) + currency(expense.amount),
    );
  }
  const reportedHomes = new Set(reports.map((report) => report.homeId));
  const lowStockHomes = new Set(
    inventory
      .filter((item) => currency(item.quantity) <= currency(item.lowStockAt))
      .map((item) => item.homeId),
  );
  const urgentHomes = new Set(
    issues
      .filter((issue) => issue.priority === "urgent")
      .map((issue) => issue.homeId),
  );

  return homes.map((home) => {
    const spend = spendByHome.get(home.id) ?? 0;
    const reportSubmitted = reportedHomes.has(home.id);
    return api.ListHomesResponseItem.parse({
      id: home.id,
      name: home.name,
      location: home.location,
      managerName: home.managerName,
      capacity: home.capacity,
      occupancy: home.occupancy,
      monthlyBudget: currency(home.monthlyBudget),
      spend,
      status: homeStatus({
        spend,
        budget: currency(home.monthlyBudget),
        reportSubmitted,
        lowStock: lowStockHomes.has(home.id),
        urgentIssue: urgentHomes.has(home.id),
      }),
      reportSubmitted,
      approvalThreshold:
        home.approvalThreshold === null
          ? null
          : currency(home.approvalThreshold),
    });
  });
}

async function homeNameMap(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: homesTable.id, name: homesTable.name })
    .from(homesTable)
    .where(inArray(homesTable.id, ids));
  return new Map(rows.map((home) => [home.id, home.name]));
}

router.get("/session", async (req, res): Promise<void> => {
  const actor = await resolveActor(req);
  if (!actor) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const [settings, home] = await Promise.all([
    ensureSettings(),
    actor.homeId
      ? db
          .select()
          .from(homesTable)
          .where(eq(homesTable.id, actor.homeId))
          .limit(1)
          .then((rows) => rows[0])
      : Promise.resolve(undefined),
  ]);
  const threshold = home?.approvalThreshold
    ? currency(home.approvalThreshold)
    : currency(settings.approvalThreshold);
  res.json(
    api.GetSessionResponse.parse({
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      homeId: actor.homeId,
      homeName: home?.name ?? null,
      threshold,
      isDemo: settings.isDemo,
    }),
  );
});

router.use(requireMember);

router.get("/dashboard", async (req, res): Promise<void> => {
  const actor = req.actor!;
  const homes = await listHomeCards(actor);
  const ids = homes.map((home) => home.id);
  const start = monthStart();
  const trendStart = monthStart(5);
  const currentWeek = weekStart();
  const until = dateAfter(7);
  const [expenses, pending, issues, inventory, bills, reports, settings] =
    await Promise.all([
      db
        .select({
          homeId: expensesTable.homeId,
          amount: expensesTable.amount,
          date: expensesTable.date,
        })
        .from(expensesTable)
        .where(
          and(
            inArray(expensesTable.homeId, ids),
            gte(expensesTable.date, trendStart),
            ne(expensesTable.status, "rejected"),
          ),
        ),
      db
        .select({ id: expensesTable.id })
        .from(expensesTable)
        .where(
          and(
            inArray(expensesTable.homeId, ids),
            eq(expensesTable.status, "pending"),
          ),
        ),
      db
        .select({ id: issuesTable.id })
        .from(issuesTable)
        .where(
          and(
            inArray(issuesTable.homeId, ids),
            ne(issuesTable.status, "resolved"),
          ),
        ),
      db
        .select({
          id: inventoryItemsTable.id,
          quantity: inventoryItemsTable.quantity,
          lowStockAt: inventoryItemsTable.lowStockAt,
        })
        .from(inventoryItemsTable)
        .where(inArray(inventoryItemsTable.homeId, ids)),
      db
        .select({
          id: billsTable.id,
          dueDate: billsTable.dueDate,
          status: billsTable.status,
        })
        .from(billsTable)
        .where(
          and(
            inArray(billsTable.homeId, ids),
            lte(billsTable.dueDate, until),
            ne(billsTable.status, "paid"),
          ),
        ),
      db
        .select({ homeId: weeklyReportsTable.homeId })
        .from(weeklyReportsTable)
        .where(
          and(
            inArray(weeklyReportsTable.homeId, ids),
            eq(weeklyReportsTable.weekStarting, currentWeek),
          ),
        ),
      ensureSettings(),
    ]);

  const spentThisMonth = expenses.reduce((total, row) => {
    if (row.date < start) return total;
    return total + currency(row.amount);
  }, 0);
  const monthlyBudget = homes.reduce(
    (total, home) => total + home.monthlyBudget,
    0,
  );
  const trend = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(`${monthStart(5 - index)}T00:00:00Z`);
    const key = month.toISOString().slice(0, 7);
    const spend = expenses.reduce(
      (total, row) =>
        row.date.slice(0, 7) === key ? total + currency(row.amount) : total,
      0,
    );
    const budget = monthlyBudget;
    return { label: month.toLocaleDateString("en-KE", { month: "short" }), spend, budget };
  });
  const homeNames = new Map(homes.map((home) => [home.id, home.name]));
  const recentExpenseRows = await db
    .select()
    .from(expensesTable)
    .where(inArray(expensesTable.homeId, ids))
    .orderBy(desc(expensesTable.createdAt))
    .limit(5);
  const recentIssueRows = await db
    .select()
    .from(issuesTable)
    .where(inArray(issuesTable.homeId, ids))
    .orderBy(desc(issuesTable.createdAt))
    .limit(5);
  const recentReportRows = await db
    .select()
    .from(weeklyReportsTable)
    .where(inArray(weeklyReportsTable.homeId, ids))
    .orderBy(desc(weeklyReportsTable.submittedAt))
    .limit(5);
  const recentInventoryRows = await db
    .select()
    .from(inventoryItemsTable)
    .where(inArray(inventoryItemsTable.homeId, ids))
    .orderBy(desc(inventoryItemsTable.updatedAt))
    .limit(5);
  const recentBillRows = await db
    .select()
    .from(billsTable)
    .where(inArray(billsTable.homeId, ids))
    .orderBy(desc(billsTable.dueDate))
    .limit(5);
  const activity = [
    ...recentExpenseRows.map((row) => ({
      id: `expense-${row.id}`,
      title: "Expense recorded",
      detail: `${row.category} · ${homeNames.get(row.homeId) ?? "Home"}`,
      timestamp: row.createdAt.toISOString(),
      kind: "expense" as const,
    })),
    ...recentIssueRows.map((row) => ({
      id: `issue-${row.id}`,
      title: row.title,
      detail: `${homeNames.get(row.homeId) ?? "Home"} · ${row.priority} priority`,
      timestamp: row.createdAt.toISOString(),
      kind: "issue" as const,
    })),
    ...recentReportRows.map((row) => ({
      id: `report-${row.id}`,
      title: "Weekly report submitted",
      detail: homeNames.get(row.homeId) ?? "Home",
      timestamp: row.submittedAt.toISOString(),
      kind: "report" as const,
    })),
    ...recentInventoryRows.map((row) => ({
      id: `inventory-${row.id}`,
      title: "Stock updated",
      detail: `${row.name} · ${homeNames.get(row.homeId) ?? "Home"}`,
      timestamp: row.updatedAt.toISOString(),
      kind: "inventory" as const,
    })),
    ...recentBillRows.map((row) => ({
      id: `bill-${row.id}`,
      title: row.status === "overdue" ? "Bill overdue" : "Upcoming bill",
      detail: `${row.name} · ${homeNames.get(row.homeId) ?? "Home"}`,
      timestamp: `${row.dueDate}T00:00:00.000Z`,
      kind: "bill" as const,
    })),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8);
  const reportCompliance =
    homes.length === 0
      ? 0
      : Math.round((new Set(reports.map((report) => report.homeId)).size / homes.length) * 100);

  res.json(
    api.GetDashboardResponse.parse({
      homes,
      monthSpend: spentThisMonth,
      monthBudget: monthlyBudget,
      pendingApprovals: pending.length,
      openIssues: issues.length,
      lowStock: inventory.filter(
        (item) => currency(item.quantity) <= currency(item.lowStockAt),
      ).length,
      upcomingBills: bills.length,
      reportCompliance,
      spendTrend: trend,
      recentActivity: activity,
      isDemo: settings.isDemo,
    }),
  );
});

router.get("/homes", async (req, res): Promise<void> => {
  res.json(api.ListHomesResponse.parse(await listHomeCards(req.actor!)));
});

router.post("/homes", async (req, res): Promise<void> => {
  if (!isCeo(req.actor!)) {
    res.status(403).json({ error: "Only the CEO can create a home" });
    return;
  }
  const parsed = api.CreateHomeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [home] = await db
    .insert(homesTable)
    .values({
      ...parsed.data,
      monthlyBudget: String(parsed.data.monthlyBudget),
    })
    .returning();
  res.status(201).json(
    api.CreateHomeResponse.parse({
      id: home.id,
      name: home.name,
      location: home.location,
      managerName: home.managerName,
      capacity: home.capacity,
      occupancy: home.occupancy,
      monthlyBudget: currency(home.monthlyBudget),
      spend: 0,
      status: "attention",
      reportSubmitted: false,
      approvalThreshold: null,
    }),
  );
});

router.get("/homes/:id", async (req, res): Promise<void> => {
  const params = api.GetHomeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [home] = await db
    .select()
    .from(homesTable)
    .where(eq(homesTable.id, params.data.id))
    .limit(1);
  if (!home) {
    res.status(404).json({ error: "Home not found" });
    return;
  }
  if (!canAccessHome(req.actor!, home.id)) {
    res.status(403).json({ error: "You cannot access this home" });
    return;
  }
  const cards = await listHomeCards(req.actor!);
  res.json(api.GetHomeResponse.parse(cards.find((item) => item.id === home.id)));
});

router.patch("/homes/:id", async (req, res): Promise<void> => {
  if (!isCeo(req.actor!)) {
    res.status(403).json({ error: "Only the CEO can update a home profile" });
    return;
  }
  const params = api.UpdateHomeParams.safeParse(req.params);
  const parsed = api.UpdateHomeBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({
      error: params.error.message,
    });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.message,
    });
    return;
  }
  const {
    monthlyBudget,
    approvalThreshold,
    ...homeUpdates
  } = parsed.data;
  const [home] = await db
    .update(homesTable)
    .set({
      ...homeUpdates,
      ...(monthlyBudget !== undefined
        ? { monthlyBudget: String(monthlyBudget) }
        : {}),
      ...(approvalThreshold !== undefined
        ? {
            approvalThreshold:
              approvalThreshold === null ? null : String(approvalThreshold),
          }
        : {}),
    })
    .where(eq(homesTable.id, params.data.id))
    .returning();
  if (!home) {
    res.status(404).json({ error: "Home not found" });
    return;
  }
  const cards = await listHomeCards(req.actor!);
  res.json(api.UpdateHomeResponse.parse(cards.find((item) => item.id === home.id)));
});

router.get("/settings", async (req, res): Promise<void> => {
  const settings = await ensureSettings();
  res.json(
    api.GetSettingsResponse.parse({
      approvalThreshold: currency(settings.approvalThreshold),
    }),
  );
});

router.patch("/settings", async (req, res): Promise<void> => {
  if (!isCeo(req.actor!)) {
    res.status(403).json({ error: "Only the CEO can update organization settings" });
    return;
  }
  const parsed = api.UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [settings] = await db
    .insert(organizationSettingsTable)
    .values({
      id: "default",
      approvalThreshold: String(parsed.data.approvalThreshold),
    })
    .onConflictDoUpdate({
      target: organizationSettingsTable.id,
      set: {
        approvalThreshold: String(parsed.data.approvalThreshold),
        updatedAt: new Date(),
      },
    })
    .returning();
  res.json(
    api.UpdateSettingsResponse.parse({
      approvalThreshold: currency(settings.approvalThreshold),
    }),
  );
});

router.get("/members", async (req, res): Promise<void> => {
  if (!isCeo(req.actor!)) {
    res.status(403).json({ error: "Only the CEO can list members" });
    return;
  }
  const members = await db.select().from(membersTable).orderBy(membersTable.email);
  const homeNames = await homeNameMap(
    members.map((member) => member.homeId).filter((id): id is string => id !== null),
  );
  res.json(
    api.ListMembersResponse.parse(
      members.map((member) => ({
        id: member.id,
        email: member.email,
        role: member.role,
        homeId: member.homeId,
        homeName: member.homeId ? homeNames.get(member.homeId) ?? null : null,
      })),
    ),
  );
});

router.post("/members", async (req, res): Promise<void> => {
  if (!isCeo(req.actor!)) {
    res.status(403).json({ error: "Only the CEO can assign organization roles" });
    return;
  }
  const parsed = api.AssignMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const homeId = parsed.data.role === "manager" ? parsed.data.homeId : null;
  if (parsed.data.role === "manager" && !homeId) {
    res.status(400).json({ error: "A manager must be assigned to a home" });
    return;
  }
  if (homeId) {
    const [home] = await db
      .select({ id: homesTable.id })
      .from(homesTable)
      .where(eq(homesTable.id, homeId))
      .limit(1);
    if (!home) {
      res.status(404).json({ error: "Home not found" });
      return;
    }
  }
  const [member] = await db
    .insert(membersTable)
    .values({ email, role: parsed.data.role, homeId })
    .onConflictDoUpdate({
      target: membersTable.email,
      set: { role: parsed.data.role, homeId },
    })
    .returning();
  const names = await homeNameMap(member.homeId ? [member.homeId] : []);
  res.status(201).json(
    api.AssignMemberResponse.parse({
      id: member.id,
      email: member.email,
      role: member.role,
      homeId: member.homeId,
      homeName: member.homeId ? names.get(member.homeId) ?? null : null,
    }),
  );
});

router.get("/expenses", async (req, res): Promise<void> => {
  const params = api.ListExpensesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const selectedHome = scopedHomeId(req.actor!, params.data.homeId);
  const filters = [];
  if (req.actor!.role === "manager") {
    if (!selectedHome) {
      res.json([]);
      return;
    }
    filters.push(eq(expensesTable.homeId, selectedHome));
  } else if (selectedHome) {
    filters.push(eq(expensesTable.homeId, selectedHome));
  }
  if (params.data.status) {
    filters.push(eq(expensesTable.status, params.data.status));
  }
  const rows = await db
    .select()
    .from(expensesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt));
  const names = await homeNameMap(rows.map((row) => row.homeId));
  res.json(
    api.ListExpensesResponse.parse(
      rows.map((row) => ({
        id: row.id,
        homeId: row.homeId,
        homeName: names.get(row.homeId) ?? "Home",
        category: row.category,
        description: row.description,
        amount: currency(row.amount),
        date: row.date,
        status: row.status,
        submittedBy: row.submittedBy,
        approvalRequired: row.approvalRequired,
      })),
    ),
  );
});

router.post("/expenses", async (req, res): Promise<void> => {
  const parsed = api.CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!canAccessHome(req.actor!, parsed.data.homeId)) {
    res.status(403).json({ error: "You cannot record expenses for this home" });
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
  const settings = await ensureSettings();
  const threshold = home.approvalThreshold
    ? currency(home.approvalThreshold)
    : currency(settings.approvalThreshold);
  const approvalRequired =
    req.actor!.role !== "ceo" && parsed.data.amount > threshold;
  const status = approvalRequired ? "pending" : "approved";
  const [expense] = await db
    .insert(expensesTable)
    .values({
      ...parsed.data,
      amount: String(parsed.data.amount),
      status,
      approvalRequired,
      submittedBy: req.actor!.email,
      submittedByUserId: req.actor!.userId,
    })
    .returning();
  if (approvalRequired) {
    await notifyRole(
      "ceo",
      "Expense needs approval",
      `${home.name}: ${expense.category} · KES ${currency(expense.amount).toLocaleString("en-KE")}`,
      "approval",
      "/expenses",
    );
  }
  res.status(201).json(
    api.CreateExpenseResponse.parse({
      id: expense.id,
      homeId: expense.homeId,
      homeName: home.name,
      category: expense.category,
      description: expense.description,
      amount: currency(expense.amount),
      date: expense.date,
      status: expense.status,
      submittedBy: expense.submittedBy,
      approvalRequired: expense.approvalRequired,
    }),
  );
});

router.post("/expenses/:id/review", async (req, res): Promise<void> => {
  if (!isCeo(req.actor!)) {
    res.status(403).json({ error: "Only the CEO can review expenses" });
    return;
  }
  const params = api.ReviewExpenseParams.safeParse(req.params);
  const parsed = api.ReviewExpenseBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(expensesTable)
    .where(eq(expensesTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "This expense has already been reviewed" });
    return;
  }
  const [expense] = await db
    .update(expensesTable)
    .set({
      status: parsed.data.decision,
      reviewNote: parsed.data.note ?? null,
      reviewerId: req.actor!.userId,
      reviewedAt: new Date(),
    })
    .where(eq(expensesTable.id, existing.id))
    .returning();
  const [home] = await db
    .select({ name: homesTable.name })
    .from(homesTable)
    .where(eq(homesTable.id, expense.homeId))
    .limit(1);
  await notifyUsers(
    [expense.submittedByUserId],
    `Expense ${expense.status}`,
    `${home?.name ?? "Your home"}: ${expense.category} · KES ${currency(expense.amount).toLocaleString("en-KE")}`,
    "approval",
    "/expenses",
  );
  res.json(
    api.ReviewExpenseResponse.parse({
      id: expense.id,
      homeId: expense.homeId,
      homeName: home?.name ?? "Home",
      category: expense.category,
      description: expense.description,
      amount: currency(expense.amount),
      date: expense.date,
      status: expense.status,
      submittedBy: expense.submittedBy,
      approvalRequired: expense.approvalRequired,
    }),
  );
});

export default router;
