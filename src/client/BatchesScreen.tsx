import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BatchDto, BatchRowDto, BatchSummaryDto, Size } from '../shared/types';
import { totalsOf, warningsOf } from '../shared/customsSheet';
import { ltrCode } from '../shared/bidi';
import { ApiFailure, api, formatDate } from './api';
import { AR } from './ar';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, ErrorLine, Field, Toast, inputClass } from './ui';

/**
 * دفعات كشف الجمارك: the sheet the directorate sends, uploaded as it came,
 * read literally, reviewed against its own totals, and kept as a live
 * registry — every row's وصل/باقٍ computed off the yard book itself. The
 * «تسجيل دخولها» button on a waiting row does NOT open a form: it arms a
 * draft and returns to the map, because the map is the application — the
 * clerk taps the bay and picks the slot as always, and the gate-in sheet
 * opens already carrying the number and the bill.
 */

/** What a waiting row hands the map when the clerk sets out to receive it. */
export interface BatchDraft {
  readonly number: string;
  readonly size: Size | null;
  readonly sizeRaw: string;
  readonly bill: string;
  readonly batchName: string;
}

/** Preview rows arrive without ids; give them the row shape the table eats. */
const toReviewRow = (
  row: { seq: number | null; number: string; size: Size | null; sizeRaw: string; bill: string; lineOp: string },
  index: number,
): BatchRowDto => ({
  id: index,
  seq: row.seq,
  number: row.number,
  size: row.size,
  sizeRaw: row.sizeRaw,
  bill: row.bill,
  lineOp: row.lineOp,
  status: 'PENDING',
  containerId: null,
  enteredAt: null,
  exitedAt: null,
});

const statusChip = (row: BatchRowDto): ReactElement => {
  const cls =
    row.status === 'STANDING'
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
      : row.status === 'EXITED'
        ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  return (
    <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold ${cls}`}>
      {AR.batchStatusName[row.status]}
    </span>
  );
};

/** The rows table — the review before approval and the stored registry alike. */
function RowsTable(props: {
  rows: readonly BatchRowDto[];
  showStatus: boolean;
  canReceive: boolean;
  onReceive?: (row: BatchRowDto) => void;
}): ReactElement {
  const warnings = warningsOf(props.rows);
  const hasSeq = props.rows.some((row) => row.seq !== null);
  const hasLineOp = props.rows.some((row) => row.lineOp !== '');
  const headCell = 'border-b-2 border-line-strong px-2 py-1.5 text-start text-xs font-extrabold text-muted';
  const cell = 'border-b border-line px-2 py-1.5 text-sm';
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-140 border-collapse">
        <thead>
          <tr>
            {hasSeq && <th className={headCell}>{AR.colSheetSeq}</th>}
            <th className={headCell}>{AR.colNumber}</th>
            <th className={headCell}>{AR.colSize}</th>
            <th className={headCell}>{AR.colBill}</th>
            {hasLineOp && <th className={headCell}>{AR.colLineOp}</th>}
            {props.showStatus && <th className={headCell}>{AR.colBatchStatus}</th>}
            {props.canReceive && <th className={headCell}></th>}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => {
            const warned = warnings[index] ?? [];
            const stripe = warned.length > 0 ? 'bg-amber-50 dark:bg-amber-950/40' : '';
            return (
              <tr key={row.id} className={stripe}>
                {hasSeq && <td className={`${cell} text-faint`}>{row.seq ?? ''}</td>}
                <td className={`${cell} font-mono font-semibold tracking-wide`} dir="ltr">
                  {row.number}
                  {warned.length > 0 && (
                    <div dir="rtl" className="mt-0.5 space-y-0.5 font-sans text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {warned.map((code) => (
                        <p key={code}>{AR.sheetWarningName[code]}</p>
                      ))}
                    </div>
                  )}
                </td>
                <td className={cell} dir="ltr">
                  {row.size ?? (
                    <span className="font-bold text-amber-600">{row.sizeRaw || '—'}</span>
                  )}
                </td>
                <td className={`${cell} font-mono`} dir="ltr">
                  {row.bill || '—'}
                </td>
                {hasLineOp && (
                  <td className={cell} dir="ltr">
                    {row.lineOp}
                  </td>
                )}
                {props.showStatus && (
                  <td className={cell}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {statusChip(row)}
                      {row.status === 'STANDING' && row.enteredAt !== null && (
                        <span className="text-xs text-faint" dir="ltr">
                          {formatDate(row.enteredAt)}
                        </span>
                      )}
                      {row.status === 'EXITED' && row.exitedAt !== null && (
                        <span className="text-xs text-faint" dir="ltr">
                          {formatDate(row.exitedAt)}
                        </span>
                      )}
                    </div>
                  </td>
                )}
                {props.canReceive && (
                  <td className={`${cell} text-end`}>
                    {row.status === 'PENDING' && (
                      <Button
                        kind="quiet"
                        onClick={() => {
                          props.onReceive?.(row);
                        }}
                      >
                        {AR.batchReceiveRow}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const totalsLine = (rows: readonly BatchRowDto[]): string => {
  const totals = totalsOf(rows);
  return AR.batchTotalsLine(totals.rows, totals.of20, totals.of40, totals.other, totals.bills);
};

export function BatchesScreen(props: {
  /** Upload and receive: the owner or a GATE_IN hand. */
  canUpload: boolean;
  /** Striking a دفعة from the registry is the owner's alone. */
  isOwner: boolean;
  onBack: () => void;
  onReceive: (draft: BatchDraft) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const [review, setReview] = useState<{ file: File; name: string; rows: readonly BatchRowDto[] } | null>(null);
  const [confirming, setConfirming] = useState<'approve' | null>(null);
  /**
   * الدفعة المرشحة للحذف — تُسمّى صراحةً لأن الحذف صار يُطلب من مكانين:
   * من داخل الدفعة المفتوحة، ومن سطرها في القائمة مباشرة كما يُحذف
   * التصريح من كشفه.
   */
  const [striking, setStriking] = useState<{ id: number; name: string } | null>(null);
  /** مسودة الاسم أثناء تعديله — null يعني أن الاسم يُقرأ لا يُكتب. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filePicker = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const list = useQuery({
    queryKey: ['batches'],
    queryFn: api.batches,
    refetchInterval: 30_000,
  });
  const open = useQuery({
    queryKey: ['batch', openId ?? 0],
    queryFn: () => api.batch(openId ?? 0),
    enabled: openId !== null,
    refetchInterval: 15_000,
  });

  const fail = (failure: unknown): void => {
    setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
  };

  const pick = (files: FileList | null): void => {
    const file = files?.[0];
    if (file === undefined) return;
    setBusy(true);
    setError(null);
    api
      .previewBatch(file)
      .then((previewed) => {
        setReview({
          file,
          name: file.name.replace(/\.[^.]+$/, ''),
          rows: previewed.rows.map(toReviewRow),
        });
      })
      .catch(fail)
      .finally(() => {
        setBusy(false);
      });
  };

  const approve = (): void => {
    if (review === null) return;
    setBusy(true);
    setError(null);
    api
      .createBatch(review.file, review.name.trim())
      .then((batch) => {
        setToast(AR.batchApproved(batch.name));
        setReview(null);
        setOpenId(batch.id);
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
        void queryClient.invalidateQueries({ queryKey: ['batch-lookup'] });
      })
      .catch(fail)
      .finally(() => {
        setBusy(false);
        setConfirming(null);
      });
  };

  const rename = (id: number): void => {
    if (renaming === null || renaming.trim() === '') return;
    setBusy(true);
    api
      .renameBatch(id, renaming.trim())
      .then(() => {
        setToast(AR.batchRenamed);
        setRenaming(null);
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
        void queryClient.invalidateQueries({ queryKey: ['batch', id] });
      })
      .catch(fail)
      .finally(() => {
        setBusy(false);
      });
  };

  const strike = (): void => {
    if (striking === null) return;
    const id = striking.id;
    setBusy(true);
    api
      .removeBatch(id)
      .then(() => {
        setToast(AR.batchDeleted);
        // Close the detail only if it is the struck batch on screen.
        if (openId === id) setOpenId(null);
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
        void queryClient.invalidateQueries({ queryKey: ['batch-lookup'] });
      })
      .catch(fail)
      .finally(() => {
        setBusy(false);
        setStriking(null);
      });
  };

  const batches = list.data?.batches ?? [];
  const detail: BatchDto | null = openId === null ? null : (open.data ?? null);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <h1 className="text-lg font-extrabold text-ink">{AR.batchesTitle}</h1>
        {review === null && detail === null && (
          <span className="text-xs font-bold text-muted">{String(batches.length)}</span>
        )}
        <div className="ms-auto flex items-center gap-1.5">
          <ThemePicker />
          <Button kind="quiet" onClick={props.onBack}>
            {AR.backToMap}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 p-4">
        {/* ── the review: what the sheet says, before it is believed ── */}
        {review !== null && (
          <>
            <h2 className="text-sm font-extrabold text-muted">{AR.batchReviewTitle}</h2>
            <p className="text-sm leading-6 text-muted">{AR.batchReviewHint}</p>
            <Field label={AR.batchName}>
              <input
                className={inputClass}
                maxLength={80}
                value={review.name}
                onChange={(event) => {
                  setReview({ ...review, name: event.target.value });
                }}
              />
            </Field>
            <p className="rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-100">
              {totalsLine(review.rows)}
            </p>
            <RowsTable rows={review.rows} showStatus={false} canReceive={false} />
            <ErrorLine message={error} />
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setConfirming('approve');
                }}
                disabled={busy || review.name.trim() === ''}
              >
                {AR.batchApprove}
              </Button>
              <Button
                kind="quiet"
                onClick={() => {
                  setReview(null);
                  setError(null);
                }}
              >
                {AR.cancel}
              </Button>
            </div>
          </>
        )}

        {/* ── one دفعة, its rows against the yard book ── */}
        {review === null && detail !== null && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {/* الاسم يُقرأ، وبضغطة يُكتب — «بدي القدرة على تعديل اسم الكشف». */}
              {renaming === null ? (
                <h2 className="text-base font-extrabold text-ink">{detail.name}</h2>
              ) : (
                <input
                  className={`${inputClass} max-w-xs`}
                  maxLength={80}
                  value={renaming}
                  autoFocus
                  onChange={(event) => {
                    setRenaming(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') rename(detail.id);
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                />
              )}
              <span className="text-xs text-faint" dir="ltr">
                {formatDate(detail.createdAt)}
              </span>
              <span className="text-xs font-semibold text-muted">
                {AR.batchCreatedBy(detail.createdBy)}
              </span>
              <div className="ms-auto flex items-center gap-1.5">
                {props.canUpload &&
                  (renaming === null ? (
                    <Button
                      kind="quiet"
                      onClick={() => {
                        setRenaming(detail.name);
                      }}
                      disabled={busy}
                    >
                      {AR.batchRenameAction}
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => {
                          rename(detail.id);
                        }}
                        disabled={busy || renaming.trim() === ''}
                      >
                        {AR.save}
                      </Button>
                      <Button
                        kind="quiet"
                        onClick={() => {
                          setRenaming(null);
                        }}
                      >
                        {AR.cancel}
                      </Button>
                    </>
                  ))}
                {props.isOwner && (
                  <Button
                    kind="danger"
                    onClick={() => {
                      setStriking({ id: detail.id, name: detail.name });
                    }}
                    disabled={busy}
                  >
                    {AR.batchDeleteAction}
                  </Button>
                )}
                <Button
                  kind="quiet"
                  onClick={() => {
                    setRenaming(null);
                    setOpenId(null);
                  }}
                >
                  {AR.close}
                </Button>
              </div>
            </div>
            <p className="rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-100">
              {totalsLine(detail.rows)}
              {' — '}
              {AR.batchArrivedOf(
                detail.rows.filter((row) => row.status !== 'PENDING').length,
                detail.rows.length,
              )}
            </p>
            <RowsTable
              rows={detail.rows}
              showStatus
              canReceive={props.canUpload}
              onReceive={(row) => {
                props.onReceive({
                  number: row.number,
                  size: row.size,
                  sizeRaw: row.sizeRaw,
                  bill: row.bill,
                  batchName: detail.name,
                });
              }}
            />
            <ErrorLine message={error} />
          </>
        )}

        {/* ── the registry ── */}
        {review === null && detail === null && (
          <>
            {props.canUpload && (
              <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => {
                      filePicker.current?.click();
                    }}
                    disabled={busy}
                  >
                    {AR.batchUpload}
                  </Button>
                  <span className="text-xs font-semibold text-faint">{AR.batchPickHint}</span>
                </div>
                <input
                  ref={filePicker}
                  type="file"
                  accept=".xlsx,.docx,.csv,.txt"
                  className="hidden"
                  onChange={(event) => {
                    pick(event.target.files);
                    event.target.value = '';
                  }}
                />
                <p className="mt-2 text-xs leading-6 text-muted">{AR.batchesHint}</p>
              </div>
            )}
            <ErrorLine message={error} />
            {batches.length === 0 && (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-faint">
                {AR.batchesEmpty}
              </p>
            )}
            {batches.map((batch: BatchSummaryDto) => {
              const complete = batch.total > 0 && batch.arrived === batch.total;
              return (
                <div
                  key={batch.id}
                  className="flex items-start gap-2 rounded-2xl border border-line bg-surface p-4 shadow-sm transition focus-within:border-blue-400 hover:border-blue-400"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(null);
                      setOpenId(batch.id);
                    }}
                    className="min-w-0 flex-1 text-start"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-extrabold text-ink">{batch.name}</span>
                      <span
                        className={
                          'rounded-lg px-2 py-0.5 text-xs font-extrabold ' +
                          (complete
                            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')
                        }
                      >
                        {complete ? AR.batchDone : AR.batchArrivedOf(batch.arrived, batch.total)}
                      </span>
                      <span className="ms-auto text-xs text-faint" dir="ltr">
                        {formatDate(batch.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-muted">
                      {AR.batchCreatedBy(batch.createdBy)}
                      {batch.filename !== '' && (
                        <span className="text-faint">
                          {' · '}
                          <span dir="ltr">{ltrCode(batch.filename)}</span>
                        </span>
                      )}
                    </p>
                  </button>
                  {/* حذف الكشف من سطره — بلا فتحه، كما يُحذف التصريح من كشفه. */}
                  {props.isOwner && (
                    <Button
                      kind="danger"
                      onClick={() => {
                        setStriking({ id: batch.id, name: batch.name });
                      }}
                      disabled={busy}
                    >
                      {AR.batchDeleteAction}
                    </Button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </main>

      {confirming === 'approve' && review !== null && (
        <Confirm
          title={AR.batchApprove}
          body={AR.batchApproveBody(review.name.trim(), review.rows.length)}
          confirmLabel={AR.batchApprove}
          busy={busy}
          onConfirm={approve}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
      {striking !== null && (
        <Confirm
          title={AR.confirmBatchDeleteTitle}
          body={AR.confirmBatchDeleteBody(striking.name)}
          confirmLabel={AR.batchDeleteAction}
          danger
          busy={busy}
          onConfirm={strike}
          onCancel={() => {
            setStriking(null);
          }}
        />
      )}
      {toast !== null && <Toast message={toast} />}
    </div>
  );
}
