import type { ContainerDto, Landmark, Position, Size, Tier, YardLayout, Zone, ZoneDef } from '../shared/types';
import { TIERS } from '../shared/types';
import { baySpan, parseAddress } from '../shared/address';
import { buildOccupancy, canPlace, fortyRoom, type Standing } from '../shared/rules';
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

/**
 * One cell of a zone's strip — a lone odd bay, or the PAIR a forty block has
 * welded longer: «اذا ما كان فيها شي تبين بلوك عادي مثل كأنه عشرين، بس في
 * حال وضعت فيها حاوية اربعين قدم تدمج المربعين بحيث يصير اطول». The owner's
 * own final wording, asked for by name after living with both drawings —
 * the SPEC's «لا يُعاد الدمج إلا بطلب صريح منه» clause, satisfied.
 */
export interface ZoneCell {
  /** The odd bays this cell covers, in plan order — one, or a claimed pair. */
  readonly bays: readonly number[];
  /** Containers belonging to this cell, each counted ONCE zone-wide. */
  readonly boxes: number;
  /**
   * How many containers the cell holds when completed as what it is: a lone
   * bay fills with twenties on the ground left to it, a pair with forties
   * (`boxes` plus the forty landings still open in it). A full forty pair
   * reads «27/27» — the same figure its twin tiles used to repeat, once.
   */
  readonly capacity: number;
  /** Every slot of the cell is taken — slot arithmetic, for the paint. */
  readonly full: boolean;
  /** Nothing covers any of the cell's ground — not even an overhang. */
  readonly empty: boolean;
}

export function zoneCells(
  zone: ZoneDef,
  loads: ReadonlyMap<string, readonly ContainerDto[]>,
): ZoneCell[] {
  // How many forties are addressed at each even bay of this zone.
  const fortyAt = new Map<number, number>();
  for (const bay of zone.bays) {
    for (const container of loads.get(bayKey(zone.zone, bay)) ?? []) {
      if (container.size === 40 && container.position !== null) {
        fortyAt.set(container.position.bay, (fortyAt.get(container.position.bay) ?? 0) + 1);
      }
    }
  }

  /**
   * A cell is AT MOST a pair — «مثلا 19-21، 23-25»: the pairs anchor on the
   * BLOCKS, each loaded even bay claiming its two odd neighbours, heaviest
   * block first, and whatever no block claims stands alone. A stray forty
   * bridging two claimed pairs counts in the cell holding the lower bay it
   * covers — off by one bay at the seam, never counted twice, and the sheet
   * a tap opens tells the exact truth.
   */
  const claimed = new Map<number, number[]>();
  const evens = [...fortyAt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  for (const [even] of evens) {
    const pair = [even - 1, even + 1];
    if (pair.every((bay) => zone.bays.includes(bay) && !claimed.has(bay))) {
      for (const bay of pair) claimed.set(bay, pair);
    }
  }

  const cells: number[][] = [];
  for (const bay of zone.bays) {
    const pair = claimed.get(bay);
    if (pair === undefined) cells.push([bay]);
    else if (pair[0] === bay) cells.push(pair);
  }

  /** The one cell each container belongs to: a forty, the lower bay it covers. */
  const cellOf = new Map<number, number[]>();
  for (const cell of cells) for (const bay of cell) cellOf.set(bay, cell);
  const home = (container: ContainerDto): number[] | undefined => {
    if (container.position === null) return undefined;
    const ground = baySpan(container.position.bay);
    return cellOf.get(ground[0] ?? container.position.bay) ?? cellOf.get(ground[1] ?? -1);
  };

  return cells.map((bays): ZoneCell => {
    const touchers = new Map<number, ContainerDto>();
    const boxes = new Set<number>();
    let usedTeu = 0;
    let totalTeu = 0;
    for (const bay of bays) {
      const load = loads.get(bayKey(zone.zone, bay));
      const count = countBay(zone, bay, load);
      usedTeu += count.used;
      totalTeu += count.total;
      for (const container of load ?? []) {
        touchers.set(container.id, container);
        if (home(container) === bays) boxes.add(container.id);
      }
    }
    // Completed as what it is: a pair fills with forties (the standing boxes
    // plus the landings still open, neighbours' overhang blocking its lanes),
    // a lone bay with twenties on whatever ground is left to it.
    const capacity =
      bays.length === 1
        ? boxes.size + (totalTeu - usedTeu)
        : boxes.size +
          fortyRoom(zone, bays, buildOccupancy(toStanding([...touchers.values()])), TIERS);
    return {
      bays,
      boxes: boxes.size,
      capacity,
      full: totalTeu > 0 && usedTeu >= totalTeu,
      empty: usedTeu === 0,
    };
  });
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

// ── the drawing's own geometry ──────────────────────────────────────────────

/**
 * The map's metrics, in yard units. The panel's inner metrics (padding,
 * title) must match the decoder's zone rects — tools/decode-aseza.mjs and
 * src/shared/layout.ts draw every strip 150 tall with a 14-unit padding.
 */
export const MAP = {
  /** Breathing room around the whole drawing. */
  outerPad: 26,
  /** The zone panel's padding, all four sides. */
  pad: 14,
  titleH: 44,
  /** The ordinary tile — the fill and bills paints, exactly as always. */
  cellH: 66,
  /** The gap between neighbouring tiles of a strip. */
  cellGap: 4,
  /**
   * عرض المحتويات. The contents paint's tile is taller, and as wide as its
   * OWN stacks ask: every stack of the yard is given the same lane, so a
   * twenty is one square of one width wherever it stands — a ten-stack bay
   * is simply twice as wide as a five-stack one — and a forty is exactly
   * two of them. The panel then hugs its tiles: no floor left under them.
   */
  detailCellH: 114,
  lane: 19,
  laneGap: 2,
  /** Between the tile's frame and its first and last lane. */
  laneInset: 4,
} as const;

/** The contents paint's panel: title, the taller tile, and the padding. */
export const DETAIL_ZONE_H = MAP.titleH + MAP.detailCellH + MAP.pad;

/**
 * How wide each bay's column is drawn, in plan order. The ordinary paints
 * share the panel's width evenly — the plan's own pitch, untouched. The
 * contents paint gives a bay its stacks' lanes and nothing more, so no lane
 * is ever squeezed and no tile carries blank ground beside its lanes.
 */
export function bayWidths(zone: ZoneDef, detail: boolean): number[] {
  if (!detail) {
    const cellW = (zone.w - MAP.pad * 2) / zone.bays.length;
    return zone.bays.map(() => cellW);
  }
  return zone.bays.map((bay) => {
    const stacks = Math.max(1, zone.stacks[String(bay)]?.length ?? 0);
    return stacks * MAP.lane - MAP.laneGap + MAP.laneInset * 2 + MAP.cellGap;
  });
}

/**
 * Where a tile's lanes stand. `pitch` is one lane's stride — one column per
 * bay of the tile, so a lone bay's lane is one twenty wide and a welded
 * pair's holds a forty over its two halves — and `start` the first lane's
 * inset from the frame's edge. The lane is the SAME width on every tile of
 * the map; a pair with room to spare centres its grid, and only a pair whose
 * bays disagree about their stacks (a custom zone's doing) squeezes its
 * lanes to stay inside the frame.
 */
export function laneGrid(
  frameW: number,
  lanes: number,
  parts: number,
): { readonly pitch: number; readonly start: number } {
  const inner = frameW - MAP.laneInset * 2;
  const pitch = Math.min(MAP.lane * parts, (inner + MAP.laneGap) / Math.max(1, lanes));
  const gridW = lanes * pitch - MAP.laneGap;
  return { pitch, start: MAP.laneInset + (inner - gridW) / 2 };
}

export interface MapLayout {
  readonly width: number;
  readonly height: number;
  readonly zones: readonly ZoneDef[];
  readonly landmarks: readonly Landmark[];
}

/** The canvas around a set of rects: their extent plus breathing room. */
function extentOf(zones: readonly ZoneDef[], landmarks: readonly Landmark[]): MapLayout {
  let maxX = 0;
  let maxY = 0;
  for (const rect of [...zones, ...landmarks]) {
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { width: maxX + MAP.outerPad * 2, height: maxY + MAP.outerPad * 2, zones, landmarks };
}

/** Canvas geometry: the decoded layout as the plan draws it. */
export function computeLayout(layout: YardLayout): MapLayout {
  return extentOf(layout.zones, layout.landmarks);
}

/**
 * The same plan redrawn for the contents paint — «حتى لو عنى ذلك تكبير
 * الزون فقط في شكل خريطة المحتويات»: every zone is as wide as its stacks'
 * lanes and exactly as tall as its taller tile needs, and the positions of
 * everything — zones and landmarks alike — stretch by the largest growth any
 * zone undergoes, so nothing can overlap what the plan set beside it. The
 * fill and bills maps never pass through here.
 */
export function detailLayout(layout: YardLayout): MapLayout {
  const grown = layout.zones.map((zone) => ({
    zone,
    w: MAP.pad * 2 + bayWidths(zone, true).reduce((sum, w) => sum + w, 0),
  }));
  const sx = Math.max(1, ...grown.map(({ zone, w }) => (zone.w > 0 ? w / zone.w : 1)));
  const sy = Math.max(1, ...layout.zones.map((zone) => (zone.h > 0 ? DETAIL_ZONE_H / zone.h : 1)));
  const zones = grown.map(({ zone, w }) => ({
    ...zone,
    x: zone.x * sx,
    y: zone.y * sy,
    w,
    h: DETAIL_ZONE_H,
  }));
  const landmarks = layout.landmarks.map((mark) => ({
    ...mark,
    x: mark.x * sx,
    y: mark.y * sy,
    w: mark.w * sx,
    h: mark.h * sy,
  }));
  return extentOf(zones, landmarks);
}
