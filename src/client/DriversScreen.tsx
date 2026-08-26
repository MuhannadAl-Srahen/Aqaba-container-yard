import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverHaulRow } from '../shared/types';
import { cardSerial } from '../shared/types';
import { findTruck } from '../shared/fleet';
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

/**
 * Whose account a haul belongs in. The driver's name when the gate wrote
 * one; otherwise the PLATE — «ضعها تحت نفس رقم السيارة» — because the name
 * is optional at the gate and a nameless haul is still work somebody did.
 * Filtering it out once hid eight real hauls and made the sheet's total
 * disagree with كشف السيارات.
 */
const groupOf = (row: DriverHaulRow): string =>
  row.driver !== '' ? `D:${row.driver}` : row.truck !== '' ? `T:${row.truck}` : 'X:';

/** The payee inside a sentence, where a group heading would not read. */
const payee = (row: DriverHaulRow): string =>
  row.driver !== '' ? row.driver : AR.driverOfTruck(row.truck);

// Digits fold to one alphabet so «٦٠» finds the plate typed 60.
const fold = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .trim();

/** A small segmented filter: one lit button per choice. */
function Seg<T extends string>(props: {
  value: T;
  onPick: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}): ReactElement {
  return (
    <div className="flex gap-1 rounded-xl border border-line bg-sunken p-1">
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            props.onPick(value);
          }}
          className={
            'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ' +
            (props.value === value
              ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
              : 'text-muted hover:bg-line')
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface DriverGroup {
  /** `D:name` or `T:plate` — a name and a plate never collide. */
  readonly key: string;
  readonly driver: string;
  readonly truck: string;
  /** True when the gate wrote a name; false when the plate carries the group. */
  readonly named: boolean;
  /** The heading as it is read. */
  readonly label: string;
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
  const [direction, setDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [paidFilter, setPaidFilter] = useState<'ALL' | 'PAID' | 'DUE'>('ALL');
  const [carrier, setCarrier] = useState(0);
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
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: api.fleet, staleTime: 60_000 });
  const needle = fold(term);

  /**
   * The filters cut ROWS, not drivers: a plate search shows that truck's own
   * hauls alone — «اريد فقط ظهور السيارة التي تم البحث عليها» — and the
   * paid, direction and carrier filters slice the same way, so every total
   * under a name sums exactly what stands on the screen.
   */
  const shownRows = useMemo(
    () =>
      rows.filter((row) => {
        if (direction !== 'ALL' && row.direction !== direction) return false;
        if (paidFilter === 'PAID' && row.paidAt === null) return false;
        if (paidFilter === 'DUE' && row.paidAt !== null) return false;
        if (carrier !== 0) {
          const registered = findTruck(fleet.data?.trucks ?? [], row.truck);
          if (registered === null || registered.carrierId !== carrier) return false;
        }
        if (needle === '') return true;
        return fold(row.driver).includes(needle) || fold(row.truck).includes(needle);
      }),
    [rows, direction, paidFilter, carrier, fleet.data, needle],
  );

  const groups = useMemo((): DriverGroup[] => {
    const map = new Map<string, DriverHaulRow[]>();
    for (const row of shownRows) {
      const id = groupOf(row);
      const list = map.get(id);
      if (list === undefined) map.set(id, [row]);
      else list.push(row);
    }
    return [...map.entries()].map(([id, list]) => {
      const driver = list[0]?.driver ?? '';
      const truck = list[0]?.truck ?? '';
      const named = driver !== '';
      return {
        key: id,
        driver,
        truck,
        named,
        label: named ? driver : truck !== '' ? AR.driverByTruck(truck) : AR.driverUnknown,
        rows: list,
        total: list.reduce((sum, row) => sum + (row.amount ?? 0), 0),
        paid: list.reduce((sum, row) => sum + (row.paidAt !== null ? (row.amount ?? 0) : 0), 0),
      };
    });
  }, [shownRows]);

  const refetch = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['drivers'] });
  };

  const fail = (failure: unknown): void => {
    setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
    setBusy(false);
  };

  /**
   * The saved figure written straight into the rows already on screen, rather
   * than re-reading the whole period: a refetch of every haul in the month to
   * learn one number is what made typing feel slow — «واظن انها توخذ بعض
   * الوقت». The server has spoken by the time this runs; the totals above
   * recompute from the same rows.
   */
  const patchRow = (row: DriverHaulRow, change: Partial<DriverHaulRow>): void => {
    queryClient.setQueryData<{ rows: DriverHaulRow[] }>(['drivers', fromIso, toIso], (prev) =>
      prev === undefined
        ? prev
        : {
            rows: prev.rows.map((candidate) =>
              key(candidate) === key(row) ? { ...candidate, ...change } : candidate,
            ),
          },
    );
  };

  const forgetDraft = (row: DriverHaulRow): void => {
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key(row))));
  };

  /**
   * Save one haul's figure the moment the clerk leaves the field — WITHOUT
   * freezing the screen: «تأكد من عدم وجود تأخير عند ادخال رقم». Nothing is
   * disabled while the save flies; the toast lands when it lands.
   *
   * And an EMPTIED box erases the figure. It used to do nothing at all, so
   * the screen went blank while the book kept the old amount and handed it
   * back on the next read — «ومسحه … تبقى القيمة موجودة».
   */
  const saveWage = (row: DriverHaulRow): void => {
    const draft = drafts[key(row)];
    if (draft === undefined) return;

    if (draft.trim() === '') {
      if (row.amount === null) {
        forgetDraft(row);
        return;
      }
      setError(null);
      api
        .clearWage({ containerId: row.containerId, direction: row.direction })
        .then(() => {
          forgetDraft(row);
          patchRow(row, { amount: null });
          setToast(AR.wageCleared);
        })
        .catch(fail);
      return;
    }

    const amount = Number(draft);
    if (!Number.isFinite(amount) || amount < 0) return;
    if (row.amount !== null && amount === row.amount) {
      forgetDraft(row);
      return;
    }
    setError(null);
    api
      .setWage({ containerId: row.containerId, direction: row.direction, amount })
      .then(() => {
        forgetDraft(row);
        patchRow(row, { amount });
        setToast(AR.wageSaved);
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

  const printGroup = groups.find((group) => group.key === printing) ?? null;

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

      {/* «فلاتر عند حساب السائقين»: الاتجاه، الاستلام، والناقل. */}
      <div className="flex flex-wrap items-center gap-3">
        <Seg
          value={direction}
          onPick={setDirection}
          options={[
            ['ALL', AR.filterAll],
            ['IN', AR.operationName['IN'] ?? 'IN'],
            ['OUT', AR.operationName['OUT'] ?? 'OUT'],
          ]}
        />
        <Seg
          value={paidFilter}
          onPick={setPaidFilter}
          options={[
            ['ALL', AR.filterAll],
            ['PAID', AR.paidFilterYes],
            ['DUE', AR.paidFilterNo],
          ]}
        />
        <select
          className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
          value={carrier}
          onChange={(event) => {
            setCarrier(Number(event.target.value));
          }}
        >
          <option value={0}>{AR.carrierFilterAll}</option>
          {(fleet.data?.carriers ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 && (
        <p className="py-6 text-center text-sm text-faint">{AR.driversEmpty}</p>
      )}
      {rows.length > 0 && groups.length === 0 && (
        <p className="py-6 text-center text-sm text-faint">{AR.driversNoMatch}</p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              className={
                'text-base font-bold ' +
                (group.named ? 'text-ink' : 'text-amber-700 dark:text-amber-400')
              }
              dir={group.named ? undefined : 'rtl'}
            >
              {group.label}
            </h3>
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
                  setPrinting(group.key);
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
                    disabled={row.paidAt !== null}
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
                      disabled={row.amount === null}
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
              ? AR.confirmPayBody(payee(paying), paying.number)
              : AR.confirmPayUndoBody(payee(paying), paying.number)
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
  // At the body, not inside the screen: clipping ancestors would cut the
  // printed statement to one page.
  return createPortal(
    <div className="permit-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="max-h-full w-full max-w-3xl overflow-y-auto">
        <div className="print-area gate-card paper-light overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          <div className="border-b-2 border-rule-strong px-3 py-3 text-center">
            <p className="text-sm font-semibold text-muted">{AR.appName}</p>
            <p className="mt-1 text-base font-bold text-ink">
              {group.named
                ? AR.driversPrintTitle(group.driver)
                : AR.driversPrintTitleTruck(group.truck)}
            </p>
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
    </div>,
    document.body,
  );
}
