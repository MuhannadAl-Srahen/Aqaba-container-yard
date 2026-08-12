import { describe, expect, it } from 'vitest';
import {
  CHAR_EM,
  PAGE_TEXT_PX,
  PRINT_CELL_CHROME,
  WORD_PAD_EM,
  isTallRow,
  longestWord,
  sheetMetrics,
} from '../src/client/sheetGeometry';
import type { TableCell, TableModel } from '../src/client/sheetKit';

/**
 * The register printed its columns on top of one another: the bill number
 * across the seal number, the container number across the card number. The
 * cause was arithmetic, not CSS — `table-layout: fixed` divides the page by
 * the declared shares and then lets any cell too big for its share spill over
 * its neighbour, and the shares were being drawn for a page two thirds wider
 * than A4 landscape actually is.
 *
 * So the promise is arithmetic too, and it is checked here: after the shares
 * have divided the page, every column is at least as wide as the widest thing
 * standing in it.
 */

const cell = (text: string): TableCell => ({ text });
const ltr = (text: string): TableCell => ({ text, ltr: true });
const free = (text: string): TableCell => ({ text, wrap: true });

/** كشف حركة الدخول as it really is: the widest sheet the office prints. */
function gateRegister(rows = 3): TableModel {
  const head = [
    'الرقم',
    'البيان',
    'اليوم',
    'التاريخ',
    'الوقت',
    'رقم السيارة',
    'رقم بطاقة دخول',
    'رقم الحاوية',
    'رقم البوليصة',
    'رقم الرصاصة',
    'الوزن (كغم)',
    'فئة الحاوية',
    'موقع الحاوية',
    'الموظف',
    'ملاحظات',
  ];
  const body = Array.from({ length: rows }, (_, index) => [
    cell(String(index + 1)),
    cell('دخول'),
    cell('الأربعاء'),
    ltr('01/08/2026'),
    ltr('12:05 ص'),
    ltr('7130'),
    ltr('0091/2026'),
    ltr('HLXU2230386'),
    ltr('J048478'),
    ltr('JO16148'),
    ltr('26919'),
    cell('20'),
    ltr('2-A-39-04-A'),
    cell('المالك'),
    free('عليها حجز جمركي والقفل بحاجة إلى تبديل'),
  ]);
  return { head, body, footer: [cell('المجموع'), cell('3 حركة')] };
}

/** How many characters each column can actually hold once printed. */
function printedCapacity(model: TableModel, hasActions: boolean): number[] {
  const metrics = sheetMetrics(model, hasActions);
  const font = Number(metrics.printFont.replace('px', ''));
  return (
    metrics.printShares
      .slice(0, model.head.length)
      .map((share) => (Number(share.replace('%', '')) / 100) * PAGE_TEXT_PX)
      // A cell's own padding and ruling are not room for text, and neither are
      // the bearings at the two ends of the word standing in it.
      .map((width) => (width - PRINT_CELL_CHROME) / font - WORD_PAD_EM)
      .map((room) => room / CHAR_EM)
  );
}

describe('the printed register fits its page', () => {
  it('gives every column at least the width of what stands in it', () => {
    for (const model of [gateRegister(), gateRegister(60)]) {
      const capacity = printedCapacity(model, true);
      const { demands } = sheetMetrics(model, true);
      demands.forEach((demand, index) => {
        // Allowed a hair of rounding, never a whole character.
        expect(
          capacity[index] ?? 0,
          `column ${String(index)} — ${model.head[index] ?? ''}`,
        ).toBeGreaterThanOrEqual(demand - 0.02);
      });
    }
  });

  it('shrinks the type for a wide sheet and leaves a narrow one alone', () => {
    const wide = Number(sheetMetrics(gateRegister(), true).printFont.replace('px', ''));
    const narrow = Number(
      sheetMetrics(
        {
          head: ['الرقم', 'اليوم', 'التاريخ', 'عدد الدخول', 'عدد الخروج', 'القائم في الساحة'],
          body: [[cell('1'), cell('الأحد'), ltr('01/08/2026'), cell('4'), cell('2'), cell('96')]],
          footer: null,
        },
        false,
      ).printFont.replace('px', ''),
    );
    expect(wide).toBeLessThan(narrow);
    // …and neither is ever printed at a size nobody can read.
    expect(wide).toBeGreaterThanOrEqual(6.6);
    expect(narrow).toBeLessThanOrEqual(10);
  });

  it('spends nothing on the actions column, which the paper never carries', () => {
    const columns = gateRegister().head.length;
    const withButton = sheetMetrics(gateRegister(), true);
    const without = sheetMetrics(gateRegister(), false);
    expect(withButton.printShares.at(-1)).toBe('0%');
    // The real columns are printed identically either way.
    expect(withButton.printShares.slice(0, columns)).toEqual(
      without.printShares.slice(0, columns),
    );
    // On screen the button does get its share, so it is not clipped there.
    expect(withButton.shares).toHaveLength(columns + 1);
  });

  it('declares shares that add up to the whole page', () => {
    const total = sheetMetrics(gateRegister(), true)
      .printShares.map((share) => Number(share.replace('%', '')))
      .reduce((sum, share) => sum + share, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  it('never breaks a word to buy room for the next column', () => {
    const name = 'الشركةالأردنيةلتخليصوتخزينالحاويات'; // one unbroken run
    const model: TableModel = {
      head: ['الرقم', 'اسم المالك'],
      body: [[cell('1'), free(name)]],
      footer: null,
    };
    const { demands } = sheetMetrics(model, false);
    // The column asks for the whole word, up to the ceiling one column may
    // take; past that the CSS breaks it rather than letting it overlap.
    expect(demands[1]).toBe(Math.min(longestWord(name), 22));
  });

  it('lets a column with a very long note grow, but only so far', () => {
    const short: TableModel = {
      head: ['ملاحظات'],
      body: [[free('لا شيء')]],
      footer: null,
    };
    const long: TableModel = {
      head: ['ملاحظات'],
      body: [[free('عليها حجز جمركي '.repeat(30))]],
      footer: null,
    };
    expect(sheetMetrics(short, false).demands[0]).toBe(14);
    expect(sheetMetrics(long, false).demands[0]).toBe(22);
  });

  /**
   * «المجموع» sits in the narrowest column of the sheet — «الرقم», which
   * carries nothing but a row number — and it was the last thing still being
   * drawn over its own ruling.
   */
  it('counts the totals row, not only the body', () => {
    const model: TableModel = {
      head: ['الرقم', 'رقم الحاوية'],
      body: [[cell('1'), ltr('HLXU2230386')]],
      footer: [cell('المجموع'), cell('حركة واحدة')],
    };
    const capacity = printedCapacity(model, false);
    expect(capacity[0] ?? 0).toBeGreaterThanOrEqual('المجموع'.length - 0.02);
  });
});

describe('a row too tall for the page', () => {
  it('is marked so it may break across pages instead of falling off one', () => {
    const ordinary = [cell('1'), free('عليها حجز جمركي')];
    const enormous = [cell('2'), free('عليها حجز جمركي '.repeat(20))];
    expect(isTallRow(ordinary)).toBe(false);
    expect(isTallRow(enormous)).toBe(true);
  });

  it('does not mark a long CODE, which is one line however long it reads', () => {
    expect(isTallRow([ltr('X'.repeat(300))])).toBe(false);
  });
});
