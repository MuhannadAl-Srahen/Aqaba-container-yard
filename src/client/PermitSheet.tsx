import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, PermitDto } from '../shared/types';
import { cardSerial, cardSerialText } from '../shared/types';
import { AR } from './ar';
import { ApiFailure, api, formatDateOnly } from './api';
import { Button, ErrorLine, Sheet, inputClass } from './ui';

/**
 * Issuing a تصريح تحميل وخروج داخلي: the bill's containers, each with a
 * checkbox and the weight the paper will carry. Standing and departed alike
 * — the office records the gate exit first and prints this paper after, so a
 * departed box is listed too.
 *
 * NOTHING is marked when the sheet opens — «بدي ما يكون ولا على وحده check
 * وانا احدد الحاويات … مثلا بدي اعمل تصريح 3 من اصل عشرين ف لازم اشيل ال
 * check عن 17». «تحديد الكل» keeps the whole-bill permit at one tap.
 *
 * The truck plate is gone from this sheet: «ليه بدخل رقم سيارة ؟؟؟ مهو ما
 * ببين اساسا بالتصريح عند الطباعة». It was written, stored and never read
 * by any paper, register or account.
 */
export function PermitSheet(props: {
  bill: string;
  /** The bill's containers as the register already holds them. */
  containers: readonly ContainerDto[];
  onDone: (permit: PermitDto, message: string) => void;
  onClose: () => void;
}): ReactElement {
  const listed = props.containers;
  /** Empty on purpose: the clerk marks what this paper covers. */
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  /** «اريد وضع خانة للوزن ايضا»: prefilled from the record, editable, and
   * whatever stands here at issue time is what the stamped paper reads. */
  const [weights, setWeights] = useState<Readonly<Record<number, string>>>(() =>
    Object.fromEntries(listed.map((container) => [container.id, container.weight])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * «تنبيه عند إصدار تصريح ثانٍ لنفس الحاوية»: 86 containers in his own book
   * carry two papers or more, because a clerk wanting another copy issued a
   * NEW permit instead of reprinting the one that already exists. A warning
   * here, never a bar — a second paper is sometimes exactly right.
   */
  const already = useQuery({
    queryKey: ['permits-for', listed.map((container) => container.id).join(',')],
    queryFn: () => api.permitsFor(listed.map((container) => container.id)),
    enabled: listed.length > 0,
  });
  const priorPermits = new Map<number, string[]>();
  for (const row of already.data?.rows ?? []) {
    const list = priorPermits.get(row.containerId) ?? [];
    list.push(`${cardSerialText(row.serial)}/${String(row.serialYear)}`);
    priorPermits.set(row.containerId, list);
  }

  const toggle = (id: number): void => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const allPicked = listed.length > 0 && picked.size === listed.length;

  const submit = (): void => {
    const items = listed
      .filter((container) => picked.has(container.id))
      .map((container) => ({
        containerId: container.id,
        weight: (weights[container.id] ?? '').trim(),
      }));
    if (items.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    api
      .createPermit({ bill: props.bill, items })
      .then((permit) => {
        props.onDone(
          permit,
          AR.permitDone(cardSerial(permit.serial, permit.serialYear) ?? String(permit.serial)),
        );
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  return (
    <Sheet title={`${AR.permitCreate} — ${AR.permitBill} ${props.bill}`} onClose={props.onClose}>
      {listed.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">{AR.permitNoContainers}</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="text-xs leading-5 text-faint">{AR.permitCreateHint}</p>
          {priorPermits.size > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {AR.permitAlreadyHint}
            </p>
          )}

          {/* The whole bill in one tap, and the tally beside it — the sheet
              opens empty, so the clerk must always be able to see how many
              he has marked without counting the ticks himself. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              kind="quiet"
              onClick={() => {
                setPicked(allPicked ? new Set() : new Set(listed.map((c) => c.id)));
              }}
            >
              {allPicked ? AR.permitSelectNone : AR.permitSelectAll}
            </Button>
            <span className="text-xs font-bold text-muted">
              {AR.permitPickedCount(picked.size, listed.length)}
            </span>
          </div>

          <ul className="divide-y divide-line rounded-xl border border-line">
            {listed.map((container) => {
              const on = picked.has(container.id);
              // Quiet lines, never a squeeze: the box and its badges first,
              // then the entry facts — and on a narrow panel the weight
              // input WRAPS onto its own line rather than overflow.
              return (
                <li key={container.id} className="px-3 py-2.5">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-blue-700"
                      checked={on}
                      onChange={() => {
                        toggle(container.id);
                      }}
                    />
                    <span className="truncate font-mono text-sm font-bold text-ink" dir="ltr">
                      {container.number}
                    </span>
                    <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                      {AR.feet(container.size)}
                    </span>
                    {/* The paper's own reading: out from its exit card,
                        even while the box still waits in its slot for the
                        truck — the permit is paper too. */}
                    {container.exitedAt !== null && (
                      <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-amber-600">
                        {AR.permitExited}
                      </span>
                    )}
                    {priorPermits.has(container.id) && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        {AR.permitAlready((priorPermits.get(container.id) ?? []).join('، '))}
                      </span>
                    )}
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 ps-7">
                    <span className="shrink-0 font-mono text-xs text-muted" dir="ltr">
                      {cardSerial(container.cardIn, container.cardInYear) ?? '—'}
                    </span>
                    <span className="shrink-0 text-xs text-muted" dir="ltr">
                      {formatDateOnly(container.enteredAt)}
                    </span>
                    <input
                      dir="ltr"
                      placeholder={AR.colWeight}
                      disabled={!on}
                      className={`${inputClass} ms-auto w-24 py-1 text-start text-sm disabled:opacity-40`}
                      value={weights[container.id] ?? ''}
                      onChange={(event) => {
                        setWeights({ ...weights, [container.id]: event.target.value });
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <ErrorLine message={error} />

          <Button type="submit" full disabled={busy || picked.size === 0}>
            {AR.permitIssue}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
