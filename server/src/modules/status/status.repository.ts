import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { repairTickets, ticketEvents } from "../../db/schema";
import type { TicketStatus } from "./status.labels";

/** All of a customer's repair tickets, newest first, with the laptop and the full status history. */
export async function findTicketsForCustomer(customerId: string) {
  return db.query.repairTickets.findMany({
    where: eq(repairTickets.customerId, customerId),
    with: {
      device: true,
      events: { orderBy: (event, { asc }) => [asc(event.createdAt)] },
    },
    orderBy: (ticket, { desc }) => [desc(ticket.createdAt)],
  });
}

/** One ticket, only if it belongs to this customer. */
export async function findTicketForCustomer(customerId: string, ticketNumber: string) {
  return db.query.repairTickets.findFirst({
    where: and(eq(repairTickets.customerId, customerId), eq(repairTickets.ticketNumber, ticketNumber.trim().toUpperCase())),
  });
}

export type VisitKind = "pickup" | "delivery";

/** Moves a pickup or delivery window and records it in the ticket history, atomically. */
export async function rescheduleVisit(input: {
  ticketId: string;
  kind: VisitKind;
  start: Date;
  end: Date;
  currentStatus: TicketStatus;
  note: string;
}) {
  // Booking a pickup on a fresh request moves it to "pickup_scheduled"; other statuses stay as they are.
  const status: TicketStatus = input.kind === "pickup" && input.currentStatus === "created" ? "pickup_scheduled" : input.currentStatus;
  const windowFields =
    input.kind === "pickup"
      ? { pickupWindowStart: input.start, pickupWindowEnd: input.end }
      : { deliveryWindowStart: input.start, deliveryWindowEnd: input.end };

  await db.transaction(async (tx) => {
    await tx.update(repairTickets).set({ ...windowFields, status }).where(eq(repairTickets.id, input.ticketId));
    await tx.insert(ticketEvents).values({ ticketId: input.ticketId, status, note: input.note });
  });
}
