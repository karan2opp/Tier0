import { z } from "zod";
import { NotFoundError } from "../../../common";
import * as scripts from "./scripts";

/**
 * A diagnostic tool the agent may call. The model only ever picks a tool by name and
 * supplies validated parameters; the script text is fixed here.
 *
 * Parameters use `.nullable()` instead of `.optional()` because OpenAI strict tool schemas
 * require every field to be present; `null` means "use the default".
 */
export interface ToolDefinition<P extends z.ZodObject = z.ZodObject> {
  name: string;
  /** Plain-language name shown to the customer in the approval prompt. */
  title: string;
  description: string;
  /** How the customer can check this themselves, offered before we run anything. */
  selfCheck: string;
  parameters: P;
  timeoutMs?: number;
  buildScript(args: z.infer<P>): string;
}

const noParams = z.object({});

const recentErrorsParams = z.object({
  log: z.enum(["System", "Application"]).nullable().describe("Event log to read. null = System."),
  hours: z.number().int().min(1).max(168).nullable().describe("How many hours back to look (1-168). null = 24."),
  maxEvents: z.number().int().min(1).max(50).nullable().describe("Maximum events to return (1-50). null = 20."),
});

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_system_info",
    title: "Laptop and Windows details",
    description: "Laptop model, manufacturer, Windows version/build, CPU, total RAM, and uptime since last boot.",
    selfCheck: "Open Settings > System > About to see the laptop model, Windows edition, and RAM.",
    parameters: noParams,
    buildScript: () => scripts.systemInfo,
  },
  {
    name: "get_performance_snapshot",
    title: "CPU and memory usage",
    description: "Current CPU load %, RAM usage, and the top 5 processes by CPU and by memory. Use for slowness, freezing, high fan noise, battery drain.",
    selfCheck: "Press Ctrl+Shift+Esc to open Task Manager, then sort the Processes tab by CPU or Memory.",
    parameters: noParams,
    buildScript: () => scripts.performanceSnapshot,
  },
  {
    name: "get_disk_usage",
    title: "Free space on your drives",
    description: "Every drive letter with size, free space, and free %. Use for low storage or 'disk full' problems.",
    selfCheck: "Open File Explorer and click This PC to see the free space on each drive.",
    parameters: noParams,
    buildScript: () => scripts.diskUsage,
  },
  {
    name: "detect_drives",
    title: "Drives Windows can see",
    description: "All physical disks Windows can see: online/offline, partition style, partitions and drive letters. Use when a drive is missing or not showing.",
    selfCheck: "Right-click the Start button and open Disk Management to see every disk and whether one is offline or has no drive letter.",
    parameters: noParams,
    buildScript: () => scripts.detectDrives,
  },
  {
    name: "get_disk_health",
    title: "Drive health",
    description: "Health and operational status of each physical disk (SSD/HDD), plus reliability counters when available.",
    selfCheck: "Open Settings > System > Storage > Advanced storage settings > Disks & volumes, then Properties, to see drive health.",
    parameters: noParams,
    buildScript: () => scripts.diskHealth,
  },
  {
    name: "get_battery_health",
    title: "Battery health",
    description: "Battery charge %, charging status, design vs full-charge capacity (health %), and cycle count. Use for battery drain or charging issues.",
    selfCheck: "Open Settings > System > Power & battery for usage. For battery health, open Command Prompt, run: powercfg /batteryreport, and open the report file it creates.",
    parameters: noParams,
    timeoutMs: 30_000,
    buildScript: () => scripts.batteryHealth,
  },
  {
    name: "get_startup_apps",
    title: "Apps that start with Windows",
    description: "Programs that start automatically with Windows. Use for slow boot, slow startup, or battery drain from background apps.",
    selfCheck: "Open Task Manager (Ctrl+Shift+Esc) and go to the Startup apps tab to see what starts with Windows and its impact.",
    parameters: noParams,
    buildScript: () => scripts.startupApps,
  },
  {
    name: "get_network_status",
    title: "Network and internet connection",
    description: "Network adapters, default gateway, internet reachability (ping), latency, and whether DNS works. Use for Wi-Fi or internet problems.",
    selfCheck: "Open Settings > Network & internet to see your connection status, and run the network troubleshooter there.",
    parameters: noParams,
    timeoutMs: 30_000,
    buildScript: () => scripts.networkStatus,
  },
  {
    name: "get_driver_problems",
    title: "Devices with driver problems",
    description: "Devices that Windows reports with an error or degraded status (driver problems, yellow marks in Device Manager). problemCode is the Windows Device Manager error code.",
    selfCheck: "Right-click the Start button and open Device Manager; devices with problems show a yellow warning icon.",
    parameters: noParams,
    buildScript: () => scripts.driverProblems,
  },
  {
    name: "get_recent_errors",
    title: "Recent Windows error logs",
    description: "Recent critical and error events from the Windows event log (crashes, unexpected shutdowns, disk or driver errors).",
    selfCheck: "Right-click the Start button, open Event Viewer > Windows Logs > System, and filter by Critical and Error.",
    parameters: recentErrorsParams,
    timeoutMs: 30_000,
    buildScript: (args: z.infer<typeof recentErrorsParams>) =>
      scripts.recentErrors({
        log: args.log ?? "System",
        hours: args.hours ?? 24,
        maxEvents: args.maxEvents ?? 20,
      }),
  },
];

const toolsByName = new Map(toolDefinitions.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDefinition {
  const tool = toolsByName.get(name);
  if (!tool) throw new NotFoundError(`Unknown tool: ${name}`);
  return tool;
}
