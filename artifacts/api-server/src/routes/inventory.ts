import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  homesTable,
  inventoryItemsTable,
  inventoryTransfersTable,
} from "@workspace/db";
import * as api from "@workspace/api-zod";
import { canAccessHome, isCeo } from "../lib/access";
import { notifyRole } from "../lib/notifications";

const router: IRouter = Router();
const amount = (value: string | number): number => Number(value);

async function namesFor(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ id: homesTable.id, name: homesTable.name })
    .from(homesTable)
    .where(inArray(homesTable.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

router.get("/inventory", async (req, res): Promise<void> => {
  const actor = req.actor!;
  if (actor.role === "manager" && !actor.homeId) {
    res.json([]);
    return;
  }
  const rows = await db
    .select()
    .from(inventoryItemsTable)
    .where(
      actor.role === "manager"
        ? eq(inventoryItemsTable.homeId, actor.homeId!)
        : undefined,
    )
    .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
  const names = await namesFor(rows.map((item) => item.homeId));
  res.json(
    api.ListInventoryResponse.parse(
      rows.map((item) => ({
        id: item.id,
        homeId: item.homeId,
        homeName: names.get(item.homeId) ?? "Home",
        name: item.name,
        category: item.category,
        quantity: amount(item.quantity),
        unit: item.unit,
        unitCost: amount(item.unitCost),
        lowStockAt: amount(item.lowStockAt),
        updatedAt: item.updatedAt.toISOString(),
      })),
    ),
  );
});

router.post("/inventory", async (req, res): Promise<void> => {
  const parsed = api.CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!canAccessHome(req.actor!, parsed.data.homeId)) {
    res.status(403).json({ error: "You cannot update stock for this home" });
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
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({
      ...parsed.data,
      quantity: String(parsed.data.quantity),
      unitCost: String(parsed.data.unitCost),
      lowStockAt: String(parsed.data.lowStockAt),
    })
    .returning();
  if (parsed.data.quantity <= parsed.data.lowStockAt) {
    await notifyRole(
      "ceo",
      "Stock needs attention",
      `${home.name}: ${item.name} is at or below its low-stock level.`,
      "stock",
      "/inventory",
    );
  }
  res.status(201).json(
    api.CreateInventoryItemResponse.parse({
      id: item.id,
      homeId: item.homeId,
      homeName: home.name,
      name: item.name,
      category: item.category,
      quantity: amount(item.quantity),
      unit: item.unit,
      unitCost: amount(item.unitCost),
      lowStockAt: amount(item.lowStockAt),
      updatedAt: item.updatedAt.toISOString(),
    }),
  );
});

router.patch("/inventory/:id", async (req, res): Promise<void> => {
  const params = api.UpdateInventoryItemParams.safeParse(req.params);
  const parsed = api.UpdateInventoryItemBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({
      error: params.success ? parsed.error.message : params.error.message,
    });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Provide a stock value to update" });
    return;
  }
  const [existing] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }
  if (!canAccessHome(req.actor!, existing.homeId)) {
    res.status(403).json({ error: "You cannot update this home's stock" });
    return;
  }
  const [item] = await db
    .update(inventoryItemsTable)
    .set({
      ...(parsed.data.quantity !== undefined
        ? { quantity: String(parsed.data.quantity) }
        : {}),
      ...(parsed.data.unitCost !== undefined
        ? { unitCost: String(parsed.data.unitCost) }
        : {}),
      ...(parsed.data.lowStockAt !== undefined
        ? { lowStockAt: String(parsed.data.lowStockAt) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(inventoryItemsTable.id, existing.id))
    .returning();
  const [home] = await db
    .select({ name: homesTable.name })
    .from(homesTable)
    .where(eq(homesTable.id, item.homeId))
    .limit(1);
  if (amount(item.quantity) <= amount(item.lowStockAt)) {
    await notifyRole(
      "ceo",
      "Stock needs attention",
      `${home?.name ?? "Home"}: ${item.name} is at or below its low-stock level.`,
      "stock",
      "/inventory",
    );
  }
  res.json(
    api.UpdateInventoryItemResponse.parse({
      id: item.id,
      homeId: item.homeId,
      homeName: home?.name ?? "Home",
      name: item.name,
      category: item.category,
      quantity: amount(item.quantity),
      unit: item.unit,
      unitCost: amount(item.unitCost),
      lowStockAt: amount(item.lowStockAt),
      updatedAt: item.updatedAt.toISOString(),
    }),
  );
});

router.post("/inventory/transfers", async (req, res): Promise<void> => {
  if (!isCeo(req.actor!)) {
    res.status(403).json({ error: "Only the CEO can transfer stock between homes" });
    return;
  }
  const parsed = api.TransferInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [source] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, parsed.data.itemId))
    .limit(1);
  if (!source) {
    res.status(404).json({ error: "Source inventory item not found" });
    return;
  }
  if (source.homeId === parsed.data.destinationHomeId) {
    res.status(400).json({ error: "Choose a different destination home" });
    return;
  }
  if (amount(source.quantity) < parsed.data.quantity) {
    res.status(400).json({ error: "There is not enough stock to transfer" });
    return;
  }
  const [destinationHome] = await db
    .select()
    .from(homesTable)
    .where(eq(homesTable.id, parsed.data.destinationHomeId))
    .limit(1);
  const [sourceHome] = await db
    .select()
    .from(homesTable)
    .where(eq(homesTable.id, source.homeId))
    .limit(1);
  if (!destinationHome || !sourceHome) {
    res.status(404).json({ error: "Home not found" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [updatedSource] = await tx
      .update(inventoryItemsTable)
      .set({
        quantity: String(amount(source.quantity) - parsed.data.quantity),
        updatedAt: new Date(),
      })
      .where(eq(inventoryItemsTable.id, source.id))
      .returning({ id: inventoryItemsTable.id });
    if (!updatedSource) throw new Error("Source stock changed; retry transfer");

    const [destinationItem] = await tx
      .select()
      .from(inventoryItemsTable)
      .where(
        and(
          eq(inventoryItemsTable.homeId, destinationHome.id),
          eq(inventoryItemsTable.name, source.name),
        ),
      )
      .limit(1);
    if (destinationItem) {
      await tx
        .update(inventoryItemsTable)
        .set({
          quantity: String(amount(destinationItem.quantity) + parsed.data.quantity),
          updatedAt: new Date(),
        })
        .where(eq(inventoryItemsTable.id, destinationItem.id));
    } else {
      await tx.insert(inventoryItemsTable).values({
        homeId: destinationHome.id,
        name: source.name,
        category: source.category,
        quantity: String(parsed.data.quantity),
        unit: source.unit,
        unitCost: source.unitCost,
        lowStockAt: source.lowStockAt,
      });
    }
    const [transfer] = await tx
      .insert(inventoryTransfersTable)
      .values({
        itemId: source.id,
        sourceHomeId: source.homeId,
        destinationHomeId: destinationHome.id,
        quantity: String(parsed.data.quantity),
        createdBy: req.actor!.email,
        createdByUserId: req.actor!.userId,
      })
      .returning();
    return transfer;
  });

  await Promise.all([
    notifyRole(
      "manager",
      "Stock transfer sent",
      `${amount(result.quantity)} ${source.unit} of ${source.name} sent from ${sourceHome.name}.`,
      "stock",
      "/inventory",
      source.homeId,
    ),
    notifyRole(
      "manager",
      "Stock transfer received",
      `${amount(result.quantity)} ${source.unit} of ${source.name} received at ${destinationHome.name}.`,
      "stock",
      "/inventory",
      destinationHome.id,
    ),
  ]);
  res.status(201).json(
    api.TransferInventoryResponse.parse({
      id: result.id,
      itemName: source.name,
      fromHome: sourceHome.name,
      toHome: destinationHome.name,
      quantity: amount(result.quantity),
      createdAt: result.createdAt.toISOString(),
    }),
  );
});

export default router;
