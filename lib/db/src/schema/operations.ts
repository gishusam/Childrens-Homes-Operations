import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const memberRoleEnum = pgEnum("member_role", ["ceo", "manager"]);
export const expenseStatusEnum = pgEnum("expense_status", [
  "pending",
  "approved",
  "rejected",
]);
export const issuePriorityEnum = pgEnum("issue_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
export const issueStatusEnum = pgEnum("issue_status", [
  "open",
  "in_progress",
  "resolved",
]);
export const billFrequencyEnum = pgEnum("bill_frequency", [
  "weekly",
  "monthly",
  "quarterly",
  "annually",
]);
export const billStatusEnum = pgEnum("bill_status", [
  "upcoming",
  "paid",
  "overdue",
]);
export const notificationKindEnum = pgEnum("notification_kind", [
  "approval",
  "issue",
  "report",
  "stock",
  "bill",
]);

export interface StoredIssueAttachment {
  name: string;
  objectPath: string;
  contentType: string;
  size: number;
}

export const homesTable = pgTable("homes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  managerName: text("manager_name").notNull(),
  capacity: integer("capacity").notNull(),
  occupancy: integer("occupancy").notNull().default(0),
  monthlyBudget: numeric("monthly_budget", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  approvalThreshold: numeric("approval_threshold", {
    precision: 12,
    scale: 2,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const organizationSettingsTable = pgTable("organization_settings", {
  id: text("id").primaryKey().default("default"),
  isDemo: boolean("is_demo").notNull().default(false),
  approvalThreshold: numeric("approval_threshold", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("25000"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const membersTable = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id"),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull(),
    homeId: uuid("home_id").references(() => homesTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("members_user_id_unique").on(table.userId),
    uniqueIndex("members_email_lower_unique").on(table.email),
    index("members_home_id_idx").on(table.homeId),
  ],
);

export const expensesTable = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    homeId: uuid("home_id")
      .notNull()
      .references(() => homesTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: expenseStatusEnum("status").notNull().default("approved"),
    submittedBy: text("submitted_by").notNull(),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    approvalRequired: boolean("approval_required").notNull().default(false),
    reviewNote: text("review_note"),
    reviewerId: text("reviewer_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("expenses_home_date_idx").on(table.homeId, table.date),
    index("expenses_status_idx").on(table.status),
  ],
);

export const inventoryItemsTable = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    homeId: uuid("home_id")
      .notNull()
      .references(() => homesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    unit: text("unit").notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    lowStockAt: numeric("low_stock_at", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("inventory_home_idx").on(table.homeId)],
);

export const inventoryTransfersTable = pgTable(
  "inventory_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItemsTable.id, { onDelete: "cascade" }),
    sourceHomeId: uuid("source_home_id")
      .notNull()
      .references(() => homesTable.id, { onDelete: "cascade" }),
    destinationHomeId: uuid("destination_home_id")
      .notNull()
      .references(() => homesTable.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    createdBy: text("created_by").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("inventory_transfers_created_idx").on(table.createdAt)],
);

export const billsTable = pgTable(
  "bills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    homeId: uuid("home_id")
      .notNull()
      .references(() => homesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    vendor: text("vendor").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    frequency: billFrequencyEnum("frequency").notNull(),
    status: billStatusEnum("status").notNull().default("upcoming"),
    lastPaidAt: timestamp("last_paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("bills_home_due_idx").on(table.homeId, table.dueDate),
    index("bills_status_idx").on(table.status),
  ],
);

export const issuesTable = pgTable(
  "issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    homeId: uuid("home_id")
      .notNull()
      .references(() => homesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    priority: issuePriorityEnum("priority").notNull().default("normal"),
    status: issueStatusEnum("status").notNull().default("open"),
    deadline: date("deadline", { mode: "string" }),
    assignedTo: text("assigned_to"),
    createdBy: text("created_by").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    attachments: jsonb("attachments")
      .$type<StoredIssueAttachment[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("issues_home_status_idx").on(table.homeId, table.status),
    index("issues_priority_idx").on(table.priority),
  ],
);

export const issueCommentsTable = pgTable(
  "issue_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issuesTable.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("issue_comments_issue_idx").on(table.issueId)],
);

export const storageUploadsTable = pgTable(
  "storage_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectPath: text("object_path").notNull().unique(),
    ownerUserId: text("owner_user_id").notNull(),
    homeId: uuid("home_id").references(() => homesTable.id, {
      onDelete: "cascade",
    }),
    issueId: uuid("issue_id").references(() => issuesTable.id, {
      onDelete: "set null",
    }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("storage_uploads_owner_idx").on(table.ownerUserId)],
);

export const weeklyReportsTable = pgTable(
  "weekly_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    homeId: uuid("home_id")
      .notNull()
      .references(() => homesTable.id, { onDelete: "cascade" }),
    weekStarting: date("week_starting", { mode: "string" }).notNull(),
    summary: text("summary").notNull(),
    highlights: text("highlights").notNull().default(""),
    needsSupport: text("needs_support").notNull().default(""),
    submittedBy: text("submitted_by").notNull(),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("weekly_reports_home_week_unique").on(
      table.homeId,
      table.weekStarting,
    ),
  ],
);

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    kind: notificationKindEnum("kind").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    href: text("href").notNull().default("/dashboard"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("notifications_user_date_idx").on(table.userId, table.createdAt)],
);
