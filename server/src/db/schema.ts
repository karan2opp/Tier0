import { relations } from "drizzle-orm";
import { boolean, date, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const warrantyPlan = pgEnum("warranty_plan", ["standard", "extended", "accidental_damage"]);

/** The repair journey, in order. "cancelled" can happen at any point. */
export const ticketStatus = pgEnum("ticket_status", [
  "created",
  "pickup_scheduled",
  "picked_up",
  "diagnosing",
  "awaiting_parts",
  "repairing",
  "quality_check",
  "ready_for_delivery",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull().unique(),
  city: text("city"),
  createdAt: createdAt(),
});

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    serialNumber: text("serial_number").notNull().unique(),
    purchaseDate: date("purchase_date").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("devices_customer_idx").on(table.customerId)],
);

export const warranties = pgTable(
  "warranties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    plan: warrantyPlan("plan").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    coversAccidentalDamage: boolean("covers_accidental_damage").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index("warranties_device_idx").on(table.deviceId)],
);

export const repairTickets = pgTable(
  "repair_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-friendly reference the customer can say on a call, e.g. "T0-1042". */
    ticketNumber: text("ticket_number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    issue: text("issue").notNull(),
    diagnosis: text("diagnosis"),
    status: ticketStatus("status").notNull().default("created"),
    coveredByWarranty: boolean("covered_by_warranty").notNull().default(false),
    estimatedCostInr: integer("estimated_cost_inr"),
    pickupWindowStart: timestamp("pickup_window_start", { withTimezone: true }),
    pickupWindowEnd: timestamp("pickup_window_end", { withTimezone: true }),
    estimatedReadyAt: timestamp("estimated_ready_at", { withTimezone: true }),
    deliveryWindowStart: timestamp("delivery_window_start", { withTimezone: true }),
    deliveryWindowEnd: timestamp("delivery_window_end", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("repair_tickets_customer_idx").on(table.customerId),
    index("repair_tickets_device_idx").on(table.deviceId),
    index("repair_tickets_status_idx").on(table.status),
  ],
);

/** Status history of a ticket, so the agent can explain what happened and when. */
export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => repairTickets.id, { onDelete: "cascade" }),
    status: ticketStatus("status").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [index("ticket_events_ticket_idx").on(table.ticketId)],
);

/* ---------- Relations (for typed nested queries) ---------- */

export const customersRelations = relations(customers, ({ many }) => ({
  devices: many(devices),
  repairTickets: many(repairTickets),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  customer: one(customers, { fields: [devices.customerId], references: [customers.id] }),
  warranties: many(warranties),
  repairTickets: many(repairTickets),
}));

export const warrantiesRelations = relations(warranties, ({ one }) => ({
  device: one(devices, { fields: [warranties.deviceId], references: [devices.id] }),
}));

export const repairTicketsRelations = relations(repairTickets, ({ one, many }) => ({
  customer: one(customers, { fields: [repairTickets.customerId], references: [customers.id] }),
  device: one(devices, { fields: [repairTickets.deviceId], references: [devices.id] }),
  events: many(ticketEvents),
}));

export const ticketEventsRelations = relations(ticketEvents, ({ one }) => ({
  ticket: one(repairTickets, { fields: [ticketEvents.ticketId], references: [repairTickets.id] }),
}));
