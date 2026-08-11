import type { TableCell, TableModel } from './sheetKit';

/**
 * How wide a register has to be drawn — the arithmetic alone, with no React in
 * it, so the promise it makes can be checked by a test rather than by holding
 * a printout up to the light.
 *
 * The promise: after `table-layout: fixed` has divided the page by these
 * shares, every column is at least as wide as the widest thing standing in it.
 * A fixed layout does not shrink a cell to fit its column — it lets the cell
 * spill straight over its neighbour — so a column one character too narrow
 * prints the bill number across the seal number, which is exactly what the
 * register used to do.
 */

/**
 * A word's width, as a fraction of the font size: so much per character, plus
 * a fixed allowance for the bearings at either end.
 *
 * The two terms are both measured, in Edge, against the built client. Cairo's
 * digits run about 0.55em per character and Arabic letters, which connect, a
 * little less — but «الموظف» measures 0.634em per character, and a flat 0.62
 * estimate had the browser sawing that heading in half («الموظ / ف») to make
 * it fit. Short words cost proportionally more than long ones, which is what
 * the fixed term is for: «ص» alone measures 1.19em.
 */
export const CHAR_EM = 0.66;
export const WORD_PAD_EM = 0.5;
/** A cell's padding, both sides, plus the ruling to the next one. */
export const PRINT_CELL_CHROME = 9;
const SCREEN_CELL_CHROME = 17;
const SCREEN_FONT = 13;
/** A4 landscape less the 9mm margins the register prints with, in CSS pixels. */
export const PAGE_TEXT_PX = ((297 - 18) / 25.4) * 96;
/** Below this the sheet stops being readable; above it, it wastes the page. */
const PRINT_FONT_MIN = 6.6;
const PRINT_FONT_MAX = 10;
/**
 * The widest a free-text column may grow, and the least it may be given. The
 * ceiling is what buys the codes their room: a register of eighteen columns
 * has none to spare, and a note is content to run to another line where a
 * container number is not.
 */
const FREE_MAX = 22;
const FREE_MIN = 14;
/** Codes and dates: no column is given more than this, however long the value. */
const FIXED_MAX = 20;
/** The actions column holds a button, not text: «بطاقة» and its padding. */
const ACTION_UNITS = 11;
/** Below this width a register looks cramped even when its columns fit. */
const SCREEN_FLOOR = 880;
/** A note written at this length makes a row taller than a page is tall. */
const TALL_ROW_CHARS = 180;

export interface SheetMetrics {
  /** Screen column widths, the on-screen-only actions column included. */
  readonly shares: readonly string[];
  /** Paper column widths; the actions column collapses to nothing. */
  readonly printShares: readonly string[];
  /** The type size that makes the widest row fit the page, e.g. `8.40px`. */
  readonly printFont: string;
  /** The width the screen table needs before it starts scrolling sideways. */
  readonly minWidth: number;
  /** Even at the smallest readable type it does not fit: let words break. */
  readonly tight: boolean;
  /** Each column's demand in characters — what the shares are drawn from. */
  readonly demands: readonly number[];
}

/** The longest unbreakable run in a string — text wraps, words do not. */
export function longestWord(text: string): number {
  return text.split(' ').reduce((longest, word) => Math.max(longest, word.length), 0);
}

/**
 * What one column asks for, in characters.
 *
 * Free text — an owner's full name, a paragraph about a dented door — earns
 * room to breathe, and the more of it there is the more it gets, up to a
 * ceiling: one long note may not swallow the page. Everything else is a code,
 * a date or a figure that belongs on a single line, and asks for exactly the
 * width of the longest one of them.
 */
function demandOf(model: TableModel, heading: string, index: number): number {
  let widest = longestWord(heading);
  let unbreakable = widest;
  let free = false;
  for (const row of model.body) {
    const cell = row[index];
    if (cell === undefined) continue;
    if (cell.wrap === true) free = true;
    widest = Math.max(widest, cell.text.length);
    unbreakable = Math.max(unbreakable, longestWord(cell.text));
  }
  // The totals row counts too. All but its last cell sit in one column each —
  // the last one spans whatever is left — and «المجموع» in the narrow «الرقم»
  // column was the one thing still drawn outside its own ruling.
  const footer = model.footer;
  if (footer !== null && index < footer.length - 1) {
    const cell = footer[index];
    if (cell !== undefined) {
      widest = Math.max(widest, cell.text.length);
      unbreakable = Math.max(unbreakable, longestWord(cell.text));
    }
  }
  if (free) return Math.min(Math.max(widest, FREE_MIN, unbreakable), FREE_MAX);
  return Math.min(widest, FIXED_MAX);
}

/** Percentages that sum to a hundred, in the order the columns are drawn. */
function shareOut(boxes: readonly number[]): string[] {
  const total = boxes.reduce((sum, box) => sum + box, 0) || 1;
  return boxes.map((box) => `${((box / total) * 100).toFixed(3)}%`);
}

/**
 * The width one column's BOX needs: the text it carries plus its own padding
 * and ruling.
 *
 * Sharing the page out in proportion to the text alone is the subtle way to
 * get this wrong, and the first draft of this file got it exactly that way: it
 * hands every column the same fraction of the padding as of the text, so a
 * narrow column — «الرقم», four characters — is charged for a fifth of a
 * padding and is given a fifth of one. Padding is per column, not per
 * character, so it is added per column here.
 */
function boxesOf(demands: readonly number[], font: number, chrome: number): number[] {
  return demands.map((demand) => (demand * CHAR_EM + WORD_PAD_EM) * font + chrome);
}

export function sheetMetrics(model: TableModel, hasActions: boolean): SheetMetrics {
  const demands = model.head.map((heading, index) => demandOf(model, heading, index));
  const screenDemands = hasActions ? [...demands, ACTION_UNITS] : demands;

  // The type size that makes every box together come to exactly one page. The
  // paper never carries the actions column, so it is not paid for in width
  // there either: a column whose cells are hidden still holds its share of a
  // fixed layout, and that share was coming off the register.
  const printTotal = demands.reduce((sum, demand) => sum + demand, 0) || 1;
  const available = PAGE_TEXT_PX - demands.length * PRINT_CELL_CHROME;
  const wanted = available / (printTotal * CHAR_EM + demands.length * WORD_PAD_EM);
  const printFont = Math.min(PRINT_FONT_MAX, Math.max(PRINT_FONT_MIN, wanted));

  const screenBoxes = boxesOf(screenDemands, SCREEN_FONT, SCREEN_CELL_CHROME);
  const minWidth = Math.max(
    SCREEN_FLOOR,
    Math.round(screenBoxes.reduce((sum, box) => sum + box, 0)),
  );

  return {
    shares: shareOut(screenBoxes),
    printShares: [
      ...shareOut(boxesOf(demands, printFont, PRINT_CELL_CHROME)),
      ...(hasActions ? ['0%'] : []),
    ],
    printFont: `${printFont.toFixed(2)}px`,
    minWidth,
    tight: wanted < PRINT_FONT_MIN,
    demands,
  };
}

/**
 * A row carrying so much free text that it is taller than the page. Such a row
 * is allowed to break across pages: holding it together, as every other row is
 * held, would push it off the paper altogether.
 */
export function isTallRow(row: readonly TableCell[]): boolean {
  return row.some((cell) => cell.wrap === true && cell.text.length > TALL_ROW_CHARS);
}
