import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enum — disimpan sebagai text agar kompatibel PGlite & Postgres
export const roleEnum = pgEnum("role", ["superadmin", "admin", "user"]);
export const pcStatusEnum = pgEnum("pc_status", [
  "available",
  "rented",
  "maintenance",
  "offline",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "waiting_verification",
  "paid",
  "active",
  "rejected",
  "expired",
  "completed",
  "cancelled",
]);
export const rentalStatusEnum = pgEnum("rental_status", [
  "active",
  "expired",
  "terminated",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "claimed",
  "done",
  "failed",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull().default(""),
  waNumber: text("wa_number").notNull().default(""),
  role: text("role").notNull().default("user"), // superadmin|admin|user
  balance: integer("balance").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  failedLogin: integer("failed_login").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const pcs = pgTable("pcs", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(), // RDP-01
  name: text("name").notNull(),
  location: text("location").notNull().default("Jakarta"),
  city: text("city").notNull().default("Jakarta"),
  cpu: text("cpu").notNull().default(""),
  gpu: text("gpu").notNull().default(""),
  motherboard: text("motherboard").notNull().default(""),
  hwJson: text("hw_json").notNull().default("{}"),
  ramGb: integer("ram_gb").notNull().default(16),
  storageGb: integer("storage_gb").notNull().default(512),
  storageType: text("storage_type").notNull().default("NVMe SSD"),
  os: text("os").notNull().default("Windows 11 Pro"),
  ipPublic: text("ip_public").notNull().default(""),
  rdpPort: integer("rdp_port").notNull().default(3389),
  sshPort: integer("ssh_port").notNull().default(22),
  agentTokenHash: text("agent_token_hash").notNull().default(""),
  status: text("status").notNull().default("available"), // available|rented|maintenance|offline
  priceHourly: integer("price_hourly").notNull().default(10000),
  priceDaily: integer("price_daily").notNull().default(75000),
  priceWeekly: integer("price_weekly").notNull().default(350000),
  priceMonthly: integer("price_monthly").notNull().default(1200000),
  description: text("description").notNull().default(""),
  isBareMetal: boolean("is_bare_metal").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(), // HOURLY|DAILY|WEEKLY|MONTHLY
  name: text("name").notNull(),
  durationHours: integer("duration_hours").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const vouchers = pgTable("vouchers", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  discountPercent: integer("discount_percent").notNull().default(0),
  maxDiscountIdr: integer("max_discount_idr").notNull().default(0),
  quota: integer("quota").notNull().default(100),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(), // ORD-20260908-XXXX
  userId: text("user_id").notNull(),
  pcId: text("pc_id").notNull(),
  planId: text("plan_id").notNull(),
  durationHours: integer("duration_hours").notNull(),
  priceIdr: integer("price_idr").notNull(),
  discountIdr: integer("discount_idr").notNull().default(0),
  totalIdr: integer("total_idr").notNull(),
  voucherCode: text("voucher_code").notNull().default(""),
  paymentMethod: text("payment_method").notNull().default("qris"),
  paymentProof: text("payment_proof").notNull().default(""),
  status: text("status").notNull().default("pending"),
  note: text("note").notNull().default(""),
  verifiedBy: text("verified_by").notNull().default(""),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const rentals = pgTable("rentals", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  userId: text("user_id").notNull(),
  pcId: text("pc_id").notNull(),
  rdpHost: text("rdp_host").notNull(),
  rdpPort: integer("rdp_port").notNull().default(3389),
  rdpUser: text("rdp_user").notNull(),
  rdpPassEnc: text("rdp_pass_enc").notNull(), // AES-GCM base64
  startAt: timestamp("start_at").notNull().defaultNow(),
  endAt: timestamp("end_at").notNull(),
  status: text("status").notNull().default("active"),
  extendedCount: integer("extended_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const agentTasks = pgTable("agent_tasks", {
  id: text("id").primaryKey(),
  pcId: text("pc_id").notNull(),
  rentalId: text("rental_id").notNull().default(""),
  type: text("type").notNull(), // create_user|delete_user|restart|shutdown|reset_password|lock|unlock
  payloadJson: text("payload_json").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  result: text("result").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  claimedAt: timestamp("claimed_at"),
  doneAt: timestamp("done_at"),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull().default(""),
  actorName: text("actor_name").notNull().default(""),
  action: text("action").notNull(),
  entity: text("entity").notNull().default(""),
  entityId: text("entity_id").notNull().default(""),
  metaJson: text("meta_json").notNull().default("{}"),
  ip: text("ip").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Pc = typeof pcs.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Rental = typeof rentals.$inferSelect;
