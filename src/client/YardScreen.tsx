import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockConfig, ContainerDto, Permission, Position } from '../shared/types';
import { MIXED_SIZE } from '../shared/types';
import { positionKey, samePosition } from '../shared/address';
import { blockOf, canPlace, locationCapacity } from '../shared/rules';
import { blockTakes } from '../shared/geometry';
import { ApiFailure, api } from './api';
import { AR } from './ar';
import { YardMap, computeLayout } from './YardMap';
import { ReportsScreen } from './ReportsScreen';
import { LogScreen } from './LogScreen';
import { PrintCard } from './PrintCard';
import {
  buildLoads,
  countLocation,
  labelerFrom,
  legalTargets,
  placesUsed,
  searchMatches,
  smallestPlaces,
  summarizeBlock,
  toStanding,
  yardFreeSpace,
} from './mapModel';
import { usePanZoom } from './usePanZoom';
import { GateInSheet } from './GateInSheet';
import { ContainerCard } from './ContainerCard';
import { YardEditor } from './YardEditor';
import { UsersScreen } from './UsersScreen';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, Toast, useEscape } from './ui';

/** Below this zoom a cell is a few pixels — hover feedback means nothing. */
const HOVER_MIN_SCALE = 0.5;

const EMPTY_LOAD: readonly ContainerDto[] = [];

/** The Arabic sentence for a rule refusal the client saw first. */
function refusalText(refusal: { code: string; free?: number; need?: number }): string {
  if (refusal.code === 'LOCATION_FULL' && refusal.free !== undefined && refusal.need !== undefined) {
    return AR.errorFull(refusal.free, refusal.need);
  }
  return AR.errors[refusal.code as keyof typeof AR.errors];
}

/**
 * The one screen. The yard drawing is the interface: receiving, moving and
 * releasing all start with a tap on the ground itself.
 */
export function YardScreen(props: { onUnauthorized: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContainerDto | null>(null);
  const [openAt, setOpenAt] = useState<Position | null>(null);
  const [gateInAt, setGateInAt] = useState<Position | null>(null);
  const [moving, setMoving] = useState<ContainerDto | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ container: ContainerDto; to: Position } | null>(
    null,
  );
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [logView, setLogView] = useState(false);
  const [printCard, setPrintCard] = useState<{ kind: 'in' | 'out'; container: ContainerDto } | null>(
    null,
  );
  const [usersView, setUsersView] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Who is working: the header, the sheets and the card only offer what this
  // person is allowed to do. The server is still the one that refuses.
  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me });
  const me = meQuery.data ?? null;
  const isOwner = me?.owner ?? false;
  const may = (permission: Permission): boolean =>
    isOwner || (me?.permissions.includes(permission) ?? false);

  const state = useQuery({
    queryKey: ['state'],
    queryFn: api.state,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  // A dead session sends us back to the door exactly once. The latch matters:
  // the bounce clears the cache, which re-renders this screen, and without it
  // a lingering 401 would fire the bounce again on every render.
  const { onUnauthorized } = props;
  const bounced = useRef(false);
  useEffect(() => {
    if (bounced.current) return;
    if (state.error instanceof ApiFailure && state.error.code === 'UNAUTHORIZED') {
      bounced.current = true;
      onUnauthorized();
    }
  }, [state.error, onUnauthorized]);

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
  const loads = useMemo(() => buildLoads(containers), [containers]);
  const layout = useMemo(() => (yard === null ? null : computeLayout(yard)), [yard]);
  const label = useMemo(() => labelerFrom(state.data?.blockNames ?? {}), [state.data]);

  const matches = useMemo(() => searchMatches(containers, search), [containers, search]);
  const searchActive = search.trim() !== '';

  const targets = useMemo(() => {
    if (yard === null || moving === null) return null;
    return legalTargets(yard, containers, moving.size, moving.id);
  }, [yard, containers, moving]);

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
  /** The standing hits, so the search can say WHERE each one is. */
  const standingResults = useMemo(
    () => containers.filter((container) => matches.has(container.id)),
    [containers, matches],
  );

  const pz = usePanZoom(layout?.width ?? 0, layout?.height ?? 0);
  const { wasDrag } = pz;

  const refresh = (message: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['state'] });
    void queryClient.invalidateQueries({ queryKey: ['container'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
    setToast(message);
    setSelected(null);
    setOpenAt(null);
    setGateInAt(null);
    setMoving(null);
    setConfirmMove(null);
    setBusy(false);
  };

  const handleCell = (position: Position): void => {
    if (yard === null) return;

    if (moving !== null) {
      if (targets !== null && targets.has(positionKey(position))) {
        setConfirmMove({ container: moving, to: position });
        return;
      }
      // Not a green target: say why in words instead of ignoring the tap.
      if (moving.position !== null && samePosition(moving.position, position)) {
        setToast(AR.errors.SAME_SLOT);
        return;
      }
      const refusal = canPlace(yard, toStanding(containers), moving.size, position, moving.id);
      if (refusal !== null) {
        setToast(refusalText(refusal));
        return;
      }
      // Legal by the fresh rules but missing from the (≤15 s old) target
      // set: trust the rules — the server re-checks inside its transaction.
      setConfirmMove({ container: moving, to: position });
      return;
    }

    // One overlay at a time: tapping a cell closes whatever was open, never
    // stacks a second sheet behind the first.
    setSelected(null);
    setGateInAt(null);
    setOpenAt(position);
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

  /** Everything else standing in this container's own location. */
  const siblingsOf = (container: ContainerDto): readonly ContainerDto[] => {
    if (container.position === null) return EMPTY_LOAD;
    const load = loads.get(positionKey(container.position)) ?? EMPTY_LOAD;
    return load.filter((other) => other.id !== container.id);
  };

  /** Places still open where this container stands, itself not counted. */
  const roomAt = (position: Position): number => {
    if (yard === null) return 0;
    const block = blockOf(yard, position.block);
    if (block === null) return 0;
    return locationCapacity(block) - placesUsed(loads.get(positionKey(position)));
  };

  const freeLabels = useMemo(() => {
    const labels = new Map<number, string>();
    if (yard !== null) {
      for (const block of yard.blocks) {
        // While a move is placing, a column the container's size can never
        // enter says so where its free count usually stands — otherwise an
        // all-grey area reads as a mystery, not a size policy.
        if (moving !== null && !blockTakes(block.size, moving.size)) {
          labels.set(block.id, AR.blockNoSize(moving.size));
          continue;
        }
        // Both halves, because the owner reads the column header to answer
        // «شو المليان وشو الفاضي» in one look.
        const summary = summarizeBlock(block, loads);
        labels.set(
          block.id,
          AR.fullAndFree(summary.totalPlaces - summary.freePlaces, summary.freePlaces),
        );
      }
    }
    return labels;
  }, [yard, loads, moving]);

  // «قديش باقي» — the whole yard's remaining room, 40s apart from 20s.
  const freeSpace = useMemo(
    () => (yard === null ? null : yardFreeSpace(yard, loads)),
    [yard, loads],
  );

  const openBlock = openAt === null || yard === null ? null : blockOf(yard, openAt.block);
  const gateInBlock = gateInAt === null || yard === null ? null : blockOf(yard, gateInAt.block);

  // The map is memoized against pan/zoom frames; its props must hold still.
  // The click handler reads fresh state through a ref so it never changes.
  const handleCellRef = useRef(handleCell);
  handleCellRef.current = handleCell;
  const onCellClick = useCallback(
    (position: Position) => {
      if (wasDrag()) return;
      handleCellRef.current(position);
    },
    [wasDrag],
  );

  const mapProps = useMemo(
    () =>
      yard === null
        ? null
        : {
            yard,
            loads,
            selectedId: selected?.id ?? null,
            matches,
            searchActive,
            targets,
            movingId: moving?.id ?? null,
            onCellClick,
          },
    [yard, loads, selected, matches, searchActive, targets, moving, onCellClick],
  );

  if (editing && yard !== null) {
    return (
      <YardEditor
        yard={yard}
        containers={containers}
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

  if (usersView && isOwner) {
    return (
      <UsersScreen
        onBack={() => {
          setUsersView(false);
        }}
      />
    );
  }

  if (reporting) {
    return (
      <ReportsScreen
        label={label}
        onCard={(kind, containerId) => {
          // Straight from the register row to the paper — no hunting the
          // exact number down in the search box first.
          void api.detail(containerId).then(({ container }) => {
            setPrintCard({ kind, container });
          });
        }}
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
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="z-10 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <div className="flex flex-wrap items-center gap-2 lg:gap-4">
          <h1 className="text-base font-extrabold text-ink lg:text-lg">{AR.appName}</h1>
          <span className="hidden text-xs font-medium text-faint lg:block">
            {AR.inYardCount(containers.length)}
          </span>

          <div className="order-3 flex w-full items-center gap-2 lg:order-none lg:w-auto lg:flex-1 lg:justify-center">
            <div className="relative w-full max-w-md">
              <input
                className={
                  'w-full rounded-xl border border-line-strong bg-sunken px-3.5 py-2 text-sm ' +
                  'outline-none focus:border-blue-500 focus:bg-surface focus:ring-2 focus:ring-blue-200'
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
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-faint hover:text-ink"
                >
                  ✕
                </button>
              )}
              {/* A search must answer «وين هي» in words, not only by lighting
                  a cell somewhere off screen: the standing hits come first,
                  each with its own location. */}
              {searchActive && (standingResults.length > 0 || departedResults.length > 0) && (
                <div className="absolute top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                  {standingResults.length > 0 && (
                    <p className="bg-sunken px-3 py-1.5 text-xs font-bold text-muted">
                      {AR.searchInTitle}
                    </p>
                  )}
                  {standingResults.slice(0, 8).map((container) => (
                    <button
                      key={container.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-sunken"
                      onClick={() => {
                        setSelected(container);
                      }}
                    >
                      <span className="font-mono font-semibold text-ink" dir="ltr">
                        {container.number}
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs text-muted">{container.customer}</span>
                        <span
                          className="shrink-0 rounded-md bg-blue-700 px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                          dir="ltr"
                        >
                          {container.position === null ? '—' : label(container.position)}
                        </span>
                      </span>
                    </button>
                  ))}
                  {departedResults.length > 0 && (
                    <p className="bg-sunken px-3 py-1.5 text-xs font-bold text-muted">
                      {AR.searchOutTitle}
                    </p>
                  )}
                  {departedResults.slice(0, 6).map((container) => (
                    <button
                      key={container.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-sunken"
                      onClick={() => {
                        setSelected(container);
                      }}
                    >
                      <span className="font-mono font-semibold text-ink" dir="ltr">
                        {container.number}
                      </span>
                      <span className="text-xs text-muted">{container.customer}</span>
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

          {/* Only what this person may actually do reaches the header. The
              server refuses the rest regardless — this is just courtesy. */}
          <div className="ms-auto flex items-center gap-1.5">
            <ThemePicker />
            {may('REPORTS') && (
              <>
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
              </>
            )}
            {isOwner && (
              <>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setEditing(true);
                  }}
                >
                  {AR.editYard}
                </Button>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setUsersView(true);
                  }}
                >
                  {AR.usersButton}
                </Button>
              </>
            )}
            <span className="hidden text-xs font-bold text-muted lg:block">{me?.name}</span>
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

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <LegendChip color="var(--yard-free)" label={AR.legendFree} dashed />
          <LegendChip
            color="var(--yard-partial)"
            label={AR.legendPartial}
            border="var(--yard-partial-border)"
          />
          <LegendChip color="var(--yard-full)" label={AR.legendFull} />
          {moving !== null && (
            <LegendChip
              color="var(--yard-target)"
              label={AR.legendTarget}
              border="var(--yard-target-border)"
            />
          )}
          {containers.some((c) => c.notes !== '') && (
            <LegendChip color="var(--yard-match)" label={AR.legendNoted} dot />
          )}

          {/* «قديش باقي» — kept apart by size, because a free place in a 40
              column is no use to a 20 standing at the gate. */}
          {freeSpace !== null && (
            <span className="ms-auto flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-muted">{AR.freeTitle}</span>
              <FreeChip label={AR.freeForty(freeSpace.forty)} />
              <FreeChip label={AR.freeTwenty(freeSpace.twenty)} />
              {freeSpace.mixed > 0 && <FreeChip label={AR.freeMixed(freeSpace.mixed)} />}
            </span>
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
              className="h-10 w-10 rounded-xl border border-line bg-surface text-lg font-bold text-ink shadow-sm hover:bg-sunken"
            >
              {glyph}
            </button>
          ))}
        </div>
      </main>

      {openAt !== null && openBlock !== null && (
        <LocationSheet
          block={openBlock}
          locationText={label(openAt)}
          load={loads.get(positionKey(openAt)) ?? EMPTY_LOAD}
          canGateIn={may('GATE_IN')}
          onPick={(container) => {
            setOpenAt(null);
            setSelected(container);
          }}
          onAdd={() => {
            const position = openAt;
            setOpenAt(null);
            setGateInAt(position);
          }}
          onClose={() => {
            setOpenAt(null);
          }}
        />
      )}

      {gateInAt !== null && gateInBlock !== null && state.data !== undefined && (
        <GateInSheet
          position={gateInAt}
          blockSize={gateInBlock.size}
          positionText={label(gateInAt)}
          freePlaces={roomAt(gateInAt)}
          customers={state.data.customers}
          onDone={refresh}
          onClose={() => {
            setGateInAt(null);
          }}
        />
      )}

      {selected !== null && (
        <ContainerCard
          container={selected}
          siblings={siblingsOf(selected)}
          roomHere={selected.position === null ? 0 : roomAt(selected.position)}
          may={may}
          label={label}
          onStartMove={(container) => {
            setSelected(null);
            setMoving(container);
          }}
          onAddHere={(position) => {
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

/**
 * What is inside one location, which is the whole question the map cannot
 * answer on its own: how full it is, who is in it, and the way to add one
 * more while there is room.
 */
function LocationSheet(props: {
  block: BlockConfig;
  locationText: string;
  load: readonly ContainerDto[];
  /** Hide the gate-in button from whoever may not receive containers. */
  canGateIn: boolean;
  onPick: (container: ContainerDto) => void;
  onAdd: () => void;
  onClose: () => void;
}): ReactElement {
  useEscape(props.onClose);
  const count = countLocation(props.block, props.load);
  const room = locationCapacity(props.block) - placesUsed(props.load);
  const canAdd = room >= smallestPlaces(props.block);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={props.onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-mono text-lg font-extrabold text-ink" dir="ltr">
            {props.locationText}
          </h3>
          <span
            className={
              'rounded-lg px-2 py-0.5 text-sm font-bold ' +
              (count.full ? 'bg-blue-800 text-white' : 'bg-sunken text-muted')
            }
          >
            {count.full ? AR.locationFull : AR.locationHas(count.used, count.total)}
          </span>
        </div>
        <p className="mt-1 text-xs text-faint">
          {AR.blockShape(
            props.block.placesPerTier / (props.block.size === 40 ? 2 : 1),
            props.block.tiers,
            props.block.size === MIXED_SIZE,
          )}
        </p>

        <div className="mt-3 space-y-1.5">
          {props.load.length === 0 && (
            <p className="rounded-xl bg-sunken px-4 py-6 text-center text-sm text-faint">
              {AR.locationHas(0, count.total)}
            </p>
          )}
          {props.load.map((container) => (
            <button
              key={container.id}
              type="button"
              className={
                'flex w-full items-center justify-between gap-3 rounded-xl border border-line ' +
                'px-3.5 py-2.5 text-start hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40'
              }
              onClick={() => {
                props.onPick(container);
              }}
            >
              <span className="min-w-0">
                <span className="block font-mono text-sm font-bold text-ink" dir="ltr">
                  {container.number}
                </span>
                <span className="block truncate text-xs text-muted">{container.customer}</span>
                {/* The note is where the condition lives now, so a couple of
                    lines of it ride along under the number. */}
                {container.notes !== '' && (
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-amber-700 dark:text-amber-400">
                    {container.notes}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs">
                <span className="rounded-md bg-sunken px-1.5 py-0.5 font-semibold text-muted">
                  {container.size}
                </span>
                {container.sealIn !== '' && (
                  <span
                    className="rounded-md bg-slate-800 px-1.5 py-0.5 font-mono font-semibold text-white"
                    dir="ltr"
                  >
                    {container.sealIn}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {props.canGateIn && (
            <Button kind="primary" disabled={!canAdd} onClick={props.onAdd}>
              {AR.locationAdd}
            </Button>
          )}
          {props.canGateIn && !canAdd && (
            <span className="text-xs text-faint">{AR.locationAddBlocked}</span>
          )}
          <span className="ms-auto">
            <Button kind="quiet" onClick={props.onClose}>
              {AR.close}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** One size's remaining room, sized to be read across the office. */
function FreeChip(props: { label: string }): ReactElement {
  return (
    <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
      {props.label}
    </span>
  );
}

function LegendChip(props: {
  color: string;
  label: string;
  dashed?: boolean;
  dot?: boolean;
  border?: string;
}): ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={props.dot === true ? 'inline-block h-2.5 w-2.5 rounded-full' : 'inline-block h-3 w-4 rounded-sm'}
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
      {props.label}
    </span>
  );
}
