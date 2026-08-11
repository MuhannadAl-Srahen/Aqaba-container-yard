import { Fragment, useMemo, useState, type ReactElement } from 'react';
import type { ContainerDto, Position, Tier, ZoneDef } from '../shared/types';
import { TIERS } from '../shared/types';
import { ASEZA } from '../shared/asezaLayout';
import { positionLabel, bayLabel } from '../shared/address';
import { canPlace } from '../shared/rules';
import { AR } from './ar';
import { maxStackOf, slotView, toStanding } from './mapModel';
import { Button, useEscape } from './ui';

/**
 * One bay opened flat: every stack across, the two tiers over each other —
 * B drawn above A the way the containers actually stand. Each cell is either
 * the wall, somebody (tap → their card), or an empty slot; tapping an empty
 * slot offers exactly the landings the rules allow there, including the 40
 * that would lie across into the neighbouring bay.
 *
 * The same sheet places a container being moved: `placing` swaps the wording
 * from «حط هون» to «انقلها لهون» and the rules ignore its current slot.
 */
export function BaySheet(props: {
  zone: ZoneDef;
  /** The odd bay this sheet opens. */
  bay: number;
  /** Everything standing in the yard — the rules need all of it. */
  containers: readonly ContainerDto[];
  /** Whoever covers this odd bay, both tiers, spanning 40s included. */
  load: readonly ContainerDto[];
  canGateIn: boolean;
  canMove: boolean;
  /** Set while a move is placing: the container looking for its new slot. */
  placing: ContainerDto | null;
  onPick: (container: ContainerDto) => void;
  onGateIn: (position: Position) => void;
  onMoveTo: (position: Position) => void;
  onClose: () => void;
}): ReactElement {
  useEscape(props.onClose);
  const { zone, bay, placing } = props;
  const maxStack = maxStackOf(zone);
  const stacks = useMemo(
    () => Array.from({ length: maxStack }, (_, i) => i + 1),
    [maxStack],
  );
  const [picked, setPicked] = useState<{ stack: number; tier: Tier } | null>(null);

  const standing = useMemo(() => {
    const all = toStanding(props.containers);
    return placing === null ? all : all.filter((s) => s.id !== placing.id);
  }, [props.containers, placing]);

  /** The legal landings from the picked cell — 20 here, or a 40 across. */
  const options = useMemo(() => {
    if (picked === null) return [];
    const ignoreId = placing?.id;
    const list: Array<{ position: Position; caption: string }> = [];
    const try20 = placing === null || placing.size === 20;
    const try40 = placing === null || placing.size === 40;
    if (try20) {
      const here: Position = { zone: zone.zone, bay, stack: picked.stack, tier: picked.tier };
      if (canPlace(ASEZA, standing, 20, here, ignoreId) === null) {
        list.push({ position: here, caption: placing === null ? AR.put20Here : AR.moveHere });
      }
    }
    if (try40) {
      for (const even of [bay - 1, bay + 1]) {
        if (even < 2) continue;
        const across: Position = { zone: zone.zone, bay: even, stack: picked.stack, tier: picked.tier };
        if (canPlace(ASEZA, standing, 40, across, ignoreId) === null) {
          const other = String(even === bay - 1 ? bay - 2 : bay + 2).padStart(2, '0');
          list.push({
            position: across,
            caption: placing === null ? AR.put40With(other) : AR.move40With(other),
          });
        }
      }
    }
    return list;
  }, [picked, placing, standing, zone, bay]);

  const mayPlace = placing === null ? props.canGateIn : props.canMove;
  const capacity = (zone.stacks[String(bay)]?.length ?? 0) * TIERS.length;
  const used = props.load.length;
  /** Drawn the way the stack stands: the top tier first, the ground last. */
  const tiersTopDown = useMemo(() => [...TIERS].reverse(), []);

  const cell = (stack: number, tier: Tier): ReactElement => {
    const view = slotView(zone, bay, stack, tier, props.load);
    const isPicked = picked !== null && picked.stack === stack && picked.tier === tier;
    if (view.kind === 'wall') {
      return (
        <div
          key={`${String(stack)}${tier}`}
          className="slot-wall flex h-14 items-center justify-center rounded-lg text-[10px] font-semibold text-faint"
        >
          {AR.slotWall}
        </div>
      );
    }
    if (view.kind === 'taken') {
      const container = view.container;
      return (
        <button
          key={`${String(stack)}${tier}`}
          type="button"
          onClick={() => {
            props.onPick(container);
          }}
          className={
            'flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-center ' +
            // Dangerous goods outrank the size colour: the crew has to see
            // which box it is before they decide anything about it.
            (container.hazmat
              ? 'border-2 border-danger-line bg-danger-soft hover:border-danger'
              : container.size === 40
                ? 'border-indigo-300 bg-indigo-100 hover:border-indigo-500 dark:border-indigo-800 dark:bg-indigo-950'
                : 'border-blue-300 bg-blue-100 hover:border-blue-500 dark:border-blue-800 dark:bg-blue-950')
          }
          title={container.hazmat ? `${container.number} — ${AR.hazmat}` : container.number}
        >
          <span
            className={`w-full font-mono text-[11px] font-bold tracking-tight ${container.hazmat ? 'text-danger' : 'text-ink'}`}
            dir="ltr"
          >
            {container.number}
          </span>
          <span
            className={`rounded px-1 text-[9px] font-bold ${container.hazmat ? 'bg-danger text-white' : 'bg-surface text-muted'}`}
            dir="ltr"
          >
            {container.hazmat ? AR.hazmatShort : container.size === 40 ? AR.size40Chip : AR.size20Chip}
          </span>
        </button>
      );
    }
    return (
      <button
        key={`${String(stack)}${tier}`}
        type="button"
        disabled={!mayPlace}
        onClick={() => {
          setPicked(isPicked ? null : { stack, tier });
        }}
        className={
          'h-14 rounded-lg border text-[10px] font-semibold transition-colors ' +
          (isPicked
            ? 'border-emerald-600 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
            : 'border-dashed border-line-strong bg-sunken text-faint hover:border-blue-400 disabled:hover:border-line-strong')
        }
      >
        {AR.slotEmpty}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={props.onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-mono text-lg font-extrabold text-ink" dir="ltr">
            {bayLabel(zone.zone, bay)}
          </h3>
          <span className="text-xs font-semibold text-muted">
            {AR.zoneTitle(zone.zone, zone.yard)}
          </span>
          <span
            className={
              'rounded-lg px-2 py-0.5 text-sm font-bold ' +
              (used >= capacity && capacity > 0 ? 'bg-blue-800 text-white' : 'bg-sunken text-muted')
            }
          >
            {used >= capacity && capacity > 0 ? AR.bayFull : AR.bayHas(used, capacity)}
          </span>
        </div>

        {/* The grid, LTR like the plan: stack 01 first, tier B over tier A.
            A cell is never narrower than a full container number — a truncated
            «TCLU1757…» is the one thing this sheet exists to show. Ten stacks
            at that width can outrun a phone, so the grid scrolls sideways
            rather than squeezing. */}
        <div className="-mx-1 mt-4 space-y-1.5 overflow-x-auto px-1 pb-1" dir="ltr">
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: `2.6rem repeat(${String(maxStack)}, minmax(5.75rem, 1fr))`,
            }}
          >
            <div />
            {stacks.map((stack) => (
              <div key={stack} className="text-center font-mono text-[11px] font-bold text-faint">
                {AR.stackShort(stack)}
              </div>
            ))}
            {tiersTopDown.map((tier) => (
              <Fragment key={tier}>
                <div className="flex items-center justify-center rounded-lg bg-sunken font-mono text-sm font-extrabold text-muted">
                  {tier}
                </div>
                {stacks.map((stack) => cell(stack, tier))}
              </Fragment>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-faint" dir="rtl">
          {AR.tierCName} · {AR.tierBName} · {AR.tierAName} — {AR.fortySpans}
        </p>

        {/* The landing choices for the picked empty slot. */}
        {picked !== null && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-sunken p-3">
            <span className="font-mono text-xs font-bold text-muted" dir="ltr">
              {positionLabel({ zone: zone.zone, bay, stack: picked.stack, tier: picked.tier })}
            </span>
            {options.length === 0 && (
              <span className="text-xs font-semibold text-red-600">{AR.noLandingHere}</span>
            )}
            {options.map((option) => (
              <Button
                key={positionLabel(option.position)}
                onClick={() => {
                  if (placing === null) props.onGateIn(option.position);
                  else props.onMoveTo(option.position);
                }}
              >
                {option.caption}
              </Button>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button kind="quiet" onClick={props.onClose}>
            {AR.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
