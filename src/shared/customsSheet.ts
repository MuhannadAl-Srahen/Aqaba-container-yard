/**
 * دفعات كشف الجمارك — reading the directorate's transfer sheet LITERALLY.
 *
 * The owner's charge: «اذا كان في لو حرف او رقم غلط تم نقله رح يعملنا مشكلة
 * جدا جدا كبيرة». So this module never guesses. It takes grids of cell text
 * already decoded from a deterministic file format (the server refuses scans
 * outright), finds the container-number columns BY THEIR CONTENT — header
 * spellings vary, ISO 6346 shapes do not — and copies what the sheet says.
 * A doubtful value is kept as written and flagged, in the same spirit as the
 * gate: record the paper, warn the reader, refuse nothing that is true.
 *
 * The real sheets this was built against («دفعة 11», «150 حاوية دفعة 8»):
 * one worksheet holding one or several side-by-side column groups of
 * `# | Unit Nbr | Type | BL Nbr [| Line Op]`, separated by fully-empty
 * columns, sometimes with a pre-numbered tail of «#» cells whose number
 * column has already run out — those are not rows, and are skipped.
 */

import type { Size } from './types';
import { checkNumber, normalizeNumber, NUMBER_FORM } from './iso6346';

/** One line of the sheet, exactly as the paper meant it. */
export interface SheetRow {
  /** The sheet's own «#» counter; null when the sheet carries none. */
  readonly seq: number | null;
  /** Normalized as the gate normalizes — the join key against the yard book. */
  readonly number: string;
  /** 20/40 — null when the sheet wrote something else or nothing. */
  readonly size: Size | null;
  /** The size cell exactly as written («45» stays «45»; '' = no size column). */
  readonly sizeRaw: string;
  readonly bill: string;
  readonly lineOp: string;
}

/**
 * Advisory codes, never refusals: a sheet row that carries a doubt is still
 * the sheet's word and is imported as written. Arabic sentences live in ar.ts.
 */
export const SHEET_WARNINGS = [
  'NUMBER_MALFORMED',
  'NUMBER_CHECK',
  'SIZE_UNKNOWN',
  'BILL_MISSING',
  'DUPLICATE_NUMBER',
  'SEQ_GAP',
] as const;
export type SheetWarning = (typeof SHEET_WARNINGS)[number];

/**
 * What the warning and totals arithmetic actually needs — BatchRowDto
 * satisfies this structurally, so the review screen, the stored registry and
 * the tests all recompute from one source and can never drift apart.
 */
export type WarnableRow = Pick<SheetRow, 'seq' | 'number' | 'size' | 'sizeRaw' | 'bill'>;

export interface SheetTotals {
  readonly rows: number;
  readonly of20: number;
  readonly of40: number;
  /** Rows whose size is not 20/40 — a «45», or no size column at all. */
  readonly other: number;
  /** Distinct non-empty bills — the eyeball check against the paper. */
  readonly bills: number;
}

// ── the cell fold: presentation stripped, content untouched ────────────────
// Trims, folds Arabic-Indic digits to Western (the register convention,
// store.ts does the same for search), and strips the invisible direction
// marks Excel and Word sprinkle into mixed-direction cells. Nothing else:
// a bill's inner spacing is the sheet's own word and is kept.
const fold = (cell: string): string =>
  cell
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u00a0/g, ' ')
    .trim();

const isInt = (text: string): boolean => /^\d+$/.test(text);
/** A size-like cell: the short figures a Type column carries (20, 40, 45…). */
const isShortInt = (text: string): boolean => /^\d{1,3}$/.test(text);

/** Count of non-empty cells in a column over the given rows, plus matches. */
function columnStats(
  grid: readonly (readonly string[])[],
  rows: readonly number[],
  col: number,
  matches: (cell: string) => boolean,
): { nonEmpty: number; hits: number } {
  let nonEmpty = 0;
  let hits = 0;
  for (const r of rows) {
    const cell = grid[r]?.[col] ?? '';
    if (cell === '') continue;
    nonEmpty += 1;
    if (matches(cell)) hits += 1;
  }
  return { nonEmpty, hits };
}

/**
 * Read every grid into sheet rows: bands of adjacent non-empty columns, a
 * number column found by content in each band, companions (seq / size / bill
 * / line op) found by their own shapes beside it. Emission keeps the sheet's
 * order — grid by grid, band left to right, row top to bottom — with NO
 * re-sorting: the order is part of what the paper says, and the SEQ_GAP
 * warning is what surfaces an anomaly in it.
 */
export function interpretGrids(
  grids: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>,
): SheetRow[] {
  const out: SheetRow[] = [];

  for (const rawGrid of grids) {
    const width = rawGrid.reduce((max, row) => Math.max(max, row.length), 0);
    if (width === 0) continue;
    const grid: string[][] = rawGrid.map((row) => {
      const dense: string[] = [];
      for (let c = 0; c < width; c += 1) dense.push(fold(row[c] ?? ''));
      return dense;
    });
    const allRows = grid.map((_, index) => index);

    // Bands: maximal runs of columns that hold anything at all.
    const occupied = Array.from({ length: width }, (_, col) =>
      grid.some((row) => (row[col] ?? '') !== ''),
    );
    const bands: Array<{ from: number; to: number }> = [];
    let start: number | null = null;
    for (let col = 0; col <= width; col += 1) {
      if (col < width && (occupied[col] ?? false)) {
        start = start ?? col;
      } else if (start !== null) {
        bands.push({ from: start, to: col - 1 });
        start = null;
      }
    }

    for (const band of bands) {
      // The number column, by content: among the cells that could be data at
      // all (they carry a digit — headers carry none), at least half are
      // ISO-shaped container numbers. The other half may be the paper's own
      // mistyped numbers, which are recorded and warned, never dropped.
      let numberCol = -1;
      for (let col = band.from; col <= band.to; col += 1) {
        let candidates = 0;
        let hits = 0;
        for (const r of allRows) {
          const cell = grid[r]?.[col] ?? '';
          if (cell === '' || !/\d/.test(cell)) continue;
          candidates += 1;
          if (NUMBER_FORM.test(normalizeNumber(cell))) hits += 1;
        }
        if (hits >= 1 && hits * 2 >= candidates) {
          numberCol = col;
          break;
        }
      }
      if (numberCol < 0) continue;

      // Data rows: the number cell says something and carries a digit — which
      // admits a mistyped number (recorded, warned) while skipping the header
      // words and the pre-numbered blank tail.
      const dataRows = allRows.filter((r) => {
        const cell = grid[r]?.[numberCol] ?? '';
        return cell !== '' && /\d/.test(cell);
      });
      if (dataRows.length === 0) continue;

      // seq: the nearest column to the right-reader's left whose data cells
      // are purely integers (the sheet's «#»).
      let seqCol = -1;
      for (let col = numberCol - 1; col >= band.from; col -= 1) {
        const { nonEmpty, hits } = columnStats(grid, dataRows, col, isInt);
        if (nonEmpty > 0 && hits * 10 >= nonEmpty * 9) {
          seqCol = col;
          break;
        }
      }

      // size: the first column right of the number whose data cells are short
      // figures (a Type column: 20/40, and the real-world 45).
      let sizeCol = -1;
      for (let col = numberCol + 1; col <= band.to; col += 1) {
        const { nonEmpty, hits } = columnStats(grid, dataRows, col, isShortInt);
        if (nonEmpty > 0 && hits * 10 >= nonEmpty * 8) {
          sizeCol = col;
          break;
        }
      }

      // bill: the first inhabited column right of the number that is not the
      // size column and does not read as one (bills may be pure digits, but
      // long ones — «272152428» — never 1–3 characters).
      let billCol = -1;
      for (let col = numberCol + 1; col <= band.to; col += 1) {
        if (col === sizeCol) continue;
        const { nonEmpty, hits } = columnStats(grid, dataRows, col, isShortInt);
        if (nonEmpty > 0 && hits * 10 < nonEmpty * 8) {
          billCol = col;
          break;
        }
      }

      // line op: a column of short capital codes (WHL, PIL, OVP…) past the bill.
      let lineOpCol = -1;
      for (let col = (billCol < 0 ? numberCol : billCol) + 1; col <= band.to; col += 1) {
        if (col === sizeCol || col === billCol) continue;
        const { nonEmpty, hits } = columnStats(grid, dataRows, col, (cell) =>
          /^[A-Z]{2,4}$/.test(cell),
        );
        if (nonEmpty > 0 && hits * 10 >= nonEmpty * 8) {
          lineOpCol = col;
          break;
        }
      }

      for (const r of dataRows) {
        const cellAt = (col: number): string => (col < 0 ? '' : (grid[r]?.[col] ?? ''));
        const seqCell = cellAt(seqCol);
        const sizeRaw = cellAt(sizeCol);
        out.push({
          seq: isInt(seqCell) ? Number(seqCell) : null,
          number: normalizeNumber(cellAt(numberCol)),
          size: sizeRaw === '20' ? 20 : sizeRaw === '40' ? 40 : null,
          sizeRaw,
          bill: cellAt(billCol),
          lineOp: cellAt(lineOpCol),
        });
      }
    }
  }

  return out;
}

/**
 * Recomputed wherever rows are shown — the upload review, the stored
 * registry, the tests — never stored, so there is exactly one arithmetic.
 * Index-aligned with the rows passed in.
 */
export function warningsOf(rows: readonly WarnableRow[]): SheetWarning[][] {
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.number, (seen.get(row.number) ?? 0) + 1);

  let lastSeq: number | null = null;
  return rows.map((row) => {
    const warnings: SheetWarning[] = [];
    const check = checkNumber(row.number);
    if (!check.wellFormed) warnings.push('NUMBER_MALFORMED');
    else if (!check.valid) warnings.push('NUMBER_CHECK');
    if (row.size === null && row.sizeRaw !== '') warnings.push('SIZE_UNKNOWN');
    if (row.bill === '') warnings.push('BILL_MISSING');
    if ((seen.get(row.number) ?? 0) > 1) warnings.push('DUPLICATE_NUMBER');
    if (row.seq !== null) {
      if (lastSeq !== null && row.seq !== lastSeq + 1) warnings.push('SEQ_GAP');
      lastSeq = row.seq;
    }
    return warnings;
  });
}

export function totalsOf(rows: readonly WarnableRow[]): SheetTotals {
  let of20 = 0;
  let of40 = 0;
  const bills = new Set<string>();
  for (const row of rows) {
    if (row.size === 20) of20 += 1;
    if (row.size === 40) of40 += 1;
    if (row.bill !== '') bills.add(row.bill);
  }
  return { rows: rows.length, of20, of40, other: rows.length - of20 - of40, bills: bills.size };
}
