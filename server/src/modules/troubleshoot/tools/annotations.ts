import { asList, asRecord, type Reading } from "./readings";

/**
 * Fixed, plain-English meanings for raw Windows codes, added to tool output before the agent sees it.
 * The model reasons better from "graphics driver stopped responding" than from "0x116", and these
 * facts come from a table, so they are always correct.
 */

type Severity = "low" | "medium" | "high";
interface Meaning {
  meaning: string;
  severity: Severity;
}

/* ---------------- Device Manager problem codes (ConfigManagerErrorCode) ---------------- */

const DEVICE_PROBLEM_CODES: Record<number, Meaning> = {
  1: { meaning: "Device is not configured correctly; reinstalling or updating the driver usually helps.", severity: "medium" },
  3: { meaning: "Driver may be corrupted, or the system is low on memory.", severity: "medium" },
  10: { meaning: "Device cannot start; usually a driver problem. Updating or reinstalling the driver often fixes it.", severity: "high" },
  12: { meaning: "Not enough free resources for this device; another device may conflict with it.", severity: "medium" },
  14: { meaning: "Device needs a restart to work properly.", severity: "low" },
  18: { meaning: "Drivers need to be reinstalled.", severity: "medium" },
  19: { meaning: "Configuration information in the registry is incomplete or damaged.", severity: "medium" },
  21: { meaning: "Windows is removing this device.", severity: "low" },
  22: { meaning: "Device is disabled. Usually harmless unless the customer needs this device.", severity: "low" },
  24: { meaning: "Device is not present, not working properly, or its drivers are missing.", severity: "medium" },
  28: { meaning: "Drivers for this device are not installed.", severity: "high" },
  29: { meaning: "Device is disabled by the laptop's firmware (BIOS).", severity: "low" },
  31: { meaning: "Device is not working properly because Windows cannot load its driver.", severity: "high" },
  32: { meaning: "The driver's service is disabled.", severity: "medium" },
  33: { meaning: "Windows cannot determine which resources this device needs.", severity: "medium" },
  34: { meaning: "Device needs manual configuration.", severity: "medium" },
  35: { meaning: "The laptop's firmware is missing information for this device; a BIOS update may help.", severity: "medium" },
  36: { meaning: "Interrupt (IRQ) conflict; a firmware setting may need changing.", severity: "medium" },
  37: { meaning: "The driver reported a failure when it started.", severity: "high" },
  38: { meaning: "A previous instance of the driver is still in memory; a restart usually helps.", severity: "low" },
  39: { meaning: "Driver is corrupted or missing.", severity: "high" },
  40: { meaning: "Driver's registry information is missing or wrong.", severity: "medium" },
  41: { meaning: "Driver loaded but cannot find the hardware.", severity: "medium" },
  42: { meaning: "A duplicate device was detected.", severity: "medium" },
  43: { meaning: "Windows stopped this device because it reported problems; often a driver or hardware fault.", severity: "high" },
  44: { meaning: "An application or service shut this device down.", severity: "medium" },
  45: { meaning: "Device is not connected right now. Harmless if it was unplugged.", severity: "low" },
  46: { meaning: "Windows is shutting down; the device is not available.", severity: "low" },
  47: { meaning: "Device was prepared for safe removal.", severity: "low" },
  48: { meaning: "The driver is blocked because it has known problems; a newer driver is needed.", severity: "high" },
  49: { meaning: "The system registry is too large.", severity: "medium" },
  50: { meaning: "Windows cannot apply all properties for this device.", severity: "medium" },
  51: { meaning: "Device is waiting on another device to start.", severity: "low" },
  52: { meaning: "Windows cannot verify the driver's digital signature.", severity: "high" },
  53: { meaning: "Device is reserved for the Windows kernel debugger.", severity: "low" },
  54: { meaning: "Device failed and is being reset.", severity: "medium" },
};

function annotateDevice(device: Reading): Reading {
  const code = typeof device.problemCode === "number" ? device.problemCode : null;
  const entry = code !== null ? DEVICE_PROBLEM_CODES[code] : undefined;
  return entry ? { ...device, meaning: entry.meaning, severity: entry.severity } : device;
}

/* ---------------- Blue screen (bugcheck) codes ---------------- */

interface Bugcheck {
  name: string;
  likelyArea: string;
  meaning: string;
}

const BUGCHECKS: Record<number, Bugcheck> = {
  0x0a: { name: "IRQL_NOT_LESS_OR_EQUAL", likelyArea: "a driver or memory", meaning: "A driver accessed memory it should not; usually a faulty or outdated driver." },
  0x19: { name: "BAD_POOL_HEADER", likelyArea: "a driver or memory", meaning: "Memory used by a driver was damaged." },
  0x1a: { name: "MEMORY_MANAGEMENT", likelyArea: "RAM or a driver", meaning: "Memory management error; can point to faulty RAM or a bad driver." },
  0x1e: { name: "KMODE_EXCEPTION_NOT_HANDLED", likelyArea: "a driver", meaning: "A driver caused an error Windows could not handle." },
  0x3b: { name: "SYSTEM_SERVICE_EXCEPTION", likelyArea: "a driver or system files", meaning: "A system service failed; often a graphics or antivirus driver." },
  0x50: { name: "PAGE_FAULT_IN_NONPAGED_AREA", likelyArea: "RAM, a driver, or the disk", meaning: "Windows looked for data in memory that was not there." },
  0x7a: { name: "KERNEL_DATA_INPAGE_ERROR", likelyArea: "the disk", meaning: "Windows could not read data from the disk; can mean a failing drive or loose connection." },
  0x7e: { name: "SYSTEM_THREAD_EXCEPTION_NOT_HANDLED", likelyArea: "a driver", meaning: "A system thread crashed, usually because of a driver." },
  0x7f: { name: "UNEXPECTED_KERNEL_MODE_TRAP", likelyArea: "hardware or a driver", meaning: "The processor hit an error it could not handle; can be hardware or overheating." },
  0x8e: { name: "KERNEL_MODE_EXCEPTION_NOT_HANDLED", likelyArea: "a driver or memory", meaning: "A kernel-mode program crashed." },
  0x9f: { name: "DRIVER_POWER_STATE_FAILURE", likelyArea: "a driver during sleep or wake", meaning: "A driver failed while the laptop was going to sleep or waking up." },
  0xa0: { name: "INTERNAL_POWER_ERROR", likelyArea: "power management", meaning: "Power management failed, often around sleep or hibernate." },
  0xc2: { name: "BAD_POOL_CALLER", likelyArea: "a driver", meaning: "A driver made a bad memory request." },
  0xd1: { name: "DRIVER_IRQL_NOT_LESS_OR_EQUAL", likelyArea: "a driver (often network or Wi-Fi)", meaning: "A driver accessed memory it should not; often a network or Wi-Fi driver." },
  0xef: { name: "CRITICAL_PROCESS_DIED", likelyArea: "system files or the disk", meaning: "A critical Windows process stopped; can mean damaged system files." },
  0x101: { name: "CLOCK_WATCHDOG_TIMEOUT", likelyArea: "the CPU", meaning: "A processor core stopped responding; can be hardware, overheating, or firmware." },
  0x116: { name: "VIDEO_TDR_FAILURE", likelyArea: "the graphics driver", meaning: "The graphics driver stopped responding and could not recover. Usually fixed by updating the graphics driver." },
  0x117: { name: "VIDEO_TDR_TIMEOUT_DETECTED", likelyArea: "the graphics driver", meaning: "The graphics driver stopped responding in time." },
  0x119: { name: "VIDEO_SCHEDULER_INTERNAL_ERROR", likelyArea: "the graphics driver", meaning: "The graphics scheduler hit an error; usually a graphics driver problem." },
  0x124: { name: "WHEA_UNCORRECTABLE_ERROR", likelyArea: "hardware (CPU, memory, or overheating)", meaning: "The hardware reported a fatal error. Often overheating or a failing component." },
  0x133: { name: "DPC_WATCHDOG_VIOLATION", likelyArea: "a driver or storage firmware", meaning: "A driver took too long to respond; often a storage or SSD driver or firmware." },
  0x139: { name: "KERNEL_SECURITY_CHECK_FAILURE", likelyArea: "a driver or memory", meaning: "Windows detected corrupted data, usually from a driver." },
  0x154: { name: "UNEXPECTED_STORE_EXCEPTION", likelyArea: "the disk", meaning: "An error in Windows' memory store, often linked to the disk." },
};

function annotateBlueScreen(entry: Reading): Reading {
  const match = typeof entry.detail === "string" ? entry.detail.match(/0x[0-9a-fA-F]{8}/) : null;
  if (!match) return entry;
  // 0x1000007E-style codes are variants of the same bugcheck (0x7E).
  const code = Number.parseInt(match[0], 16) & 0x0fffffff;
  const info = BUGCHECKS[code];
  const bugcheck = `0x${code.toString(16).toUpperCase()}`;
  return info
    ? { ...entry, bugcheck, bugcheckName: info.name, likelyArea: info.likelyArea, meaning: info.meaning }
    : { ...entry, bugcheck };
}

/* ---------------- Processes that commonly show up in crash lists ---------------- */

const PROCESS_ROLES: Record<string, string> = {
  "wlanext.exe": "the Wi-Fi driver's helper (part of the Wi-Fi driver)",
  "rtkauduservice64.exe": "the Realtek audio driver service",
  "nvcontainer.exe": "an NVIDIA graphics driver or app component",
  "nvdisplay.container.exe": "the NVIDIA display driver container",
  "igfxem.exe": "the Intel graphics driver helper",
  "explorer.exe": "the Windows desktop and File Explorer",
  "dwm.exe": "the Windows desktop window manager (graphics)",
  "audiodg.exe": "the Windows audio engine",
  "searchhost.exe": "Windows Search",
  "searchindexer.exe": "Windows Search indexing",
  "shellexperiencehost.exe": "the Windows taskbar and notifications",
  "startmenuexperiencehost.exe": "the Start menu",
  "svchost.exe": "a Windows background service",
  "mcchsvc.exe": "McAfee security software",
};

const REPEATED_CRASH_THRESHOLD = 5;

/* ---------------- Windows Update error codes ---------------- */

const UPDATE_ERRORS: Record<string, string> = {
  "0x80240034": "The update download failed; usually a network or Microsoft Store issue. Often retried successfully later.",
  "0x80246007": "The update download did not complete.",
  "0x80D02002": "The update download timed out.",
  "0x8024402C": "Cannot reach the update server; check the internet connection, DNS, or a proxy/VPN.",
  "0x80244022": "The update server was busy; trying again later usually works.",
  "0x80070002": "A required file is missing; the update cache may be damaged.",
  "0x80070003": "A required path is missing; the update cache may be damaged.",
  "0x8007000D": "Update data is invalid; the download may be corrupted.",
  "0x80070005": "Access denied while installing the update.",
  "0x80070070": "Not enough disk space to install the update.",
  "0x800F081F": "Windows component files needed by the update are missing.",
  "0x80073712": "Windows component store is damaged.",
  "0x800F0922": "The update could not install; often a VPN connection or a too-small system reserved partition.",
  "0x800F0831": "A previous update the new one depends on is missing.",
  "0x80240017": "The update does not apply to this laptop.",
};

/* ---------------- Common event log entries (source:eventId) ---------------- */

const EVENT_MEANINGS: Record<string, Meaning> = {
  "Microsoft-Windows-Kernel-Power:41": { meaning: "The laptop restarted without shutting down cleanly (a crash, power loss, or forced power-off).", severity: "high" },
  "EventLog:6008": { meaning: "The previous shutdown was unexpected.", severity: "medium" },
  "Microsoft-Windows-WLAN-AutoConfig:10003": { meaning: "The Wi-Fi driver's helper module crashed; usually a Wi-Fi driver problem.", severity: "medium" },
  "Microsoft-Windows-DistributedCOM:10010": { meaning: "A background component did not start in time. Usually harmless.", severity: "low" },
  "Microsoft-Windows-DistributedCOM:10016": { meaning: "A permissions warning for a background component. Harmless and very common.", severity: "low" },
  "Microsoft-Windows-TPM-WMI:1801": { meaning: "A Secure Boot certificate update is waiting to be applied to the firmware. Security housekeeping; it does not cause slowness or crashes.", severity: "low" },
  "Microsoft-Windows-TPM-WMI:1802": { meaning: "A Secure Boot update was blocked by a known firmware issue; a BIOS update from the manufacturer resolves it. Does not cause slowness or crashes.", severity: "low" },
  "Microsoft-Windows-Bits-Client:16392": { meaning: "The background download service (used by Windows Update) failed to start.", severity: "medium" },
  "Service Control Manager:7000": { meaning: "A Windows service failed to start.", severity: "medium" },
  "Service Control Manager:7009": { meaning: "A Windows service took too long to start.", severity: "low" },
  "Service Control Manager:7011": { meaning: "A Windows service took too long to respond.", severity: "low" },
  "Service Control Manager:7023": { meaning: "A Windows service stopped with an error.", severity: "medium" },
  "Service Control Manager:7024": { meaning: "A Windows service stopped with a service-specific error.", severity: "medium" },
  "Service Control Manager:7031": { meaning: "A Windows service crashed unexpectedly and was restarted.", severity: "medium" },
  "Service Control Manager:7034": { meaning: "A Windows service crashed unexpectedly.", severity: "medium" },
  "disk:7": { meaning: "The disk has a bad block; the drive may be failing.", severity: "high" },
  "disk:11": { meaning: "The disk controller reported an error; the drive or its connection may be failing.", severity: "high" },
  "disk:51": { meaning: "An error occurred while writing to the disk.", severity: "high" },
  "disk:153": { meaning: "Disk operations had to be retried; the drive may be struggling.", severity: "medium" },
  "Ntfs:55": { meaning: "The file system on a drive is damaged.", severity: "high" },
  "Ntfs:98": { meaning: "A drive needs a file system check.", severity: "medium" },
  "Display:4101": { meaning: "The graphics driver stopped responding and recovered.", severity: "medium" },
  "Microsoft-Windows-Resource-Exhaustion-Detector:2004": { meaning: "Windows ran low on memory.", severity: "medium" },
  "Microsoft-Windows-WHEA-Logger:18": { meaning: "The hardware reported a fatal error (CPU, memory, or overheating).", severity: "high" },
  "Microsoft-Windows-WHEA-Logger:19": { meaning: "The hardware reported a corrected error; repeated ones can mean failing hardware.", severity: "medium" },
  "Microsoft-Windows-WHEA-Logger:17": { meaning: "A corrected hardware connection (PCIe) error. Usually harmless unless frequent.", severity: "low" },
  "Microsoft-Windows-Kernel-Processor-Power:37": { meaning: "The CPU speed was limited by the firmware, often because of heat or power limits.", severity: "medium" },
};

/* ---------------- Per-tool annotators ---------------- */

const annotators: Partial<Record<string, (data: Reading) => Reading>> = {
  get_driver_problems: (data) => ({ ...data, devices: asList(data.devices).map(annotateDevice) }),

  get_peripheral_devices: (data) => ({
    ...data,
    deviceClasses: asList(data.deviceClasses).map((group) => ({ ...group, problems: asList(group.problems).map(annotateDevice) })),
  }),

  get_crash_history: (data) => {
    const blueScreens = asList(data.blueScreens).map(annotateBlueScreen);
    const topCrashingApps = asList(data.topCrashingApps).map((app): Reading => {
      const role = PROCESS_ROLES[String(app.app ?? "").toLowerCase()];
      const repeated = typeof app.crashes === "number" && app.crashes >= REPEATED_CRASH_THRESHOLD;
      return { ...app, ...(role && { role }), ...(repeated && { repeated: true }) };
    });

    // Short, pre-digested highlights so the most important clues are not missed.
    const highlights = [
      ...blueScreens.filter((b) => b.bugcheckName).map((b) => `Blue screen ${b.bugcheck} (${b.bugcheckName}) points to ${b.likelyArea}.`),
      ...topCrashingApps
        .filter((app) => app.repeated)
        .map((app) => `${app.app} crashed ${app.crashes} times in ${data.days ?? 30} days${app.role ? `; it is ${app.role}` : ""}.`),
    ];
    return { ...data, blueScreens, topCrashingApps, highlights };
  },

  get_windows_update_status: (data) => {
    const explain = (entry: Reading) => {
      const code = typeof entry.errorCode === "string" ? entry.errorCode.toUpperCase().replace("0X", "0x") : null;
      return code && UPDATE_ERRORS[code] ? { ...entry, meaning: UPDATE_ERRORS[code] } : entry;
    };
    return { ...data, recentFailures: asList(data.recentFailures).map(explain), recentUpdates: asList(data.recentUpdates).map(explain) };
  },

  get_recent_errors: (data) => ({
    ...data,
    events: asList(data.events).map((event) => {
      const entry = EVENT_MEANINGS[`${event.source}:${event.eventId}`];
      return entry ? { ...event, meaning: entry.meaning, severity: entry.severity } : event;
    }),
  }),

  get_thermal_status: (data) => {
    const events = typeof data.firmwareThrottleEvents7d === "number" ? data.firmwareThrottleEvents7d : 0;
    return events > 0
      ? { ...data, throttlingNote: `The firmware limited the CPU speed ${events} times in the last 7 days, usually because of heat or power limits.` }
      : data;
  },
};

/** Adds plain-English meanings to a tool's output. Unknown tools and unexpected shapes pass through unchanged. */
export function annotateToolOutput(tool: string, output: unknown): unknown {
  const annotate = annotators[tool];
  const data = asRecord(output);
  return annotate && data ? annotate(data) : output;
}
