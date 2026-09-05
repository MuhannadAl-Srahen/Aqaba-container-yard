import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { ContainerDto, Position, Tier, Zone, ZoneDef } from '../shared/types';
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
  /**
   * «عرض الموقع» من مهمة آلية: the container this sheet was opened FOR —
   * its cell wears an amber ring so the driver's eye lands on it at once.
   */
  highlightId?: number | undefined;
  /** Set while a move is placing: the container looking for its new slot. */
  placing: ContainerDto | null;
  /**
   * طابور النقل — «اذا ضغطت على حاوية ثانية بحط الحاوية الاولى والثانية»:
   * while a move is placing, tapping a STANDING container queues it to be
   * moved right after, instead of opening its card. Absent when queueing
   * is not available (no move in flight, or a correction).
   */
  onAddToMove?: ((container: ContainerDto) => void) | undefined;
  /**
   * النقل الجماعي — «بدي انقل كمية من الحاويات مره وحده»: hand the checked
   * containers up; the map then takes ONE destination bay and the planner
   * does the rest. Absent while a single move is already placing.
   */
  onGroupMove?: ((containers: readonly ContainerDto[]) => void) | undefined;
  /**
   * السحب والإفلات: a container held and dropped on a legal cell of this
   * same sheet — the caller runs it through the usual move confirmation.
   */
  onDragMove?: ((container: ContainerDto, to: Position) => void) | undefined;
  /**
   * السحب خارج الورقة — «اقدر اسحبها بره البلوكة»: dragged past the card,
   * the sheet steps aside and the map shows; dropped on a bay tile, the
   * caller plans the landing there.
   */
  onDragOut?: ((container: ContainerDto, target: { zone: Zone; bay: number }) => void) | undefined;
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
  /** تحديد للنقل: which of this bay's containers ride the group move. */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const canGroup = props.onGroupMove !== undefined && placing === null && props.canMove;

  /**
   * السحب والإفلات — «اذا ضليت ماسك حاوية جوا البلوك وامشي فيها براحتي»,
   * and «النقل بعمله ع التلفون اغلب الوقت»: hold a container ~0.4s and it
   * comes off the grid under the finger; the cells that take it glow; let
   * go over one and the usual confirmation moves it — card and all. A
   * quick tap stays a tap. Pointer events serve mouse and touch alike;
   * scrolling stays free everywhere (a FULL bay taught us why) and is
   * suppressed only for the lifetime of an actual drag, by the touchmove
   * guard below.
   */
  const [drag, setDrag] = useState<{
    container: ContainerDto;
    x: number;
    y: number;
    live: boolean;
  } | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  /** Dragged past the card: the sheet steps aside so the map shows through. */
  const [peek, setPeek] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const holdTimer = useRef<number | null>(null);
  const downAt = useRef<{ x: number; y: number; container: ContainerDto } | null>(null);
  /** The click that trails a finished drag must not open a card. */
  const dragHappened = useRef(false);
  const canDrag = props.canMove && placing === null && !selecting;

  /** Where the dragged container may land in THIS sheet: cell → position. */
  const dragTargets = useMemo((): ReadonlyMap<string, Position> => {
    const map = new Map<string, Position>();
    if (drag === null) return map;
    for (const spot of bayLandings(
      props.layout,
      zone,
      bay,
      props.containers,
      drag.container.size,
      drag.container.id,
    )) {
      const cell = `${String(spot.stack)}|${spot.tier}`;
      if (!map.has(cell)) map.set(cell, spot);
    }
    return map;
  }, [drag, props.layout, props.containers, zone, bay]);

  /**
   * «ما بقدر احرك الـscroll بالتلفون اذا كان الحاويات ماكنهم فلل»: the
   * cells used to carry touch-action:none, and a FULL bay left no empty
   * ground to scroll from. The cells scroll freely again now; the browser
   * is barred from scrolling only from the moment a hold actually becomes
   * a drag — a non-passive touchmove guard armed right then, torn down
   * with the drag. Before the hold completes, a moving finger is a scroll
   * and cancels the lift, exactly as before.
   */
  const touchGuard = useRef<((event: TouchEvent) => void) | null>(null);
  const armTouchGuard = (): void => {
    if (touchGuard.current !== null) return;
    const guard = (event: TouchEvent): void => {
      event.preventDefault();
    };
    touchGuard.current = guard;
    window.addEventListener('touchmove', guard, { passive: false });
  };
  const disarmTouchGuard = (): void => {
    if (touchGuard.current !== null) {
      window.removeEventListener('touchmove', touchGuard.current);
      touchGuard.current = null;
    }
  };
  useEffect(() => disarmTouchGuard, []);

  const endDrag = (): void => {
    disarmTouchGuard();
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    downAt.current = null;
    setDrag(null);
    setHoverCell(null);
    setPeek(false);
    window.setTimeout(() => {
      dragHappened.current = false;
    }, 80);
  };

  // The window listeners live for the length of ONE drag; everything they
  // read rides in refs so the subscription never churns per pointer frame.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const targetsRef = useRef(dragTargets);
  targetsRef.current = dragTargets;
  const dropRef = useRef(props.onDragMove);
  dropRef.current = props.onDragMove;
  const dragOutRef = useRef(props.onDragOut);
  dragOutRef.current = props.onDragOut;
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const cellUnder = (event: PointerEvent): string | null =>
      document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-drop-cell]')
        ?.getAttribute('data-drop-cell') ?? null;
    const onMove = (event: PointerEvent): void => {
      event.preventDefault();
      setDrag((current) =>
        current === null ? null : { ...current, x: event.clientX, y: event.clientY },
      );
      setHoverCell(cellUnder(event));
      // «اقدر اسحبها بره البلوكة»: carried past the card, the sheet steps
      // aside and the yard shows through — carried back in, it returns.
      const card = cardRef.current?.getBoundingClientRect();
      if (card !== undefined) {
        const outside =
          event.clientX < card.left ||
          event.clientX > card.right ||
          event.clientY < card.top ||
          event.clientY > card.bottom;
        setPeek(outside);
      }
    };
    const onUp = (event: PointerEvent): void => {
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const mover = dragRef.current?.container;
      // Inside the sheet: an empty cell takes it — and dropping ON a
      // standing container means the tier ABOVE it, exactly as the owner
      // said it: «انقلها فوق الثانية، تصير الثانية طابق اول».
      const cell = under?.closest('[data-drop-cell]')?.getAttribute('data-drop-cell') ?? null;
      let landing = cell === null ? undefined : targetsRef.current.get(cell);
      if (landing === undefined) {
        const onTop = under?.closest('[data-stack-cell]')?.getAttribute('data-stack-cell') ?? null;
        if (onTop !== null) {
          const [stackText, tier] = onTop.split('|');
          const above = tier === 'A' ? 'B' : tier === 'B' ? 'C' : null;
          if (above !== null) landing = targetsRef.current.get(`${stackText ?? ''}|${above}`);
        }
      }
      // Outside the sheet: a bay tile of the map names the destination.
      const mapBay =
        landing === undefined
          ? (under?.closest('[data-map-bay]')?.getAttribute('data-map-bay') ?? null)
          : null;
      endDrag();
      if (mover === undefined) return;
      if (landing !== undefined) {
        dropRef.current?.(mover, landing);
        return;
      }
      if (mapBay !== null) {
        const [zoneText, bayText] = mapBay.split('|');
        const bayNumber = Number(bayText);
        if (zoneText !== undefined && Number.isInteger(bayNumber)) {
          dragOutRef.current?.(mover, { zone: zoneText as Zone, bay: bayNumber });
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [dragActive]);

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
      const checked = selecting && selected.has(container.id);
      const beingDragged = drag !== null && drag.container.id === container.id;
      return (
        <button
          key={`${String(stack)}${tier}`}
          type="button"
          data-stack-cell={`${String(stack)}|${tier}`}
          onPointerDown={(event) => {
            if (!canDrag || props.onDragMove === undefined) return;
            downAt.current = { x: event.clientX, y: event.clientY, container };
            if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
            holdTimer.current = window.setTimeout(() => {
              const held = downAt.current;
              if (held !== null && held.container.id === container.id) {
                dragHappened.current = true;
                // From this instant the finger's movement is a DRAG, never
                // a scroll — the guard comes off with the drag.
                armTouchGuard();
                setDrag({ container, x: held.x, y: held.y, live: true });
              }
            }, 400);
          }}
          onPointerCancel={() => {
            // The browser took the gesture for a scroll before the hold
            // completed — no lift, then.
            if (drag === null && holdTimer.current !== null) {
              window.clearTimeout(holdTimer.current);
              holdTimer.current = null;
              downAt.current = null;
            }
          }}
          onContextMenu={(event) => {
            // Android's long-press menu and the drag start from the same
            // gesture; the drag wins.
            if (canDrag) event.preventDefault();
          }}
          onPointerMove={(event) => {
            const held = downAt.current;
            if (drag !== null || held === null) return;
            // A slip before the hold fires is a scroll, not a lift.
            if (
              Math.abs(event.clientX - held.x) + Math.abs(event.clientY - held.y) > 10 &&
              holdTimer.current !== null
            ) {
              window.clearTimeout(holdTimer.current);
              holdTimer.current = null;
              downAt.current = null;
            }
          }}
          onPointerUp={() => {
            if (drag === null && holdTimer.current !== null) {
              window.clearTimeout(holdTimer.current);
              holdTimer.current = null;
              downAt.current = null;
            }
          }}
          onClick={() => {
            // The click that trails a drag is the drag's own echo.
            if (dragHappened.current) return;
            // تحديد للنقل: a tap marks the container for the group instead
            // of opening its card.
            if (selecting) {
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(container.id)) next.delete(container.id);
                else next.add(container.id);
                return next;
              });
              return;
            }
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
              : 'border-blue-300 bg-blue-100 hover:border-blue-500 dark:border-blue-800 dark:bg-blue-950') +
            (checked ? ' ring-2 ring-emerald-600' : '') +
            (props.highlightId === container.id ? ' ring-2 ring-amber-500' : '') +
            (canDrag ? ' select-none' : '') +
            (beingDragged ? ' opacity-40' : '')
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
    // the yard's own habits, offered, never imposed. And while a container
    // is HELD, the cells that take it glow the same way — let go and it
    // lands.
    const key = `${String(stack)}|${tier}`;
    const lands = landable !== null && landable.has(key);
    const advised = lands && suggested.has(key);
    const catches = drag !== null && dragTargets.has(key);
    const hovered = catches && hoverCell === key;
    return (
      <button
        key={`${String(stack)}${tier}`}
        type="button"
        disabled={!mayPlace}
        title={advised ? AR.suggestedCellTitle : undefined}
        data-drop-cell={key}
        onClick={() => {
          if (dragHappened.current) return;
          setPicked(isPicked ? null : { stack, tier });
        }}
        className={
          'h-14 rounded-lg border text-[10px] font-semibold transition-colors ' +
          (hovered
            ? 'border-emerald-700 bg-emerald-300 font-bold text-emerald-950 ring-2 ring-emerald-600'
            : catches
              ? 'border-emerald-500 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : isPicked
                ? 'border-emerald-600 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                : advised
                  ? 'border-emerald-600 bg-emerald-200 font-bold text-emerald-900 ring-1 ring-emerald-500 hover:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-100'
                  : lands
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:border-emerald-600 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'border-dashed border-line-strong bg-sunken text-faint hover:border-blue-400 disabled:hover:border-line-strong')
        }
      >
        {catches ? AR.dropHere : advised ? AR.slotSuggested : AR.slotEmpty}
      </button>
    );
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        peek ? 'pointer-events-none bg-transparent' : 'bg-slate-900/40'
      }`}
      onClick={() => {
        if (dragHappened.current) return;
        props.onClose();
      }}
    >
      {/* Wide enough for the widest bay the plan has — ten stacks — at the
          size the numbers are now printed. The sheet was capped at 72rem and
          a ten-stack bay no longer fitted, which put a scrollbar under it and
          half a stack out of sight: «ما بدي يكون scroll بدي يبين كله». */}
      <div
        ref={cardRef}
        className={`max-h-[88dvh] w-full max-w-368 overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl${
          peek ? ' invisible' : ''
        }`}
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

        {/* النقل الجماعي: mark the group here, name the destination on the
            map — «خط الباي احيانا بكون فيه 6 حاويات بمكان غير صحيح». */}
        {canGroup && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!selecting ? (
              <Button
                kind="quiet"
                disabled={props.load.length === 0}
                onClick={() => {
                  setSelecting(true);
                }}
              >
                {AR.selectForMove}
              </Button>
            ) : (
              <>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setSelected(new Set(props.load.map((container) => container.id)));
                  }}
                >
                  {AR.selectAllBay}
                </Button>
                <Button
                  disabled={selected.size === 0}
                  onClick={() => {
                    props.onGroupMove?.(
                      props.load.filter((container) => selected.has(container.id)),
                    );
                  }}
                >
                  {AR.moveSelected(selected.size)}
                </Button>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setSelecting(false);
                    setSelected(new Set());
                  }}
                >
                  {AR.selectCancel}
                </Button>
              </>
            )}
          </div>
        )}

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
          {canDrag && props.onDragMove !== undefined ? ` — ${AR.dragHint}` : ''}
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

      {/* The held container rides under the finger. */}
      {drag !== null && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border-2 border-emerald-600 bg-surface px-2 py-1 font-mono text-sm font-bold text-ink shadow-xl"
          style={{ left: drag.x, top: drag.y - 8 }}
          dir="ltr"
        >
          {drag.container.number}
        </div>
      )}
    </div>
  );
}
