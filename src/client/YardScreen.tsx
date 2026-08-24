import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContainerDto, Permission, PermitDto, Position, Zone } from '../shared/types';
import { ASEZA } from '../shared/asezaLayout';
import { bayLabel, positionLabel } from '../shared/address';
import { freeNow, zoneOf } from '../shared/rules';
import { ApiFailure, api } from './api';
import { AR } from './ar';
import { YardMap, computeLayout } from './YardMap';
import { ReportsScreen } from './ReportsScreen';
import { LogScreen } from './LogScreen';
import { PrintCard, type CardJob } from './PrintCard';
import { PrintPermit } from './PrintPermit';
import { PermitSheet } from './PermitSheet';
import { FillSheet } from './FillSheet';
import {
  addressMatch,
  bayKey,
  billMatches,
  buildBayLoads,
  searchMatches,
  targetBays,
  toStanding,
} from './mapModel';
import { downloadBlob } from './sheetKit';
import { usePanZoom } from './usePanZoom';
import { GateInSheet } from './GateInSheet';
import { ContainerCard } from './ContainerCard';
import { BaySheet } from './BaySheet';
import { OwnerToolsScreen } from './OwnerToolsScreen';
import { UsersScreen } from './UsersScreen';
import { CarriersScreen } from './CarriersScreen';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, Toast } from './ui';

/** Below this zoom a cell is a few pixels — hover feedback means nothing. */
const HOVER_MIN_SCALE = 0.5;

const EMPTY_LOAD: readonly ContainerDto[] = [];

/**
 * The one screen. The yard drawing is the interface: receiving, moving and
 * releasing all start with a tap on the ground itself — a bay opens flat as
 * a grid of stacks and tiers, and the exact slot is picked there.
 */
export function YardScreen(props: { onUnauthorized: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContainerDto | null>(null);
  const [openBay, setOpenBay] = useState<{ zone: Zone; bay: number } | null>(null);
  const [gateInAt, setGateInAt] = useState<Position | null>(null);
  const [moving, setMoving] = useState<ContainerDto | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ container: ContainerDto; to: Position } | null>(
    null,
  );
  // false = closed; true = open on the default tab; a string = open on that
  // bill's own sheet — the search's doorway into كشف البوليصة.
  const [reporting, setReporting] = useState<boolean | string>(false);
  const [logView, setLogView] = useState(false);
  /**
   * The paper on screen: the entry card the moment a container is received,
   * the exit card as it leaves, the move card as it is carried across the
   * yard. A move card names the movement it prints, since one container is
   * moved many times.
   */
  const [printCard, setPrintCard] = useState<CardJob | null>(null);
  /** تصريح تحميل وخروج داخلي: the paper on screen, and the issue form. */
  const [permitPrint, setPermitPrint] = useState<PermitDto | null>(null);
  const [permitCreate, setPermitCreate] = useState<{
    bill: string;
    containers: readonly ContainerDto[];
  } | null>(null);
  /** «كم باقٍ حتى تمتلئ الساحة» — opened from the room chip in the header. */
  const [fillView, setFillView] = useState(false);
  const [usersView, setUsersView] = useState(false);
  /** سجل الناقلين وسياراتهم، وفيه «توزيع السيارات» — للمالك وحده. */
  const [carriersView, setCarriersView] = useState(false);
  /** Temporary: the owner's training tools, removed with OwnerToolsScreen. */
  const [toolsView, setToolsView] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  // Who is working: the header, the sheets and the card only offer what this
  // person is allowed to do. The server is still the one that refuses.
  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me });
  const me = meQuery.data ?? null;
  /**
   * The owner does not stop being the owner while `me` is being re-read.
   * Without this latch, any moment when that answer is briefly absent drops
   * `isOwner` to false and tears an owner-only screen off the page in the
   * middle of what he is doing — which is how a wipe came to run, say nothing,
   * and leave him looking at the map wondering whether it had.
   *
   * It only decides what the SCREEN offers. Every route still refuses on its
   * own authority, so a stale latch can permit nothing.
   */
  const knownOwner = useRef(false);
  useEffect(() => {
    if (meQuery.data !== undefined) knownOwner.current = meQuery.data.owner;
  }, [meQuery.data]);
  const isOwner = meQuery.data?.owner ?? knownOwner.current;
  const may = (permission: Permission): boolean =>
    isOwner || (me?.permissions.includes(permission) ?? false);

  /**
   * Is the map itself the thing on screen? This component owns every screen —
   * the register, the log, the staff list, the owner's tools are all values it
   * renders — so it stays mounted behind all of them, and its poll went on
   * running underneath.
   *
   * That poll is not cheap: each answer rebuilds the whole yard model — the
   * load of every one of 681 ground slots, the free-space arithmetic, the
   * search index — and then re-renders whatever screen is actually in front.
   * Every eight seconds, while somebody is typing an employee's name. It is
   * paid for gladly when the map is on screen, since that IS the map, and it
   * is pure waste when it is not.
   */
  const mapShown =
    !usersView && !toolsView && !carriersView && reporting === false && !logView;

  // The map is the shared picture of the ground, so it is the fastest poll:
  // whatever the gate does has to reach the office within a few seconds.
  const state = useQuery({
    queryKey: ['state'],
    queryFn: api.state,
    refetchInterval: mapShown ? 8_000 : false,
    // Nor on coming back to the window while another screen is in front.
    refetchOnWindowFocus: mapShown,
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

  const containers = useMemo(() => state.data?.containers ?? [], [state.data]);
  const loads = useMemo(() => buildBayLoads(containers), [containers]);
  const layout = useMemo(() => computeLayout(ASEZA), []);

  /**
   * A typed address is a search too: «2-E-18-01-A» asks where that is, and
   * the answer is the bay itself — this is a map, so the search opens it.
   */
  const addressHit = useMemo(() => addressMatch(ASEZA, containers, search), [containers, search]);

  const matches = useMemo(() => {
    const found = searchMatches(containers, search);
    // An address lights whatever is standing on it, so the map answers
    // «وين هي» before the dropdown is even touched.
    for (const container of addressHit?.containers ?? []) found.add(container.id);
    return found;
  }, [containers, search, addressHit]);
  const searchActive = search.trim() !== '';
  /** The bills the query touches — each row a doorway to its own sheet. */
  const billRows = useMemo(() => billMatches(containers, search), [containers, search]);

  // While a move is placing: the bays holding at least one legal landing.
  const targets = useMemo(() => {
    if (moving === null) return null;
    return targetBays(ASEZA, containers, moving.size, moving.id);
  }, [containers, moving]);

  // «قديش باقي» — legal landings for each size, per yard, right now.
  const free = useMemo(() => freeNow(ASEZA, toStanding(containers)), [containers]);

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

  const pz = usePanZoom(layout.width, layout.height);
  const { wasDrag } = pz;

  const refresh = (message: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['state'] });
    void queryClient.invalidateQueries({ queryKey: ['container'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
    // A register open on this same device must not go stale behind the
    // operation that just happened in front of it.
    for (const key of ['report-gate', 'report-standing', 'report-daily', 'report-truck', 'report-bill', 'report-log', 'report-permits']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    setToast(message);
    setSelected(null);
    setOpenBay(null);
    setGateInAt(null);
    setMoving(null);
    setConfirmMove(null);
    setBusy(false);
  };

  const handleBay = (zone: Zone, bay: number): void => {
    // One overlay at a time: tapping a bay closes whatever was open. While a
    // move is placing, the sheet opens in placing mode and the exact slot is
    // picked inside it — the map only says WHICH bay.
    setSelected(null);
    setGateInAt(null);
    setOpenBay({ zone, bay });
  };

  const commitMove = (): void => {
    if (confirmMove === null) return;
    setBusy(true);
    api
      .move(confirmMove.container.id, confirmMove.to)
      .then((moved) => {
        refresh(AR.moveDone(confirmMove.container.number, positionLabel(confirmMove.to)));
        // The paper the crane is handed, without anybody asking for it: it
        // names the slot it left and the slot it is going to.
        setPrintCard({ kind: 'move', container: moved.container, move: moved.move });
      })
      .catch((failure: unknown) => {
        setBusy(false);
        setConfirmMove(null);
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      });
  };

  // The map is memoized against pan/zoom frames; its props must hold still.
  // The click handler reads fresh state through a ref so it never changes.
  const handleBayRef = useRef(handleBay);
  handleBayRef.current = handleBay;
  const onBayClick = useCallback(
    (zone: Zone, bay: number) => {
      if (wasDrag()) return;
      handleBayRef.current(zone, bay);
    },
    [wasDrag],
  );

  const mapProps = useMemo(
    () => ({
      loads,
      selectedId: selected?.id ?? null,
      matches,
      searchActive,
      targets,
      movingId: moving?.id ?? null,
      onBayClick,
    }),
    [loads, selected, matches, searchActive, targets, moving, onBayClick],
  );

  const openZone = openBay === null ? null : zoneOf(ASEZA, openBay.zone);

  /**
   * The screen the app is on. It is a VALUE, not an early return, because the
   * overlays below have to outlive it: the gate card is opened from inside a
   * register, and while a register owned the whole render the card had
   * nothing to mount into — it appeared only once the register was closed.
   */
  let screen: ReactElement;
  if (usersView && isOwner) {
    screen = (
      <UsersScreen
        onBack={() => {
          setUsersView(false);
        }}
      />
    );
  } else if (carriersView && isOwner) {
    screen = (
      <CarriersScreen
        onBack={() => {
          setCarriersView(false);
        }}
      />
    );
  } else if (toolsView && isOwner) {
    screen = (
      <OwnerToolsScreen
        onBack={() => {
          setToolsView(false);
        }}
      />
    );
  } else if (reporting !== false) {
    screen = (
      <ReportsScreen
        initialBill={typeof reporting === 'string' ? reporting : undefined}
        onCard={(kind, containerId) => {
          // Straight from the register row to the paper — no hunting the
          // exact number down in the search box first.
          void api.detail(containerId).then(({ container }) => {
            setPrintCard({ kind, container });
          });
        }}
        onPermit={(permitId) => {
          // The row may be stale — the owner can void a permit from another
          // device — so a refusal is told in a sentence, not swallowed.
          api.permit(permitId).then(setPermitPrint).catch((failure: unknown) => {
            setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
          });
        }}
        onCreatePermit={(bill, billContainers) => {
          setPermitCreate({ bill, containers: billContainers });
        }}
        canPermit={may('GATE_OUT')}
        isOwner={isOwner}
        onBack={() => {
          setReporting(false);
        }}
      />
    );
  } else if (logView) {
    screen = (
      <LogScreen
        // Undoing what the log already records is the owner's alone; the
        // server refuses either way, this keeps the promise off the screen.
        isOwner={isOwner}
        onBack={() => {
          setLogView(false);
        }}
      />
    );
  } else {
    screen = (
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
                  each with its full official code. */}
              {searchActive &&
                (standingResults.length > 0 ||
                  departedResults.length > 0 ||
                  billRows.length > 0 ||
                  addressHit !== null) && (
                <div className="absolute top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                  {/* An address row goes to the ground it names — the bay
                      sheet, open, with whatever is standing there. */}
                  {addressHit !== null && (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-sm hover:bg-sunken"
                      onClick={() => {
                        setOpenBay({ zone: addressHit.zone, bay: addressHit.bay });
                        setSearch('');
                      }}
                    >
                      <span className="font-semibold text-blue-800 dark:text-blue-300">
                        {AR.searchAddressRow(addressHit.containers.length)}
                      </span>
                      <span
                        className="shrink-0 rounded-md bg-blue-700 px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                        dir="ltr"
                      >
                        {addressHit.position === null
                          ? bayLabel(addressHit.zone, addressHit.bay)
                          : positionLabel(addressHit.position)}
                      </span>
                    </button>
                  )}
                  {/* A bill row is a doorway: the whole group, on its own sheet. */}
                  {billRows.length > 0 && may('REPORTS') && (
                    <p className="bg-sunken px-3 py-1.5 text-xs font-bold text-muted">
                      {AR.searchBillTitle}
                    </p>
                  )}
                  {may('REPORTS') &&
                    billRows.map((row) => (
                      <button
                        key={row.bill}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-sunken dark:text-blue-300"
                        onClick={() => {
                          setReporting(row.bill);
                        }}
                      >
                        <span>{AR.searchBillRow(row.bill, row.count)}</span>
                        <span className="text-xs text-faint">←</span>
                      </button>
                    ))}
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
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="font-mono font-semibold text-ink" dir="ltr">
                          {container.number}
                        </span>
                        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                          {AR.feet(container.size)}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        {container.bill !== '' && (
                          <span className="truncate font-mono text-xs text-muted" dir="ltr">
                            {container.bill}
                          </span>
                        )}
                        <span
                          className="shrink-0 rounded-md bg-blue-700 px-1.5 py-0.5 font-mono text-xs font-bold text-white"
                          dir="ltr"
                        >
                          {container.position === null ? '—' : positionLabel(container.position)}
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
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="font-mono font-semibold text-ink" dir="ltr">
                          {container.number}
                        </span>
                        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                          {AR.feet(container.size)}
                        </span>
                      </span>
                      <span className="font-mono text-xs text-muted" dir="ltr">
                        {container.bill === '' ? '—' : container.bill}
                      </span>
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
                    setUsersView(true);
                  }}
                >
                  {AR.usersButton}
                </Button>
                <Button
                  kind="quiet"
                  onClick={() => {
                    setCarriersView(true);
                  }}
                >
                  {AR.carriersButton}
                </Button>
                <Button
                  kind="quiet"
                  disabled={backingUp}
                  onClick={() => {
                    setBackingUp(true);
                    api
                      .backup()
                      .then(({ blob, filename }) => {
                        // Two copies from one tap: the server kept its own,
                        // and this one lands in the browser's downloads.
                        downloadBlob(blob, filename);
                        setToast(AR.backupDone);
                        setBackingUp(false);
                      })
                      .catch((failure: unknown) => {
                        setToast(
                          failure instanceof ApiFailure ? failure.arabic : AR.networkError,
                        );
                        setBackingUp(false);
                      });
                  }}
                >
                  {backingUp ? AR.backupWorking : AR.backup}
                </Button>
                {/* Temporary, for the training period — see OwnerToolsScreen. */}
                <Button
                  kind="quiet"
                  onClick={() => {
                    setToolsView(true);
                  }}
                >
                  {AR.toolsButton}
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

          {/* How much room is left, per yard the plan actually holds: one
              chip today, since the whole drawing is one yard. It counts the
              slots a container could be set down on this minute — press it
              for the other question, how many more until the yard is full. */}
          <span className="ms-auto flex flex-wrap items-center gap-1.5">
            {free.map((room) => (
              <FreeChip
                key={room.yard}
                label={AR.freeOfYard(room.yard, room.t20, room.t40)}
                onClick={() => {
                  setFillView(true);
                }}
              />
            ))}
          </span>
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
            <YardMap layout={layout} map={mapProps} />
          </div>
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

      {openBay !== null && openZone !== null && (
        <BaySheet
          zone={openZone}
          bay={openBay.bay}
          containers={containers}
          load={loads.get(bayKey(openBay.zone, openBay.bay)) ?? EMPTY_LOAD}
          canGateIn={may('GATE_IN')}
          canMove={may('MOVE')}
          placing={moving}
          onPick={(container) => {
            setOpenBay(null);
            setSelected(container);
          }}
          onGateIn={(position) => {
            setOpenBay(null);
            setGateInAt(position);
          }}
          onMoveTo={(position) => {
            if (moving === null) return;
            setOpenBay(null);
            setConfirmMove({ container: moving, to: position });
          }}
          onClose={() => {
            setOpenBay(null);
          }}
        />
      )}

      {gateInAt !== null && state.data !== undefined && (
        <GateInSheet
          position={gateInAt}
          // The entry card is what the gate is doing this for, so it comes up
          // by itself — no hunting the container down to press a button.
          onDone={(container, message) => {
            refresh(message);
            setPrintCard({ kind: 'in', container });
          }}
          onClose={() => {
            setGateInAt(null);
          }}
        />
      )}

      {selected !== null && (
        <ContainerCard
          container={selected}
          may={may}
          onStartMove={(container) => {
            setSelected(null);
            setMoving(container);
          }}
          onPrint={setPrintCard}
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

      {confirmMove !== null && (
        <Confirm
          title={AR.confirmMoveTitle}
          body={AR.confirmMoveBody(confirmMove.container.number, positionLabel(confirmMove.to))}
          confirmLabel={AR.actionMove}
          busy={busy}
          onConfirm={commitMove}
          onCancel={() => {
            setConfirmMove(null);
          }}
        />
      )}
    </div>
    );
  }

  // The overlays sit OUTSIDE the screen choice, so a gate card opened from a
  // register appears over the register instead of waiting for it to close.
  return (
    <>
      {screen}
      {fillView && (
        <FillSheet
          containers={containers}
          onClose={() => {
            setFillView(false);
          }}
        />
      )}
      {permitCreate !== null && (
        <PermitSheet
          // Keyed by bill: pressing «إصدار تصريح» for another bill while the
          // sheet is open must start a fresh sheet, not reuse this one's
          // checkboxes against the other bill's containers.
          key={permitCreate.bill}
          bill={permitCreate.bill}
          containers={permitCreate.containers}
          onDone={(permit, message) => {
            // The paper is the point: it opens by itself, and the register
            // behind refreshes to show the new serial.
            setPermitCreate(null);
            setToast(message);
            void queryClient.invalidateQueries({ queryKey: ['report-permits'] });
            setPermitPrint(permit);
          }}
          onClose={() => {
            setPermitCreate(null);
          }}
        />
      )}
      {permitPrint !== null && (
        <PrintPermit
          permit={permitPrint}
          onClose={() => {
            setPermitPrint(null);
          }}
        />
      )}
      {printCard !== null && (
        <PrintCard
          {...printCard}
          onClose={() => {
            setPrintCard(null);
          }}
        />
      )}
      {toast !== null && <Toast message={toast} />}
    </>
  );
}

/** One yard's remaining room, sized to be read across the office. */
function FreeChip(props: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={AR.fillTitle}
      className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-800 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
    >
      {props.label}
    </button>
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
