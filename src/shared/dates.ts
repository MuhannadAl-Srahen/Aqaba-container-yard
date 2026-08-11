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

/**
 * The Amman calendar YEAR of an instant. The gate cards are numbered per year
 * and start again at 1 each January, so which year a card belongs to is the
 * office's year, not UTC's — a card issued at 01:30 on the first of January
 * belongs to the new year even though UTC still says the old one.
 */
export function ammanYear(iso: string | Date): number {
  return Number(ammanDay(iso).slice(0, 4));
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

const AMMAN_STAMP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Amman',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * An instant as the `YYYY-MM-DDTHH:mm` a datetime-local input wants, on the
 * Amman wall clock — because that is the clock the person correcting a gate
 * date read it from.
 */
export function toLocalStamp(iso: string | Date): string {
  const parts = AMMAN_STAMP.formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
  const of = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  return `${of('year')}-${of('month')}-${of('day')}T${of('hour')}:${of('minute')}`;
}

/**
 * The reverse: the UTC instant whose Amman wall clock reads exactly this.
 * Solved by iteration rather than by hard-coding +03:00 — Jordan has changed
 * its mind about daylight saving before, and a wrong hour here would silently
 * move a container between two days of the register.
 */
export function fromLocalStamp(stamp: string): string | null {
  // Shape-checked rather than handed straight to Date.parse, which accepts
  // all sorts of nonsense and answers with a plausible-looking instant.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(stamp)) return null;
  const target = Date.parse(`${stamp}:00Z`);
  if (Number.isNaN(target)) return null;
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const shown = Date.parse(`${toLocalStamp(new Date(guess))}:00Z`);
    if (shown === target) break;
    guess += target - shown;
  }
  return new Date(guess).toISOString();
}
