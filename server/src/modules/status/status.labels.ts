import type { repairTickets } from "../../db/schema";

export type TicketStatus = NonNullable<(typeof repairTickets.$inferSelect)["status"]>;

/** What each status means, in words a customer understands. */
export const STATUS_MEANINGS: Record<TicketStatus, string> = {
  created: "Repair request received; pickup not booked yet",
  pickup_scheduled: "Pickup is scheduled",
  picked_up: "Picked up and on its way to the service centre",
  diagnosing: "A technician is diagnosing the problem",
  awaiting_parts: "Waiting for a replacement part to arrive",
  repairing: "Being repaired",
  quality_check: "Repair done; final quality check in progress",
  ready_for_delivery: "Repaired and ready; delivery can be scheduled",
  out_for_delivery: "Out for delivery today",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Pickup can only be changed before the laptop has been collected. */
export const PICKUP_CHANGEABLE: TicketStatus[] = ["created", "pickup_scheduled"];

/** Delivery can be booked or changed once the repair is far enough along, but not once it is on the road. */
export const DELIVERY_SCHEDULABLE: TicketStatus[] = ["repairing", "quality_check", "ready_for_delivery"];

const DATE = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

/** "Tue, 27 Oct" in Indian time. */
export const formatDay = (date: Date) => DATE.format(date);

/** "Tue, 27 Oct, 10:00 to 12:00" in Indian time. */
export function formatWindow(start: Date | null, end: Date | null): string | null {
  if (!start) return null;
  return end ? `${DATE.format(start)}, ${TIME.format(start)} to ${TIME.format(end)}` : `${DATE.format(start)}, ${TIME.format(start)}`;
}

export const formatInr = (amount: number) => `Rs ${amount.toLocaleString("en-IN")}`;

const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** "today", "tomorrow", "in 3 days", "yesterday", "5 days ago", computed in Indian time so the model never has to. */
export function relativeDay(date: Date, now = new Date()): string {
  const days = Math.round((Date.parse(DAY_KEY.format(date)) - Date.parse(DAY_KEY.format(now))) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 1 ? `in ${days} days` : `${-days} days ago`;
}

/** A window for the customer, with the relative day added: "Thu, 29 Oct, 14:00 to 17:00 (in 2 days)". */
export function describeWindow(start: Date | null, end: Date | null): string | null {
  const label = formatWindow(start, end);
  return label && start ? `${label} (${relativeDay(start)})` : null;
}
