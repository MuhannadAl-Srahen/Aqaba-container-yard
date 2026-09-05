import { describe, expect, it } from 'vitest';
import { interpretGrids, totalsOf, warningsOf } from '../src/shared/customsSheet';

/**
 * قراءة كشف الجمارك حرفاً بحرف — the pure interpreter against the shapes the
 * real sheets taught us: «دفعة 11» (three side-by-side column bands with a
 * pre-numbered blank tail) and «150 حاوية دفعة 8» (one band, a Line Op
 * column, and four honest rows of size 45).
 */

// Real numbers from the owner's own sheets — every check digit valid.
const N = [
  'CMAU3320281',
  'SEGU6308793',
  'TCNU3691473',
  'CMAU6824645',
  'CMAU7319210',
  'BMOU6391373',
  'FSCU8572423',
  'ECMU5627285',
  'TLLU8535197',
  'CMAU8852137',
  'CMAU9960440',
  'CSNU8219720',
] as const;

const empty = ['', '', '', ''];

describe('interpretGrids — the band walk', () => {
  it('reads three side-by-side bands in sheet order, skipping the numbered tail', () => {
    // The دفعة-11 shape in miniature: bands A-D, F-I, K-N with an empty
    // separator column between; the third band's «#» keeps counting past
    // where its numbers stop — those tails are not rows.
    const header = ['#', 'Unit Nbr', 'Type', 'BL Nbr'];
    const band = (seq: number, number: string, size: string, bill: string): string[] => [
      String(seq),
      number,
      size,
      bill,
    ];
    const grid: string[][] = [
      [...header, '', ...header, '', ...header],
      [...band(1, N[0], '40', 'CFA0935597'), '', ...band(6, N[5], '40', 'CFA0936319'), '', ...band(11, N[10], '40', 'CFA0937659')],
      [...band(2, N[1], '40', 'CFA0935894'), '', ...band(7, N[6], '40', 'CFA0936770'), '', ...band(12, N[11], '40', 'COSU6504546770')],
      [...band(3, N[2], '40', 'CFA0935909'), '', ...band(8, N[7], '40', 'CFA0936890'), '', '13', '', '', ''],
      [...band(4, N[3], '40', 'CFA0935918'), '', ...band(9, N[8], '20', 'CFA0937493'), '', '14', '', '', ''],
      [...band(5, N[4], '40', 'CFA0935940'), '', ...band(10, N[9], '40', 'CFA0937501'), '', ...empty],
    ];
    const rows = interpretGrids([grid]);
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[0]).toEqual({
      seq: 1,
      number: 'CMAU3320281',
      size: 40,
      sizeRaw: '40',
      bill: 'CFA0935597',
      lineOp: '',
    });
    expect(rows[8]?.size).toBe(20);
    expect(warningsOf(rows).every((w) => w.length === 0)).toBe(true);
    expect(totalsOf(rows)).toEqual({ rows: 12, of20: 1, of40: 11, other: 0, bills: 12 });
  });

  it('reads the single-band shape with a Line Op column and keeps a 45 literally', () => {
    const grid: string[][] = [
      ['#', 'Unit Nbr', 'Type', 'BL Nbr', 'Line Op'],
      ['1', N[0], '40', '151G502146', 'WHL'],
      ['2', N[1], '45', 'HUA602265000', 'PIL'],
      ['3', N[2], '20', '151G502146', 'OVP'],
    ];
    const rows = interpretGrids([grid]);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.lineOp).toBe('WHL');
    expect(rows[1]).toMatchObject({ size: null, sizeRaw: '45', bill: 'HUA602265000' });
    const warnings = warningsOf(rows);
    expect(warnings[1]).toEqual(['SIZE_UNKNOWN']);
    expect(totalsOf(rows)).toEqual({ rows: 3, of20: 1, of40: 1, other: 1, bills: 2 });
  });

  it('folds Arabic-Indic digits and strips direction marks before reading', () => {
    const grid: string[][] = [
      ['م', 'رقم الحاوية', 'الفئة', 'البوليصة'],
      ['١', `‏${N[0]}`, '٤٠', 'CFA0935597'],
      ['٢', N[1], '٢٠', 'CFA0935894'],
    ];
    const rows = interpretGrids([grid]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ seq: 1, number: 'CMAU3320281', size: 40, sizeRaw: '40' });
    expect(rows[1]).toMatchObject({ seq: 2, size: 20 });
  });

  it('finds nothing in empty grids, header-only grids, or wordy tables', () => {
    expect(interpretGrids([])).toEqual([]);
    expect(interpretGrids([[]])).toEqual([]);
    expect(interpretGrids([[['#', 'Unit Nbr', 'Type']]])).toEqual([]);
    expect(
      interpretGrids([
        [
          ['التاريخ', 'البيان', 'الملاحظات'],
          ['01/09', 'وصول', 'بلا'],
        ],
      ]),
    ).toEqual([]);
  });

  it('a lone mistyped number among real ones is recorded, not dropped', () => {
    const grid: string[][] = [
      ['#', 'Unit Nbr', 'Type', 'BL Nbr'],
      ['1', N[0], '40', 'B-1'],
      ['2', 'CMAU332028', '40', 'B-2'], // one digit short — the paper's own sin
      ['3', N[2], '40', 'B-3'],
    ];
    const rows = interpretGrids([grid]);
    expect(rows).toHaveLength(3);
    expect(rows[1]?.number).toBe('CMAU332028');
    expect(warningsOf(rows)[1]).toEqual(['NUMBER_MALFORMED']);
  });
});

describe('warningsOf — advisory, exhaustive', () => {
  it('flags a wrong check digit, a duplicate, a bill hole and a seq jump', () => {
    const row = (seq: number | null, number: string, bill: string): Parameters<typeof warningsOf>[0][number] => ({
      seq,
      number,
      size: 40,
      sizeRaw: '40',
      bill,
    });
    const rows = [
      row(1, 'CMAU3320281', 'B-1'),
      row(2, 'CMAU3320282', 'B-2'), // check digit belongs to ...1
      row(3, 'CMAU3320281', ''),    // duplicate of the first, and no bill
      row(5, 'SEGU6308793', 'B-3'), // 4 is missing
    ];
    const warnings = warningsOf(rows);
    expect(warnings[0]).toEqual(['DUPLICATE_NUMBER']);
    expect(warnings[1]).toEqual(['NUMBER_CHECK']);
    expect(warnings[2]).toEqual(['BILL_MISSING', 'DUPLICATE_NUMBER']);
    expect(warnings[3]).toEqual(['SEQ_GAP']);
  });

  it('a sheet with no seq column raises no gap talk at all', () => {
    const rows = [
      { seq: null, number: 'CMAU3320281', size: 40 as const, sizeRaw: '40', bill: 'B' },
      { seq: null, number: 'SEGU6308793', size: 40 as const, sizeRaw: '40', bill: 'B' },
    ];
    expect(warningsOf(rows).every((w) => w.length === 0)).toBe(true);
  });

  it('a missing size column is silence, not a warning', () => {
    const rows = [{ seq: 1, number: 'CMAU3320281', size: null, sizeRaw: '', bill: 'B' }];
    expect(warningsOf(rows)[0]).toEqual([]);
  });
});
