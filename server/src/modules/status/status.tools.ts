import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { logger } from "../../common";
import { wrapUntrustedToolOutput } from "../../common/guardrails";
import {
  DELIVERY_SCHEDULABLE,
  describeWindow,
  formatInr,
  formatWindow,
  PICKUP_CHANGEABLE,
  STATUS_MEANINGS,
  type TicketStatus,
} from "./status.labels";
import { findTicketForCustomer, findTicketsForCustomer, rescheduleVisit } from "./status.repository";
import type { StatusSession } from "./status.schema";
import { upcomingWindows } from "./status.slots";

export interface StatusContext {
  session: StatusSession;
}

const verified = ({ runContext }: { runContext: RunContext<StatusContext> }) =>
  Boolean(runContext.context.session.identity.customerId);

/** Why a pickup or delivery cannot be changed right now, or null when it can. */
function blockedReason(kind: "pickup" | "delivery", status: TicketStatus): string | null {
  if (kind === "pickup" && !PICKUP_CHANGEABLE.includes(status)) {
    return "The laptop has already been picked up, so the pickup cannot be changed.";
  }
  if (kind === "delivery" && !DELIVERY_SCHEDULABLE.includes(status)) {
    if (status === "out_for_delivery") return "The laptop is already out for delivery, so only a human agent can change it now.";
    if (status === "delivered") return "The laptop has already been delivered.";
    return "Delivery can only be scheduled once the repair is under way, after diagnosis and any parts have arrived.";
  }
  return null;
}

/** Words that show the customer wants to book or change a visit (checked by the server on their own message). */
const CHANGE_INTENT =
  /\b(move|change|reschedul\w*|instead|different|another|other|earlier|later|sooner|postpone|prepone|book|prefer|works?|suits?|fine|ok(ay)?|go (with|for|ahead)|pick|choose|take|yes|sure|please do)\b/i;

export const asksForChange = (message: string) => CHANGE_INTENT.test(message);

function canProposeChange(session: StatusSession): boolean {
  return session.customerAskedForChange || Object.values(session.offeredSlots).some((slot) => slot.offeredInTurn < session.turn);
}

/**
 * Whether the agent may propose this slot. It must be a slot we offered, and either the customer saw it in an
 * earlier reply, or the customer's current message asks for a change. A customer who only asked a question can
 * never be sent a change. Returns the reason it cannot be chosen, or null. Checked before confirmation and on save.
 */
export function whySlotNotChoosable(session: StatusSession, slotId: string): string | null {
  const slot = session.offeredSlots[slotId.trim().toUpperCase()];
  if (!slot) return "Unknown slot id. Offer slots with get_available_slots first and let the customer choose one.";
  if (slot.offeredInTurn >= session.turn && !session.customerAskedForChange) {
    return "The customer has not asked for a change. Answer their question; only offer other times if they want to change.";
  }
  if (session.changesThisTurn >= 1) return "A change was already saved for this message. Confirm it to the customer.";
  return null;
}

const noParams = z.object({});

export const myRepairsTool = tool<typeof noParams, StatusContext>({
  name: "get_my_repairs",
  description:
    "The verified customer's repair tickets: status in plain words, issue, diagnosis, cost or warranty cover, pickup window, " +
    "estimated ready time, delivery window, whether pickup or delivery can be changed, and the full status history.",
  parameters: noParams,
  // Only once the customer is verified (it always reads THAT customer's data), and once per message.
  isEnabled: ({ runContext }) => verified({ runContext }) && runContext.context.session.lookupsThisTurn < 1,
  execute: async (_input, runContext?: RunContext<StatusContext>) => {
    const session = runContext!.context.session;
    session.lookupsThisTurn += 1;

    const tickets = (await findTicketsForCustomer(session.identity.customerId!)).map((ticket) => {
      const latest = ticket.events.at(-1);
      return {
        ticketNumber: ticket.ticketNumber,
        laptop: `${ticket.device.brand} ${ticket.device.model}`,
        onThisCall: ticket.device.id === session.identity.laptop?.deviceId,
        serialEnding: ticket.device.serialNumber.slice(-4),
        issue: ticket.issue,
        diagnosis: ticket.diagnosis,
        status: ticket.status,
        statusMeaning: STATUS_MEANINGS[ticket.status],
        cost: ticket.coveredByWarranty
          ? "Free, covered by warranty"
          : ticket.estimatedCostInr
            ? `${formatInr(ticket.estimatedCostInr)} (customer pays)`
            : "Not quoted yet",
        // Relative days ("tomorrow", "in 2 days") are computed here so the model never has to work them out.
        pickupWindow: describeWindow(ticket.pickupWindowStart, ticket.pickupWindowEnd),
        estimatedReady: describeWindow(ticket.estimatedReadyAt, null),
        deliveryWindow: describeWindow(ticket.deliveryWindowStart, ticket.deliveryWindowEnd),
        canChangePickup: blockedReason("pickup", ticket.status) === null,
        canScheduleDelivery: blockedReason("delivery", ticket.status) === null,
        latestUpdate: latest ? { when: describeWindow(latest.createdAt, null), note: latest.note } : null,
        history: ticket.events.map((event) => ({
          when: describeWindow(event.createdAt, null),
          status: STATUS_MEANINGS[event.status],
          note: event.note,
        })),
      };
    });

    return wrapUntrustedToolOutput("get_my_repairs", { now: describeWindow(new Date(), null), tickets });
  },
});

const slotParams = z.object({
  ticketNumber: z.string().min(3).max(20).describe("The ticket number from get_my_repairs, e.g. T0-1043"),
  kind: z.enum(["pickup", "delivery"]).describe("Which visit to schedule"),
});

export const availableSlotsTool = tool<typeof slotParams, StatusContext>({
  name: "get_available_slots",
  description:
    "Free pickup or delivery windows for one of the customer's tickets. Returns slot ids (S1, S2, ...) to use with " +
    "reschedule_visit, or the reason it cannot be changed.",
  parameters: slotParams,
  // Once per customer message: after offering options, the agent must reply and wait for the customer's choice.
  isEnabled: ({ runContext }) => verified({ runContext }) && runContext.context.session.slotLookupsThisTurn < 1,
  execute: async ({ ticketNumber, kind }, runContext?: RunContext<StatusContext>) => {
    const session = runContext!.context.session;
    session.slotLookupsThisTurn += 1;
    const ticket = await findTicketForCustomer(session.identity.customerId!, ticketNumber);
    if (!ticket) {
      return wrapUntrustedToolOutput("get_available_slots", { available: false, reason: "No such ticket for this customer." });
    }

    const reason = blockedReason(kind, ticket.status);
    if (reason) return wrapUntrustedToolOutput("get_available_slots", { available: false, reason });

    // Delivery cannot be before the repair is expected to be ready.
    const earliest = kind === "delivery" ? ticket.estimatedReadyAt : null;
    const slots = upcomingWindows(earliest).map((window) => {
      const slotId = `S${++session.slotCounter}`;
      const label = formatWindow(window.start, window.end)!;
      session.offeredSlots[slotId] = {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        kind,
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        label,
        offeredInTurn: session.turn,
      };
      return { slotId, when: describeWindow(window.start, window.end) };
    });

    return wrapUntrustedToolOutput("get_available_slots", { available: true, ticketNumber: ticket.ticketNumber, kind, slots });
  },
});

const rescheduleParams = z.object({
  slotId: z.string().min(2).max(6).describe("A slot id the customer chose, from get_available_slots, e.g. S2"),
});

export const rescheduleVisitTool = tool<typeof rescheduleParams, StatusContext>({
  name: "reschedule_visit",
  description:
    "Books or moves the pickup or delivery to the slot the customer chose. The customer is asked to confirm before it is saved.",
  parameters: rescheduleParams,
  // Only when the customer asked for a change or has seen options, and one change per customer message.
  isEnabled: ({ runContext }) => {
    const { session } = runContext.context;
    return verified({ runContext }) && session.changesThisTurn < 1 && canProposeChange(session);
  },
  // Changes data: the run pauses until the customer explicitly confirms this exact change.
  needsApproval: true,
  execute: async ({ slotId }, runContext?: RunContext<StatusContext>) => {
    const session = runContext!.context.session;
    const reasonNotChoosable = whySlotNotChoosable(session, slotId);
    if (reasonNotChoosable) return wrapUntrustedToolOutput("reschedule_visit", { done: false, reason: reasonNotChoosable });
    const slot = session.offeredSlots[slotId.trim().toUpperCase()];

    // Re-check everything at the moment of the change: ownership, status, and that the slot is still ahead.
    const ticket = await findTicketForCustomer(session.identity.customerId!, slot.ticketNumber);
    if (!ticket || ticket.id !== slot.ticketId) {
      return wrapUntrustedToolOutput("reschedule_visit", { done: false, reason: "No such ticket for this customer." });
    }
    const reason = blockedReason(slot.kind, ticket.status);
    if (reason) return wrapUntrustedToolOutput("reschedule_visit", { done: false, reason });
    if (new Date(slot.start).getTime() < Date.now() + 60 * 60 * 1000) {
      return wrapUntrustedToolOutput("reschedule_visit", { done: false, reason: "That slot is too soon now. Offer new slots." });
    }

    const verb = slot.kind === "pickup" ? "Pickup" : "Delivery";
    session.changesThisTurn += 1;
    await rescheduleVisit({
      ticketId: ticket.id,
      kind: slot.kind,
      start: new Date(slot.start),
      end: new Date(slot.end),
      currentStatus: ticket.status,
      note: `${verb} set to ${slot.label} at the customer's request`,
    });
    logger.info({ ticket: ticket.ticketNumber, kind: slot.kind }, "Visit rescheduled");

    return wrapUntrustedToolOutput("reschedule_visit", { done: true, ticketNumber: ticket.ticketNumber, kind: slot.kind, newWindow: slot.label });
  },
});
