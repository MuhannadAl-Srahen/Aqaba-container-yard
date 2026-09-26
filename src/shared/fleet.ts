import type { CarrierDto, TruckDto } from './types';

/**
 * الناقلون وسياراتهم. A truck's identity on paper is its ترميز and its
 * number — the yard writes «60-84785» — but the gate types plates however
 * the moment allows: with the code, without it, with a dash, with Arabic
 * digits. Matching is therefore by NORMALIZED text, and this module is the
 * single authority both sides use, so the gate's autofill and the carrier
 * register can never disagree about which truck a plate names.
 *
 * Pure by contract: no fetch, no DB, no DOM.
 */

/** ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ down to Western digits. */
const ARABIC_DIGITS: Readonly<Record<string, string>> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * A plate reduced to what identifies it: digits and Latin letters, uppercase,
 * Arabic digits folded to Western. «60-84785», «60 84785» and «٦٠٨٤٧٨٥» all
 * come out as «6084785».
 */
export function normalizePlate(text: string): string {
  let out = '';
  for (const ch of text) {
    const western = ARABIC_DIGITS[ch] ?? ch;
    if (/[0-9A-Za-z]/.test(western)) out += western.toUpperCase();
  }
  return out;
}

/** The plate as the yard writes it: «60-84785», or the bare number without a code. */
export function plateLabel(truck: { readonly code: string; readonly number: string }): string {
  return truck.code === '' ? truck.number : `${truck.code}-${truck.number}`;
}

/** Does this typed plate name this registered truck — with or without its code? */
export function plateMatches(
  truck: { readonly code: string; readonly number: string },
  typed: string,
): boolean {
  const wanted = normalizePlate(typed);
  if (wanted === '' || truck.number === '') return false;
  return wanted === normalizePlate(truck.code + truck.number) || wanted === normalizePlate(truck.number);
}

/**
 * The one registered truck a typed plate names, or null. A full plate (code
 * and number) wins outright; a bare number only answers when exactly one
 * truck carries it — two carriers with the same number under different codes
 * is an ambiguity this must not guess at.
 */
export function findTruck(trucks: readonly TruckDto[], typed: string): TruckDto | null {
  const wanted = normalizePlate(typed);
  if (wanted === '') return null;
  const full = trucks.filter((truck) => normalizePlate(truck.code + truck.number) === wanted);
  if (full.length === 1) return full[0] ?? null;
  if (full.length > 1) return null;
  const bare = trucks.filter(
    (truck) => truck.number !== '' && normalizePlate(truck.number) === wanted,
  );
  return bare.length === 1 ? (bare[0] ?? null) : null;
}

/**
 * One plate the gate has written, with the last driver name typed beside it.
 * The registry says whose truck it is; this says who was actually driving.
 */
export interface PlateDriver {
  /** Normalized — «60-84785», «60 84785» and «٦٠٨٤٧٨٥» all key the same row. */
  readonly plate: string;
  readonly driver: string;
  /** The instant that name was written, newest wins. */
  readonly at: string;
}

/**
 * «بدي مجرد ما كتبت رقم سيارته خلص يكتب اسمه تلقائي»: the driver the gate
 * last wrote beside this plate. A suggestion, and only that — the same truck
 * carries different drivers, so whatever the clerk types over it stands.
 */
export function findPlateDriver(book: readonly PlateDriver[], typed: string): string {
  const wanted = normalizePlate(typed);
  if (wanted === '') return '';
  return book.find((row) => row.plate === wanted)?.driver ?? '';
}

/**
 * A gate-typed plate split back into ترميز and number, for pre-filling the
 * registration form: «60-84785» and «60 84785» give code 60 and number 84785.
 * Anything without one clean digits-separator-digits shape keeps the whole
 * text as the number — guessing further would put words in the owner's mouth.
 */
export function splitPlate(text: string): { code: string; number: string } {
  const trimmed = text.trim();
  const parts = /^(\d{1,3})[\s/-]+(\d{3,})$/.exec(trimmed);
  const code = parts?.[1];
  const number = parts?.[2];
  if (code !== undefined && number !== undefined) return { code, number };
  return { code: '', number: trimmed };
}

/** The carrier a typed plate belongs to, through its registered truck. */
export function carrierOfPlate(
  carriers: readonly CarrierDto[],
  trucks: readonly TruckDto[],
  typed: string,
): CarrierDto | null {
  const truck = findTruck(trucks, typed);
  if (truck === null) return null;
  return carriers.find((carrier) => carrier.id === truck.carrierId) ?? null;
}
