import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { isTallRow, sheetMetrics } from './sheetGeometry';
import { nextSort, type SortState } from './sheetSort';
import { arrange } from './sheetView';
import { ThemePicker } from './ThemePicker';
import { Button } from './ui';

/**
 * The paper-sheet machinery every register shares: one table model that
 * feeds the screen (paginated, no sideways scrolling), the printer, the
 * server-made PDF and the Excel file alike.
 */

export const dayFormat = new Intl.DateTimeFormat('ar-JO', {
  weekday: 'long',
  timeZone: 'Asia/Amman',
});
// Latin digit order (dd/mm/yyyy) so the date never scrambles inside RTL text.
export const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeZone: 'Asia/Amman',
});
/** 12-hour clock with the Arabic م/ص marker, Western digits. */
export const timeFormat = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

/** Today's Amman date as the value an <input type="date"> speaks. */
export function ammanToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Amman',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function monthStart(): string {
  return `${ammanToday().slice(0, 8)}01`;
}

/** The Amman midnight instants bounding [from, to] inclusive. */
export function rangeInstants(from: string, to: string): { fromIso: string; toIso: string } {
  const fromIso = new Date(`${from}T00:00:00+03:00`).toISOString();
  const toIso = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000).toISOString();
  return { fromIso, toIso };
}

/** One cell: its text, direction, wrapping policy, and an optional action. */
export interface TableCell {
  readonly text: string;
  readonly ltr?: boolean;
  /** Free-form text that may need to break anywhere (names, notes). */
  readonly wrap?: boolean;
  /** Screen only: the cell is a link (e.g. a truck opening its register). */
  readonly onClick?: () => void;
  /** مواد خطرة: red on screen, on paper and in the PDF alike. */
  readonly danger?: boolean;
  /**
   * What this cell is ORDERED by, when its text is not the answer: a date
   * reading «14/08/2026» sorts by the instant behind it, not by the two
   * digits it happens to start with. Text cells need nothing here.
   */
  readonly sort?: string | number;
}

export interface TableModel {
  readonly head: readonly string[];
  readonly body: readonly (readonly TableCell[])[];
  readonly footer: readonly TableCell[] | null;
  /**
   * The first column is a line counter rather than data. It is rewritten to
   * run 1, 2, 3 … down whatever the sheet actually shows, so a register
   * sorted by slot or narrowed by a search still reads in order on paper.
   */
  readonly counted?: boolean;
}

/**
 * The sort key is left OFF the cell when there is none, rather than set to
 * undefined: the project builds with exactOptionalPropertyTypes, and an
 * absent key and a key holding undefined are not the same thing here.
 */
const keyed = (cell: TableCell, sort: string | number | undefined): TableCell =>
  sort === undefined ? cell : { ...cell, sort };

/**
 * A figure the gate typed by hand: the scale ticket is copied as it reads, so
 * «28000» and «28,000» and «28 000» all occur. Ordered by the number it
 * means, not by the punctuation it was written with — and text that is not a
 * figure at all keeps its own text order.
 */
export const cellNumeric = (text: string, empty: string): TableCell => {
  if (text.trim() === '') return { text: empty };
  const figure = Number(text.replace(/[\s,٬]/g, ''));
  return Number.isFinite(figure) ? { text, ltr: true, sort: figure } : { text, ltr: true };
};

export const cellText = (text: string, sort?: string | number): TableCell => keyed({ text }, sort);
export const cellLtr = (text: string, sort?: string | number): TableCell =>
  keyed({ text, ltr: true }, sort);
export const cellWrap = (text: string, sort?: string | number): TableCell =>
  keyed({ text, wrap: true }, sort);
/** A yes/no that must be impossible to miss when it is a yes. */
export const cellFlag = (on: boolean, yes: string, no: string): TableCell =>
  on ? { text: yes, danger: true } : { text: no };
export const dash = '—';

/**
 * Day, date and time of one instant — and all three ordered BY that instant,
 * so sorting on any of them is chronological. Ordering «14/08/2026» as text
 * would put the 14th of August before the 2nd of September.
 */
export const stampCells = (at: Date): TableCell[] => {
  const instant = at.getTime();
  return [
    cellText(dayFormat.format(at), instant),
    cellLtr(dateFormat.format(at), instant),
    cellLtr(timeFormat.format(at), instant),
  ];
};

const esc = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The standalone sheet document — what the PDF printer and Excel both read. */
export function sheetHtml(title: string, period: string, model: TableModel): string {
  // The paper sheet is ruled by exactly the measurements the screen used, so
  // what the owner reviews on the screen is what comes out of the printer.
  const metrics = sheetMetrics(model, false);
  const colGroup = `<colgroup>${metrics.printShares
    .map((share) => `<col style="width:${share}">`)
    .join('')}</colgroup>`;
  const headRow = `<tr>${model.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const bodyRows = model.body
    .map(
      (row) =>
        `<tr class="${isTallRow(row) ? 'tall' : ''}">${row
          .map(
            (c) =>
              `<td class="${[
                c.ltr === true ? 'ltr' : '',
                c.wrap === true ? 'free' : '',
                c.danger === true ? 'danger' : '',
              ]
                .filter(Boolean)
                .join(' ')}">${esc(c.text)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  const footerCells = model.footer;
  const footerRow =
    footerCells === null
      ? ''
      : `<tfoot><tr>${footerCells
          .map((c, i) =>
            i === footerCells.length - 1
              ? `<td colspan="${String(model.head.length - footerCells.length + 1)}">${esc(c.text)}</td>`
              : `<td>${esc(c.text)}</td>`,
          )
          .join('')}</tr></tfoot>`;
  return (
    `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>` +
    `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `body{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;margin:0;color:#0f172a;` +
    `font-variant-numeric:lining-nums}` +
    `.head{text-align:center;border-bottom:2.5px solid #1e293b;padding-bottom:8px;margin-bottom:12px}` +
    `.site{color:#64748b;font-size:12px;margin:0 0 2px}` +
    `h1{font-size:19px;margin:0}` +
    `.period{font-size:12px;color:#475569;margin:4px 0 0}` +
    // A fixed layout divides the page evenly instead of letting one long
    // company name starve every other column, and the type is sized to the
    // widest row this particular sheet carries — a register of eighteen
    // columns cannot be read at the same size as one of six, and printing it
    // at that size is precisely what made the columns overlap.
    `table{width:100%;border-collapse:collapse;font-size:${metrics.printFont};` +
    `border:2px solid #334155;table-layout:fixed}` +
    `th,td{border:1px solid #94a3b8;padding:2.5px 4px;text-align:right;vertical-align:middle;` +
    `overflow-wrap:break-word;word-break:normal}` +
    `th{background:#e2e8f0;border-bottom:2px solid #334155;font-weight:700;line-height:1.35;` +
    `text-align:center}` +
    `tbody tr:nth-child(even) td{background:#f8fafc}` +
    `td.ltr{direction:ltr;white-space:nowrap}` +
    // Free text is the only thing allowed to grow tall, and it breaks
    // between words — never through the middle of one.
    `td.free{line-height:1.5}` +
    // مواد خطرة: the one colour on the sheet, and print-color-adjust above
    // makes sure the printer honours it instead of dropping it to grey. The
    // even-row stripe is overridden so it stays red down the whole column.
    `td.danger,tbody tr:nth-child(even) td.danger{background:#fee2e2;color:#b91c1c;font-weight:800}` +
    `tfoot td{border-top:2px solid #334155;font-weight:700;background:#e2e8f0}` +
    `thead{display:table-header-group}tfoot{display:table-footer-group}` +
    // A row is kept whole so the reader never loses the line they were on —
    // unless a note has been written at such length that the row is taller
    // than the page, in which case keeping it whole would push it off the
    // paper altogether.
    `tr{break-inside:avoid;page-break-inside:avoid}` +
    `tr.tall{break-inside:auto;page-break-inside:auto}` +
    `.printed{margin-top:8px;font-size:9px;color:#94a3b8;text-align:left;direction:ltr}` +
    `</style></head><body>` +
    `<div class="head"><p class="site">${esc(AR.appName)}</p><h1>${esc(title)}</h1>` +
    `<p class="period">${esc(period)}</p></div>` +
    `<table>${colGroup}<thead>${headRow}</thead><tbody>${bodyRows}</tbody>${footerRow}</table>` +
    `<p class="printed">${dateFormat.format(new Date())}</p>` +
    `</body></html>`
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const cellBase = 'border border-rule px-2 py-1.5 text-[13px] align-middle';
/**
 * Free text — a company's full name, a note about a dented door — breaks
 * BETWEEN words: the old `wrap-anywhere` told the browser that one letter
 * was a legal column width, so «شركة النورس للشحن والتفريغ» came out sawn
 * through the middle of a word.
 */
const cellFree = ' break-words leading-6';
/** Rows per screen page; 0 is «عرض الكل» — the whole register at once. */
const PAGE_SIZES = [20, 50, 80, 0] as const;

/** Inline custom properties: the sheet hands its measurements to the CSS. */
type StyleVars = CSSProperties & Record<`--${string}`, string>;

/**
 * A whole register screen: title row with the caller's tabs, a filter row
 * with the date range plus extras, print/PDF/Excel actions, and the sheet —
 * paginated on screen, complete on paper.
 */
export function SheetScreen(props: {
  screenTitle: string;
  sheetTitle: string;
  model: TableModel;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  tabs?: ReactNode;
  extraFilters?: ReactNode;
  emptyText?: string | undefined;
  /**
   * A snapshot register (what is standing right now) has no range to pick.
   * Give the line that stands in place of «من … إلى …» on the paper, and the
   * date inputs disappear.
   */
  rangeless?: string | undefined;
  /**
   * «عرض الكل» — the owner's ask: every register offers the whole record in
   * one press, no fiddling the pickers back to the beginning of time. While
   * it is on, the date inputs step aside and the paper says so in the period
   * line, because a sheet must always state what it covers.
   */
  allRange?: { on: boolean; toggle: () => void } | undefined;
  /** Screen-only per-row actions (undo buttons and the like); never printed. */
  actions?: { header: string; render: (rowIndex: number) => ReactNode } | undefined;
  onBack: () => void;
}): ReactElement {
  const { model } = props;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** Which heading the reader pressed, and which way. Null = the register's own order. */
  const [sort, setSort] = useState<SortState | null>(null);

  /**
   * The register as it is actually read — narrowed, ordered and renumbered by
   * `arrange`, which is pure and tested. Every consumer downstream (screen,
   * printer, PDF, Excel) is handed THIS, so what is on the paper is what was
   * on the screen.
   */
  const view = useMemo(() => arrange(model, query, sort), [model, query, sort]);
  const searching = view.searching;
  const sheet = useMemo(
    () => ({
      head: view.head,
      body: view.body,
      // The caller's footer counts the whole register, so while a search is on
      // it would be a lie; what stands in its place is the count of the search.
      footer: searching
        ? [cellText(AR.sheetSearchRow), cellText(AR.sheetSearchFound(view.body.length, view.total))]
        : model.footer,
    }),
    [view, searching, model.footer],
  );

  /**
   * One SheetScreen serves six registers with different columns, so an order
   * by column 12 means nothing after the reader switches to a register that
   * has six. Changing the register puts it back in its own order.
   */
  useEffect(() => {
    setSort(null);
  }, [props.sheetTitle]);

  // Page size 0 is «عرض الكل»: one page as long as the register itself.
  const rowsPerPage = pageSize === 0 ? Math.max(1, sheet.body.length) : pageSize;
  const pages = Math.max(1, Math.ceil(sheet.body.length / rowsPerPage));
  useEffect(() => {
    setPage(0);
  }, [props.sheetTitle, sheet.body.length, pageSize, sort]);
  const current = Math.min(page, pages - 1);

  const rangeText =
    props.rangeless ??
    (props.allRange?.on === true
      ? AR.rangeAll
      : `${AR.rangeFrom} ${props.from.split('-').reverse().join('/')} ${AR.rangeTo} ${props.to
          .split('-')
          .reverse()
          .join('/')}`);
  // A filtered or reordered sheet says so on its own face: paper that leaves
  // the office showing some of the register — or the register in an order
  // that is not its own — must never read as the plain thing.
  const periodText = [
    rangeText,
    searching ? `${AR.sheetSearchLabel} ${query.trim()}` : null,
    sort === null ? null : AR.sortedBy(sheet.head[sort.column] ?? '', sort.dir),
  ]
    .filter((part) => part !== null)
    .join(' — ');
  const hasRows = sheet.body.length > 0;

  const exportExcel = (): void => {
    const blob = new Blob(['﻿', sheetHtml(props.sheetTitle, periodText, sheet)], {
      type: 'application/vnd.ms-excel',
    });
    downloadBlob(blob, `${props.sheetTitle}.xls`);
  };

  /**
   * Rows off the current page are in the DOM but hidden, and un-hide for the
   * printer. Printing just this page means re-hiding them for the duration of
   * the print, which a class on the root does — and which must come off again
   * whether the dialog was used or cancelled.
   */
  const printSheet = (scope: 'all' | 'page'): void => {
    const root = document.documentElement;
    if (scope === 'page') root.classList.add('printing-page');
    try {
      window.print();
    } finally {
      root.classList.remove('printing-page');
    }
  };

  const exportPdf = (): void => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setError(null);
    api
      .reportPdf(props.sheetTitle, sheetHtml(props.sheetTitle, periodText, sheet), true)
      .then((blob) => {
        downloadBlob(blob, `${props.sheetTitle}.pdf`);
        setPdfBusy(false);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setPdfBusy(false);
      });
  };

  const footer = sheet.footer;
  const metrics = sheetMetrics(sheet, props.actions !== undefined);
  const sheetStyle: StyleVars = { '--sheet-font': metrics.printFont };

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {/* Registers print sideways: the sheets are wide. */}
      <style>{'@media print { @page { size: A4 landscape; margin: 9mm; } }'}</style>

      <header className="print-hidden z-10 space-y-2.5 border-b border-line bg-surface px-3 py-2.5 shadow-sm lg:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-extrabold text-ink">{props.screenTitle}</h1>
          {props.tabs}
          <div className="ms-auto flex items-center gap-2">
            <ThemePicker />
            <Button kind="quiet" onClick={props.onBack}>
              {AR.backToMap}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {props.rangeless === undefined ? (
            <>
              {props.allRange?.on !== true && (
                <>
                  <label className="flex items-center gap-1.5 text-sm">
                    <span className="font-semibold text-muted">{AR.rangeFrom}</span>
                    <input
                      type="date"
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
                      value={props.from}
                      onChange={(event) => {
                        props.onFrom(event.target.value);
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <span className="font-semibold text-muted">{AR.rangeTo}</span>
                    <input
                      type="date"
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
                      value={props.to}
                      onChange={(event) => {
                        props.onTo(event.target.value);
                      }}
                    />
                  </label>
                </>
              )}
              {props.allRange !== undefined && (
                <button
                  type="button"
                  onClick={props.allRange.toggle}
                  className={
                    'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ' +
                    (props.allRange.on
                      ? 'bg-blue-700 text-white hover:bg-blue-800'
                      : 'bg-sunken text-muted hover:bg-line')
                  }
                >
                  {AR.showAll}
                </button>
              )}
            </>
          ) : (
            <span className="text-sm font-semibold text-muted">{props.rangeless}</span>
          )}
          {props.extraFilters}
          {/* Every register, one box, every column. It reads what the sheet
              itself says — so a date, a plate, a bill, a slot, a note or the
              employee's own name all answer, without a filter per column. */}
          <div className="flex min-w-56 flex-1 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1 sm:flex-none">
            <input
              type="search"
              className="min-w-0 flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-faint"
              placeholder={AR.sheetSearch}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            {searching && (
              <>
                <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-xs font-bold text-muted">
                  {AR.sheetSearchFound(sheet.body.length, view.total)}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-sm font-bold text-faint hover:text-ink"
                  title={AR.clearSearch}
                  onClick={() => {
                    setQuery('');
                  }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold text-muted">{AR.perPage}</span>
            <select
              className="rounded-lg border border-line-strong px-2 py-1.5 text-sm"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size === 0 ? AR.perPageAll : size}
                </option>
              ))}
            </select>
          </label>
          <div className="ms-auto flex items-center gap-1.5">
            {/* Every row is in the DOM, so the printer can have the whole
                register regardless of the page shown — but nothing on screen
                said so. Now it is a choice, and the whole register is the
                one that reads as the default. */}
            <Button
              onClick={() => {
                printSheet('all');
              }}
              disabled={!hasRows}
            >
              {AR.printAll}
            </Button>
            {pages > 1 && (
              <Button
                kind="quiet"
                onClick={() => {
                  printSheet('page');
                }}
                disabled={!hasRows}
              >
                {AR.printPage}
              </Button>
            )}
            <Button kind="quiet" onClick={exportPdf} disabled={!hasRows || pdfBusy}>
              {pdfBusy ? AR.pdfWorking : AR.exportPdf}
            </Button>
            <Button kind="quiet" onClick={exportExcel} disabled={!hasRows}>
              {AR.exportExcel}
            </Button>
          </div>
        </div>
        {error !== null && <p className="text-xs font-semibold text-red-600">{error}</p>}
      </header>

      <main className="flex-1 overflow-auto p-4 lg:p-6">
        <div
          className={`print-area report-sheet mx-auto max-w-[1700px] rounded-2xl bg-surface p-5 shadow-sm lg:p-8${
            metrics.tight ? ' sheet-tight' : ''
          }`}
          style={sheetStyle}
        >
          <div className="mb-5 border-b-2 border-rule-strong pb-3 text-center">
            <p className="text-sm font-semibold text-muted">{AR.appName}</p>
            <h2 className="text-xl font-extrabold text-ink">{props.sheetTitle}</h2>
            <p className="mt-1 text-sm text-muted">{periodText}</p>
          </div>

          {!hasRows ? (
            <p className="py-12 text-center text-sm text-faint">
              {searching ? AR.sheetSearchEmpty : (props.emptyText ?? AR.reportEmpty)}
            </p>
          ) : (
            <>
              {/* On screen a wide register keeps its columns readable and
                  scrolls sideways if it must — the floor is what this sheet's
                  own columns need at screen type, so nothing overlaps here
                  either. On paper the page decides the width and every column
                  comes back in. Print gets every row; the screen pages. */}
              <div className="sheet-scroll overflow-x-auto">
              <table
                className="w-full table-fixed border-collapse border-2 border-rule-strong"
                style={{ minWidth: `${String(metrics.minWidth)}px` }}
              >
                <colgroup>
                  {metrics.shares.map((share, index) => {
                    const colStyle: StyleVars = {
                      width: share,
                      '--print-w': metrics.printShares[index] ?? share,
                    };
                    return <col key={index} style={colStyle} />;
                  })}
                </colgroup>
                <thead>
                  <tr>
                    {/* Every heading orders the register by its own column —
                        press once for تصاعدي, again for تنازلي, a third time
                        to put the register back in its own order. The caret
                        is screen-only: it would be noise on the paper. */}
                    {sheet.head.map((heading, column) => {
                      const active = sort !== null && sort.column === column;
                      // The line counter is not a column to order by: it is
                      // rewritten to 1 … N over whatever the sheet shows, so
                      // ordering it could only ever be the register's own
                      // order, or that order reversed under a column still
                      // reading 1, 2, 3. It stays a plain heading.
                      const orderable = column > 0 || model.counted !== true;
                      const headClass = `${cellBase} border-b-2 border-b-rule-strong bg-sunken text-center font-bold text-ink`;
                      if (!orderable) {
                        return (
                          <th key={heading} className={headClass}>
                            {heading}
                          </th>
                        );
                      }
                      return (
                        <th
                          key={heading}
                          aria-sort={
                            active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                          }
                          // The button carries the padding on screen, so the
                          // cell gives its own up — and `p-0` alone would not
                          // do it: cellBase's px/py are longhand and win.
                          className={`${headClass} px-0! py-0!`}
                        >
                          <button
                            type="button"
                            // What the NEXT press will do — all three of them.
                            title={
                              !active ? AR.sortAsc : sort.dir === 'asc' ? AR.sortDesc : AR.sortClear
                            }
                            onClick={() => {
                              setSort(nextSort(sort, column));
                            }}
                            className={`flex w-full items-center justify-center gap-1 px-2 py-1.5 text-center transition-colors hover:bg-line${
                              active ? ' text-blue-800 dark:text-blue-300' : ''
                            }`}
                          >
                            <span>{heading}</span>
                            <span className="print-hidden text-[10px] leading-none opacity-70">
                              {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                    {props.actions !== undefined && (
                      <th
                        className={`${cellBase} print-hidden border-b-2 border-b-rule-strong bg-sunken text-center font-bold text-ink`}
                      >
                        {props.actions.header}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* Every row is in the DOM: the screen shows one page, the
                      printer un-hides the rest. */}
                  {sheet.body.map((row, rowIndex) => {
                    const onPage =
                      rowIndex >= current * rowsPerPage && rowIndex < (current + 1) * rowsPerPage;
                    return (
                      <tr
                        key={rowIndex}
                        className={
                          (onPage ? '' : 'row-off hidden print:table-row ') +
                          (isTallRow(row) ? 'row-tall ' : '') +
                          'odd:bg-surface even:bg-sunken'
                        }
                      >
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={
                              cellBase +
                              (cell.ltr === true ? ' whitespace-nowrap' : '') +
                              (cell.wrap === true ? cellFree : '') +
                              (cell.onClick !== undefined
                                ? ' cursor-pointer font-semibold text-blue-700 underline decoration-dotted hover:text-blue-900'
                                : '') +
                              (cell.danger === true
                                ? ' bg-danger-soft font-extrabold text-danger'
                                : '')
                            }
                            dir={cell.ltr === true ? 'ltr' : undefined}
                            onClick={cell.onClick}
                          >
                            {cell.text}
                          </td>
                        ))}
                        {props.actions !== undefined && (
                          <td className={`${cellBase} print-hidden overflow-hidden text-center`}>
                            {props.actions.render(view.seats?.[rowIndex] ?? rowIndex)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {footer !== null && (
                  <tfoot>
                    <tr className="bg-sunken">
                      {footer.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          colSpan={
                            cellIndex === footer.length - 1
                              ? sheet.head.length - footer.length + 1
                              : 1
                          }
                          className={`${cellBase} border-t-2 border-t-rule-strong font-bold text-ink`}
                        >
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
              </div>

              {pages > 1 && (
                <div className="print-hidden mt-3 flex items-center justify-center gap-2">
                  <Button
                    kind="quiet"
                    disabled={current === 0}
                    onClick={() => {
                      setPage(current - 1);
                    }}
                  >
                    {AR.pagePrev}
                  </Button>
                  <span className="text-sm font-semibold text-muted">
                    {AR.pageOf(current + 1, pages)}
                  </span>
                  <Button
                    kind="quiet"
                    disabled={current >= pages - 1}
                    onClick={() => {
                      setPage(current + 1);
                    }}
                  >
                    {AR.pageNext}
                  </Button>
                </div>
              )}
            </>
          )}

          <p className="mt-4 text-end text-xs text-faint">
            {AR.printedAt} <span dir="ltr">{dateFormat.format(new Date())}</span>
          </p>
        </div>
      </main>
    </div>
  );
}
