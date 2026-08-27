import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, Position, YardLayout } from '../shared/types';
import { sizeOfBay } from '../shared/types';
import { baySpan, positionLabel, samePosition } from '../shared/address';
import { buildOccupancy, reclassOptions, reclassOptionsGone, type Standing } from '../shared/rules';
import { api } from './api';
import { AR } from './ar';
import { Button, Confirm, ErrorLine, Sheet } from './ui';

/**
 * تصحيح الفئة — «ممكن الشخص خربط ف بطر انو يعدل بدل ما يحذفها من السجل».
 *
 * The class is never a dropdown here, and never will be. The bay's parity IS
 * the class, so a class written wrong is an address written wrong: the whole
 * gesture is naming the bay the box truly stands on, and the class follows —
 * exactly as it does at the gate, where nobody is asked for it either.
 *
 * The choice is at most two bays, because nothing moves: same zone, same
 * stack, same tier, one bay sideways. The strip of ground below the buttons
 * is why the choice can be made at all — it shows what is actually beside the
 * container, so the decision is made against the yard rather than against two
 * labels that look alike.
 *
 * The server re-runs every one of these checks inside its transaction; the
 * options computed here only let the screen answer before the network does.
 */
export function ReclassSheet(props: {
  container: ContainerDto;
  /** The composed ground — the official plan plus the owner's own zones. */
  layout: YardLayout;
  /** Everything standing, as the rules see it. */
  standing: readonly Standing[];
  onDone: (container: ContainerDto, message: string) => void;
  onClose: () => void;
}): ReactElement {
  const { container, layout, standing } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Position | null>(null);

  const detail = useQuery({
    queryKey: ['container', container.id],
    queryFn: () => api.detail(container.id),
  });

  /** Where it stands — or, for a record that has left, where it stood. */
  const anchor = useMemo((): Position | null => {
    if (container.position !== null) return container.position;
    const out = [...(detail.data?.movements ?? [])].reverse().find((m) => m.type === 'OUT');
    return out?.from ?? null;
  }, [container.position, detail.data]);

  const options = useMemo((): readonly Position[] => {
    if (anchor === null) return [];
    if (container.position !== null) {
      return reclassOptions(layout, standing, {
        id: container.id,
        number: container.number,
        size: container.size,
        position: container.position,
      });
    }
    return reclassOptionsGone(layout, anchor);
  }, [layout, standing, container, anchor]);

  /**
   * The ground on either side, as it is right now. A bay that holds nothing
   * reads «فارغة»; one the plan does not have at this stack reads «خارج
   * المخطط», which is the honest reason its option is missing.
   */
  const neighbours = useMemo(() => {
    if (anchor === null) return [];
    const cells = buildOccupancy(standing);
    const zone = layout.zones.find((candidate) => candidate.zone === anchor.zone);
    const odd = anchor.bay % 2 === 1 ? anchor.bay : anchor.bay + 1;
    return [odd - 2, odd, odd + 2]
      .filter((bay) => bay >= 1)
      .map((bay) => {
        const exists = (zone?.stacks[String(bay)] ?? []).includes(anchor.stack);
        const holder = cells.get(`${anchor.zone}|${String(bay)}|${String(anchor.stack)}|${anchor.tier}`);
        return {
          bay,
          label: positionLabel({ ...anchor, bay }),
          text: !exists
            ? AR.reclassWallCell
            : holder === undefined
              ? AR.reclassEmptyCell
              : holder.number,
          mine: holder?.id === container.id,
          exists,
        };
      });
  }, [layout, standing, anchor, container.id]);

  const commit = (to: Position | null): void => {
    setBusy(true);
    setError(null);
    api
      .reclass(container.id, to ?? undefined)
      .then((reply) => {
        setConfirming(null);
        setBusy(false);
        props.onDone(
          reply.container,
          AR.reclassDone(
            reply.container.number,
            reply.container.size,
            reply.container.position === null
              ? (to === null ? '—' : positionLabel(to))
              : positionLabel(reply.container.position),
          ),
        );
      })
      .catch((failure: unknown) => {
        setConfirming(null);
        setBusy(false);
        setError(failure instanceof Error ? failure.message : AR.networkError);
        if (failure !== null && typeof failure === 'object' && 'arabic' in failure) {
          setError(String((failure as { arabic: string }).arabic));
        }
      });
  };

  const departed = container.position === null;
  const other = container.size === 20 ? 40 : 20;

  return (
    <Sheet title={AR.reclassTitle(container.number)} onClose={props.onClose}>
      <div className="space-y-4 p-5">
        <p className="text-sm leading-6 text-muted">
          {departed ? AR.reclassGoneLead : AR.reclassLead(container.size, other)}
        </p>
        {!departed && <p className="text-xs leading-6 text-faint">{AR.reclassExplain}</p>}

        {anchor === null ? (
          <>
            <p className="text-sm leading-6 text-muted">{AR.reclassGoneNoSlot}</p>
            <Button
              disabled={busy}
              onClick={() => {
                commit(null);
              }}
            >
              {AR.actionReclass}
            </Button>
          </>
        ) : (
          <>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-faint">{AR.reclassNeighbours}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {neighbours.map((cell) => (
                  <div
                    key={cell.bay}
                    className={
                      'rounded-lg border px-2 py-1.5 text-center ' +
                      (cell.mine
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
                        : !cell.exists
                          ? 'border-line bg-sunken'
                          : 'border-line bg-surface')
                    }
                  >
                    <span className="block font-mono text-[11px] text-faint" dir="ltr">
                      {cell.label}
                    </span>
                    <span className="block truncate text-[11px] font-semibold text-ink" dir="auto">
                      {cell.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {options.length === 0 ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {AR.reclassNoRoom}
              </p>
            ) : (
              <div className="space-y-2">
                {options.map((option) => {
                  const size = sizeOfBay(option.bay);
                  const span = baySpan(option.bay);
                  const covers =
                    size === 40 && span.length === 2
                      ? AR.reclassCovers(
                          positionLabel({ ...option, bay: span[0] ?? option.bay }),
                          positionLabel({ ...option, bay: span[1] ?? option.bay }),
                        )
                      : anchor.bay % 2 === 0
                        ? AR.reclassFrees(
                            positionLabel({
                              ...anchor,
                              bay: baySpan(anchor.bay).find((b) => b !== option.bay) ?? anchor.bay,
                            }),
                          )
                        : '';
                  return (
                    <button
                      key={positionLabel(option)}
                      type="button"
                      disabled={busy || samePosition(option, anchor)}
                      onClick={() => {
                        setConfirming(option);
                      }}
                      className={
                        'w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-start ' +
                        'hover:border-blue-500 hover:bg-sunken disabled:opacity-50'
                      }
                    >
                      <span className="block text-sm font-bold text-ink">
                        {AR.reclassOption(positionLabel(option), size)}
                      </span>
                      {covers !== '' && (
                        <span className="mt-0.5 block text-[11px] text-muted">{covers}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <ErrorLine message={error} />
      </div>

      {confirming !== null && anchor !== null && (
        <Confirm
          title={AR.confirmReclassTitle}
          body={AR.confirmReclassBody(
            container.number,
            sizeOfBay(confirming.bay),
            positionLabel(anchor),
            positionLabel(confirming),
          )}
          confirmLabel={AR.actionReclass}
          busy={busy}
          onConfirm={() => {
            commit(confirming);
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
    </Sheet>
  );
}
