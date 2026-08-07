import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContainerDto, Position, Size, Tier } from '../shared/types';
import { GROUND_TIER } from '../shared/types';
import { positionLabel, slotKey } from '../shared/address';
import { canPlace } from '../shared/rules';
import { ApiFailure, api } from './api';
import { AR } from './ar';
import { YardMap, computeLayout } from './YardMap';
import { buildStacks, legalTargets, searchMatches, summarizeZone, toStanding } from './mapModel';
import { usePanZoom } from './usePanZoom';
import { GateInSheet } from './GateInSheet';
import { ContainerCard } from './ContainerCard';
import { Button, Confirm, Toast } from './ui';

/**
 * The one screen. The yard drawing is the interface: receiving, moving and
 * releasing all start with a tap on the ground itself.
 */
export function YardScreen(props: { onUnauthorized: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<Tier>(GROUND_TIER);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ContainerDto | null>(null);
  const [gateInAt, setGateInAt] = useState<Position | null>(null);
  const [moving, setMoving] = useState<ContainerDto | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ container: ContainerDto; to: Position } | null>(
    null,
  );
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

  const pz = usePanZoom(layout?.width ?? 0, layout?.height ?? 0);

  const refresh = (message: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['state'] });
    void queryClient.invalidateQueries({ queryKey: ['container'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
    setToast(message);
    setSelected(null);
    setGateInAt(null);
    setMoving(null);
    setConfirmMove(null);
    setBusy(false);
  };

  const handleCell = (position: Position, occupant: ContainerDto | null): void => {
    if (yard === null) return;

    if (moving !== null) {
      const key = `${slotKey(position)}|${String(position.tier)}`;
      if (targets !== null && targets.has(key)) {
        setConfirmMove({ container: moving, to: position });
      }
      return;
    }

    if (occupant !== null) {
      setSelected(occupant);
      return;
    }

    // An empty position: start a gate-in there, or say in words why not.
    const refusal = canPlace(yard, toStanding(containers), position.zone, position);
    if (refusal !== null) {
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
        refresh(AR.moveDone(confirmMove.container.number, positionLabel(confirmMove.to)));
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
    const labels = new Map<Size, string>();
    if (yard !== null) {
      for (const zone of [20, 40] as const) {
        const summary = summarizeZone(yard, stacks, zone);
        labels.set(zone, AR.freeOf(summary.freeGround, summary.totalGround));
      }
    }
    return labels;
  }, [yard, stacks]);

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
              {([1, 2] as const).map((level) => (
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
                  {level === 1 ? AR.tierGround : AR.tierUpper}
                </button>
              ))}
            </div>
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
          <LegendChip color="#0f172a" label={AR.legendStacked} round />
          <LegendChip color="#f8fafc" label={AR.legendFree} dashed />
          {moving !== null && <LegendChip color="#dcfce7" label={AR.legendTarget} border="#16a34a" />}
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
          ref={pz.containerRef}
          {...pz.handlers}
          className="absolute inset-0 touch-none overflow-hidden"
        >
          {yard !== null && layout !== null && (
            <div
              style={{
                transform: `translate(${String(pz.view.x)}px, ${String(pz.view.y)}px) scale(${String(pz.view.scale)})`,
                transformOrigin: '0 0',
                width: layout.width,
                height: layout.height,
              }}
            >
              <YardMap
                layout={layout}
                freeLabels={freeLabels}
                map={{
                  yard,
                  stacks,
                  tier,
                  selectedId: selected?.id ?? null,
                  matches,
                  searchActive,
                  targets,
                  movingId: moving?.id ?? null,
                  onCellClick: (position, occupant) => {
                    if (pz.wasDrag()) return;
                    handleCell(position, occupant);
                  },
                }}
              />
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
          ).map(([glyph, label, action]) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={action}
              className="h-10 w-10 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              {glyph}
            </button>
          ))}
        </div>
      </main>

      {gateInAt !== null && state.data !== undefined && (
        <GateInSheet
          position={gateInAt}
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
          above={stackOf(selected).above}
          below={stackOf(selected).below}
          onStartMove={(container) => {
            setSelected(null);
            setMoving(container);
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

      {toast !== null && <Toast message={toast} />}
    </div>
  );
}

function LegendChip(props: {
  color: string;
  label: string;
  round?: boolean;
  dashed?: boolean;
  border?: string;
}): ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={props.round === true ? 'inline-block h-3 w-3 rounded-full' : 'inline-block h-3 w-4 rounded-sm'}
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
