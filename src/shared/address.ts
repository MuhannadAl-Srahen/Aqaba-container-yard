import type { Position, Tier, Zone } from './types';
import { TIERS, ZONES } from './types';
import { ASEZA } from './asezaLayout';

/**
 * The official five-part code, exactly as the yard writes it:
 *
 *     1-A-03-01-A
 *     │ │  │  │ └─ tier: A الطابق الأول، B الثاني
 *     │ │  │  └─── stack: 01…10 across the strip
 *     │ │  └────── bay: odd = a 20; even = a 40 across the two odd bays
 *     │ └───────── zone: A…E as painted on the ground
 *     └─────────── yard: derived, not typed — everything here is SAHA 2
 *
 * Western digits, LTR — the code reads the same on screen, paper and radio.
 */

/**
 * Which yard each zone belongs to — the address digit nobody types by hand.
 * Seeded from the official plan (A…E are SAHA 2) and taught the owner's own
 * zones whenever the effective layout is composed; an unknown letter reads
 * as yard 2, the plan's own ground.
 */
const yardRegistry = new Map<string, number>(
  ASEZA.zones.map((zone) => [zone.zone, zone.yard]),
);

export function registerYards(
  zones: ReadonlyArray<{ readonly zone: string; readonly yard: number }>,
): void {
  for (const zone of zones) yardRegistry.set(zone.zone, zone.yard);
}

export function yardOf(zone: Zone): number {
  return yardRegistry.get(zone) ?? 2;
}

/** Every yard the registry knows, smallest first — the map's tab row. */
export function knownYards(): readonly number[] {
  return [...new Set(yardRegistry.values())].sort((a, b) => a - b);
}

const two = (n: number): string => String(n).padStart(2, '0');

export function positionLabel(position: Position): string {
  return [
    String(yardOf(position.zone)),
    position.zone,
    two(position.bay),
    two(position.stack),
    position.tier,
  ].join('-');
}

/** The short form for tight spots (map cells, chips): `A-03` بدون التفصيل. */
export function bayLabel(zone: string, bay: number): string {
  return `${zone}-${two(bay)}`;
}

export function samePosition(a: Position, b: Position): boolean {
  return a.zone === b.zone && a.bay === b.bay && a.stack === b.stack && a.tier === b.tier;
}

export function positionKey(position: Position): string {
  return `${position.zone}|${String(position.bay)}|${String(position.stack)}|${position.tier}`;
}

/**
 * The odd bays a container at this bay actually covers on the ground:
 * a 20 covers its own odd bay; a 40 at an even bay lies across the odd
 * bays either side of it.
 */
export function baySpan(bay: number): readonly number[] {
  return bay % 2 === 1 ? [bay] : [bay - 1, bay + 1];
}

/**
 * The inverse of `baySpan`: the even bays whose 40 would cover this odd one.
 *
 * A CHOICE of two, not arithmetic — only the person standing in the yard
 * knows which side the steel actually lies on. Bay 0 is not an address (and
 * `sizeOfBay(0)` would answer 40 while `baySpan(0)` returned [-1, 1]), so
 * bay 01 has one answer and not two.
 *
 * The caller must still ask the LAYOUT whether the far odd bay exists AT THE
 * SAME STACK. `zone.bays.includes` is necessary and not sufficient: on the
 * official plan A 11/2, A 47/1, E 25/1 and E 25/2 pass the bay test and fail
 * the stack test.
 */
export function coveringBays(oddBay: number): readonly number[] {
  if (oddBay % 2 === 0) return [];
  return oddBay >= 3 ? [oddBay - 1, oddBay + 1] : [oddBay + 1];
}


/**
 * An address somebody typed, as far as they typed it. The search box takes
 * the code the way it is read over the radio, so this is deliberately
 * forgiving: the yard digit is optional (the zone already decides it), the
 * separator may be a dash, a slash or a space, the numbers need not be padded
 * and the letters may be lower case.
 *
 *     2-E-18-01-A   E-18-01-A   E/18/1/a   e 18   E-18-01
 *
 * A bay alone is a perfectly good answer — «وين الباي E-18» — so the stack
 * and tier come back undefined rather than refusing the whole thing.
 */
export interface AddressQuery {
  /**
   * The leading digit, when one was typed. It is carried, not judged: only
   * the layout knows which yard a zone sits in, and this file has no layout.
   */
  readonly yard?: number;
  readonly zone: Zone;
  readonly bay: number;
  readonly stack?: number;
  readonly tier?: Tier;
}

export function parseAddress(text: string): AddressQuery | null {
  const parts = text
    .trim()
    .toUpperCase()
    .split(/[-/\s.]+/)
    .filter((part) => part !== '');
  if (parts.length < 2) return null;

  let rest = parts;
  let yard: number | undefined;
  const lead = parts[0];
  if (lead !== undefined && /^[1-9]$/.test(lead)) {
    yard = Number(lead);
    rest = parts.slice(1);
  }
  if (rest.length < 2 || rest.length > 4) return null;

  const zone = rest[0];
  if (zone === undefined || !isZone(zone)) return null;

  const bay = wholeNumber(rest[1]);
  if (bay === null || bay < 1 || bay > 99) return null;

  const stackText = rest[2];
  const stack = stackText === undefined ? undefined : (wholeNumber(stackText) ?? -1);
  if (stack !== undefined && (stack < 1 || stack > 99)) return null;

  const tierText = rest[3];
  if (tierText !== undefined && !isTier(tierText)) return null;
  const tier = tierText === undefined ? undefined : (tierText as Tier);
  // A tier without a stack is not an address, it is half of one.
  if (tier !== undefined && stack === undefined) return null;

  return {
    ...(yard === undefined ? {} : { yard }),
    zone,
    bay,
    ...(stack === undefined ? {} : { stack }),
    ...(tier === undefined ? {} : { tier }),
  };
}

function isZone(text: string): text is Zone {
  // The official letters plus whatever the owner's zones have taught the
  // registry — the layout, not this file, is the judge of what exists.
  return (ZONES as readonly string[]).includes(text) || yardRegistry.has(text);
}

function isTier(text: string): text is Tier {
  return (TIERS as readonly string[]).includes(text);
}

function wholeNumber(text: string | undefined): number | null {
  if (text === undefined || !/^\d{1,2}$/.test(text)) return null;
  return Number(text);
}
