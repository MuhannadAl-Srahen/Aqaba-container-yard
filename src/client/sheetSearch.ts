/**
 * Searching a register: one box that reads EVERY column, because the office
 * does not know in advance which column holds the thing it is looking for —
 * «بدي كل الكشوفات يكون الها امكانية البحث عن اي معلومة». A row is kept when
 * every word typed appears somewhere in it, so «مسكو 3210» narrows twice.
 *
 * Pure on purpose: no React, no DOM, so what it promises is testable.
 */

/**
 * The shapes of one Arabic word that a keyboard produces and a reader does
 * not distinguish: أ إ آ are ا, ة is ه, ى is ي, the harakat and the tatweel
 * are ornament. The Arabic-Indic digits fold onto the Western ones the yard
 * writes its numbers in, so ٣٢١٠ finds 3210.
 */
export function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0x0660 + 0x30),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words a query asks for — all of which a row must carry. */
export function searchTerms(query: string): readonly string[] {
  const folded = fold(query);
  return folded === '' ? [] : folded.split(' ');
}

/**
 * Does this row answer the query? The cells are joined with a space, so a
 * term is never matched across the seam between two columns.
 *
 * A term that is all digits also reads each cell with its separators taken
 * out, because the yard writes one number many ways: the plate 60-84785 is
 * found by «6084785» just as it is by «84785», and a serial by «00012026».
 */
export function rowMatches(cells: readonly string[], terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const hay = fold(cells.join(' '));
  const digitRuns = cells.map((cell) => fold(cell).replace(/[^0-9]/g, ''));
  return terms.every(
    (term) =>
      hay.includes(term) ||
      (/^[0-9]+$/.test(term) && digitRuns.some((run) => run.includes(term))),
  );
}
