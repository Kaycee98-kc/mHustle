// Copy of supabase/functions/_shared/time.ts so the web folder builds on its own. Keep in sync.
// Singapore time helpers (Asia/Singapore is fixed UTC+8, no daylight saving).
// Pure TypeScript — shared by the web app and the Supabase Edge Functions.

export const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for the Singapore calendar date of an instant. */
export function sgtDate(d: Date = new Date()): string {
  return new Date(d.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:MM" Singapore wall-clock time of an instant. */
export function sgtTime(d: Date = new Date()): string {
  return new Date(d.getTime() + SGT_OFFSET_MS).toISOString().slice(11, 16);
}

/** Instant for a Singapore date + time ("HH:MM" or "HH:MM:SS"). */
export function sgtInstant(date: string, time = "00:00"): Date {
  const t = time.length === 5 ? `${time}:00` : time.slice(0, 8);
  return new Date(`${date}T${t}+08:00`);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Reporting period (Saturday → Friday) that contains the given Singapore date. */
export function periodFor(date: string): { start: string; end: string } {
  const back = (weekday(date) + 1) % 7; // Sat→0, Sun→1, … Fri→6
  const start = addDays(date, -back);
  return { start, end: addDays(start, 6) };
}

/** Instant at which a period's automatic report is due: Friday 23:59 SGT. */
export function reportDueAt(periodEnd: string): Date {
  return sgtInstant(periodEnd, "23:59");
}

/** Most recent period whose Friday 23:59 SGT has passed. */
export function lastClosedPeriod(now: Date = new Date()): { start: string; end: string } {
  const current = periodFor(sgtDate(now));
  if (now.getTime() >= reportDueAt(current.end).getTime()) return current;
  return periodFor(addDays(current.start, -1));
}

/** Next Monday strictly after the Singapore date of `from` (Monday → +7 days). */
export function nextMonday(from: Date): string {
  const d = sgtDate(from);
  const wd = weekday(d); // Mon = 1
  const add = wd === 1 ? 7 : (8 - wd) % 7 || 7;
  return addDays(d, add);
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/** "Saturday, 21 November 2026" */
export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${DAYS[weekday(date)]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "21 Nov 2026" */
export function shortDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

/** "2:30 PM" from "14:30[:00]" */
export function time12(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "21 Nov 2026, 2:30 PM" (Singapore) for an ISO instant */
export function sgtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${shortDate(sgtDate(d))}, ${time12(sgtTime(d))}`;
}
