/**
 * ISO 6346 container number check — fresh implementation for the web rebuild.
 *
 * Four letters (owner code + category letter U/J/Z) and seven digits — six of
 * serial and one of check — which is the shape the owner records containers
 * in: «4 احرف و7 ارقام». **An invalid number is a warning, never a refusal**:
 * real yards receive containers whose numbers are mistyped on the paperwork or
 * repainted wrongly, and refusing to record them would force the clerk to
 * either lie or keep the box off the books.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * A = 10, then one per letter skipping every multiple of 11 — so B = 12 and
 * L = 23. Derived from the rule rather than typed as a 26-entry table: a
 * transposed digit in such a table yields a validator wrong for exactly one
 * letter, which no reviewer would spot.
 */
const LETTER_VALUES = new Map<string, number>();
{
  let value = 10;
  for (const letter of ALPHABET) {
    while (value % 11 === 0) value += 1;
    LETTER_VALUES.set(letter, value);
    value += 1;
  }
}

/** Strips the separators people write by hand: `MSCU 123456-7` → `MSCU1234567`. */
export function normalizeNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export interface NumberCheck {
  readonly valid: boolean;
  /** The number is the standard shape — four letters, seven digits. */
  readonly wellFormed: boolean;
  readonly normalized: string;
  /** What the last digit should have been; null when too malformed to compute. */
  readonly expectedDigit: number | null;
}

/**
 * The one accepted form, on the owner's instruction: FOUR LETTERS AND SEVEN
 * DIGITS. A shorter four-and-four designation used to pass here as «the yard's
 * own form» — it no longer does, because a number that short cannot carry a
 * check digit and so cannot be checked at all, which is the whole point of
 * writing it down. Anything else is still RECORDED, with a warning beside it.
 */
export const NUMBER_FORM = /^[A-Z]{4}\d{7}$/;

export function checkNumber(raw: string): NumberCheck {
  const normalized = normalizeNumber(raw);

  if (!NUMBER_FORM.test(normalized)) {
    return { valid: false, wellFormed: false, normalized, expectedDigit: null };
  }

  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const ch = normalized[i] ?? '';
    const value = i < 4 ? (LETTER_VALUES.get(ch) ?? 0) : Number(ch);
    sum += value * 2 ** i;
  }

  // Modulo 11 then 10: a remainder of ten cannot be written in one digit and
  // the standard records it as zero.
  const expectedDigit = (sum % 11) % 10;
  const category = normalized[3] ?? '';
  const valid = 'UJZ'.includes(category) && Number(normalized[10]) === expectedDigit;

  return { valid, wellFormed: true, normalized, expectedDigit };
}
