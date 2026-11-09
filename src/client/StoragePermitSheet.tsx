import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PermitDto, StandingReportRow } from '../shared/types';
import { STORAGE_DWELL_DAYS, cardSerial, cardSerialText } from '../shared/types';
import { AR } from './ar';
import { ApiFailure, api, formatDateOnly } from './api';
import { rowMatches, searchTerms } from './sheetSearch';
import { Button, ErrorLine, Sheet, inputClass } from './ui';

/** The server's cap on one paper's lines — the exit permit's own. */
const MAX_LINES = 200;

/**
 * تصريح نقل حاويات إلى مديرية التخزين — «اذا قعدت اكثر من تسعين يوم
 * بننقلهم ل مكان داخل الساحة … وهي نقل وليست اخراج».
 *
 * Born on كشف الرُّكود, from the very rows the register is showing: what has
 * sat longer than the span picked there. Many bills on one paper. NOTHING is
 * marked when the sheet opens, as on the exit permit; «تحديد الكل» takes
 * whatever the filter shows.
 *
 * Two amber chips, both warnings and never bars — the owner's call:
 * «لم تكمل 90 يوماً» for a box younger than the rule, and «منقولة للتخزين»
 * for one a live storage paper already carries (reprint that paper rather
 * than mint a second number).
 *
 * Issuing moves nothing on the map: the crew carries the boxes afterwards
 * with the ordinary move, which prints its own move card.
 */
export function StoragePermitSheet(props: {
  /** The dormancy register's rows, oldest first. */
  rows: readonly StandingReportRow[];
  onDone: (permit: PermitDto, message: string) => void;
  onClose: () => void;
}): ReactElement {
  const listed = props.rows;
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  const [weights, setWeights] = useState<Readonly<Record<number, string>>>(() =>
    Object.fromEntries(listed.map((row) => [row.containerId, row.weight])),
  );
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const already = useQuery({
    queryKey: ['permits-for', 'STORAGE', listed.map((row) => row.containerId).join(',')],
    queryFn: () =>
      api.permitsFor(
        listed.map((row) => row.containerId),
        'STORAGE',
      ),
    enabled: listed.length > 0,
  });
  const prior = new Map<number, string[]>();
  for (const row of already.data?.rows ?? []) {
    const list = prior.get(row.containerId) ?? [];
    list.push(`${cardSerialText(row.serial)}/${String(row.serialYear)}`);
    prior.set(row.containerId, list);
  }

  // The filter reads the number and the bill the way every register's search
  // does: Arabic digits, separators and look-alike letters all fold.
  const visible = useMemo(() => {
    const terms = searchTerms(filter);
    if (terms.length === 0) return listed;
    return listed.filter((row) => rowMatches([row.number, row.bill], terms));
  }, [listed, filter]);

  const toggle = (id: number): void => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const allVisiblePicked =
    visible.length > 0 && visible.every((row) => picked.has(row.containerId));
  const anyUnder = listed.some(
    (row) => picked.has(row.containerId) && row.dwellDays < STORAGE_DWELL_DAYS,
  );
  const tooMany = picked.size > MAX_LINES;

  const submit = (): void => {
    const items = listed
      .filter((row) => picked.has(row.containerId))
      .map((row) => ({
        containerId: row.containerId,
        weight: (weights[row.containerId] ?? '').trim(),
      }));
    if (items.length === 0 || tooMany || busy) return;
    setBusy(true);
    setError(null);
    api
      .createPermit({ kind: 'STORAGE', items })
      .then((permit) => {
        props.onDone(
          permit,
          AR.storagePermitDone(cardSerial(permit.serial, permit.serialYear) ?? String(permit.serial)),
        );
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  return (
    <Sheet title={AR.storagePermitCreate} onClose={props.onClose}>
      {listed.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">{AR.storageNoContainers}</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="text-xs leading-5 text-faint">{AR.storagePermitCreateHint}</p>
          {prior.size > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {AR.storageAlreadyHint}
            </p>
          )}
          {anyUnder && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {AR.storageUnderHint}
            </p>
          )}

          <input
            dir="auto"
            placeholder={AR.storageFilter}
            className={`${inputClass} text-sm`}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              kind="quiet"
              disabled={visible.length === 0}
              onClick={() => {
                const next = new Set(picked);
                for (const row of visible) {
                  if (allVisiblePicked) next.delete(row.containerId);
                  else next.add(row.containerId);
                }
                setPicked(next);
              }}
            >
              {allVisiblePicked ? AR.permitSelectNone : AR.permitSelectAll}
            </Button>
            <span className="text-xs font-bold text-muted">
              {AR.permitPickedCount(picked.size, listed.length)}
            </span>
          </div>

          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">{AR.storageNoMatch}</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {visible.map((row) => {
                const on = picked.has(row.containerId);
                const young = row.dwellDays < STORAGE_DWELL_DAYS;
                return (
                  <li key={row.containerId} className="px-3 py-2.5">
                    <label className="flex cursor-pointer flex-wrap items-center gap-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-blue-700"
                        checked={on}
                        onChange={() => {
                          toggle(row.containerId);
                        }}
                      />
                      <span className="truncate font-mono text-sm font-bold text-ink" dir="ltr">
                        {row.number}
                      </span>
                      <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                        {AR.feet(row.size)}
                      </span>
                      <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                        {AR.daysCount(row.dwellDays)}
                      </span>
                      {young && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          {AR.storageUnder}
                        </span>
                      )}
                      {prior.has(row.containerId) && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          {AR.storageAlready((prior.get(row.containerId) ?? []).join('، '))}
                        </span>
                      )}
                    </label>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 ps-7">
                      <span className="shrink-0 font-mono text-xs text-muted" dir="ltr">
                        {cardSerial(row.cardIn, row.cardInYear) ?? '—'}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted" dir="ltr">
                        {row.bill === '' ? '—' : row.bill}
                      </span>
                      <span className="shrink-0 text-xs text-muted" dir="ltr">
                        {formatDateOnly(row.enteredAt)}
                      </span>
                      <input
                        dir="ltr"
                        placeholder={AR.colWeight}
                        disabled={!on}
                        className={`${inputClass} ms-auto w-24 py-1 text-start text-sm disabled:opacity-40`}
                        value={weights[row.containerId] ?? ''}
                        onChange={(event) => {
                          setWeights({ ...weights, [row.containerId]: event.target.value });
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {tooMany && <ErrorLine message={AR.storagePermitMax(MAX_LINES)} />}
          <ErrorLine message={error} />

          <Button type="submit" full disabled={busy || picked.size === 0 || tooMany}>
            {AR.permitIssue}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
