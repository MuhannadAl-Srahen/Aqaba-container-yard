import { useMemo, useState, type ReactElement } from 'react';
import type { ContainerDto } from '../shared/types';
import { TIERS } from '../shared/types';
import type { YardLayout } from '../shared/types';
import { fillPlan } from '../shared/rules';
import { AR } from './ar';
import { toStanding } from './mapModel';
import { Sheet } from './ui';

/**
 * «كم باقي على الساحة ان تمتلئ» — answered in CONTAINERS, which is the way
 * the question is asked and the way the old figure could not answer it.
 *
 * Two numbers, because they are two different answers: filling from here with
 * twenties, or with forties. A forty occupies two slots and needs two adjacent
 * odd bays, so it is never simply half.
 *
 * The height is the office's assumption, not the yard's rule: the yard still
 * accepts three tiers everywhere. «مو كل الأماكن بتوخذ 3 طوابق».
 */
export function FillSheet(props: {
  /** The whole effective ground — the plan plus the owner's own zones. */
  layout: YardLayout;
  containers: readonly ContainerDto[];
  onClose: () => void;
}): ReactElement {
  const [height, setHeight] = useState<number>(TIERS.length);
  const standing = useMemo(() => toStanding(props.containers), [props.containers]);
  const plan = useMemo(
    () => fillPlan(props.layout, standing, height),
    [props.layout, standing, height],
  );

  const row = (
    label: string,
    twenties: number,
    forties: number,
    used: number,
    capacity: number,
    strong = false,
  ): ReactElement => (
    <tr key={label} className={strong ? 'bg-sunken font-extrabold text-ink' : 'text-ink'}>
      <td className="border border-line px-2 py-1.5 font-bold">{label}</td>
      <td className="border border-line px-2 py-1.5 text-center tabular-nums" dir="ltr">
        {twenties}
      </td>
      <td className="border border-line px-2 py-1.5 text-center tabular-nums" dir="ltr">
        {forties}
      </td>
      <td className="border border-line px-2 py-1.5 text-center tabular-nums text-muted" dir="ltr">
        {used} / {capacity}
      </td>
    </tr>
  );

  return (
    <Sheet title={AR.fillTitle} onClose={props.onClose}>
      <div className="space-y-4 p-5">
        {/* The assumption, stated and switchable — not hidden in the sums. */}
        <div>
          <p className="mb-1.5 text-sm font-bold text-ink">{AR.fillHeight}</p>
          <div className="grid grid-cols-2 gap-2">
            {[TIERS.length, 2].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setHeight(option);
                }}
                className={
                  'rounded-xl border-2 px-3 py-2 text-sm font-bold transition ' +
                  (height === option
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-line bg-surface text-muted hover:border-blue-400')
                }
              >
                {AR.fillTiers(option)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs leading-5 text-faint">{AR.fillHeightHint}</p>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-sunken text-xs font-bold text-muted">
              <th className="border border-line px-2 py-1.5 text-start">{AR.fillZone}</th>
              <th className="border border-line px-2 py-1.5">{AR.fillTwenties}</th>
              <th className="border border-line px-2 py-1.5">{AR.fillForties}</th>
              <th className="border border-line px-2 py-1.5">{AR.fillUsed}</th>
            </tr>
          </thead>
          <tbody>
            {plan.zones.map((zone) =>
              row(
                AR.zoneTitle(zone.zone, zone.yard),
                zone.twenties,
                zone.forties,
                zone.used,
                zone.capacity,
              ),
            )}
            {row(
              AR.totalRow,
              plan.total.twenties,
              plan.total.forties,
              plan.total.used,
              plan.total.capacity,
              true,
            )}
          </tbody>
        </table>

        <p className="rounded-xl bg-sunken px-3 py-2.5 text-xs leading-6 text-muted">
          {AR.fillExplain}
        </p>
      </div>
    </Sheet>
  );
}
