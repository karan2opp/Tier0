import { asList, asRecord } from "./tools/readings";

/**
 * Deterministic hardware rules applied to real tool readings. Any hit means that part needs a repair or
 * replacement: the customer is always told, and a human engineer is always offered for it.
 */
export const HARDWARE_THRESHOLDS = {
  /** Below this, the battery holds too little charge and should be replaced. */
  minBatteryHealthPercent: 70,
} as const;

export function detectHardwareIssues(tool: string, output: unknown): string[] {
  const data = asRecord(output);
  if (!data) return [];

  switch (tool) {
    case "get_battery_health": {
      const health = data.healthPercent;
      if (typeof health === "number" && health < HARDWARE_THRESHOLDS.minBatteryHealthPercent) {
        return [`Battery health is ${health}%, below ${HARDWARE_THRESHOLDS.minBatteryHealthPercent}%: the battery needs replacing`];
      }
      return [];
    }
    case "get_disk_health":
      return asList(data.physicalDisks).flatMap((disk) => {
        const health = String(disk.healthStatus ?? "");
        return health && health !== "Healthy"
          ? [`Disk "${disk.friendlyName ?? "unknown"}" reports health "${health}": it may be failing`]
          : [];
      });
    case "detect_drives":
      return asList(data.disks).flatMap((disk) =>
        disk.partitionStyle === "RAW"
          ? [`Disk ${disk.number ?? "?"} ("${disk.friendlyName ?? "unknown"}") is uninitialized (RAW): data may be at risk`]
          : [],
      );
    default:
      return [];
  }
}
