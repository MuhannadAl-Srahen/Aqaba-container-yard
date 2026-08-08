import type { ContainerStatus, Position, Size, YardConfig } from '../shared/types';
import { GROUND_TIER } from '../shared/types';
import { checkNumber } from '../shared/iso6346';

/**
 * The demo yard, planned purely: given the live yard's shape, a seed and a
 * clock, produce the containers, movements, statuses and card serials the
 * dev seeder writes. No DB, no randomness source of its own — the same seed
 * over the same yard always plans the same demo, which is what the tests
 * pin. The seeder wipes first, so the plan assumes an empty yard.
 */

export interface SeedMovement {
  readonly type: 'IN' | 'MOVE' | 'OUT';
  readonly at: string;
  readonly from: Position | null;
  readonly to: Position | null;
}

export interface SeedContainer {
  readonly number: string;
  readonly numberValid: boolean;
  readonly size: Size;
  readonly customer: string;
  readonly cargo: 'EMPTY' | 'LADEN';
  readonly notes: string;
  readonly status: ContainerStatus;
  readonly enteredAt: string;
  readonly exitedAt: string | null;
  /** Final standing position; null once exited. */
  readonly position: Position | null;
  readonly weight: string;
  readonly truckIn: string;
  readonly driverIn: string;
  readonly cardIn: number;
  readonly truckOut: string;
  readonly driverOut: string;
  readonly cardOut: number | null;
  readonly movements: readonly SeedMovement[];
}

export interface SeedPlan {
  readonly containers: readonly SeedContainer[];
  readonly cardInNext: number;
  readonly cardOutNext: number;
}

/** Small deterministic PRNG — good enough to lay out a demo, and testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OWNER_PREFIXES = ['MSCU', 'CSQU', 'TGHU', 'MAEU', 'CMAU', 'HLXU', 'ONEU', 'EGHU'];

const CUSTOMERS = [
  'شركة النورس للشحن والتفريغ',
  'مؤسسة أبو خالد للنقليات',
  'شركة العقبة الحديثة للتخليص',
  'مكتب الميناء للاستيراد',
  'شركة البحر الأحمر التجارية',
  'مؤسسة الصحراء للنقل',
  'شركة الأردن الدولية للشحن',
  'مكتب أبو محمود للتخليص',
  'شركة الساحل للتجارة العامة',
  'مؤسسة النخيل للاستيراد والتصدير',
  'شركة القافلة للنقل البري',
  'مكتب العاصمة للشحن السريع',
];

const DRIVERS = [
  'أبو أحمد',
  'محمد العمري',
  'خالد السعدي',
  'أبو يوسف',
  'عمر الزعبي',
  'سامر النجار',
  'أبو معاذ',
  'حسين الرواشدة',
];

const NOTES = ['', '', '', '', 'باب الحاوية مخدوش', 'بدها تفتيش جمارك', '', 'وصلت متأخرة عن الموعد', ''];

interface Slot {
  readonly block: number;
  readonly row: number;
  readonly col: number;
}

export function buildSeedPlan(seed: number, now: Date, yard: YardConfig): SeedPlan {
  const rng = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T => {
    const item = list[Math.floor(rng() * list.length)];
    if (item === undefined) throw new Error('seed: pick from empty list');
    return item;
  };

  // Every ground slot in the yard, shuffled once.
  const slots: Slot[] = [];
  for (const block of yard.blocks) {
    for (let row = 1; row <= block.rows; row += 1) {
      for (let col = 1; col <= block.cols; col += 1) {
        slots.push({ block: block.id, row, col });
      }
    }
  }
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = slots[i];
    const b = slots[j];
    if (a !== undefined && b !== undefined) {
      slots[i] = b;
      slots[j] = a;
    }
  }

  const sizeFor = (blockId: number): Size => {
    const block = yard.blocks.find((candidate) => candidate.id === blockId);
    if (block === undefined) throw new Error('seed: slot without a block');
    if (block.size === 20 || block.size === 40) return block.size;
    return rng() < 0.6 ? 20 : 40;
  };

  const usedNumbers = new Set<string>();
  const makeNumber = (): { number: string; valid: boolean } => {
    for (;;) {
      const roll = rng();
      let candidate: string;
      let valid = true;
      if (roll < 0.6) {
        // Full ISO with a correct check digit.
        let digits = '';
        for (let i = 0; i < 6; i += 1) digits += String(Math.floor(rng() * 10));
        const stem = `${pick(OWNER_PREFIXES)}${digits}`;
        const probe = checkNumber(`${stem}0`);
        candidate = `${stem}${String(probe.expectedDigit ?? 0)}`;
      } else if (roll < 0.9) {
        // The yard's own 4+4 working form.
        let digits = '';
        for (let i = 0; i < 4; i += 1) digits += String(Math.floor(rng() * 10));
        candidate = `${pick(OWNER_PREFIXES)}${digits}`;
      } else {
        // A mistyped ISO number — the paperwork is sometimes wrong.
        let digits = '';
        for (let i = 0; i < 6; i += 1) digits += String(Math.floor(rng() * 10));
        const stem = `${pick(OWNER_PREFIXES)}${digits}`;
        const probe = checkNumber(`${stem}0`);
        const wrong = ((probe.expectedDigit ?? 0) + 1 + Math.floor(rng() * 8)) % 10;
        candidate = `${stem}${String(wrong)}`;
        valid = false;
      }
      if (!usedNumbers.has(candidate)) {
        usedNumbers.add(candidate);
        return { number: candidate, valid };
      }
    }
  };

  // Business-hours instants spread over the last month, newest ~2h back.
  const DAY_MS = 86_400_000;
  const instantBack = (maxDaysBack: number): Date => {
    const daysBack = Math.floor(rng() * maxDaysBack);
    const base = new Date(now.getTime() - daysBack * DAY_MS);
    base.setUTCHours(4 + Math.floor(rng() * 10), Math.floor(rng() * 60), 0, 0); // 07–17 Amman
    return base.getTime() > now.getTime() - 2 * 3600_000
      ? new Date(now.getTime() - 2 * 3600_000)
      : base;
  };

  const totalGround = slots.length;
  const standingCount = Math.min(45, Math.floor(totalGround * 0.4));
  const exitedCount = Math.min(15, Math.max(3, Math.floor(standingCount / 3)));
  const stackCount = Math.min(10, Math.floor(standingCount / 4));

  interface Draft {
    number: string;
    numberValid: boolean;
    size: Size;
    customer: string;
    cargo: 'EMPTY' | 'LADEN';
    notes: string;
    status: ContainerStatus;
    enteredAt: Date;
    exitedAt: Date | null;
    position: Position | null;
    weight: string;
    truckIn: string;
    driverIn: string;
    truckOut: string;
    driverOut: string;
    movements: SeedMovement[];
  }
  const drafts: Draft[] = [];
  const plate = (): string => String(10000 + Math.floor(rng() * 89999));

  // Standing containers on the ground.
  const groundStanding: Draft[] = [];
  for (let i = 0; i < standingCount; i += 1) {
    const slot = slots[i];
    if (slot === undefined) break;
    const size = sizeFor(slot.block);
    const numberInfo = makeNumber();
    const enteredAt = instantBack(30);
    const finalPosition: Position = { ...slot, tier: GROUND_TIER };
    const draft: Draft = {
      number: numberInfo.number,
      numberValid: numberInfo.valid,
      size,
      customer: pick(CUSTOMERS),
      cargo: rng() < 0.65 ? 'LADEN' : 'EMPTY',
      notes: pick(NOTES),
      status: 'NORMAL',
      enteredAt,
      exitedAt: null,
      position: finalPosition,
      weight: rng() < 0.6 ? String(18 + Math.floor(rng() * 14)) : '',
      truckIn: plate(),
      driverIn: pick(DRIVERS),
      truckOut: '',
      driverOut: '',
      movements: [],
    };
    // A third of them walked here from another slot in the same block.
    const homeBlock = yard.blocks.find((candidate) => candidate.id === slot.block);
    const origin: Position = {
      block: slot.block,
      row: 1 + Math.floor(rng() * (homeBlock?.rows ?? 1)),
      col: 1,
      tier: GROUND_TIER,
    };
    const cameFromElsewhere =
      rng() < 0.3 && (origin.row !== finalPosition.row || origin.col !== finalPosition.col);
    if (cameFromElsewhere) {
      const movedAt = new Date(
        enteredAt.getTime() + (now.getTime() - enteredAt.getTime()) * (0.3 + rng() * 0.5),
      );
      draft.movements.push(
        { type: 'IN', at: enteredAt.toISOString(), from: null, to: origin },
        { type: 'MOVE', at: movedAt.toISOString(), from: origin, to: finalPosition },
      );
    } else {
      draft.movements.push({
        type: 'IN',
        at: enteredAt.toISOString(),
        from: null,
        to: finalPosition,
      });
    }
    drafts.push(draft);
    groundStanding.push(draft);
  }

  // A few second tiers — never a 40 on a 20.
  let stacked = 0;
  for (const under of groundStanding) {
    if (stacked >= stackCount) break;
    if (under.position === null) continue;
    const upperSize: Size = under.size === 20 ? 20 : rng() < 0.5 ? 20 : 40;
    const numberInfo = makeNumber();
    const enteredAt = new Date(
      under.enteredAt.getTime() + (now.getTime() - under.enteredAt.getTime()) * (0.2 + rng() * 0.6),
    );
    const position: Position = { ...under.position, tier: 2 };
    drafts.push({
      number: numberInfo.number,
      numberValid: numberInfo.valid,
      size: upperSize,
      customer: pick(CUSTOMERS),
      cargo: rng() < 0.5 ? 'LADEN' : 'EMPTY',
      notes: pick(NOTES),
      status: 'NORMAL',
      enteredAt,
      exitedAt: null,
      position,
      weight: rng() < 0.6 ? String(18 + Math.floor(rng() * 14)) : '',
      truckIn: plate(),
      driverIn: pick(DRIVERS),
      truckOut: '',
      driverOut: '',
      movements: [{ type: 'IN', at: enteredAt.toISOString(), from: null, to: position }],
    });
    stacked += 1;
  }

  // Departed visits: came, stood somewhere, left with their own paperwork.
  for (let i = 0; i < exitedCount; i += 1) {
    const slot = slots[(standingCount + i) % slots.length];
    if (slot === undefined) break;
    const size = sizeFor(slot.block);
    const numberInfo = makeNumber();
    const enteredAt = instantBack(30);
    const dwellMs = (1 + Math.floor(rng() * 15)) * DAY_MS;
    const exitCap = now.getTime() - 3600_000;
    const exitedAt = new Date(Math.min(enteredAt.getTime() + dwellMs, exitCap));
    const stood: Position = { ...slot, tier: GROUND_TIER };
    drafts.push({
      number: numberInfo.number,
      numberValid: numberInfo.valid,
      size,
      customer: pick(CUSTOMERS),
      cargo: rng() < 0.65 ? 'LADEN' : 'EMPTY',
      notes: pick(NOTES),
      status: 'NORMAL',
      enteredAt,
      exitedAt,
      position: null,
      weight: rng() < 0.6 ? String(18 + Math.floor(rng() * 14)) : '',
      truckIn: plate(),
      driverIn: pick(DRIVERS),
      truckOut: plate(),
      driverOut: pick(DRIVERS),
      movements: [
        { type: 'IN', at: enteredAt.toISOString(), from: null, to: stood },
        { type: 'OUT', at: exitedAt.toISOString(), from: stood, to: null },
      ],
    });
  }

  // Sprinkle conditions over the standing boxes only.
  const flags: ContainerStatus[] = ['DAMAGED', 'DAMAGED', 'HOLD', 'REPAIR', 'INSPECT', 'INSPECT'];
  const standingDrafts = drafts.filter((draft) => draft.position !== null);
  for (const [index, status] of flags.entries()) {
    const target = standingDrafts[(index * 7) % Math.max(1, standingDrafts.length)];
    if (target !== undefined && target.status === 'NORMAL') target.status = status;
  }

  // Card serials in gate order, one counter per direction — like the paper.
  const inOrder = [...drafts].sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime());
  const cardIn = new Map<Draft, number>();
  inOrder.forEach((draft, index) => cardIn.set(draft, index + 1));
  const outOrder = drafts
    .filter((draft) => draft.exitedAt !== null)
    .sort((a, b) => (a.exitedAt?.getTime() ?? 0) - (b.exitedAt?.getTime() ?? 0));
  const cardOut = new Map<Draft, number>();
  outOrder.forEach((draft, index) => cardOut.set(draft, index + 1));

  return {
    containers: drafts.map((draft) => ({
      number: draft.number,
      numberValid: draft.numberValid,
      size: draft.size,
      customer: draft.customer,
      cargo: draft.cargo,
      notes: draft.notes,
      status: draft.status,
      enteredAt: draft.enteredAt.toISOString(),
      exitedAt: draft.exitedAt?.toISOString() ?? null,
      position: draft.position,
      weight: draft.weight,
      truckIn: draft.truckIn,
      driverIn: draft.driverIn,
      cardIn: cardIn.get(draft) ?? 0,
      truckOut: draft.truckOut,
      driverOut: draft.driverOut,
      cardOut: cardOut.get(draft) ?? null,
      movements: draft.movements,
    })),
    cardInNext: inOrder.length + 1,
    cardOutNext: outOrder.length + 1,
  };
}
