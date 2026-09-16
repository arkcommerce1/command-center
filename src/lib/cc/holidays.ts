// Chinese public holiday table (SPEC §3.6). Checked into the repo so
// business-time math is deterministic and reviewable. Business days are
// Monday–Friday excluding every date in this table (ranges are inclusive).
//
// 2026 festival dates follow the State Council General Office circular for
// 2026. 2027 Spring Festival / Dragon Boat / Mid-Autumn dates are provisional
// (lunar-calendar mapping) — confirm against the State Council circular when
// it is published and patch this file. Golden Week (Oct 1–7) is fixed both
// years.

export interface ChinaHoliday {
  name: string;
  /** Inclusive start, YYYY-MM-DD. */
  start: string;
  /** Inclusive end, YYYY-MM-DD. */
  end: string;
}

export const CHINA_HOLIDAYS_2026: ChinaHoliday[] = [
  { name: "New Year's Day", start: "2026-01-01", end: "2026-01-01" },
  { name: "Spring Festival", start: "2026-02-16", end: "2026-02-22" },
  { name: "Qingming Festival", start: "2026-04-04", end: "2026-04-06" },
  { name: "Labour Day", start: "2026-05-01", end: "2026-05-05" },
  { name: "Dragon Boat Festival", start: "2026-06-19", end: "2026-06-19" },
  { name: "Mid-Autumn Festival", start: "2026-09-25", end: "2026-09-25" },
  { name: "National Day Golden Week", start: "2026-10-01", end: "2026-10-07" },
];

export const CHINA_HOLIDAYS_2027: ChinaHoliday[] = [
  { name: "New Year's Day", start: "2027-01-01", end: "2027-01-01" },
  { name: "Spring Festival", start: "2027-02-06", end: "2027-02-12" },
  { name: "Qingming Festival", start: "2027-04-05", end: "2027-04-05" },
  { name: "Labour Day", start: "2027-05-01", end: "2027-05-05" },
  { name: "Dragon Boat Festival", start: "2027-06-11", end: "2027-06-11" },
  { name: "Mid-Autumn Festival", start: "2027-09-15", end: "2027-09-15" },
  { name: "National Day Golden Week", start: "2027-10-01", end: "2027-10-07" },
];

export const CHINA_HOLIDAYS: ChinaHoliday[] = [...CHINA_HOLIDAYS_2026, ...CHINA_HOLIDAYS_2027];

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True when the calendar date (UTC) falls inside any holiday range. */
export function isHolidayKey(yyyymmdd: string, holidays: ChinaHoliday[] = CHINA_HOLIDAYS): boolean {
  return holidays.some((h) => yyyymmdd >= h.start && yyyymmdd <= h.end);
}

export function isHolidayDate(d: Date, holidays: ChinaHoliday[] = CHINA_HOLIDAYS): boolean {
  return isHolidayKey(toKey(d), holidays);
}
