import { Fragment, useMemo, useState, type ReactElement } from 'react';
import type { ContainerDto, Position, Tier, ZoneDef } from '../shared/types';
import { TIERS } from '../shared/types';
import type { YardLayout } from '../shared/types';
import { positionLabel, bayLabel } from '../shared/address';
import { canPlace } from '../shared/rules';
import { AR } from './ar';
import { bayLandings, maxStackOf, slotView, suggestedCells, toStanding } from './mapModel';
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
  /** The whole effective ground — the rules judge against all of it. */
  layout: YardLayout;
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
  /**
   * طابور النقل — «اذا ضغطت على حاوية ثانية بحط الحاوية الاولى والثانية»:
   * while a move is placing, tapping a STANDING container queues it to be
   * moved right after, instead of opening its card. Absent when queueing
   * is not available (no move in flight, or a correction).
   */
  onAddToMove?: ((container: ContainerDto) => void) | undefined;
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

  /**
   * While a container is being placed: the cells of THIS sheet that hold at
   * least one legal landing for it, keyed `stack|tier`. They glow before
   * anything is picked — the owner stood before a grid of identical «فارغ»
   * cells and guessed, and the one he guessed had no free partner.
   */
  const landable = useMemo((): ReadonlySet<string> | null => {
    if (placing === null) return null;
    const spots = bayLandings(props.layout, zone, bay, props.containers, placing.size, placing.id);
    return new Set(spots.map((spot) => `${String(spot.stack)}|${spot.tier}`));
  }, [placing, props.layout, props.containers, zone, bay]);

  /**
   * مقترحات المكان: the darker cells among the legal ones — singles beside
   * singles, a group beside its own bill, the third tier for the light box
   * on the face of the رصة. Advice; the crane still decides.
   */
  const suggested = useMemo((): ReadonlySet<string> => {
    if (placing === null) return new Set<string>();
    return suggestedCells(props.layout, zone, bay, props.containers, placing);
  }, [placing, props.layout, props.containers, zone, bay]);

  /**
   * The legal landings from the picked cell — 20 here, or a 40 across. And
   * when a way is CLOSED while a container is being placed, the reason by
   * name: a forty's partner cell lives on another bay's sheet, so «الخانة
   * فارغة» here says nothing about the ground next door.
   */
  const options = useMemo(() => {
    const list: Array<{ position: Position; caption: string }> = [];
    const blocked: string[] = [];
    if (picked === null) return { list, blocked };
    const ignoreId = placing?.id;
    const try20 = placing === null || placing.size === 20;
    const try40 = placing === null || placing.size === 40;
    if (try20) {
      const here: Position = { zone: zone.zone, bay, stack: picked.stack, tier: picked.tier };
      const refusal = canPlace(props.layout, standing, 20, here, ignoreId);
      if (refusal === null) {
        list.push({ position: here, caption: placing === null ? AR.put20Here : AR.moveHere });
      } else if (placing !== null && refusal.code === 'NO_SUPPORT') {
        blocked.push(AR.noLanding20NoSupport);
      }
    }
    if (try40) {
      for (const even of [bay - 1, bay + 1]) {
        if (even < 2) continue;
        const partnerBay = even === bay - 1 ? bay - 2 : bay + 2;
        const across: Position = { zone: zone.zone, bay: even, stack: picked.stack, tier: picked.tier };
        const refusal = canPlace(props.layout, standing, 40, across, ignoreId);
        if (refusal === null) {
          list.push({
            position: across,
            caption:
              placing === null
                ? AR.put40With(String(partnerBay).padStart(2, '0'))
                : AR.move40With(String(partnerBay).padStart(2, '0')),
          });
        } else if (placing !== null && placing.size === 40) {
          const evenLabel = String(even).padStart(2, '0');
          if (refusal.code === 'OCCUPIED') {
            // The picked cell is empty on THIS sheet, so the occupier can
            // only be standing on the partner's half of the pair.
            blocked.push(
              AR.noLanding40Occupied(
                evenLabel,
                positionLabel({
                  zone: zone.zone,
                  bay: partnerBay,
                  stack: picked.stack,
                  tier: picked.tier,
                }),
                refusal.other ?? '',
              ),
            );
          } else if (refusal.code === 'NO_SUPPORT') {
            blocked.push(AR.noLanding40NoSupport(evenLabel));
          } else {
            blocked.push(AR.noLanding40NoGround(evenLabel, String(partnerBay).padStart(2, '0')));
          }
        }
      }
    }
    return { list, blocked };
  }, [picked, placing, standing, zone, bay, props.layout]);

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
            // Mid-move, a standing container joins the move instead of
            // opening its card — the queue, exactly as the owner asked.
            if (placing !== null && props.onAddToMove !== undefined && container.id !== placing.id) {
              props.onAddToMove(container);
              return;
            }
            props.onPick(container);
          }}
          className={
            'flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-center ' +
            (container.size === 40
              ? 'border-indigo-300 bg-indigo-100 hover:border-indigo-500 dark:border-indigo-800 dark:bg-indigo-950'
              : 'border-blue-300 bg-blue-100 hover:border-blue-500 dark:border-blue-800 dark:bg-blue-950')
          }
          title={
            container.bill === ''
              ? container.number
              : `${container.number} — ${AR.bill} ${container.bill}`
          }
        >
          <span
            className="w-full font-mono text-[13px] font-bold leading-4 tracking-tight text-ink"
            dir="ltr"
          >
            {container.number}
          </span>
          {/* Three facts, and the bay sheet is where all three are wanted at
              once: which box, what class, and whose bill. The bill is what
              answers «هل هذول من نفس البوليصة ولا منفصلة» without opening a
              single container — so it is read straight off the grid.

              It takes a LINE OF ITS OWN rather than sitting beside the class:
              a bill of nine digits at a size that can be read across a desk
              needs the cell's full width, and beside the chip it would be
              sawn off — «بتقدر تكبر هاي الخط تبعها شوي». */}
          <span
            className="shrink-0 rounded bg-surface px-1.5 text-[13px] font-extrabold leading-4 text-ink"
            dir="ltr"
          >
            {container.size === 40 ? AR.size40Chip : AR.size20Chip}
          </span>
          {container.bill !== '' && (
            <span
              className="w-full truncate font-mono text-[13px] font-bold leading-4 text-muted"
              dir="ltr"
            >
              {container.bill}
            </span>
          )}
        </button>
      );
    }
    // While placing, the cells that actually take the container glow — the
    // rest stay plain, so «فارغ» stops promising ground a forty's partner
    // bay has already spent. The SUGGESTED cells among them glow darker:
    // the yard's own habits, offered, never imposed.
    const key = `${String(stack)}|${tier}`;
    const lands = landable !== null && landable.has(key);
    const advised = lands && suggested.has(key);
    return (
      <button
        key={`${String(stack)}${tier}`}
        type="button"
        disabled={!mayPlace}
        title={advised ? AR.suggestedCellTitle : undefined}
        onClick={() => {
          setPicked(isPicked ? null : { stack, tier });
        }}
        className={
          'h-14 rounded-lg border text-[10px] font-semibold transition-colors ' +
          (isPicked
            ? 'border-emerald-600 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
            : advised
              ? 'border-emerald-600 bg-emerald-200 font-bold text-emerald-900 ring-1 ring-emerald-500 hover:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-100'
              : lands
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:border-emerald-600 dark:bg-emerald-950 dark:text-emerald-300'
                : 'border-dashed border-line-strong bg-sunken text-faint hover:border-blue-400 disabled:hover:border-line-strong')
        }
      >
        {advised ? AR.slotSuggested : AR.slotEmpty}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={props.onClose}
    >
      {/* Wide enough for the widest bay the plan has — ten stacks — at the
          size the numbers are now printed. The sheet was capped at 72rem and
          a ten-stack bay no longer fitted, which put a scrollbar under it and
          half a stack out of sight: «ما بدي يكون scroll بدي يبين كله». */}
      <div
        className="max-h-[88dvh] w-full max-w-368 overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl"
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
            A cell is never narrower than a full container number AT THE SIZE
            IT IS PRINTED — a truncated «TCLU1757…» is the one thing this sheet
            exists to show — plus the class and the bill beneath it. The floor
            is set to exactly that and no more, so the widest bay on the plan
            still fits a desk screen whole. Wider screens spread the cells out;
            only a phone gets the sideways scroll it cannot avoid. */}
        <div className="-mx-1 mt-4 space-y-1.5 overflow-x-auto px-1 pb-1" dir="ltr">
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: `2.4rem repeat(${String(maxStack)}, minmax(6.75rem, 1fr))`,
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
        {landable !== null && (
          <p
            className={
              'mt-1 text-xs font-semibold leading-5 ' +
              (landable.size === 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')
            }
            dir="rtl"
          >
            {landable.size === 0
              ? AR.landingNoneInBay
              : suggested.size > 0
                ? `${AR.landingHint} ${AR.suggestionHint}`
                : AR.landingHint}
          </p>
        )}

        {/* The landing choices for the picked empty slot — and when a way is
            closed, the reason by name instead of a bare refusal. */}
        {picked !== null && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-sunken p-3">
            <span className="font-mono text-xs font-bold text-muted" dir="ltr">
              {positionLabel({ zone: zone.zone, bay, stack: picked.stack, tier: picked.tier })}
            </span>
            {options.list.length === 0 && options.blocked.length === 0 && (
              <span className="text-xs font-semibold text-red-600">{AR.noLandingHere}</span>
            )}
            {options.list.length === 0 &&
              options.blocked.map((reason) => (
                <span key={reason} className="w-full text-xs font-semibold leading-5 text-red-600">
                  {reason}
                </span>
              ))}
            {options.list.map((option) => (
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
