import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { wrapUntrustedToolOutput } from "../../common/guardrails";
import { findDevicesWithWarranties } from "../customers/customers.repository";
import { createVerifyCustomerTool, type VerificationState } from "../customers/verification.tool";
import { WARRANTY_PLANS } from "./frontdesk.warranty";

export interface FrontDeskContext {
  /** The conversation's identity, shared with every agent the customer is handed to. */
  session: VerificationState;
  /** Laptop and warranty lookups since the customer's last message (max one: it returns everything). */
  turn: { lookups: number };
}

const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

const noParams = z.object({});

export const verifyCustomerTool = createVerifyCustomerTool<FrontDeskContext>();

export const laptopsAndWarrantiesTool = tool<typeof noParams, FrontDeskContext>({
  name: "get_my_laptops_and_warranties",
  description:
    "The verified customer's laptops with their warranty: plan, start and end dates, whether it is active, days left, " +
    "and what the plan covers and does not cover.",
  parameters: noParams,
  // Only once the customer is verified (it always reads THAT customer's data), and once per message.
  isEnabled: ({ runContext }) => {
    const { session, turn } = runContext.context;
    return Boolean(session.customerId) && turn.lookups < 1;
  },
  execute: async (_input, runContext?: RunContext<FrontDeskContext>) => {
    const { session, turn } = runContext!.context;
    turn.lookups += 1;
    const now = today();
    const laptops = (await findDevicesWithWarranties(session.customerId!)).map((device) => {
      const latest = [...device.warranties].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
      const plan = latest ? WARRANTY_PLANS[latest.plan] : null;
      const daysLeft = latest ? daysBetween(now, latest.endsOn) : null;
      return {
        laptop: `${device.brand} ${device.model}`,
        serialEnding: device.serialNumber.slice(-4),
        onThisCall: device.id === session.laptop?.deviceId,
        purchaseDate: device.purchaseDate,
        warranty: latest && plan
          ? {
              plan: plan.name,
              startsOn: latest.startsOn,
              endsOn: latest.endsOn,
              active: daysLeft! >= 0,
              daysLeft: daysLeft! >= 0 ? daysLeft : 0,
              expiredDaysAgo: daysLeft! < 0 ? -daysLeft! : null,
              covers: plan.covers,
              notCovered: plan.notCovered,
            }
          : null,
      };
    });
    return wrapUntrustedToolOutput("get_my_laptops_and_warranties", { today: now, laptops });
  },
});
