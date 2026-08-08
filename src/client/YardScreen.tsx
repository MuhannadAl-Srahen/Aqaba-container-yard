import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContainerDto, LocationState, Position } from '../shared/types';
import { GROUND_TIER, LOCATION_STATES, MIXED_SIZE } from '../shared/types';
import { positionKey, sameSlot, slotKey } from '../shared/address';
import { blockOf, canPlace, type SlotStates } from '../shared/rules';
import { blockTakes } from '../shared/geometry';
import { ApiFailure, api } from './api';
import { AR } from './ar';
import { YardMap, computeLayout, type ViewTier } from './YardMap';
import { ReportsScreen } from './ReportsScreen';
import { LogScreen } from './LogScreen';
import { PrintCard } from './PrintCard';
import {
  buildStacks,
  labelerFrom,
  legalTargets,
  searchMatches,
  summarizeBlock,
  toStanding,
  type SlotStack,
} from './mapModel';
import { usePanZoom } from './usePanZoom';
import { GateInSheet } from './GateInSheet';
import { ContainerCard } from './ContainerCard';
import { YardEditor } from './YardEditor';
import { Button, Confirm, Toast, useEscape } from './ui';

/** Below this zoom a cell is a few pixels — hover feedback means nothing. */
const HOVER_MIN_SCALE = 0.5;

/** Stable empty record so memo deps hold still while the state loads. */
const NO_SLOT_STATES: SlotStates = {};

/**
 * The one screen. The yard drawing is the interface: receiving, moving and
 * releasing all start with a tap on the ground itself.
 */
export function YardScreen(props: { onUnauthorized: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<ViewTier>(GROUND_TIER);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContainerDto | null>(null);
  const [gateInAt, setGateInAt] = useState<Position | null>(null);
  const [moving, setMoving] = useState<ContainerDto | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ container: ContainerDto; to: Position } | null>(
    null,
  );
  const [stackChoice, setStackChoice] = useState<SlotStack | null>(null);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [logView, setLogView] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [printCard, setPrintCard] = useState<{ kind: 'in' | 'out'; container: ContainerDto } | null>(
    null,
  );
  const [slotStateAt, setSlotStateAt] = useState<Position | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const state = useQuery({
    queryKey: ['state'],
    queryFn: api.state,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (state.error instanceof ApiFailure && state.error.code === 'UNAUTHORIZED') {
      props.onUnauthorized();
    }
  }, [state.error, props]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const yard = state.data?.yard ?? null;
  const containers = useMemo(() => state.data?.containers ?? [], [state.data]);
  const stacks = useMemo(() => buildStacks(containers), [containers]);
  const layout = useMemo(() => (yard === null ? null : computeLayout(yard)), [yard]);
  const label = useMemo(() => labelerFrom(state.data?.blockNames ?? {}), [state.data]);
  const slotStates = state.data?.slotStates ?? NO_SLOT_STATES;

  const matches = useMemo(() => searchMatches(containers, search), [containers, search]);
  const searchActive = search.trim() !== '';

  const targets = useMemo(() => {
    if (yard === null || moving === null) return null;
    return legalTargets(yard, containers, slotStates, moving.size, moving.id);
  }, [yard, containers, slotStates, moving]);

  // Out-of-yard hits come from the server: the map query only carries who is standing.
  const remote = useQuery({
    queryKey: ['search', search.trim()],
    queryFn: () => api.search(search.trim()),
    enabled: search.trim().length >= 2,
  });
  const departedResults = useMemo(
    () => (remote.data?.results ?? []).filter((c) => c.position === null),
    [remote.data],
  );

  const pz = usePanZoom(layout?.width ?? 0, layout?.height ?? 0);
  const { wasDrag } = pz;

  const refresh = (message: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['state'] });
    void queryClient.invalidateQueries({ queryKey: ['container'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
    setToast(message);
    setSelected(null);
    setGateInAt(null);
    setMoving(null);
    setConfirmMove(null);
    setStackChoice(null);
    setSlotStateAt(null);
    setBusy(false);
  };

  const handleCell = (position: Position, stack: SlotStack): void => {
    if (yard === null) return;

    if (moving !== null) {
      if (targets !== null && targets.has(positionKey(position))) {
        setConfirmMove({ container: moving, to: position });
        return;
      }
      // Not a green target: say why in words instead of ignoring the tap.
      if (
        moving.position !== null &&
        sameSlot(moving.position, position) &&
        moving.position.tier === position.tier
      ) {
        setToast(AR.errors.SAME_SLOT);
        return;
      }
      const refusal = canPlace(
        yard,
        toStanding(containers),
        slotStates,
        moving.size,
        position,
        moving.id,
      );
      if (refusal !== null) {
        setToast(
          'by' in refusal ? AR.errorWithBy(refusal.code, refusal.by) : AR.errors[refusal.code],
        );
        return;
      }
      // Legal by the fresh rules but missing from the (≤15 s old) target
      // set: trust the rules — the server re-checks inside its transaction.
      setConfirmMove({ container: moving, to: position });
      return;
    }

    const occupant = position.tier === GROUND_TIER ? stack.ground : stack.upper;

    // One overlay at a time: tapping a new cell closes whatever was open,
    // never stacks a second sheet behind the first.
    setSelected(null);
    setGateInAt(null);
    setStackChoice(null);
    setSlotStateAt(null);

    // Two containers on this ground: ask which one is meant. In the الكل
    // view both halves are visible separately, so the tap is unambiguous.
    if (
      tier !== 'ALL' &&
      position.tier === GROUND_TIER &&
      stack.ground !== undefined &&
      stack.upper !== undefined
    ) {
      setStackChoice(stack);
      return;
    }

    if (occupant !== undefined) {
      setSelected(occupant);
      return;
    }

    // An empty position: start a gate-in there, or say in words why not.
    // In a mixed block any size probes the same support/occupancy rules.
    const block = blockOf(yard, position.block);
    if (block === null) return;
    const probeSize = block.size === MIXED_SIZE ? 20 : block.size;
    const refusal = canPlace(yard, toStanding(containers), slotStates, probeSize, position);
    if (refusal !== null) {
      // A blocked location opens its state sheet instead of a dead end —
      // otherwise صيانة could be set and never cleared from the map.
      if (refusal.code === 'LOCATION_MAINTENANCE' || refusal.code === 'LOCATION_CLOSED') {
        setSlotStateAt(position);
        return;
      }
      setToast('by' in refusal ? AR.errorWithBy(refusal.code, refusal.by) : AR.errors[refusal.code]);
      return;
    }
    setGateInAt(position);
  };

  const commitMove = (): void => {
    if (confirmMove === null) return;
    setBusy(true);
    api
      .move(confirmMove.container.id, confirmMove.to)
      .then(() => {
        refresh(AR.moveDone(confirmMove.container.number, label(confirmMove.to)));
      })
      .catch((failure: unknown) => {
        setBusy(false);
        setConfirmMove(null);
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      });
  };

  const stackOf = (container: ContainerDto): { above: ContainerDto | null; below: ContainerDto | null } => {
    if (container.position === null) return { above: null, below: null };
    const stack = stacks.get(slotKey(container.position));
    if (stack === undefined) return { above: null, below: null };
    if (container.position.tier === GROUND_TIER) {
      return { above: stack.upper ?? null, below: null };
    }
    return { above: null, below: stack.ground ?? null };
  };

  const freeLabels = useMemo(() => {
    const labels = new Map<number, string>();
    if (yard !== null) {
      for (const block of yard.blocks) {
        // While a move is placing, a block the container's size can never
        // enter says so where its free count usually stands — otherwise an
        // all-grey area reads as a mystery, not a size policy.
        const base =
          moving !== null && !blockTakes(block.size, moving.size)
            ? AR.blockNoSize(moving.size)
            : ((): string => {
                const summary = summarizeBlock(block, stacks);
                return AR.freeOf(summary.freeGround, summary.totalGround);
              })();
        // An area under a state announces it beside the free count.
        labels.set(
          block.id,
          block.state === 'NORMAL' ? base : `${AR.locationStateName[block.state]} — ${base}`,
        );
      }
    }
    return labels;
  }, [yard, stacks, moving]);

  const gateInBlock = gateInAt === null || yard === null ? null : blockOf(yard, gateInAt.block);

  // The map is memoized against pan/zoom frames; its props must hold still.
  // The click handler reads fresh state through a ref so it never changes.
  const handleCellRef = useRef(handleCell);
  handleCellRef.current = handleCell;
  const onCellClick = useCallback(
    (position: Position, stack: SlotStack) => {
      if (wasDrag()) return;
      handleCellRef.current(position, stack);
    },
    [wasDrag],
  );

  const mapProps = useMemo(
    () =>
      yard === null
        ? null
        : {
            yard,
            stacks,
            tier,
            selectedId: selected?.id ?? null,
            matches,
            searchActive,
            targets,
            movingId: moving?.id ?? null,
            slotStates,
            onCellClick,
          },
    [yard, stacks, tier, selected, matches, searchActive, targets, moving, slotStates, onCellClick],
  );

  if (editing && yard !== null) {
    return (
      <YardEditor
        yard={yard}
        containers={containers}
        slotStates={slotStates}
        onSaved={(message) => {
          setEditing(false);
          void queryClient.invalidateQueries({ queryKey: ['state'] });
          setToast(message);
        }}
        onCancel={() => {
          setEditing(false);
        }}
      />
    );
  }

  if (reporting) {
    return (
      <ReportsScreen
        label={label}
        onBack={() => {
          setReporting(false);
        }}
      />
    );
  }

  if (logView) {
    return (
      <LogScreen
        label={label}
        onBack={() => {
          setLogView(false);
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <header className="z-10 border-b border-slate-200 bg-white px-3 py-2 shadow-sm lg:px-5">
        <div className="flex flex-wrap items-center gap-2 lg:gap-4">
          <h1 className="text-base font-extrabold text-slate-900 lg:text-lg">{AR.appName}</h1>
          <span className="hidden text-xs font-medium text-slate-400 lg:block">
            {AR.inYardCount(containers.length)}
          </span>

          <div className="order-3 flex w-full items-center gap-2 lg:order-none lg:w-auto lg:flex-1 lg:justify-center">
            <div className="relative w-full max-w-md">
              <input
                className={
                  'w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-sm ' +
                  'outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200'
                }
                placeholder={AR.searchPlaceholder}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
              {searchActive && (
                <button
                  type="button"
                  aria-label={AR.clearSearch}
                  onClick={() => {
                    setSearch('');
                  }}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-slate-400 hover:text-slate-700"
                >
                  ✕
                </button>
              )}
              {searchActive && departedResults.length > 0 && (
                <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                  <p className="bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500">
                    {AR.searchOutTitle}
                  </p>
                  {departedResults.slice(0, 6).map((container) => (
                    <button
                      key={container.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={() => {
                        setSelected(container);
                      }}
                    >
                      <span className="font-mono font-semibold" dir="ltr">
                        {container.number}
                      </span>
                      <span className="text-xs text-slate-500">{container.customer}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {searchActive && (
              <span className="whitespace-nowrap text-xs font-semibold text-amber-600">
                {AR.matches(matches.size + departedResults.length)}
              </span>
            )}
          </div>

          <div className="ms-auto flex items-center gap-1.5">
            <div className="flex overflow-hidden rounded-xl border border-slate-300">
              {([1, 2, 'ALL'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => {
                    setTier(level);
                  }}
                  className={
                    'px-3 py-1.5 text-sm font-semibold transition-colors ' +
                    (tier === level ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100')
                  }
                >
                  {level === 1 ? AR.tierGround : level === 2 ? AR.tierUpper : AR.tierAll}
                </button>
              ))}
            </div>
            <Button
              kind="quiet"
              onClick={() => {
                setReporting(true);
              }}
            >
              {AR.reports}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                setLogView(true);
              }}
            >
              {AR.logButton}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                setEditing(true);
              }}
            >
              {AR.editYard}
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                setConfirmReset(true);
              }}
            >
              {AR.devReset}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                void api.logout().then(props.onUnauthorized);
              }}
            >
              {AR.logout}
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <LegendChip color="#1d4ed8" label={AR.legendLaden} />
          <LegendChip color="#bfdbfe" label={AR.legendEmpty} />
          <LegendChip color="#475569" label={AR.legendStacked} layered />
          <LegendChip color="#f8fafc" label={AR.legendFree} dashed />
          {moving !== null && <LegendChip color="#dcfce7" label={AR.legendTarget} border="#16a34a" />}
          {/* Condition chips appear only when the condition exists somewhere. */}
          {containers.some((c) => c.status === 'DAMAGED') && (
            <LegendChip color="#dc2626" label={AR.containerStatusName.DAMAGED} />
          )}
          {containers.some((c) => c.status === 'HOLD') && (
            <LegendChip color="#0f172a" label={AR.containerStatusName.HOLD} />
          )}
          {containers.some((c) => c.status === 'REPAIR') && (
            <LegendChip color="#7c3aed" label={AR.containerStatusName.REPAIR} />
          )}
          {containers.some((c) => c.status === 'INSPECT') && (
            <LegendChip color="#f59e0b" label={AR.containerStatusName.INSPECT} />
          )}
          {(Object.values(slotStates).includes('MAINTENANCE') ||
            (yard?.blocks.some((b) => b.state === 'MAINTENANCE') ?? false)) && (
            <LegendChip color="#e2e8f0" label={AR.locationStateName.MAINTENANCE} border="#94a3b8" />
          )}
          {(Object.values(slotStates).includes('RESERVED') ||
            (yard?.blocks.some((b) => b.state === 'RESERVED') ?? false)) && (
            <LegendChip color="#fef9c3" label={AR.locationStateName.RESERVED} border="#ca8a04" />
          )}
          {(Object.values(slotStates).includes('CLOSED') ||
            (yard?.blocks.some((b) => b.state === 'CLOSED') ?? false)) && (
            <LegendChip color="#fecaca" label={AR.locationStateName.CLOSED} border="#b91c1c" />
          )}
        </div>
      </header>

      {moving !== null && (
        <div className="z-10 flex items-center justify-between gap-3 bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
          <span>{AR.movingBanner(moving.number)}</span>
          <button
            type="button"
            className="rounded-lg bg-emerald-800 px-3 py-1 hover:bg-emerald-900"
            onClick={() => {
              setMoving(null);
            }}
          >
            {AR.movingCancel}
          </button>
        </div>
      )}

      <main className="relative flex-1 overflow-hidden">
        <div
          ref={pz.attachContainer}
          {...pz.handlers}
          className="absolute inset-0 touch-none overflow-hidden"
          style={{ contain: 'layout paint' }}
        >
          {layout !== null && mapProps !== null && (
            <div
              className={pz.view.scale >= HOVER_MIN_SCALE ? 'map-hover' : undefined}
              style={{
                // Pinned physically top-left: pan/zoom math works in client
                // coordinates, and RTL would otherwise right-align this box
                // and shift the whole coordinate system.
                position: 'absolute',
                left: 0,
                top: 0,
                transform: `translate(${String(pz.view.x)}px, ${String(pz.view.y)}px) scale(${String(pz.view.scale)})`,
                transformOrigin: '0 0',
                // Its own compositor layer: panning must never repaint the
                // thousands of SVG nodes behind it.
                willChange: 'transform',
                width: layout.width,
                height: layout.height,
              }}
            >
              <YardMap layout={layout} freeLabels={freeLabels} map={mapProps} />
            </div>
          )}
        </div>

        <div className="absolute bottom-4 end-4 flex flex-col gap-1.5">
          {(
            [
              ['+', AR.zoomIn, pz.zoomButtons.zoomIn],
              ['−', AR.zoomOut, pz.zoomButtons.zoomOut],
              ['◻', AR.fit, pz.zoomButtons.fit],
            ] as const
          ).map(([glyph, label_, action]) => (
            <button
              key={label_}
              type="button"
              aria-label={label_}
              onClick={action}
              className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {glyph}
            </button>
          ))}
        </div>
      </main>

      {gateInAt !== null && gateInBlock !== null && state.data !== undefined && (
        <GateInSheet
          position={gateInAt}
          blockSize={gateInBlock.size}
          positionText={label(gateInAt)}
          slotState={
            slotStates[slotKey(gateInAt)] ??
            (gateInBlock.state === 'RESERVED' ? 'RESERVED' : 'NORMAL')
          }
          customers={state.data.customers}
          onDone={refresh}
          onEditSlotState={() => {
            const position = gateInAt;
            setGateInAt(null);
            setSlotStateAt(position);
          }}
          onClose={() => {
            setGateInAt(null);
          }}
        />
      )}

      {slotStateAt !== null && yard !== null && (
        <SlotStateSheet
          slotText={label(slotStateAt)}
          slotState={slotStates[slotKey(slotStateAt)] ?? 'NORMAL'}
          blockState={blockOf(yard, slotStateAt.block)?.state ?? 'NORMAL'}
          busy={busy}
          onSet={(nextState, scope) => {
            setBusy(true);
            const slot = slotStateAt;
            const work =
              scope === 'slot'
                ? api.setSlotState({ block: slot.block, row: slot.row, col: slot.col }, nextState)
                : api.setBlockState(slot.block, nextState);
            work
              .then(() => {
                refresh(AR.slotStateSaved);
              })
              .catch((failure: unknown) => {
                setBusy(false);
                setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
              });
          }}
          onClose={() => {
            setSlotStateAt(null);
          }}
        />
      )}

      {selected !== null && (
        <ContainerCard
          container={selected}
          above={stackOf(selected).above}
          below={stackOf(selected).below}
          label={label}
          onStartMove={(container) => {
            setSelected(null);
            setMoving(container);
          }}
          onStackOnTop={(position) => {
            setSelected(null);
            setGateInAt(position);
          }}
          onPrint={(kind, container) => {
            setPrintCard({ kind, container });
          }}
          onExited={(departed, message) => {
            refresh(message);
            setPrintCard({ kind: 'out', container: departed });
          }}
          onChanged={refresh}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}

      {printCard !== null && (
        <PrintCard
          kind={printCard.kind}
          container={printCard.container}
          label={label}
          onClose={() => {
            setPrintCard(null);
          }}
        />
      )}

      {stackChoice !== null && (
        <StackChooser
          stack={stackChoice}
          onPick={(container) => {
            setStackChoice(null);
            setSelected(container);
          }}
          onClose={() => {
            setStackChoice(null);
          }}
        />
      )}

      {confirmReset && (
        <Confirm
          title={AR.devResetTitle}
          body={AR.devResetBody}
          confirmLabel={AR.devReset}
          danger
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            api
              .devReset()
              .then(() => {
                setConfirmReset(false);
                refresh(AR.devResetDone);
              })
              .catch((failure: unknown) => {
                setBusy(false);
                setConfirmReset(false);
                setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
              });
          }}
          onCancel={() => {
            setConfirmReset(false);
          }}
        />
      )}

      {confirmMove !== null && (
        <Confirm
          title={AR.confirmMoveTitle}
          body={AR.confirmMoveBody(confirmMove.container.number, label(confirmMove.to))}
          confirmLabel={AR.actionMove}
          busy={busy}
          onConfirm={commitMove}
          onCancel={() => {
            setConfirmMove(null);
          }}
        />
      )}

      {toast !== null && <Toast message={toast} />}
    </div>
  );
}

/** Two containers share the tapped ground — a clear pick, not a hidden toggle. */
function StackChooser(props: {
  stack: SlotStack;
  onPick: (container: ContainerDto) => void;
  onClose: () => void;
}): ReactElement {
  useEscape(props.onClose);
  const { ground, upper } = props.stack;
  const choice = (
    container: ContainerDto | undefined,
    title: string,
  ): ReactElement | null =>
    container === undefined ? null : (
      <button
        type="button"
        className={
          'flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 ' +
          'text-sm hover:border-blue-400 hover:bg-blue-50'
        }
        onClick={() => {
          props.onPick(container);
        }}
      >
        <span className="font-bold text-slate-700">{title}</span>
        <span className="font-mono font-semibold text-slate-900" dir="ltr">
          {container.number}
        </span>
      </button>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-sm space-y-2 rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h3 className="mb-3 text-base font-bold text-slate-900">{AR.stackChooserTitle}</h3>
        {choice(upper, AR.stackUpperChoice)}
        {choice(ground, AR.stackGroundChoice)}
      </div>
    </div>
  );
}

/**
 * The location-state sheet: opened from an empty slot (via the gate-in card
 * or by tapping a blocked slot) — sets the slot's own state or, with the
 * scope toggle, the whole area's.
 */
function SlotStateSheet(props: {
  slotText: string;
  slotState: LocationState;
  blockState: LocationState;
  busy: boolean;
  onSet: (state: LocationState, scope: 'slot' | 'block') => void;
  onClose: () => void;
}): ReactElement {
  const [scope, setScope] = useState<'slot' | 'block'>('slot');
  useEscape(props.onClose);
  const current = scope === 'slot' ? props.slotState : props.blockState;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h3 className="text-base font-bold text-slate-900">{AR.slotStateTitle}</h3>
        <p className="mt-1 text-sm font-semibold text-slate-500" dir="ltr">
          {props.slotText}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['slot', 'block'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setScope(option);
              }}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ' +
                (scope === option
                  ? 'border-slate-700 bg-slate-700 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500')
              }
            >
              {option === 'slot' ? AR.slotStateScopeSlot : AR.slotStateScopeBlock}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {LOCATION_STATES.map((option) => (
            <button
              key={option}
              type="button"
              disabled={props.busy || option === current}
              onClick={() => {
                props.onSet(option, scope);
              }}
              className={
                'rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ' +
                (option === current
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400')
              }
            >
              {AR.locationStateName[option]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegendChip(props: {
  color: string;
  label: string;
  layered?: boolean;
  dashed?: boolean;
  border?: string;
}): ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      {props.layered === true ? (
        <span className="relative inline-block h-3.5 w-4">
          <span
            className="absolute bottom-0 start-0 inline-block h-3 w-3.5 rounded-sm"
            style={{ backgroundColor: '#93c5fd' }}
          />
          <span
            className="absolute end-0 top-0 inline-block h-3 w-3.5 rounded-sm"
            style={{ backgroundColor: props.color }}
          />
        </span>
      ) : (
        <span
          className="inline-block h-3 w-4 rounded-sm"
          style={{
            backgroundColor: props.color,
            border:
              props.border !== undefined
                ? `1.5px solid ${props.border}`
                : props.dashed === true
                  ? '1.5px dashed #cbd5e1'
                  : undefined,
          }}
        />
      )}
      {props.label}
    </span>
  );
}
