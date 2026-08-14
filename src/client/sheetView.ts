import type { TableCell, TableModel } from './sheetKit';
import { rowMatches, searchTerms } from './sheetSearch';
import { sortOrder, type SortState } from './sheetSort';

/**
 * The register as it is actually read: narrowed by the search, then put in
 * the order the reader asked for, then given line numbers that count the
 * lines of THIS sheet. One pure function, because it is the piece everything
 * downstream trusts — the screen, the printer, the PDF, the Excel file and
 * the per-row buttons all read what it returns.
 */

export interface SheetView {
  readonly head: readonly string[];
  readonly body: readonly (readonly TableCell[])[];
  /**
   * Each shown row's ORIGINAL index in the model. The per-row actions the
   * caller renders — a card to reprint, an edit to revert — are addressed by
   * position in the register it built, not by position on this sheet.
   */
  readonly seats: readonly number[];
  readonly searching: boolean;
  readonly total: number;
}

export function arrange(
  model: TableModel,
  query: string,
  sort: SortState | null,
): SheetView {
  const terms = searchTerms(query);
  const searching = terms.length > 0;
  /**
   * The line counter is not information: nobody looks for «the row that was
   * number 10». Searching it would keep rows that carry the term nowhere a
   * reader can see — the counter is rewritten below — so it is left out of
   * what the search reads.
   */
  const from = model.counted === true ? 1 : 0;

  const kept: number[] = [];
  model.body.forEach((row, index) => {
    if (
      !searching ||
      rowMatches(
        row.slice(from).map((cell) => cell.text),
        terms,
      )
    ) {
      kept.push(index);
    }
  });

  const seats = sortOrder(model.body, kept, sort);
  const body = seats.map((seat, place) => {
    const row = model.body[seat] ?? [];
    // Sorted by slot or narrowed by a search, the first line of the sheet is
    // still line 1 — which is what a printed register has to do.
    if (model.counted !== true) return row;
    return [{ text: String(place + 1) }, ...row.slice(1)];
  });

  return { head: model.head, body, seats, searching, total: model.body.length };
}
