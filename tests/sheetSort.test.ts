import { describe, expect, it } from 'vitest';
import { cellLtr, cellNumeric, cellText, dash, type TableModel, type TableCell } from '../src/client/sheetKit';
import { compareCells, nextSort, sortOrder } from '../src/client/sheetSort';
import { arrange } from '../src/client/sheetView';

/**
 * Ordering a register by pressing one of its headings — «ترتيب تصاعدي او
 * تنزالي بس اكبس على العامود الخاص فيهم». The two the owner named are the
 * slot and the bill, and both need more than plain text order to come out
 * the way a person reads them.
 */

const rowsOf = (values: readonly (readonly TableCell[])[]): number[] =>
  values.map((_, index) => index);

/** Order a one-column table and read back the text, top to bottom. */
function ordered(cells: readonly TableCell[], dir: 'asc' | 'desc' = 'asc'): string[] {
  const body = cells.map((cell) => [cell]);
  return sortOrder(body, rowsOf(body), { column: 0, dir }).map(
    (seat) => body[seat]?.[0]?.text ?? '',
  );
}

describe('ordering a register', () => {
  it('reads a bill number as a number, not as text', () => {
    // Plain text order puts 265313216 first, because '2' comes before '3'.
    // The office means the smaller number, whatever its length.
    expect(ordered(['3210', '265313216', '4187', '408117702'].map((b) => cellLtr(b)))).toEqual([
      '3210',
      '4187',
      '265313216',
      '408117702',
    ]);
  });

  it('orders slots down the yard: zone, then bay, then stack, then tier', () => {
    const slots = [
      '2-B-03-01-A',
      '2-A-11-02-C',
      '2-A-01-10-A',
      '2-A-01-02-B',
      '2-A-01-02-A',
      '2-A-11-02-A',
    ].map((slot) => cellLtr(slot));
    expect(ordered(slots)).toEqual([
      '2-A-01-02-A',
      '2-A-01-02-B',
      // Bay 01 stack 10 comes after stack 02 — the digits are read as
      // numbers, so 10 does not land between 01 and 02.
      '2-A-01-10-A',
      '2-A-11-02-A',
      '2-A-11-02-C',
      '2-B-03-01-A',
    ]);
    expect(ordered(slots, 'desc')[0]).toBe('2-B-03-01-A');
  });

  it('orders a date by its instant, not by the digits it starts with', () => {
    const stamp = (text: string, iso: string): TableCell => cellLtr(text, Date.parse(iso));
    const dates = [
      stamp('14/08/2026', '2026-08-14T09:00:00.000Z'),
      stamp('02/09/2026', '2026-09-02T09:00:00.000Z'),
      stamp('30/07/2026', '2026-07-30T09:00:00.000Z'),
    ];
    expect(ordered(dates)).toEqual(['30/07/2026', '14/08/2026', '02/09/2026']);
  });

  it('puts a container that has not left yet after every departure', () => {
    const cells = [
      cellLtr('01/08/2026', Date.parse('2026-08-01T09:00:00.000Z')),
      cellText('ما زالت في الساحة', Number.POSITIVE_INFINITY),
      cellLtr('09/08/2026', Date.parse('2026-08-09T09:00:00.000Z')),
    ];
    expect(ordered(cells).at(-1)).toBe('ما زالت في الساحة');
    // Two of them would compare Infinity against Infinity — which must be a
    // tie, not a NaN that leaves the order undefined.
    expect(compareCells(cells[1], cells[1])).toBe(0);
  });

  it('keeps the register’s own order inside a tie', () => {
    // Three containers of one bill stay in the order they came in.
    const body = [
      [cellLtr('3210'), cellLtr('FIRST')],
      [cellLtr('9999'), cellLtr('OTHER')],
      [cellLtr('3210'), cellLtr('SECOND')],
      [cellLtr('3210'), cellLtr('THIRD')],
    ];
    const seats = sortOrder(body, rowsOf(body), { column: 0, dir: 'asc' });
    expect(seats.map((seat) => body[seat]?.[1]?.text)).toEqual([
      'FIRST',
      'SECOND',
      'THIRD',
      'OTHER',
    ]);
    // And descending flips the columns, not the ties inside them.
    const down = sortOrder(body, rowsOf(body), { column: 0, dir: 'desc' });
    expect(down.map((seat) => body[seat]?.[1]?.text)).toEqual([
      'OTHER',
      'FIRST',
      'SECOND',
      'THIRD',
    ]);
  });

  it('sorts only the rows a search left standing', () => {
    const body = [[cellLtr('9')], [cellLtr('3')], [cellLtr('7')]];
    // The search kept rows 0 and 1; row 2 is not in the sheet at all.
    expect(sortOrder(body, [0, 1], { column: 0, dir: 'asc' })).toEqual([1, 0]);
  });

  it('walks asc, then desc, then back to the register’s own order', () => {
    expect(nextSort(null, 3)).toEqual({ column: 3, dir: 'asc' });
    expect(nextSort({ column: 3, dir: 'asc' }, 3)).toEqual({ column: 3, dir: 'desc' });
    expect(nextSort({ column: 3, dir: 'desc' }, 3)).toBeNull();
    // Pressing a different heading starts that column fresh, ascending.
    expect(nextSort({ column: 3, dir: 'desc' }, 5)).toEqual({ column: 5, dir: 'asc' });
  });

  it('leaves the order alone when nothing is sorted', () => {
    const body = [[cellLtr('9')], [cellLtr('3')]];
    expect(sortOrder(body, [0, 1], null)).toEqual([0, 1]);
  });
});

/**
 * The whole composition, which is what the screen, the printer and the
 * per-row buttons actually read: narrow by the search, order by the pressed
 * heading, renumber the line counter over what is left.
 */
describe('the sheet as it is read', () => {
  /** A register shaped like كشف الحاويات في الساحة: counter, number, slot, bill. */
  const register = (
    rows: ReadonlyArray<[string, string, string]>,
  ): TableModel => ({
    head: ['الرقم', 'رقم الحاوية', 'موقع الحاوية', 'رقم البوليصة'],
    body: rows.map(([number, slot, bill], index) => [
      cellText(String(index + 1)),
      cellLtr(number),
      slot === '' ? cellText(dash) : cellLtr(slot),
      cellLtr(bill),
    ]),
    footer: null,
    counted: true,
  });

  const model = register([
    ['MSCU0000001', '2-B-03-01-A', '3210'],
    ['MSCU0000002', '2-A-11-02-C', '265313216'],
    ['MSCU0000003', '', '4187'],
    ['MSCU0000004', '2-A-01-10-A', '3210'],
  ]);

  it('carries every row’s ORIGINAL place, so a row button prints its own container', () => {
    const view = arrange(model, '', { column: 2, dir: 'asc' });
    // Ordered by slot: 2-A-01-10-A, 2-A-11-02-C, 2-B-03-01-A, then the one
    // with no slot at all.
    expect(view.body.map((row) => row[1]?.text)).toEqual([
      'MSCU0000004',
      'MSCU0000002',
      'MSCU0000001',
      'MSCU0000003',
    ]);
    // The seats are the register's own indices, in the order shown — this is
    // what the «بطاقة» button is addressed by.
    expect(view.seats).toEqual([3, 1, 0, 2]);
  });

  it('sends the rows with nothing in that column to the foot, both ways', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const view = arrange(model, '', { column: 2, dir });
      expect(view.body.at(-1)?.[1]?.text, dir).toBe('MSCU0000003');
    }
  });

  it('renumbers the counter over the sheet, not over the register', () => {
    const view = arrange(model, '', { column: 3, dir: 'asc' });
    expect(view.body.map((row) => row[0]?.text)).toEqual(['1', '2', '3', '4']);
    // 3210 twice, then 4187, then 265313216 — read as numbers.
    expect(view.body.map((row) => row[3]?.text)).toEqual([
      '3210',
      '3210',
      '4187',
      '265313216',
    ]);
  });

  it('never lets the line number itself answer a search', () => {
    // Row 3 of the register is «MSCU0000003» and carries no 3 anywhere else.
    // Searching «3» must not keep it on the strength of a counter that is
    // rewritten before it is shown.
    const view = arrange(register([
      ['AAAA0000001', '2-A-01-01-A', '9999'],
      ['BBBB0000002', '2-A-01-02-A', '8888'],
      ['CCCC0000004', '2-A-01-04-A', '7777'],
    ]), '3', null);
    expect(view.body).toEqual([]);
    expect(view.searching).toBe(true);
    expect(view.total).toBe(3);
  });

  it('searches and orders together, and the counter follows', () => {
    const view = arrange(model, '3210', { column: 1, dir: 'desc' });
    expect(view.body.map((row) => row[1]?.text)).toEqual(['MSCU0000004', 'MSCU0000001']);
    expect(view.body.map((row) => row[0]?.text)).toEqual(['1', '2']);
    expect(view.seats).toEqual([3, 0]);
  });

  it('reads a hand-typed weight as the figure it means', () => {
    expect(cellNumeric('28,000', '—').sort).toBe(28000);
    expect(cellNumeric('28 000', '—').sort).toBe(28000);
    expect(cellNumeric('9000', '—').sort).toBe(9000);
    // Not a figure at all: it keeps its own text order rather than lying.
    expect(cellNumeric('حوالي ٢٨ طن', '—').sort).toBeUndefined();
    // And nothing recorded is the register's dash.
    expect(cellNumeric('', '—').text).toBe('—');

    const weights = ['9,000', '800', '12,500', '25000'].map((w) => [cellNumeric(w, '—')]);
    const order = sortOrder(weights, [0, 1, 2, 3], { column: 0, dir: 'asc' });
    expect(order.map((seat) => weights[seat]?.[0]?.text)).toEqual([
      '800',
      '9,000',
      '12,500',
      '25000',
    ]);
  });
});
