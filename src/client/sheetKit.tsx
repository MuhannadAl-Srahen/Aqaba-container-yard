import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { AR } from './ar';
import { ApiFailure, api } from './api';
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
export const timeFormat = new Intl.DateTimeFormat('en-GB', {
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

/** One cell: its text and whether it reads left-to-right (numbers, plates). */
export interface TableCell {
  readonly text: string;
  readonly ltr?: boolean;
}

export interface TableModel {
  readonly head: readonly string[];
  readonly body: readonly (readonly TableCell[])[];
  readonly footer: readonly TableCell[] | null;
}

export const cellText = (text: string): TableCell => ({ text });
export const cellLtr = (text: string): TableCell => ({ text, ltr: true });
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
  const headRow = `<tr>${model.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const bodyRows = model.body
    .map(
      (row) =>
        `<tr>${row
          .map((c) => `<td${c.ltr === true ? ' class="ltr"' : ''}>${esc(c.text)}</td>`)
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
    `body{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;margin:0;color:#0f172a}` +
    `.head{text-align:center;border-bottom:2.5px solid #1e293b;padding-bottom:8px;margin-bottom:14px}` +
    `.site{color:#64748b;font-size:12px;margin:0 0 2px}` +
    `h1{font-size:19px;margin:0}` +
    `.period{font-size:12px;color:#475569;margin:4px 0 0}` +
    `table{width:100%;border-collapse:collapse;font-size:10.5px;border:2px solid #334155}` +
    `th,td{border:1px solid #94a3b8;padding:3.5px 6px;text-align:right}` +
    `th{background:#e2e8f0;border-bottom:2px solid #334155;font-weight:700;white-space:nowrap}` +
    `tbody tr:nth-child(even) td{background:#f8fafc}` +
    `td.ltr{direction:ltr;white-space:nowrap}` +
    `tfoot td{border-top:2px solid #334155;font-weight:700;background:#e2e8f0}` +
    `thead{display:table-header-group}tr{break-inside:avoid}` +
    `.printed{margin-top:10px;font-size:9.5px;color:#94a3b8;text-align:left;direction:ltr}` +
    `</style></head><body>` +
    `<div class="head"><p class="site">${esc(AR.appName)}</p><h1>${esc(title)}</h1>` +
    `<p class="period">${esc(period)}</p></div>` +
    `<table><thead>${headRow}</thead><tbody>${bodyRows}</tbody>${footerRow}</table>` +
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

const cellBase = 'border border-slate-300 px-2.5 py-1.5 text-sm';
const PAGE_SIZE = 15;

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
  onBack: () => void;
}): ReactElement {
  const { model } = props;
  const [page, setPage] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = Math.max(1, Math.ceil(model.body.length / PAGE_SIZE));
  useEffect(() => {
    setPage(0);
  }, [props.sheetTitle, model.body.length]);
  const current = Math.min(page, pages - 1);

  const periodText = `${AR.rangeFrom} ${props.from.split('-').reverse().join('/')} ${AR.rangeTo} ${props.to
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

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      {/* Registers print sideways: the sheets are wide. */}
      <style>{'@media print { @page { size: A4 landscape; margin: 9mm; } }'}</style>

      <header className="print-hidden z-10 space-y-2.5 border-b border-slate-200 bg-white px-3 py-2.5 shadow-sm lg:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-extrabold text-slate-900">{props.screenTitle}</h1>
          {props.tabs}
          <div className="ms-auto">
            <Button kind="quiet" onClick={props.onBack}>
              {AR.backToMap}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold text-slate-600">{AR.rangeFrom}</span>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              value={props.from}
              onChange={(event) => {
                props.onFrom(event.target.value);
              }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold text-slate-600">{AR.rangeTo}</span>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              value={props.to}
              onChange={(event) => {
                props.onTo(event.target.value);
              }}
            />
          </label>
          {props.extraFilters}
          <div className="ms-auto flex items-center gap-1.5">
            <Button
              onClick={() => {
                window.print();
              }}
              disabled={!hasRows}
            >
              {AR.print}
            </Button>
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
        <div className="print-area report-sheet mx-auto max-w-6xl rounded-2xl bg-white p-5 shadow-sm lg:p-8">
          <div className="mb-5 border-b-2 border-slate-800 pb-3 text-center">
            <p className="text-sm font-semibold text-slate-500">{AR.appName}</p>
            <h2 className="text-xl font-extrabold text-slate-900">{props.sheetTitle}</h2>
            <p className="mt-1 text-sm text-slate-600">{periodText}</p>
          </div>

          {!hasRows ? (
            <p className="py-12 text-center text-sm text-slate-400">
              {props.emptyText ?? AR.reportEmpty}
            </p>
          ) : (
            <>
              {/* The whole width always fits: cells wrap instead of the sheet
                  scrolling sideways. Print gets every row; the screen pages. */}
              <table className="w-full border-collapse border-2 border-slate-700">
                <thead>
                  <tr>
                    {model.head.map((heading) => (
                      <th
                        key={heading}
                        className={`${cellBase} border-b-2 border-b-slate-700 bg-slate-100 font-bold`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Every row is in the DOM: the screen shows one page, the
                      printer un-hides the rest. */}
                  {model.body.map((row, rowIndex) => {
                    const onPage =
                      rowIndex >= current * PAGE_SIZE && rowIndex < (current + 1) * PAGE_SIZE;
                    return (
                      <tr
                        key={rowIndex}
                        className={
                          (onPage ? '' : 'hidden print:table-row ') + 'odd:bg-white even:bg-slate-50'
                        }
                      >
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className={`${cellBase}${cell.ltr === true ? ' whitespace-nowrap' : ' wrap-anywhere'}`}
                            dir={cell.ltr === true ? 'ltr' : undefined}
                          >
                            {cell.text}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                {footer !== null && (
                  <tfoot>
                    <tr className="bg-slate-100">
                      {footer.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          colSpan={
                            cellIndex === footer.length - 1
                              ? model.head.length - footer.length + 1
                              : 1
                          }
                          className={`${cellBase} border-t-2 border-t-slate-700 font-bold`}
                        >
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>

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
                  <span className="text-sm font-semibold text-slate-600">
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

          <p className="mt-4 text-end text-xs text-slate-400">
            {AR.printedAt} <span dir="ltr">{dateFormat.format(new Date())}</span>
          </p>
        </div>
      </main>
    </div>
  );
}
