import { describe, expect, it } from 'vitest';
import { fold, rowMatches, searchTerms } from '../src/client/sheetSearch';

/**
 * One box over every register, reading every column — «بدي كل الكشوفات يكون
 * الها امكانية البحث عن اي معلومة». What it promises is that the office finds
 * the row without knowing which column holds the thing it is looking for.
 */

/** A row of كشف حركة الدخول, as the sheet actually builds it. */
const row = [
  '7',
  'دخول',
  'الأربعاء',
  '12/08/2026',
  '7:04 م',
  '911',
  '0005/2026',
  'MSKU0682650',
  '9110',
  'JO91100',
  '28000',
  '20',
  '2-A-01-06-A',
  'وسام',
  'الباب مبعوج',
];

describe('searching a register', () => {
  it('finds the row by any column it carries', () => {
    for (const query of [
      'MSKU0682650', // the container
      '9110', // the bill
      '911', // the plate
      'JO91100', // the seal
      '2-A-01-06', // the slot
      '12/08/2026', // the date
      'وسام', // the employee
      'مبعوج', // a word out of the note
      '0005', // the card serial
    ]) {
      expect(rowMatches(row, searchTerms(query)), query).toBe(true);
    }
  });

  it('narrows with every word typed, in any order', () => {
    expect(rowMatches(row, searchTerms('mskU 9110'))).toBe(true);
    expect(rowMatches(row, searchTerms('9110 وسام'))).toBe(true);
    // Both words must be there — one alone is not a match for two.
    expect(rowMatches(row, searchTerms('9110 سامر'))).toBe(false);
  });

  it('ignores the shapes a keyboard changes but a reader does not', () => {
    // ا / أ / إ, ة / ه, ى / ي, and the harakat.
    expect(rowMatches(['الأربعاء'], searchTerms('الاربعاء'))).toBe(true);
    expect(rowMatches(['شركة النورس'], searchTerms('شركه'))).toBe(true);
    expect(rowMatches(['مصطفى'], searchTerms('مصطفي'))).toBe(true);
    expect(rowMatches(['بُوليصة'], searchTerms('بوليصه'))).toBe(true);
    // Arabic-Indic digits find the Western ones the yard writes.
    expect(rowMatches(['3210'], searchTerms('٣٢١٠'))).toBe(true);
    expect(fold('  الرقم   ')).toBe('الرقم');
  });

  it('keeps every row when nothing has been typed', () => {
    expect(searchTerms('   ')).toEqual([]);
    expect(rowMatches(row, searchTerms(''))).toBe(true);
  });

  it('does not match a term across the seam between two columns', () => {
    // «911» ends one cell and «0005» opens the next; joined blindly they would
    // read as one number that no column actually holds.
    expect(rowMatches(row, searchTerms('9110005'))).toBe(false);
  });

  it('a digits-only search reads through the separators a number is written with', () => {
    // The plate 60-84785 is found by «6084785» just as by «84785» …
    expect(rowMatches(['60-84785'], searchTerms('6084785'))).toBe(true);
    // … a card serial 0005/2026 by «00052026» …
    expect(rowMatches(row, searchTerms('00052026'))).toBe(true);
    // … and an Arabic-Indic spelling folds first, then reads the same way.
    expect(rowMatches(['60-84785'], searchTerms('٦٠٨٤٧٨٥'))).toBe(true);
    // Words keep their exact shape — only digit runs read through separators.
    expect(rowMatches(['ABC-123'], searchTerms('abc123'))).toBe(false);
  });
});
