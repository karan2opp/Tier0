/** Fixed warranty terms by plan, so the agent explains coverage from data instead of guessing. */

type Plan = "standard" | "extended" | "accidental_damage";

const BASE_COVERS = [
  "Manufacturing defects in parts and workmanship",
  "Battery replacement if it fails or its health drops below 70% during the warranty",
  "Motherboard, display, keyboard, touchpad, ports, speakers and fans that fail on their own",
  "Free pickup and delivery for covered repairs",
];

const BASE_NOT_COVERED = [
  "Software problems, viruses, or data recovery",
  "Cosmetic wear like scratches",
  "Damage from unauthorised repairs",
];

export const WARRANTY_PLANS: Record<Plan, { name: string; covers: string[]; notCovered: string[] }> = {
  standard: {
    name: "Standard warranty",
    covers: BASE_COVERS,
    notCovered: ["Accidental damage such as drops, cracked screens, or liquid spills", ...BASE_NOT_COVERED],
  },
  extended: {
    name: "Extended warranty",
    covers: BASE_COVERS,
    notCovered: ["Accidental damage such as drops, cracked screens, or liquid spills", ...BASE_NOT_COVERED],
  },
  accidental_damage: {
    name: "Warranty with accidental damage protection",
    covers: [...BASE_COVERS, "Accidental damage from drops, cracked screens, and liquid spills (one claim per year)"],
    notCovered: ["Loss or theft", ...BASE_NOT_COVERED],
  },
};
