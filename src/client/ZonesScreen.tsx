import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomZoneDto } from '../shared/types';
import { composeLayout } from '../shared/layout';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, Confirm, ErrorLine, Field, Toast, inputClass } from './ui';

/**
 * الزونات والساحات: the owner draws his OTHER grounds here — yards 1 and 3,
 * or a zone added beside the official plan, which stays committed data and
 * is never editable. A zone is a grid of twenty-foot bays and stacks, three
 * tiers always (his explicit call), and any ground slot he taps shut
 * refuses placement exactly the way the plan's walls do. The map picks the
 * new zones up immediately; the server refuses any change that would leave
 * a standing container without ground.
 */

interface ZoneDraft {
  yard: string;
  name: string;
  bays: string;
  stacks: string;
}

const EMPTY_DRAFT: ZoneDraft = { yard: '1', name: '', bays: '10', stacks: '6' };

const asCount = (text: string, max: number): number | null => {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};

/**
 * One zone's shape, drawn the way the YARD draws it — the owner's call:
 * «اصلح شكل الزون كما هو موجود في الساحة». A bordered strip like the map's
 * zone, the odd bay numbers across its head the way the bay sheet writes
 * its columns, the stacks down the side, and every ground slot a wide cell
 * with the sheet's own dashed border. A closed one wears the map's hatch.
 */
function ZoneGrid(props: {
  zone: CustomZoneDto;
  closed: ReadonlySet<string>;
  onToggle: (bay: number, stack: number) => void;
}): ReactElement {
  const bays = Array.from({ length: props.zone.bays }, (_, i) => i * 2 + 1);
  const stacks = Array.from({ length: props.zone.stacks }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto rounded-xl border-2 border-line-strong bg-canvas p-3">
      <table className="border-separate border-spacing-1" dir="ltr">
        <thead>
          <tr>
            <th className="px-1 text-[10px] font-bold text-faint">{AR.zoneBayWord} ←</th>
            {bays.map((bay) => (
              <th key={bay} className="px-1 pb-1 text-center font-mono text-xs font-bold text-muted">
                {String(bay).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stacks.map((stack) => (
            <tr key={stack}>
              <td className="pe-1.5 text-end">
                <span className="inline-block rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[11px] font-bold text-muted">
                  {String(stack).padStart(2, '0')}
                </span>
              </td>
              {bays.map((bay) => {
                const shut = props.closed.has(`${String(bay)}|${String(stack)}`);
                return (
                  <td key={bay} className="p-0">
                    <button
                      type="button"
                      title={`${props.zone.zone}-${String(bay).padStart(2, '0')}-${String(stack).padStart(2, '0')}`}
                      onClick={() => {
                        props.onToggle(bay, stack);
                      }}
                      className={
                        'h-11 w-14 rounded-lg border transition-colors ' +
                        (shut
                          ? 'slot-wall border-solid border-line-strong'
                          : 'border-dashed border-line-strong bg-surface hover:border-solid hover:border-blue-500')
                      }
                    >
                      {/* The three tiers the yard stacks on every slot —
                          «شكل طوابق»: C over B over A, like the bay sheet. */}
                      {!shut && (
                        <span className="flex h-full w-full flex-col justify-between gap-0.5 p-1">
                          <span className="block flex-1 rounded-sm border border-dashed border-line" />
                          <span className="block flex-1 rounded-sm border border-dashed border-line" />
                          <span className="block flex-1 rounded-sm border border-dashed border-line-strong bg-sunken" />
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One defined zone: its facts, its grid, its place on the drawing, and
 * its own save/delete. */
function ZoneCard(props: {
  zone: CustomZoneDto;
  busy: boolean;
  onSave: (closed: ReadonlyArray<readonly [number, number]>) => void;
  /** «بدي اقدر احرك الزون»: nudge the strip across its yard's drawing. */
  onNudge: (dx: number, dy: number) => void;
  onAutoPlace: () => void;
  onDelete: () => void;
}): ReactElement {
  const { zone } = props;
  const [closed, setClosed] = useState<ReadonlySet<string>>(
    () => new Set(zone.closed.map(([bay, stack]) => `${String(bay)}|${String(stack)}`)),
  );
  // When the server's own closed set changes under the card (the office and
  // the gate both run this app), the grid adopts it — otherwise the next
  // «حفظ الشكل» would silently reopen slots another session closed.
  const serverClosed = zone.closed
    .map(([bay, stack]) => `${String(bay)}|${String(stack)}`)
    .join(';');
  useEffect(() => {
    setClosed(new Set(serverClosed === '' ? [] : serverClosed.split(';')));
  }, [serverClosed]);
  const openSlots = zone.bays * zone.stacks - closed.size;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ink">{AR.zoneLabel(zone.yard, zone.zone)}</h3>
        <span className="text-xs font-semibold text-muted">{AR.zoneOpenSlots(openSlots)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-faint">{AR.zoneClosedHint}</p>
      <p className="text-xs leading-5 text-faint">{AR.zoneTiersNote}</p>
      <div className="mt-3">
        <ZoneGrid
          zone={zone}
          closed={closed}
          onToggle={(bay, stack) => {
            const key = `${String(bay)}|${String(stack)}`;
            const next = new Set(closed);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            setClosed(next);
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted">{AR.zoneMove}</span>
        {(
          [
            ['→', AR.zoneMoveEnd, 40, 0],
            ['←', AR.zoneMoveStart, -40, 0],
            ['↑', AR.zoneMoveUp, 0, -40],
            ['↓', AR.zoneMoveDown, 0, 40],
          ] as const
        ).map(([glyph, label, dx, dy]) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            disabled={props.busy}
            onClick={() => {
              props.onNudge(dx, dy);
            }}
            className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-sm font-bold text-ink hover:border-blue-500 disabled:opacity-40"
          >
            {glyph}
          </button>
        ))}
        <button
          type="button"
          disabled={props.busy}
          onClick={props.onAutoPlace}
          className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-muted hover:border-blue-500 disabled:opacity-40"
        >
          {AR.zoneMoveAuto}
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          disabled={props.busy}
          onClick={() => {
            props.onSave(
              [...closed].map((key) => {
                const [bay, stack] = key.split('|');
                return [Number(bay), Number(stack)] as const;
              }),
            );
          }}
        >
          {AR.zoneSave}
        </Button>
        <Button kind="danger" disabled={props.busy} onClick={props.onDelete}>
          {AR.zoneDelete}
        </Button>
      </div>
    </section>
  );
}

export function ZonesScreen(props: { onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const zones = useQuery({ queryKey: ['zones'], queryFn: api.zones });
  const [draft, setDraft] = useState<ZoneDraft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CustomZoneDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['zones'] });
    void queryClient.invalidateQueries({ queryKey: ['state'] });
  };

  const finish = (message: string): void => {
    refresh();
    setToast(message);
    setBusy(false);
  };

  const fail = (failure: unknown): void => {
    setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
    setBusy(false);
  };

  const yard = asCount(draft.yard, 9);
  const bays = asCount(draft.bays, 40);
  const stacks = asCount(draft.stacks, 20);
  const nameOk = /^[A-Z]{1,2}$/.test(draft.name.trim().toUpperCase());
  const draftOk = yard !== null && bays !== null && stacks !== null && nameOk;

  const submit = (): void => {
    if (!draftOk || busy) return;
    setBusy(true);
    setError(null);
    api
      .addZone({
        yard: yard,
        name: draft.name.trim().toUpperCase(),
        bays: bays,
        stacks: stacks,
      })
      .then(() => {
        setDraft(EMPTY_DRAFT);
        setAdding(false);
        finish(AR.zoneCreated);
      })
      .catch(fail);
  };

  const rows = zones.data?.zones ?? [];
  /** The zones as the map actually places them — the nudge starts there. */
  const placed = composeLayout(rows).zones;
  // The last spot each nudge wrote: the next press builds on it even while
  // the zones refetch is still in flight, so rapid presses never lose a step.
  const written = useRef(new Map<number, { x: number; y: number }>());

  const reshape = (
    zone: CustomZoneDto,
    shape: { x: number | null; y: number | null },
    said: string,
  ): void => {
    setBusy(true);
    setError(null);
    api
      .editZone(zone.id, shape)
      .then(() => {
        finish(said);
      })
      .catch(fail);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-ink">{AR.zonesTitle}</h2>
        <Button kind="quiet" onClick={props.onBack}>
          {AR.backToMap}
        </Button>
      </header>

      <p className="text-sm leading-6 text-muted">{AR.zonesHint}</p>
      <p className="rounded-xl bg-sunken px-3 py-2 text-xs font-semibold text-muted">
        {AR.zonesOfficialNote}
      </p>

      {rows.length === 0 && <p className="py-6 text-center text-sm text-faint">{AR.zonesEmpty}</p>}

      {rows.map((zone) => (
        <ZoneCard
          key={zone.id}
          zone={zone}
          busy={busy}
          onSave={(closed) => {
            setBusy(true);
            setError(null);
            api
              .editZone(zone.id, { closed })
              .then(() => {
                finish(AR.zoneSaved);
              })
              .catch(fail);
          }}
          onNudge={(dx, dy) => {
            const here =
              written.current.get(zone.id) ?? placed.find((def) => def.zone === zone.zone);
            if (here === undefined) return;
            const next = {
              x: Math.min(5000, Math.max(0, here.x + dx)),
              y: Math.min(5000, Math.max(0, here.y + dy)),
            };
            written.current.set(zone.id, next);
            reshape(zone, next, AR.zoneMoved);
          }}
          onAutoPlace={() => {
            written.current.delete(zone.id);
            reshape(zone, { x: null, y: null }, AR.zoneMoved);
          }}
          onDelete={() => {
            setRemoving(zone);
          }}
        />
      ))}

      <ErrorLine message={error} />

      {adding ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field label={AR.zoneYard} hint={<span className="text-faint">{AR.zoneYardHint}</span>}>
            <input
              dir="ltr"
              className={`${inputClass} w-20 text-start`}
              value={draft.yard}
              onChange={(event) => {
                setDraft({ ...draft, yard: event.target.value });
              }}
            />
          </Field>
          <Field label={AR.zoneName} hint={<span className="text-faint">{AR.zoneNameHint}</span>}>
            <input
              dir="ltr"
              className={`${inputClass} w-20 text-start font-mono uppercase`}
              value={draft.name}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />
          </Field>
          <Field label={AR.zoneBays} hint={<span className="text-faint">{AR.zoneBaysHint}</span>}>
            <input
              dir="ltr"
              type="number"
              className={`${inputClass} w-24 text-start`}
              value={draft.bays}
              onChange={(event) => {
                setDraft({ ...draft, bays: event.target.value });
              }}
            />
          </Field>
          <Field label={AR.zoneStacks}>
            <input
              dir="ltr"
              type="number"
              className={`${inputClass} w-24 text-start`}
              value={draft.stacks}
              onChange={(event) => {
                setDraft({ ...draft, stacks: event.target.value });
              }}
            />
          </Field>
          <div className="flex gap-2 pb-0.5">
            <Button type="submit" disabled={busy || !draftOk}>
              {AR.zoneCreate}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                setAdding(false);
              }}
            >
              {AR.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          kind="quiet"
          onClick={() => {
            setAdding(true);
          }}
        >
          {AR.zoneAdd}
        </Button>
      )}

      {removing !== null && (
        <Confirm
          title={AR.confirmZoneDeleteTitle}
          body={AR.confirmZoneDeleteBody(AR.zoneLabel(removing.yard, removing.zone))}
          confirmLabel={AR.zoneDelete}
          busy={busy}
          onConfirm={() => {
            setBusy(true);
            setError(null);
            api
              .removeZone(removing.id)
              .then(() => {
                setRemoving(null);
                finish(AR.zoneDeleted);
              })
              .catch((failure: unknown) => {
                setRemoving(null);
                fail(failure);
              });
          }}
          onCancel={() => {
            setRemoving(null);
          }}
        />
      )}

      {toast !== null && <Toast message={toast} />}
    </div>
  );
}
