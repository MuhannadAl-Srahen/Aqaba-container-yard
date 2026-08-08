/**
 * The yard's calendar. Every day in this system is an AMMAN day — the office
 * opens and closes by the wall clock, not by UTC — and a container that came
 * in last night at 23:30 has been here "a day" this morning even though only
 * nine hours passed. Counting elapsed 24-hour blocks instead of calendar days
 * is the bug this file exists to prevent, in one place for both sides.
 */

const AMMAN_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Amman',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Amman calendar date of an instant, as `YYYY-MM-DD`. */
export function ammanDay(iso: string | Date): string {
  return AMMAN_DAY.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** Midday UTC of an Amman calendar date — a safe instant to do date maths on. */
function noonOf(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

/**
 * Whole Amman calendar days from one instant to another; never negative.
 * Same day is 0, last night to this morning is 1.
 */
export function daysBetween(fromIso: string | Date, toIso: string | Date): number {
  const days = Math.round((noonOf(ammanDay(toIso)) - noonOf(ammanDay(fromIso))) / 86_400_000);
  return Math.max(0, days);
}
