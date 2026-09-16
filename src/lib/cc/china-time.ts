// China business-time module (SPEC §3.6). Clock: China Standard Time (UTC+8,
// no DST). Business days: Monday–Friday excluding the holiday table in
// ./holidays. Follow-ups go out only 9:30–18:00 on business days.
//
// Due-date model: "24 business-day hours" means the wall-clock deadline
// pushed past non-business days with time-of-day preserved — so Friday 5pm
// + 24h becomes due Monday 5pm, and nothing ever becomes due on a weekend,
// a holiday, or during Golden Week.
import { CHINA_HOLIDAYS, type ChinaHoliday, isHolidayKey } from "@/lib/cc/holidays";

export const CST_OFFSET_MS = 8 * 3600 * 1000;
export const SLOT_START_HOUR = 9;
export const SLOT_START_MIN = 30;
export const SLOT_END_HOUR = 18;
export const DAY_MS = 24 * 3600 * 1000;

interface CstParts {
  key: string; // YYYY-MM-DD in CST
  weekday: number; // 0=Sun..6=Sat, in CST
  minutes: number; // minutes since midnight, in CST
}

function cstParts(d: Date): CstParts {
  const c = new Date(d.getTime() + CST_OFFSET_MS);
  const key = c.toISOString().slice(0, 10);
  return {
    key,
    weekday: c.getUTCDay(),
    minutes: c.getUTCHours() * 60 + c.getUTCMinutes(),
  };
}

/** Business day: Mon–Fri in CST and not a Chinese public holiday. */
export function isBusinessDay(d: Date, holidays: ChinaHoliday[] = CHINA_HOLIDAYS): boolean {
  const p = cstParts(d);
  if (p.weekday === 0 || p.weekday === 6) return false;
  return !isHolidayKey(p.key, holidays);
}

/** Business time: business day AND inside the 9:30–18:00 send window. */
export function isBusinessTime(d: Date, holidays: ChinaHoliday[] = CHINA_HOLIDAYS): boolean {
  if (!isBusinessDay(d, holidays)) return false;
  const p = cstParts(d);
  return p.minutes >= SLOT_START_HOUR * 60 + SLOT_START_MIN && p.minutes < SLOT_END_HOUR * 60;
}

function cstMidnightUtcMs(key: string): number {
  const [y, m, day] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, day) - CST_OFFSET_MS;
}

/**
 * Next send slot: the input itself when it is business time, 9:30 the same
 * business day when before the window, else 9:30 on the next business day.
 */
export function nextBusinessSlot(d: Date, holidays: ChinaHoliday[] = CHINA_HOLIDAYS): Date {
  if (isBusinessTime(d, holidays)) return new Date(d.getTime());
  const p = cstParts(d);
  if (isBusinessDay(d, holidays) && p.minutes < SLOT_START_HOUR * 60 + SLOT_START_MIN) {
    return new Date(cstMidnightUtcMs(p.key) + (SLOT_START_HOUR * 60 + SLOT_START_MIN) * 60 * 1000);
  }
  let dayMs = cstMidnightUtcMs(p.key) + DAY_MS;
  for (;;) {
    const cand = new Date(dayMs + (SLOT_START_HOUR * 60 + SLOT_START_MIN) * 60 * 1000);
    if (isBusinessDay(cand, holidays)) return cand;
    dayMs += DAY_MS;
  }
}

/**
 * Add business hours: wall-clock add, then push whole days past weekends and
 * holidays with time-of-day preserved. Friday 5pm + 24h -> Monday 5pm;
 * nothing lands inside Golden Week.
 */
export function addBusinessHours(d: Date, hours: number, holidays: ChinaHoliday[] = CHINA_HOLIDAYS): Date {
  let t = d.getTime() + hours * 3600 * 1000;
  while (!isBusinessDay(new Date(t), holidays)) t += DAY_MS;
  return new Date(t);
}

/**
 * True when `hoursNeeded` business hours after `openedAt` have passed as of
 * `now` (defaults to now). E.g. a they_owe question (24h): opened Friday 5pm
 * CST is due Monday 5pm CST.
 */
export function isDue(
  openedAt: Date,
  hoursNeeded: number,
  now: Date = new Date(),
  holidays: ChinaHoliday[] = CHINA_HOLIDAYS,
): boolean {
  return now.getTime() >= addBusinessHours(openedAt, hoursNeeded, holidays).getTime();
}
