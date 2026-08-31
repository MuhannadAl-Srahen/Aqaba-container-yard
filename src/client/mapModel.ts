import type { ContainerDto, Position, Size, Tier, YardLayout, Zone, ZoneDef } from '../shared/types';
import { TIERS } from '../shared/types';
import { baySpan, parseAddress } from '../shared/address';
import { buildOccupancy, canPlace, type Standing } from '../shared/rules';
import { normalizeNumber } from '../shared/iso6346';

/**
 * Pure map arithmetic, kept out of the components so it can be tested without
 * rendering anything. The grid itself is the official layout; everything here
 * only counts who stands where on it.
 */

export function toStanding(containers: readonly ContainerDto[]): Standing[] {
  const standing: Standing[] = [];
  for (const container of containers) {
    if (container.position === null) continue;
    standing.push({
      id: container.id,
      number: container.number,
      size: container.size,
      position: container.position,
    });
  }
  return standing;
}

/** `zone|oddBay` — the ground a map cell draws. */
export const bayKey = (zone: Zone, oddBay: number): string => `${zone}|${String(oddBay)}`;

/**
 * Who covers each odd bay, keyed by `bayKey`. A 40 stored at its even bay
 * appears under BOTH odd bays it lies across — the map paints it on both
 * cells, and each bay sheet shows it among its own slots.
 */
export function buildBayLoads(
  containers: readonly ContainerDto[],
): Map<string, ContainerDto[]> {
  const loads = new Map<string, ContainerDto[]>();
  for (const container of containers) {
    if (container.position === null) continue;
    for (const oddBay of baySpan(container.position.bay)) {
      const key = bayKey(container.position.zone, oddBay);
      const load = loads.get(key);
      if (load === undefined) loads.set(key, [container]);
      else load.push(container);
    }
  }
  return loads;
}

/** How full one bay reads: TEU standing over TEU the plan gives it. */
export interface BayCount {
  readonly used: number;
  readonly total: number;
  readonly full: boolean;
}

export function countBay(
  zone: ZoneDef,
  oddBay: number,
  load: readonly ContainerDto[] | undefined,
): BayCount {
  // Three tiers everywhere — the yard stacks three high as a matter of course.
  const total = (zone.stacks[String(oddBay)]?.length ?? 0) * TIERS.length;
  // A 40 puts one TEU of itself on each odd bay it covers, so per-bay TEU is
  // simply the number of containers listed under the bay.
  const used = load?.length ?? 0;
  return { used, total, full: total > 0 && used >= total };
}

/** Zone roll-up for the panel header: TEU standing against TEU capacity. */
export interface ZoneSummary {
  readonly usedTeu: number;
  readonly totalTeu: number;
}

export function summarizeZone(
  zone: ZoneDef,
  loads: ReadonlyMap<string, readonly ContainerDto[]>,
): ZoneSummary {
  let usedTeu = 0;
  let totalTeu = 0;
  for (const bay of zone.bays) {
    const count = countBay(zone, bay, loads.get(bayKey(zone.zone, bay)));
    usedTeu += count.used;
    totalTeu += count.total;
  }
  return { usedTeu, totalTeu };
}


/**
 * البوليصة تحكم الرصف — «احنا محكومين فيه الي هو البوليصة»: the merchant
 * takes his boxes out by the bill, the whole group in one batch, so the
 * yard tries to keep a bill's containers side by side. These three answer
 * the questions that flow asks the map.
 */

/**
 * Where a bill already stands: each odd bay one of its containers covers,
 * with how many of them are there — the gold count the map wears while a
 * container of this bill hunts for its slot. A spanning forty is present
 * in both bays it covers.
 */
export function billBays(
  containers: readonly ContainerDto[],
  bill: string,
  excludeId?: number,
): Map<string, number> {
  const bays = new Map<string, number>();
  if (bill === '') return bays;
  for (const container of containers) {
    if (container.bill !== bill || container.position === null || container.id === excludeId) {
      continue;
    }
    for (const oddBay of baySpan(container.position.bay)) {
      const key = bayKey(container.position.zone, oddBay);
      bays.set(key, (bays.get(key) ?? 0) + 1);
    }
  }
  return bays;
}

/**
 * How a bill's standing boxes fall across zones, biggest first — the words
 * behind «متفرقة»: a bill in more than one zone is the scatter the owner
 * asked to be told about, because its batch exit means hunting.
 */
export function billSpread(
  containers: readonly ContainerDto[],
  bill: string,
  excludeId?: number,
): Array<{ zone: Zone; count: number }> {
  const zones = new Map<Zone, number>();
  if (bill === '') return [];
  for (const container of containers) {
    if (container.bill !== bill || container.position === null || container.id === excludeId) {
      continue;
    }
    zones.set(container.position.zone, (zones.get(container.position.zone) ?? 0) + 1);
  }
  return [...zones.entries()]
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone));
}

/**
 * Is this landing BESIDE the bill's standing boxes — same zone, same bay or
 * the odd bay next door? `null` when the bill has nothing standing, so the
 * question does not arise. Used to warn, never to refuse: the crane still
 * goes where the yard needs it to.
 */
export function nearBillMates(
  containers: readonly ContainerDto[],
  bill: string,
  landing: Position,
  excludeId?: number,
): boolean | null {
  if (bill === '') return null;
  const landingBays = baySpan(landing.bay);
  let any = false;
  for (const container of containers) {
    if (container.bill !== bill || container.position === null || container.id === excludeId) {
      continue;
    }
    any = true;
    if (container.position.zone !== landing.zone) continue;
    for (const mateBay of baySpan(container.position.bay)) {
      for (const bay of landingBays) {
        if (Math.abs(bay - mateBay) <= 2) return true;
      }
    }
  }
  return any ? false : null;
}

/**
 * وضع تلوين البوالص — «تلون الخريطة بناءا على انو عدد البوليصات يعني فوق
 * ال 5 او فوق ال 10»: the band a bay wears is the size class of the BIGGEST
 * bill standing on it. 1 = a bill of more than ten, 2 = six to ten,
 * 3 = two to five, 4 = singles only. Group size is counted yard-wide (the
 * bill is one batch wherever its boxes stand), and a spanning forty puts
 * its bill on both bays it covers.
 */
export type BillBand = 1 | 2 | 3 | 4;

export interface BayBand {
  /** The size class of the biggest bill standing on the bay. */
  readonly band: BillBand;
  /**
   * How many bills stand on this bay's ground — «لو كان عدد البوليصات في
   * المكان لكانت افضل»: in the bills paint the tile SAYS this count, so a
   * stray single inside a block is a «2» instead of an invisible guest.
   */
  readonly bills: number;
}

export function billBands(containers: readonly ContainerDto[]): Map<string, BayBand> {
  const groupSize = new Map<string, number>();
  /** «أسأل الموظف عند الإدخال»: any MANIFEST answer marks the whole bill. */
  const manifest = new Set<string>();
  for (const container of containers) {
    if (container.position === null || container.bill === '') continue;
    groupSize.set(container.bill, (groupSize.get(container.bill) ?? 0) + 1);
    if (container.billKind === 'MANIFEST') manifest.add(container.bill);
  }
  // The declaration settles the one ambiguous case: a bill with a single
  // standing box that the gate was TOLD has a manifest behind it is a small
  // group arriving, not a single.
  const bandOf = (bill: string): BillBand => {
    const size = groupSize.get(bill) ?? 1;
    if (size > 10) return 1;
    if (size > 5) return 2;
    if (size > 1) return 3;
    return manifest.has(bill) ? 3 : 4;
  };

  const bands = new Map<string, { band: BillBand; bills: Set<string> }>();
  for (const container of containers) {
    if (container.position === null) continue;
    const band = container.bill === '' ? 4 : bandOf(container.bill);
    for (const oddBay of baySpan(container.position.bay)) {
      const key = bayKey(container.position.zone, oddBay);
      const held = bands.get(key);
      if (held === undefined) {
        bands.set(key, { band, bills: new Set([container.bill]) });
      } else {
        held.bills.add(container.bill);
        if (band < held.band) bands.set(key, { band, bills: held.bills });
      }
    }
  }
  return new Map(
    [...bands.entries()].map(([key, value]) => [
      key,
      { band: value.band, bills: value.bills.size },
    ]),
  );
}

/**
 * مقترحات المكان — «تقدمله اقتراحات على المكان»: among the LEGAL landings of
 * one bay sheet, the ones the yard's own practice prefers, worn darker:
 *
 *  - a SINGLE goes where singles already are («الحاويات الفردية ضمن مكان
 *    موجود فيه فردي») — its bay holds another lone bill;
 *  - a container with standing bill-mates goes beside them (the same rule
 *    the gold already points at);
 *  - the THIRD tier is advised only for a light box — under 20 tonnes as
 *    the clerks type it, in kilograms — and only on «الوجه», the outermost
 *    رصة the machines reach (the bay's last stack), and only on its own
 *    bill's column: «خذ بعين الاعتبار البوليصة».
 *
 * Advice, never a bar: everything legal stays green; these glow darker.
 */
export function suggestedCells(
  layout: YardLayout,
  zone: ZoneDef,
  oddBay: number,
  containers: readonly ContainerDto[],
  mover: ContainerDto,
): Set<string> {
  const suggested = new Set<string>();
  const landings = bayLandings(layout, zone, oddBay, containers, mover.size, mover.id);
  if (landings.length === 0) return suggested;

  const standing = containers.filter(
    (container) => container.position !== null && container.id !== mover.id,
  );
  const mates = standing.filter((container) => container.bill === mover.bill);
  const groupCount = new Map<string, number>();
  for (const container of standing) {
    if (container.bill === '') continue;
    groupCount.set(container.bill, (groupCount.get(container.bill) ?? 0) + 1);
  }
  const isSingleBill = (container: ContainerDto): boolean =>
    container.billKind === 'SINGLE' ||
    (container.billKind !== 'MANIFEST' && (groupCount.get(container.bill) ?? 1) === 1);
  const moverSingle =
    mover.billKind === 'SINGLE' || (mover.billKind !== 'MANIFEST' && mates.length === 0);

  // «ضمن مكان موجود فيه فردي»: does THIS bay's ground hold another single?
  const bayHoldsSingle = standing.some(
    (container) =>
      container.position !== null &&
      container.position.zone === zone.zone &&
      baySpan(container.position.bay).includes(oddBay) &&
      container.bill !== mover.bill &&
      isSingleBill(container),
  );

  // «تحت الـ20»: kilograms as the gate types them; unreadable means heavy.
  const kilos = Number.parseInt(mover.weight, 10);
  const light = Number.isFinite(kilos) && kilos > 0 && kilos < 20_000;
  // «الوجه» — رصة 10: the bay's outermost stack, the one the machines reach.
  const face = Math.max(...(zone.stacks[String(oddBay)] ?? [0]));
  const occupancy = buildOccupancy(toStanding(standing));

  for (const landing of landings) {
    const cell = `${String(landing.stack)}|${landing.tier}`;
    if (landing.tier === 'C') {
      // The third tier: light, on the face, on its own bill's column.
      if (!light || landing.stack !== face) continue;
      const ownColumn = baySpan(landing.bay).every((covered) => {
        const below = occupancy.get(
          `${zone.zone}|${String(covered)}|${String(landing.stack)}|B`,
        );
        if (below === undefined) return false;
        const carrier = containers.find((container) => container.id === below.id);
        return carrier !== undefined && carrier.bill === mover.bill;
      });
      if (ownColumn) suggested.add(cell);
      continue;
    }
    if (moverSingle) {
      if (bayHoldsSingle) suggested.add(cell);
    } else if (mates.length > 0 && nearBillMates(containers, mover.bill, landing, mover.id) === true) {
      suggested.add(cell);
    }
  }
  return suggested;
}

/** The tallest stack this zone reaches anywhere — the bay sheet's grid width. */
export function maxStackOf(zone: ZoneDef): number {
  let max = 0;
  for (const bay of zone.bays) {
    for (const stack of zone.stacks[String(bay)] ?? []) max = Math.max(max, stack);
  }
  return max;
}

/**
 * What one slot of a bay sheet shows: the wall, an empty cell, or whoever
 * stands there (possibly a 40 reaching over from the even bay).
 */
export type SlotView =
  | { readonly kind: 'wall' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'taken'; readonly container: ContainerDto };

export function slotView(
  zone: ZoneDef,
  oddBay: number,
  stack: number,
  tier: Tier,
  load: readonly ContainerDto[] | undefined,
): SlotView {
  const usable = zone.stacks[String(oddBay)]?.includes(stack) ?? false;
  if (!usable) return { kind: 'wall' };
  const taken = load?.find(
    (container) =>
      container.position !== null &&
      container.position.stack === stack &&
      container.position.tier === tier &&
      baySpan(container.position.bay).includes(oddBay),
  );
  return taken === undefined ? { kind: 'empty' } : { kind: 'taken', container: taken };
}

/**
 * The landings a container of this size has inside ONE bay's sheet, computed
 * with the same shared rules the server runs — the paint cannot lie. For a
 * 40, the landing pairs this odd bay with a neighbour and is addressed by the
 * even bay between them.
 */
export function bayLandings(
  layout: YardLayout,
  zone: ZoneDef,
  oddBay: number,
  containers: readonly ContainerDto[],
  size: Size,
  ignoreId?: number,
): Position[] {
  const standing =
    ignoreId === undefined
      ? toStanding(containers)
      : toStanding(containers).filter((s) => s.id !== ignoreId);
  const occupancy = buildOccupancy(standing);
  const bays =
    size === 20
      ? [oddBay]
      : [oddBay - 1, oddBay + 1].filter((even) => even >= 2);
  const landings: Position[] = [];
  for (const bay of bays) {
    for (const stack of zone.stacks[String(oddBay)] ?? []) {
      for (const tier of TIERS) {
        const position: Position = { zone: zone.zone, bay, stack, tier };
        if (canPlace(layout, standing, size, position, ignoreId, occupancy) === null) {
          landings.push(position);
        }
      }
    }
  }
  return landings;
}

/**
 * The bays worth lighting up while a container is being placed: any bay whose
 * sheet contains at least one legal landing for it.
 */
export function targetBays(
  layout: YardLayout,
  containers: readonly ContainerDto[],
  size: Size,
  ignoreId?: number,
): Set<string> {
  const standing =
    ignoreId === undefined
      ? toStanding(containers)
      : toStanding(containers).filter((s) => s.id !== ignoreId);
  const occupancy = buildOccupancy(standing);
  const targets = new Set<string>();
  for (const zone of layout.zones) {
    const lastBay = zone.bays[zone.bays.length - 1] ?? 0;
    for (const bay of zone.bays) {
      const stacks = zone.stacks[String(bay)] ?? [];
      let reachable = false;
      for (const stack of stacks) {
        for (const tier of TIERS) {
          if (size === 20) {
            if (canPlace(layout, standing, 20, { zone: zone.zone, bay, stack, tier }, ignoreId, occupancy) === null) {
              reachable = true;
            }
          } else {
            for (const even of [bay - 1, bay + 1]) {
              if (even < 2 || even > lastBay) continue;
              if (canPlace(layout, standing, 40, { zone: zone.zone, bay: even, stack, tier }, ignoreId, occupancy) === null) {
                reachable = true;
              }
            }
          }
          if (reachable) break;
        }
        if (reachable) break;
      }
      if (reachable) targets.add(bayKey(zone.zone, bay));
    }
  }
  return targets;
}

/** Container ids whose number, bill of lading or seal matches the query. */
export function searchMatches(
  containers: readonly ContainerDto[],
  query: string,
): Set<number> {
  const matches = new Set<number>();
  const trimmed = query.trim();
  if (trimmed === '') return matches;

  const asNumber = normalizeNumber(trimmed);
  const lower = trimmed.toLowerCase();

  for (const container of containers) {
    if (
      (asNumber.length > 0 && container.number.includes(asNumber)) ||
      // Typing a bill number lights the WHOLE group on the map at once.
      (container.bill !== '' && container.bill.toLowerCase().includes(lower)) ||
      // The seal too — «اريد ايضا القدرة على البحث على الرصاصة».
      (container.sealIn !== '' && container.sealIn.toLowerCase().includes(lower))
    ) {
      matches.add(container.id);
    }
  }
  return matches;
}

/**
 * A location the search box was asked about: «2-E-18-01-A» — where is that,
 * and what is standing on it. The address is resolved against the official
 * plan, so a bay the drawing does not have answers nothing rather than
 * opening an empty sheet for ground that is not there.
 *
 * An even bay is a 40's address, and it stands across the two odd bays
 * either side; the sheet that shows it is the odd one, which is what `bay`
 * comes back as.
 */
export interface AddressHit {
  /** The odd bay whose sheet holds this address. */
  readonly zone: Zone;
  readonly bay: number;
  /** The exact slot, when the query named one down to the tier. */
  readonly position: Position | null;
  /** Whoever is standing there — or on the bay, when only a bay was named. */
  readonly containers: readonly ContainerDto[];
}

export function addressMatch(
  layout: YardLayout,
  containers: readonly ContainerDto[],
  query: string,
): AddressHit | null {
  const asked = parseAddress(query);
  if (asked === null) return null;

  const zone = layout.zones.find((candidate) => candidate.zone === asked.zone);
  if (zone === undefined) return null;
  // A typed yard digit has to agree with the ground it names: the layout is
  // the only thing that knows which yard a zone sits in.
  if (asked.yard !== undefined && asked.yard !== zone.yard) return null;
  // The sheet is always an odd bay's; an even bay is read through its left
  // neighbour, which is the one the plan draws.
  const sheetBay = asked.bay % 2 === 1 ? asked.bay : asked.bay - 1;
  if (!zone.bays.includes(sheetBay)) return null;
  if (asked.stack !== undefined && !(zone.stacks[String(sheetBay)] ?? []).includes(asked.stack)) {
    return null;
  }

  const exact: Position | null =
    asked.stack !== undefined && asked.tier !== undefined
      ? { zone: asked.zone, bay: asked.bay, stack: asked.stack, tier: asked.tier }
      : null;

  const standing = containers.filter((container) => {
    const at = container.position;
    if (at === null || at.zone !== asked.zone) return false;
    if (!baySpan(at.bay).includes(sheetBay)) return false;
    if (asked.stack !== undefined && at.stack !== asked.stack) return false;
    if (asked.tier !== undefined && at.tier !== asked.tier) return false;
    return true;
  });

  return { zone: asked.zone, bay: sheetBay, position: exact, containers: standing };
}

/**
 * The bills of lading the query touches, with how many containers each
 * gathers among the results at hand — the search's «بوليصة 3210 — 12 حاوية»
 * rows, each a doorway to the bill's own sheet.
 */
export function billMatches(
  containers: readonly ContainerDto[],
  query: string,
): Array<{ bill: string; count: number }> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return [];
  const counts = new Map<string, number>();
  for (const container of containers) {
    if (container.bill === '' || !container.bill.toLowerCase().includes(trimmed)) continue;
    counts.set(container.bill, (counts.get(container.bill) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([bill, count]) => ({ bill, count }))
    .sort((a, b) => a.bill.localeCompare(b.bill))
    .slice(0, 5);
}
