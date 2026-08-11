import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { isTallRow, sheetMetrics } from './sheetGeometry';
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
}

export interface TableModel {
  readonly head: readonly string[];
  readonly body: readonly (readonly TableCell[])[];
  readonly footer: readonly TableCell[] | null;
}

export const cellText = (text: string): TableCell => ({ text });
export const cellLtr = (text: string): TableCell => ({ text, ltr: true });
export const cellWrap = (text: string): TableCell => ({ text, wrap: true });
/** A yes/no that must be impossible to miss when it is a yes. */
export const cellFlag = (on: boolean, yes: string, no: string): TableCell =>
  on ? { text: yes, danger: true } : { text: no };
export const dash = '—';

export const stampCells = (at: Date): TableCell[] => [
  cellText(dayFormat.format(at)),
  cellLtr(dateFormat.format(at)),
  cellLtr(timeFormat.format(at)),
];

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
const PAGE_SIZES = [20, 50, 80] as const;

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
  /** Screen-only per-row actions (undo buttons and the like); never printed. */
  actions?: { header: string; render: (rowIndex: number) => ReactNode } | undefined;
  onBack: () => void;
}): ReactElement {
  const { model } = props;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = Math.max(1, Math.ceil(model.body.length / pageSize));
  useEffect(() => {
    setPage(0);
  }, [props.sheetTitle, model.body.length, pageSize]);
  const current = Math.min(page, pages - 1);

  const periodText =
    props.rangeless ??
    `${AR.rangeFrom} ${props.from.split('-').reverse().join('/')} ${AR.rangeTo} ${props.to
      .split('-')
      .reverse()
      .join('/')}`;
  const hasRows = model.body.length > 0;

  const exportExcel = (): void => {
    const blob = new Blob(['﻿', sheetHtml(props.sheetTitle, periodText, model)], {
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
      .reportPdf(props.sheetTitle, sheetHtml(props.sheetTitle, periodText, model), true)
      .then((blob) => {
        downloadBlob(blob, `${props.sheetTitle}.pdf`);
        setPdfBusy(false);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setPdfBusy(false);
      });
  };

  const footer = model.footer;
  const metrics = sheetMetrics(model, props.actions !== undefined);
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
          ) : (
            <span className="text-sm font-semibold text-muted">{props.rangeless}</span>
          )}
          {props.extraFilters}
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
                  {size}
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
              {props.emptyText ?? AR.reportEmpty}
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
                    {model.head.map((heading) => (
                      <th
                        key={heading}
                        className={`${cellBase} border-b-2 border-b-rule-strong bg-sunken text-center font-bold text-ink`}
                      >
                        {heading}
                      </th>
                    ))}
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
                  {model.body.map((row, rowIndex) => {
                    const onPage =
                      rowIndex >= current * pageSize && rowIndex < (current + 1) * pageSize;
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
                            {props.actions.render(rowIndex)}
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
                              ? model.head.length - footer.length + 1
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
