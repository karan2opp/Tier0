/**
 * Visit windows for pickup and delivery, generated deterministically in Indian time (UTC+05:30, no DST).
 * Demo rule set: Monday to Saturday, three 2-hour windows a day, never sooner than 2 hours from now.
 */

const WINDOWS: Array<[startHour: number, endHour: number]> = [
  [10, 12],
  [13, 15],
  [16, 18],
];
const MIN_NOTICE_MS = 2 * 60 * 60 * 1000;
const DAYS_AHEAD = 10;
/** Six working days of three windows, so the day a customer asks for is usually in the list. */
export const MAX_SLOTS = 18;

export interface Window {
  start: Date;
  end: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's calendar date in India. */
function indiaToday(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  return { y: parts[0], m: parts[1], d: parts[2] };
}

/** Upcoming windows that start no earlier than `earliest` (and at least 2 hours from now). */
export function upcomingWindows(earliest: Date | null, now = new Date()): Window[] {
  const notBefore = new Date(Math.max(now.getTime() + MIN_NOTICE_MS, earliest?.getTime() ?? 0));
  const { y, m, d } = indiaToday(now);
  const windows: Window[] = [];

  for (let offset = 0; offset <= DAYS_AHEAD && windows.length < MAX_SLOTS; offset++) {
    const day = new Date(Date.UTC(y, m - 1, d + offset));
    if (day.getUTCDay() === 0) continue; // no visits on Sundays
    const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
    for (const [startHour, endHour] of WINDOWS) {
      const start = new Date(`${date}T${pad(startHour)}:00:00+05:30`);
      if (start < notBefore) continue;
      windows.push({ start, end: new Date(`${date}T${pad(endHour)}:00:00+05:30`) });
      if (windows.length >= MAX_SLOTS) break;
    }
  }
  return windows;
}
