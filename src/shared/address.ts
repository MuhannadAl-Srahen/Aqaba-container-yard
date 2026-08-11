import type { Position, Tier, Zone } from './types';
import { TIERS, ZONES, yardOf } from './types';

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
  if (bay === null || bay < 1 || bay > 60) return null;

  const stackText = rest[2];
  const stack = stackText === undefined ? undefined : (wholeNumber(stackText) ?? -1);
  if (stack !== undefined && (stack < 1 || stack > 10)) return null;

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
  return (ZONES as readonly string[]).includes(text);
}

function isTier(text: string): text is Tier {
  return (TIERS as readonly string[]).includes(text);
}

function wholeNumber(text: string | undefined): number | null {
  if (text === undefined || !/^\d{1,2}$/.test(text)) return null;
  return Number(text);
}
