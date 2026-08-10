import type { Position } from './types';
import { yardOf } from './types';

/**
 * The official five-part code, exactly as the yard writes it:
 *
 *     1-A-03-01-A
 *     │ │  │  │ └─ tier: A الطابق الأول، B الثاني
 *     │ │  │  └─── stack: 01…10 across the strip
 *     │ │  └────── bay: odd = a 20; even = a 40 across the two odd bays
 *     │ └───────── zone: A…E as painted on the ground
 *     └─────────── yard: derived from the zone — E is yard 2
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
