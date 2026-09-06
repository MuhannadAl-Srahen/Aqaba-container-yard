import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverHaulRow, OrphanWageRow } from '../shared/types';
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

type GroupBy = 'DRIVER' | 'TRUCK';

/**
 * Whose account a haul belongs in. By the driver's name — or by the PLATE,
 * which the owner asked for as a second reading of the same book: «بدي كمان
 * يعطي بناءا على رقم السيارة مو على اساس اسم السائق». The plate is also the
 * fallback in driver mode whenever the gate wrote no name, because the name
 * is optional there and a nameless haul is still work somebody did —
 * filtering it out once hid eight real hauls and made the sheet's total
 * disagree with كشف السيارات.
 */
const groupOf = (row: DriverHaulRow, by: GroupBy): string => {
  if (by === 'DRIVER' && row.driver !== '') return `D:${row.driver}`;
  if (row.truck !== '') return `T:${row.truck}`;
  return row.driver !== '' ? `D:${row.driver}` : 'X:';
};

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

/**
 * One figure with its name over it. The settling eye hunts for a number,
 * not for a label buried in a sentence — «يكون سهل التعامل معه وتكون واضحة».
 */
function Stat(props: {
  label: string;
  value: number;
  tone?: 'emerald' | 'amber';
  big?: boolean;
}): ReactElement {
  const tone =
    props.tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400'
      : props.tone === 'amber'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-ink';
  return (
    <div className="text-center">
      <span className="block text-[10px] font-semibold text-faint">{props.label}</span>
      <bdi
        dir="ltr"
        className={`block font-bold tabular-nums ${props.big === true ? 'text-xl' : 'text-sm'} ${tone}`}
      >
        {String(props.value)}
      </bdi>
    </div>
  );
}

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
  /** No driver name anywhere under this heading: what still wants one. */
  readonly nameless: boolean;
  /** The heading is a plate, so the printed paper is the truck's. */
  readonly byTruck: boolean;
  /** The heading as it is read. */
  readonly label: string;
  readonly rows: DriverHaulRow[];
  readonly total: number;
  readonly paid: number;
  /** Every haul under this heading stamped received — «حاسبت». */
  readonly settled: boolean;
}

export function DriversScreen(props: { isOwner: boolean; onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(ammanToday());
  /** «بدي القدرة البحث عن اسم السايق او رقم سيارته». */
  const [term, setTerm] = useState('');
  const [direction, setDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  /**
   * The PLATE opens the sheet, not the name — «بدل ما تحط اسم السايق هون
   * بهمني رقم السيارة اكثر من اسمه». The heading still names the driver after
   * its plate when the gate wrote one; «حسب السائق» reads the same hauls the
   * other way round for whoever wants a man's whole account across trucks.
   */
  const [by, setBy] = useState<GroupBy>('TRUCK');
  const [paidFilter, setPaidFilter] = useState<'ALL' | 'PAID' | 'DUE'>('ALL');
  const [carrier, setCarrier] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState<DriverHaulRow | null>(null);
  const [payingAll, setPayingAll] = useState<DriverGroup | null>(null);
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
   * Search, direction and carrier cut ROWS: a plate search shows that truck's
   * own hauls alone — «اريد فقط ظهور السيارة التي تم البحث عليها» — so every
   * total under a heading sums exactly what stands on the screen.
   *
   * الاستلام is NOT here, and that is the fix. It used to cut rows too, so a
   * driver with one settled haul and one outstanding appeared under BOTH
   * «استلموا حسابهم» and «لم يستلموا», each time with half his account —
   * which is why it read as broken. The question is about PEOPLE — «الناس
   * الي ما حاسبت والناس الي حاسبت» — so it cuts headings, below.
   */
  const shownRows = useMemo(
    () =>
      rows.filter((row) => {
        if (direction !== 'ALL' && row.direction !== direction) return false;
        if (carrier !== 0) {
          const registered = findTruck(fleet.data?.trucks ?? [], row.truck);
          if (registered === null || registered.carrierId !== carrier) return false;
        }
        if (needle === '') return true;
        return fold(row.driver).includes(needle) || fold(row.truck).includes(needle);
      }),
    [rows, direction, carrier, fleet.data, needle],
  );

  const groups = useMemo((): DriverGroup[] => {
    const map = new Map<string, DriverHaulRow[]>();
    for (const row of shownRows) {
      const id = groupOf(row, by);
      const list = map.get(id);
      if (list === undefined) map.set(id, [row]);
      else list.push(row);
    }
    return [...map.entries()].map(([id, rows]) => {
      // «ورتب الدخول اولا والخروج اخر شي ب الترتيب»: the period's entries
      // first, then its exits, each run in its own time order. The printed
      // statement reads from the same array, so paper follows the screen.
      const list = rows
        .slice()
        .sort((a, b) =>
          a.direction !== b.direction
            ? a.direction === 'IN'
              ? -1
              : 1
            : a.at < b.at
              ? -1
              : a.at > b.at
                ? 1
                : a.containerId - b.containerId,
        );
      const truck = list[0]?.truck ?? '';
      const byTruck = id.startsWith('T:');
      // One plate may have carried more than one man over a month.
      const names = [...new Set(list.map((row) => row.driver).filter((name) => name !== ''))];
      const driver = byTruck ? '' : (list[0]?.driver ?? '');
      return {
        key: id,
        driver,
        truck,
        nameless: names.length === 0,
        byTruck,
        label: !byTruck
          ? driver
          : truck === ''
            ? AR.driverUnknown
            : names.length === 0
              ? AR.driverByTruck(truck)
              : names.length === 1
                ? AR.truckWithDriver(truck, names[0] ?? '')
                : AR.truckManyDrivers(truck, names.length),
        rows: list,
        total: list.reduce((sum, row) => sum + (row.amount ?? 0), 0),
        paid: list.reduce((sum, row) => sum + (row.paidAt !== null ? (row.amount ?? 0) : 0), 0),
        settled: list.every((row) => row.paidAt !== null),
      };
    });
  }, [shownRows, by]);

  /**
   * «الناس الي ما حاسبت والناس الي حاسبت»: settled means every haul under the
   * heading is stamped received. A haul with no figure written is not settled
   * — it is work still waiting to be priced.
   */
  const shownGroups = useMemo(
    () =>
      groups
        .filter((group) =>
          paidFilter === 'ALL' ? true : paidFilter === 'PAID' ? group.settled : !group.settled,
        )
        // What is owed comes first, largest first, and the settled accounts
        // fall to the bottom — the sheet is opened in order to pay people.
        .sort((a, b) => {
          if (a.settled !== b.settled) return a.settled ? 1 : -1;
          const due = b.total - b.paid - (a.total - a.paid);
          return due !== 0 ? due : a.label.localeCompare(b.label, 'ar');
        }),
    [groups, paidFilter],
  );

  /** The one line he reads before paying anybody: what all of this comes to. */
  const totals = useMemo(() => {
    const shown = shownGroups.flatMap((group) => group.rows);
    const total = shown.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    const paid = shown.reduce(
      (sum, row) => sum + (row.paidAt !== null ? (row.amount ?? 0) : 0),
      0,
    );
    return {
      groups: shownGroups.length,
      hauls: shown.length,
      unpriced: shown.filter((row) => row.amount === null).length,
      total,
      paid,
      due: total - paid,
    };
  }, [shownGroups]);

  /** The hauls of one heading that are priced and not yet stamped. */
  const payableOf = (group: DriverGroup): DriverHaulRow[] =>
    group.rows.filter((row) => row.amount !== null && row.paidAt === null);

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

  /**
   * A whole heading stamped at once — «وقت يجي يحاسب يكون سهل محاسبته». The
   * server does it in one transaction, so the account is never half settled.
   */
  const confirmPayAll = (): void => {
    if (payingAll === null) return;
    const hauls = payableOf(payingAll).map((row) => ({
      containerId: row.containerId,
      direction: row.direction,
    }));
    if (hauls.length === 0) {
      setPayingAll(null);
      return;
    }
    setBusy(true);
    setError(null);
    api
      .payMany({ hauls })
      .then((reply) => {
        setPayingAll(null);
        refetch();
        setToast(AR.payAllDone(reply.stamped));
        setBusy(false);
      })
      .catch((failure: unknown) => {
        setPayingAll(null);
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

      {/* «فلاتر عند حساب السائقين»: التجميع، الاتجاه، الاستلام، والناقل. */}
      <div className="flex flex-wrap items-center gap-3">
        <Seg
          value={by}
          onPick={setBy}
          options={[
            ['DRIVER', AR.groupByDriver],
            ['TRUCK', AR.groupByTruck],
          ]}
        />
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
      {rows.length > 0 && shownGroups.length === 0 && (
        <p className="py-6 text-center text-sm text-faint">{AR.driversNoMatch}</p>
      )}

      {/* الإجمالي قبل أي اسم: ما على الشاشة كله في سطر واحد. */}
      {shownGroups.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-sunken px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink">{AR.screenTotals}</span>
            <span className="text-xs font-semibold text-muted">{AR.haulsCount(totals.hauls)}</span>
            {/* Its own badge, not a clause after a dot: two numbers on one RTL
                line read as one number. */}
            {totals.unpriced > 0 && (
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {AR.unpricedCount(totals.unpriced)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-5">
            <Stat label={AR.totalWages} value={totals.total} />
            <Stat label={AR.paidWages} value={totals.paid} tone="emerald" />
            <Stat label={AR.dueWages} value={totals.due} tone="amber" big />
          </div>
        </div>
      )}

      {shownGroups.map((group) => {
        const payable = payableOf(group);
        const unpriced = group.rows.filter((row) => row.amount === null).length;
        return (
        <section key={group.key} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
            <div className="min-w-0">
              <h3
                className={
                  'text-base font-bold ' +
                  (group.nameless ? 'text-amber-700 dark:text-amber-400' : 'text-ink')
                }
                dir={group.byTruck ? 'rtl' : undefined}
              >
                {group.label}
                {group.settled && (
                  <span className="ms-2 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {AR.groupSettled}
                  </span>
                )}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
                <span>{AR.haulsCount(group.rows.length)}</span>
                {unpriced > 0 && (
                  <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {AR.unpricedCount(unpriced)}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Stat label={AR.totalWages} value={group.total} />
              <Stat label={AR.paidWages} value={group.paid} tone="emerald" />
              <Stat label={AR.dueWages} value={group.total - group.paid} tone="amber" big />
              <div className="flex flex-col gap-1">
                {payable.length > 0 && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setPayingAll(group);
                    }}
                  >
                    {AR.paySettleAll}
                  </Button>
                )}
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
          </div>
          <ul className="mt-3 space-y-2">
            {group.rows.map((row) => (
              <li
                key={key(row)}
                className={
                  'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm ' +
                  (row.paidAt !== null
                    ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
                    : 'border-line')
                }
              >
                {/* Fixed widths, so the eye runs down a column instead of
                    hunting across a ragged line. */}
                <span className="w-20 shrink-0 text-xs text-faint" dir="ltr">
                  {formatDateOnly(row.at)}
                </span>
                <span
                  className={
                    'w-12 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[11px] font-bold ' +
                    (row.direction === 'IN'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300')
                  }
                >
                  {AR.operationName[row.direction] ?? row.direction}
                </span>
                <span className="w-14 shrink-0 font-mono text-xs text-muted" dir="ltr">
                  {cardSerial(row.card, row.cardYear) ?? '—'}
                </span>
                <span className="w-32 shrink-0 font-mono tracking-wide text-ink" dir="ltr">
                  {row.number}
                </span>
                <span className="w-24 shrink-0 font-mono text-xs text-muted" dir="ltr">
                  {row.truck}
                </span>
                {/* Whose haul it is, when the heading is a plate that carried
                    more than one man. */}
                {group.byTruck && !group.nameless && (
                  <span className="w-28 shrink-0 truncate text-xs text-muted">
                    {row.driver === '' ? '—' : row.driver}
                  </span>
                )}
                <div className="ms-auto flex items-center gap-2">
                  <input
                    className={
                      `${inputClass} w-24 text-center tabular-nums ` +
                      (row.amount === null ? 'border-amber-400 dark:border-amber-600' : '')
                    }
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
        );
      })}

      <OrphanWages />
      {props.isOwner && <MergeNames />}

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

      {payingAll !== null && (
        <Confirm
          title={AR.confirmPayAllTitle}
          body={AR.confirmPayAllBody(
            payingAll.label,
            payableOf(payingAll).length,
            payableOf(payingAll).reduce((sum, row) => sum + (row.amount ?? 0), 0),
          )}
          confirmLabel={AR.paySettleAll}
          busy={busy}
          onConfirm={confirmPayAll}
          onCancel={() => {
            setPayingAll(null);
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

/**
 * دمج أسماء السائقين المكررة — «حماد عودة» بثلاث صيغ يوزّع نقلاته على
 * ثلاثة أسطر حتى يُدمج: the owner picks the canonical spelling, ticks the
 * strays, and the whole book — hauls and fleet cards alike — reads one
 * name. Owner-only; the server refuses everyone else regardless.
 */
function MergeNames(): ReactElement {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState('');
  const [drop, setDrop] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const names = useQuery({
    queryKey: ['driver-names'],
    queryFn: api.driverNames,
    enabled: open,
    staleTime: 30_000,
  });
  const rows = names.data?.rows ?? [];
  const candidates = rows.filter((row) => row.name !== keep);

  const toggle = (name: string): void => {
    setDrop((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  };

  const merge = (): void => {
    setBusy(true);
    api
      .mergeDrivers(keep, drop)
      .then(({ hauls, trucks }) => {
        setToast(AR.mergeDone(hauls, trucks));
        setKeep('');
        setDrop([]);
        void queryClient.invalidateQueries({ queryKey: ['driver-names'] });
        void queryClient.invalidateQueries({ queryKey: ['drivers'] });
        void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      })
      .catch((failure: unknown) => {
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between text-start"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="text-sm font-extrabold text-ink">{AR.mergeTitle}</span>
        <span className="text-xs font-bold text-faint">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-6 text-muted">{AR.mergeHint}</p>
          <Field label={AR.mergeKeepLabel}>
            <select
              className={inputClass}
              value={keep}
              onChange={(event) => {
                setKeep(event.target.value);
                setDrop((current) => current.filter((entry) => entry !== event.target.value));
              }}
            >
              <option value="">—</option>
              {rows.map((row) => (
                <option key={row.name} value={row.name}>
                  {row.name} — {AR.haulsCount(row.hauls)}
                </option>
              ))}
            </select>
          </Field>
          {keep !== '' && (
            <Field label={AR.mergeDropLabel}>
              <div className="grid max-h-64 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto sm:grid-cols-2">
                {candidates.map((row) => (
                  <label
                    key={row.name}
                    className="flex cursor-pointer items-center gap-2 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-700"
                      checked={drop.includes(row.name)}
                      onChange={() => {
                        toggle(row.name);
                      }}
                    />
                    {row.name}
                    <span className="text-xs text-faint">({AR.haulsCount(row.hauls)})</span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Button
            disabled={busy || keep === '' || drop.length === 0}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {AR.mergeAction}
          </Button>
        </div>
      )}
      {confirming && (
        <Confirm
          title={AR.mergeConfirmTitle}
          body={AR.mergeConfirmBody(keep, drop.length)}
          confirmLabel={AR.mergeAction}
          danger
          busy={busy}
          onConfirm={merge}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      )}
      {toast !== null && <Toast message={toast} />}
    </section>
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
              {group.byTruck
                ? AR.driversPrintTitleTruck(group.truck)
                : AR.driversPrintTitle(group.driver)}
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

/**
 * أجور على سجلات محذوفة — «أضيف طريقة لإلغاء أجر على سجل محذوف من كشف
 * الحساب»: a haul struck out after its figure was written (or paid) leaves
 * that figure standing on nothing, and the statement above cannot show it.
 * Listed here for anyone who keeps the ledger, and voided on confirmation.
 */
function OrphanWages(): ReactElement {
  const queryClient = useQueryClient();
  const orphans = useQuery({ queryKey: ['orphan-wages'], queryFn: api.orphanWages });
  const [voiding, setVoiding] = useState<OrphanWageRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const rows = orphans.data?.rows ?? [];

  const confirmVoid = (): void => {
    if (voiding === null) return;
    setBusy(true);
    api
      .voidWage({ containerId: voiding.containerId, direction: voiding.direction })
      .then(() => {
        setToast(AR.wageVoided);
      })
      .catch((failure: unknown) => {
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setBusy(false);
        setVoiding(null);
        void queryClient.invalidateQueries({ queryKey: ['orphan-wages'] });
        void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      });
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-sm font-extrabold text-ink">{AR.orphanWagesTitle}</h2>
      <p className="mt-1 text-xs leading-6 text-muted">{AR.orphanWagesHint}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-faint">{AR.orphanWagesEmpty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li
              key={`${String(row.containerId)}|${row.direction}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-sunken px-3 py-2 text-sm"
            >
              <span className="rounded-lg bg-red-100 px-2 py-0.5 text-xs font-extrabold text-red-800 dark:bg-red-950 dark:text-red-200">
                {row.direction === 'IN' ? AR.movementIn : AR.movementOut}
              </span>
              <span className="font-mono font-bold text-ink" dir="ltr">
                {row.number}
              </span>
              <span className="text-muted">{row.driver !== '' ? row.driver : row.truck}</span>
              <span className="font-bold text-ink" dir="ltr">
                {String(row.amount)}
              </span>
              {row.paidAt !== null && (
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {AR.paidMark}
                  {row.paidBy === null ? '' : ` — ${AR.paidByLine(row.paidBy)}`}{' '}
                  <bdi dir="ltr">{formatDateOnly(row.paidAt)}</bdi>
                </span>
              )}
              <span className="text-xs text-faint">
                {AR.orphanDeletedOn(formatDateOnly(row.deletedAt))}
              </span>
              <span className="ms-auto">
                <Button
                  kind="danger"
                  disabled={busy}
                  onClick={() => {
                    setVoiding(row);
                  }}
                >
                  {AR.voidWageAction}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {voiding !== null && (
        <Confirm
          title={AR.voidWageTitle}
          body={AR.voidWageBody(voiding.number, voiding.amount, voiding.paidAt !== null)}
          confirmLabel={AR.voidWageAction}
          danger
          busy={busy}
          onConfirm={confirmVoid}
          onCancel={() => {
            setVoiding(null);
          }}
        />
      )}
      {toast !== null && <Toast message={toast} />}
    </section>
  );
}
