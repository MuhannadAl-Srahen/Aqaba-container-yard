import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, PermitDto } from '../shared/types';
import { cardSerial } from '../shared/types';
import { findTruck } from '../shared/fleet';
import { AR } from './ar';
import { ApiFailure, api, formatDateOnly } from './api';
import { Button, ErrorLine, Sheet, inputClass } from './ui';

/**
 * Issuing a تصريح تحميل وخروج داخلي: the bill's containers, each with a
 * checkbox and the plate of the truck that will carry it out. Standing and
 * departed alike — the office records the gate exit first and prints this
 * paper after, so a departed box is listed too, its exit truck already in
 * the field. The plate is a suggestion field like the gate's — a registered
 * truck names its carrier as it is typed — and may stay blank, to be
 * written on the printed paper by hand at loading time.
 */
export function PermitSheet(props: {
  bill: string;
  /** The bill's containers as the register already holds them. */
  containers: readonly ContainerDto[];
  onDone: (permit: PermitDto, message: string) => void;
  onClose: () => void;
}): ReactElement {
  const listed = props.containers;
  /** Checked by default: a permit is usually the whole group. */
  const [picked, setPicked] = useState<ReadonlySet<number>>(
    () => new Set(listed.map((container) => container.id)),
  );
  /** A departed box already knows its truck — the one that took it out. */
  const [trucks, setTrucks] = useState<Readonly<Record<number, string>>>(() =>
    Object.fromEntries(
      listed
        .filter((container) => container.position === null && container.truckOut !== '')
        .map((container) => [container.id, container.truckOut]),
    ),
  );
  /** «اريد وضع خانة للوزن ايضا»: prefilled from the record, editable, and
   * whatever stands here at issue time is what the stamped paper reads. */
  const [weights, setWeights] = useState<Readonly<Record<number, string>>>(() =>
    Object.fromEntries(listed.map((container) => [container.id, container.weight])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fleet = useQuery({ queryKey: ['fleet'], queryFn: api.fleet, staleTime: 60_000 });

  const toggle = (id: number): void => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const submit = (): void => {
    const items = listed
      .filter((container) => picked.has(container.id))
      .map((container) => ({
        containerId: container.id,
        truck: (trucks[container.id] ?? '').trim(),
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

          <ul className="divide-y divide-line rounded-xl border border-line">
            {listed.map((container) => {
              const on = picked.has(container.id);
              const plate = trucks[container.id] ?? '';
              const match = findTruck(fleet.data?.trucks ?? [], plate);
              const home =
                match === null
                  ? null
                  : (fleet.data?.carriers.find((c) => c.id === match.carrierId) ?? null);
              // Quiet lines, never a squeeze: the box and its badges first,
              // then the entry facts — and on a narrow panel the weight and
              // plate inputs WRAP onto their own line rather than overflow.
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
                    {container.position === null && (
                      <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-amber-600">
                        {AR.permitExited}
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
                      className={`${inputClass} ms-auto w-20 py-1 text-start text-sm disabled:opacity-40`}
                      value={weights[container.id] ?? ''}
                      onChange={(event) => {
                        setWeights({ ...weights, [container.id]: event.target.value });
                      }}
                    />
                    <input
                      dir="ltr"
                      placeholder={AR.colPermitTruck}
                      disabled={!on}
                      className={`${inputClass} w-28 py-1 text-start text-sm disabled:opacity-40`}
                      value={plate}
                      onChange={(event) => {
                        setTrucks({ ...trucks, [container.id]: event.target.value });
                      }}
                    />
                  </div>
                  {home !== null && (
                    <p className="mt-1 truncate ps-7 text-xs font-semibold text-emerald-600">
                      {AR.carrierChip(home.name)}
                    </p>
                  )}
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
