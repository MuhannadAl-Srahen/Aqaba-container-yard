import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverHaulRow } from '../shared/types';
import { cardSerial } from '../shared/types';
import { ApiFailure, api, formatDateOnly } from './api';
import { ammanToday, monthStart, rangeInstants } from './sheetKit';
import { AR } from './ar';
import { Button, Confirm, Field, Toast, inputClass, useEscape } from './ui';

/**
 * محاسبة السائقين — «يكتب يدوياً … نكتفي بالرقم». Every gate movement with a
 * named driver is one payable haul: the container's IN is one and its OUT is
 * another, even for the same truck the same day — «قد يكون حملت هذه السيارة
 * اكثر من مره». The figure is written by hand per haul, no currency on
 * purpose, and the receipt is confirmed per haul — stamped with who
 * confirmed it and when.
 */

const key = (row: DriverHaulRow): string => `${String(row.containerId)}|${row.direction}`;

interface DriverGroup {
  readonly driver: string;
  readonly rows: DriverHaulRow[];
  readonly total: number;
  readonly paid: number;
}

export function DriversScreen(props: { onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(ammanToday());
  /** «بدي القدرة البحث عن اسم السايق او رقم سيارته». */
  const [term, setTerm] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState<DriverHaulRow | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const valid = from !== '' && to !== '' && from <= to;
  const { fromIso, toIso } = useMemo(() => rangeInstants(from, to), [from, to]);
  const hauls = useQuery({
    queryKey: ['drivers', fromIso, toIso],
    queryFn: () => api.drivers(fromIso, toIso),
    enabled: valid,
  });
  const rows = useMemo(() => hauls.data?.rows ?? [], [hauls.data]);

  const groups = useMemo((): DriverGroup[] => {
    const map = new Map<string, DriverHaulRow[]>();
    for (const row of rows) {
      const list = map.get(row.driver);
      if (list === undefined) map.set(row.driver, [row]);
      else list.push(row);
    }
    return [...map.entries()].map(([driver, list]) => ({
      driver,
      rows: list,
      total: list.reduce((sum, row) => sum + (row.amount ?? 0), 0),
      paid: list.reduce((sum, row) => sum + (row.paidAt !== null ? (row.amount ?? 0) : 0), 0),
    }));
  }, [rows]);

  // Digits fold to one alphabet so «٦٠» finds the plate typed 60.
  const fold = (text: string): string =>
    text
      .toLowerCase()
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .trim();
  const needle = fold(term);
  // The driver keeps his WHOLE statement when found through one of his
  // trucks — the point of the search is settling with him, not one row.
  const shown =
    needle === ''
      ? groups
      : groups.filter(
          (group) =>
            fold(group.driver).includes(needle) ||
            group.rows.some((row) => fold(row.truck).includes(needle)),
        );

  const refetch = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['drivers'] });
  };

  const fail = (failure: unknown): void => {
    setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
    setBusy(false);
  };

  /** Save one haul's figure the moment the clerk leaves the field. */
  const saveWage = (row: DriverHaulRow): void => {
    const draft = drafts[key(row)];
    if (draft === undefined) return;
    const amount = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(amount) || amount < 0) return;
    if (row.amount !== null && amount === row.amount) return;
    setBusy(true);
    setError(null);
    api
      .setWage({ containerId: row.containerId, direction: row.direction, amount })
      .then(() => {
        setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key(row))));
        refetch();
        setToast(AR.wageSaved);
        setBusy(false);
      })
      .catch(fail);
  };

  const confirmPay = (): void => {
    if (paying === null) return;
    const undo = paying.paidAt !== null;
    setBusy(true);
    setError(null);
    api
      .payWage({ containerId: paying.containerId, direction: paying.direction, paid: !undo })
      .then(() => {
        setPaying(null);
        refetch();
        setToast(undo ? AR.payUndone : AR.payDone);
        setBusy(false);
      })
      .catch((failure: unknown) => {
        setPaying(null);
        fail(failure);
      });
  };

  const printGroup = groups.find((group) => group.driver === printing) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-ink">{AR.driversTitle}</h2>
        <Button kind="quiet" onClick={props.onBack}>
          {AR.backToMap}
        </Button>
      </header>
      <p className="text-sm leading-6 text-muted">{AR.driversHint}</p>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={AR.rangeFrom}>
          <input
            type="date"
            className={inputClass}
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field label={AR.rangeTo}>
          <input
            type="date"
            className={inputClass}
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
        <div className="min-w-56 flex-1">
          <input
            className={inputClass}
            value={term}
            placeholder={AR.driversSearch}
            onChange={(event) => {
              setTerm(event.target.value);
            }}
          />
        </div>
      </div>

      {groups.length === 0 && (
        <p className="py-6 text-center text-sm text-faint">{AR.driversEmpty}</p>
      )}
      {groups.length > 0 && shown.length === 0 && (
        <p className="py-6 text-center text-sm text-faint">{AR.driversNoMatch}</p>
      )}

      {shown.map((group) => (
        <section key={group.driver} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-ink">{group.driver}</h3>
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-muted">
              <span>{AR.haulsCount(group.rows.length)}</span>
              <span>
                {AR.totalWages}: <bdi dir="ltr">{String(group.total)}</bdi>
              </span>
              <span>
                {AR.paidWages}: <bdi dir="ltr">{String(group.paid)}</bdi>
              </span>
              <span className="text-amber-600">
                {AR.dueWages}: <bdi dir="ltr">{String(group.total - group.paid)}</bdi>
              </span>
              <Button
                kind="quiet"
                onClick={() => {
                  setPrinting(group.driver);
                }}
              >
                {AR.print}
              </Button>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {group.rows.map((row) => (
              <li
                key={key(row)}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3 py-2 text-sm"
              >
                <span className="w-20 text-xs text-faint" dir="ltr">
                  {formatDateOnly(row.at)}
                </span>
                <span
                  className={
                    row.direction === 'IN'
                      ? 'rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                  }
                >
                  {AR.operationName[row.direction] ?? row.direction}
                </span>
                <span className="font-mono text-xs text-muted" dir="ltr">
                  {cardSerial(row.card, row.cardYear) ?? '—'}
                </span>
                <span className="font-mono tracking-wide text-ink" dir="ltr">
                  {row.number}
                </span>
                <span className="text-xs text-muted" dir="ltr">
                  {row.truck}
                </span>
                <div className="ms-auto flex items-center gap-2">
                  <input
                    className={`${inputClass} w-24 text-center`}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder={AR.colWage}
                    disabled={busy || row.paidAt !== null}
                    value={drafts[key(row)] ?? (row.amount === null ? '' : String(row.amount))}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDrafts((prev) => ({ ...prev, [key(row)]: next }));
                    }}
                    onBlur={() => {
                      saveWage(row);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveWage(row);
                    }}
                  />
                  {row.paidAt === null ? (
                    <Button
                      kind="quiet"
                      disabled={busy || row.amount === null}
                      onClick={() => {
                        setPaying(row);
                      }}
                    >
                      {AR.payAction}
                    </Button>
                  ) : (
                    <span className="flex flex-col items-end text-end">
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        {AR.paidMark} — <bdi dir="ltr">{formatDateOnly(row.paidAt)}</bdi>
                      </span>
                      {row.paidBy !== null && (
                        <span className="text-[10px] text-faint">{AR.paidByLine(row.paidBy)}</span>
                      )}
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-muted underline"
                        disabled={busy}
                        onClick={() => {
                          setPaying(row);
                        }}
                      >
                        {AR.payUndo}
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {error !== null && <p className="text-xs font-semibold text-red-600">{error}</p>}
      {toast !== null && <Toast message={toast} />}

      {paying !== null && (
        <Confirm
          title={paying.paidAt === null ? AR.confirmPayTitle : AR.confirmPayUndoTitle}
          body={
            paying.paidAt === null
              ? AR.confirmPayBody(paying.driver, paying.number)
              : AR.confirmPayUndoBody(paying.driver, paying.number)
          }
          confirmLabel={paying.paidAt === null ? AR.payAction : AR.payUndo}
          busy={busy}
          onConfirm={confirmPay}
          onCancel={() => {
            setPaying(null);
          }}
        />
      )}

      {printGroup !== null && (
        <PrintDriver
          group={printGroup}
          from={from}
          to={to}
          onClose={() => {
            setPrinting(null);
          }}
        />
      )}
    </div>
  );
}

/** The driver's own paper: register ruling, totals, and his signature line. */
function PrintDriver(props: {
  group: DriverGroup;
  from: string;
  to: string;
  onClose: () => void;
}): ReactElement {
  useEscape(props.onClose);
  useEffect(() => {
    document.documentElement.classList.add('printing-card');
    return () => {
      document.documentElement.classList.remove('printing-card');
    };
  }, []);
  const headCell =
    'border border-rule border-b-2 border-b-rule-strong bg-sunken px-2 py-1.5 text-center text-[12px] font-bold text-ink';
  const bodyCell = 'border border-rule px-2 py-1.5 text-center text-[12px] text-ink';
  const { group } = props;
  return (
    <div className="permit-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="max-h-full w-full max-w-3xl overflow-y-auto">
        <div className="print-area gate-card paper-light overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          <div className="border-b-2 border-rule-strong px-3 py-3 text-center">
            <p className="text-sm font-semibold text-muted">{AR.appName}</p>
            <p className="mt-1 text-base font-bold text-ink">{AR.driversPrintTitle(group.driver)}</p>
            <p className="mt-1 text-xs text-muted" dir="ltr">
              {props.from} — {props.to}
            </p>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${headCell} w-9`}>{AR.colSeq}</th>
                <th className={headCell}>{AR.colDate}</th>
                <th className={headCell}>{AR.colDirection}</th>
                <th className={headCell}>{AR.colNumber}</th>
                <th className={headCell}>{AR.colTruck}</th>
                <th className={headCell}>{AR.colWage}</th>
                <th className={headCell}>{AR.colReceipt}</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row, index) => (
                <tr key={key(row)} className="odd:bg-surface even:bg-sunken">
                  <td className={bodyCell}>{String(index + 1)}</td>
                  <td className={bodyCell} dir="ltr">
                    {formatDateOnly(row.at)}
                  </td>
                  <td className={bodyCell}>{AR.operationName[row.direction] ?? row.direction}</td>
                  <td className={`${bodyCell} font-mono`} dir="ltr">
                    {row.number}
                  </td>
                  <td className={`${bodyCell} font-mono`} dir="ltr">
                    {row.truck}
                  </td>
                  <td className={bodyCell} dir="ltr">
                    {row.amount === null ? '' : String(row.amount)}
                  </td>
                  <td className={bodyCell}>{row.paidAt === null ? '' : AR.paidMark}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunken">
                <td className={`${bodyCell} border-t-2 border-t-rule-strong font-bold`} colSpan={5}>
                  {AR.totalRow} — {AR.haulsCount(group.rows.length)}
                </td>
                <td className={`${bodyCell} border-t-2 border-t-rule-strong font-bold`} dir="ltr">
                  {String(group.total)}
                </td>
                <td className={`${bodyCell} border-t-2 border-t-rule-strong font-bold`}>
                  {AR.dueWages}: <bdi dir="ltr">{String(group.total - group.paid)}</bdi>
                </td>
              </tr>
            </tfoot>
          </table>
          <div className="gate-sign h-24 border-t-2 border-rule-strong p-3">
            <p className="text-center text-[13px] font-bold text-ink">{AR.driverSignature}</p>
          </div>
        </div>
        <div className="print-hidden mt-3 flex justify-center gap-2">
          <Button
            onClick={() => {
              window.print();
            }}
          >
            {AR.print}
          </Button>
          <Button kind="quiet" onClick={props.onClose}>
            {AR.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
