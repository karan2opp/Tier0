import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { wrapUntrustedToolOutput } from "../../common/guardrails";
import { findDevicesWithWarranties } from "../customers/customers.repository";
import { createVerifyCustomerTool } from "../customers/verification.tool";
import type { InfoSession } from "./info.schema";
import { WARRANTY_PLANS } from "./info.warranty";

export interface InfoContext {
  session: InfoSession;
}

const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

const noParams = z.object({});

export const verifyCustomerTool = createVerifyCustomerTool<InfoContext>();

export const laptopsAndWarrantiesTool = tool<typeof noParams, InfoContext>({
  name: "get_my_laptops_and_warranties",
  description:
    "The verified customer's laptops with their warranty: plan, start and end dates, whether it is active, days left, " +
    "and what the plan covers and does not cover.",
  parameters: noParams,
  // Only once the customer is verified (it always reads THAT customer's data), and once per message.
  isEnabled: ({ runContext }) => {
    const { session } = runContext.context;
    return Boolean(session.customerId) && session.lookupsThisTurn < 1;
  },
  execute: async (_input, runContext?: RunContext<InfoContext>) => {
    const session = runContext!.context.session;
    session.lookupsThisTurn += 1;
    const customerId = session.customerId!;
    const now = today();
    const laptops = (await findDevicesWithWarranties(customerId)).map((device) => {
      const latest = [...device.warranties].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
      const plan = latest ? WARRANTY_PLANS[latest.plan] : null;
      const daysLeft = latest ? daysBetween(now, latest.endsOn) : null;
      return {
        laptop: `${device.brand} ${device.model}`,
        serialEnding: device.serialNumber.slice(-4),
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
