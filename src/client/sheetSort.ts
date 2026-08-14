import type { TableCell } from './sheetKit';

/**
 * Ordering a register by one of its own columns — «ترتيب تصاعدي او تنزالي بس
 * اكبس على العامود الخاص فيهم». Pure, so what it promises about the order of
 * slot codes and bill numbers is testable without a browser.
 */

export interface SortState {
  /** Index into the model's head. */
  readonly column: number;
  readonly dir: 'asc' | 'desc';
}

/**
 * Arabic collation with NUMERIC runs, which is the whole difficulty here.
 * Bills are numbers written as text and of different lengths, so plain text
 * order puts 265313216 before 3210; numeric collation reads the digits as a
 * number and puts 3210 first. The same rule sorts «2-A-01-03-B» correctly
 * part by part, and it is what a person means by ترتيب تصاعدي.
 */
const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' });

/** What a cell is ordered BY: its own key when it has one, else its text. */
export function sortKeyOf(cell: TableCell | undefined): string | number {
  if (cell === undefined) return '';
  return cell.sort ?? cell.text;
}

/**
 * A cell with nothing in it — an em dash is how this register writes "not
 * recorded", and a container that has left has no slot at all. Blanks go to
 * the BOTTOM whichever way the column is ordered: ordering by slot to see the
 * yard from A to E must not open with a page of departed containers, and
 * reversing it must not open with them either.
 */
export function isBlank(cell: TableCell | undefined): boolean {
  if (cell === undefined) return true;
  if (cell.sort !== undefined) return false;
  const text = cell.text.trim();
  return text === '' || text === '—';
}

export function compareCells(a: TableCell | undefined, b: TableCell | undefined): number {
  const left = sortKeyOf(a);
  const right = sortKeyOf(b);
  if (typeof left === 'number' && typeof right === 'number') {
    // Never `left - right`: a still-standing container carries Infinity as
    // its exit date, and Infinity − Infinity is NaN, which would leave the
    // sort undefined rather than merely wrong.
    return left === right ? 0 : left < right ? -1 : 1;
  }
  return collator.compare(String(left), String(right));
}

/**
 * Clicking a heading walks asc → desc → back to the register's own order.
 * The third state matters: the natural order of كشف حركة الدخول is time, and
 * there has to be a way back to it without reloading the screen.
 */
export function nextSort(current: SortState | null, column: number): SortState | null {
  if (current === null || current.column !== column) return { column, dir: 'asc' };
  return current.dir === 'asc' ? { column, dir: 'desc' } : null;
}

/**
 * The order the rows should be read in, as indices into `body`. Handing back
 * indices rather than rows keeps every row's ORIGINAL position, which the
 * per-row buttons are addressed by.
 *
 * Ties keep the register's own order — the sort is stable — so ordering by
 * bill leaves each bill's containers in the order they came in.
 */
export function sortOrder(
  body: readonly (readonly TableCell[])[],
  seats: readonly number[],
  sort: SortState | null,
): readonly number[] {
  if (sort === null) return seats;
  const sign = sort.dir === 'asc' ? 1 : -1;
  const cellAt = (seat: number): TableCell | undefined => body[seat]?.[sort.column];

  // The rows with nothing in that column are set aside first, so they land at
  // the foot of the sheet in both directions rather than heading it whenever
  // the order is reversed.
  const filled = [...seats].filter((seat) => !isBlank(cellAt(seat)));
  const blank = seats.filter((seat) => isBlank(cellAt(seat)));

  filled.sort((left, right) => {
    const decided = compareCells(cellAt(left), cellAt(right));
    return decided === 0 ? left - right : decided * sign;
  });
  return [...filled, ...blank];
}
