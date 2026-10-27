import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, billsTable, homesTable } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { canAccessHome } from "../lib/access";
import { notifyRole } from "../lib/notifications";

const router: IRouter = Router();
const amount = (value: string | number): number => Number(value);
const today = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

async function getBillHomeName(homeId: string): Promise<string> {
  const [home] = await db
    .select({ name: homesTable.name })
    .from(homesTable)
    .where(eq(homesTable.id, homeId))
    .limit(1);
  return home?.name ?? "Home";
}

router.get("/bills", async (req, res): Promise<void> => {
  const actor = req.actor!;
  if (actor.role === "manager" && !actor.homeId) {
    res.json([]);
    return;
  }
  const rows = await db
    .select()
    .from(billsTable)
    .where(
      actor.role === "manager"
        ? eq(billsTable.homeId, actor.homeId!)
        : undefined,
    )
    .orderBy(billsTable.dueDate, billsTable.name);
  const homes = new Map<string, string>();
  await Promise.all(
    rows.map(async (row) => {
      homes.set(row.homeId, await getBillHomeName(row.homeId));
    }),
  );
  res.json(
    api.ListBillsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        homeId: row.homeId,
        homeName: homes.get(row.homeId) ?? "Home",
        name: row.name,
        vendor: row.vendor,
        amount: amount(row.amount),
        dueDate: row.dueDate,
        frequency: row.frequency,
        status:
          row.status === "paid"
            ? "paid"
            : row.dueDate < today()
              ? "overdue"
              : "upcoming",
      })),
    ),
  );
});

router.post("/bills", async (req, res): Promise<void> => {
  const parsed = api.CreateBillBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!canAccessHome(req.actor!, parsed.data.homeId)) {
    res.status(403).json({ error: "You cannot manage bills for this home" });
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
  const status = parsed.data.dueDate < today() ? "overdue" : "upcoming";
  const [bill] = await db
    .insert(billsTable)
    .values({
      ...parsed.data,
      amount: String(parsed.data.amount),
      status,
    })
    .returning();
  res.status(201).json(
    api.CreateBillResponse.parse({
      id: bill.id,
      homeId: bill.homeId,
      homeName: home.name,
      name: bill.name,
      vendor: bill.vendor,
      amount: amount(bill.amount),
      dueDate: bill.dueDate,
      frequency: bill.frequency,
      status: bill.status,
    }),
  );
});

router.patch("/bills/:id", async (req, res): Promise<void> => {
  const params = api.UpdateBillParams.safeParse(req.params);
  const parsed = api.UpdateBillBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({
      error: params.success ? parsed.error.message : params.error.message,
    });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Provide bill details to update" });
    return;
  }
  const [existing] = await db
    .select()
    .from(billsTable)
    .where(eq(billsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Bill not found" });
    return;
  }
  if (!canAccessHome(req.actor!, existing.homeId)) {
    res.status(403).json({ error: "You cannot update this home's bills" });
    return;
  }
  const [bill] = await db
    .update(billsTable)
    .set({
      ...(parsed.data.amount !== undefined
        ? { amount: String(parsed.data.amount) }
        : {}),
      ...(parsed.data.dueDate !== undefined
        ? { dueDate: parsed.data.dueDate }
        : {}),
      ...(parsed.data.status !== undefined
        ? {
            status: parsed.data.status,
            lastPaidAt:
              parsed.data.status === "paid" ? new Date() : existing.lastPaidAt,
          }
        : {}),
    })
    .where(eq(billsTable.id, existing.id))
    .returning();
  const homeName = await getBillHomeName(bill.homeId);
  if (bill.status === "overdue") {
    await notifyRole(
      "ceo",
      "Bill is overdue",
      `${homeName}: ${bill.name} was due ${bill.dueDate}.`,
      "bill",
      "/bills",
    );
  }
  res.json(
    api.UpdateBillResponse.parse({
      id: bill.id,
      homeId: bill.homeId,
      homeName,
      name: bill.name,
      vendor: bill.vendor,
      amount: amount(bill.amount),
      dueDate: bill.dueDate,
      frequency: bill.frequency,
      status:
        bill.status === "paid"
          ? "paid"
          : bill.dueDate < today()
            ? "overdue"
            : "upcoming",
    }),
  );
});

export default router;
