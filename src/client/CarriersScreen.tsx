import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CarrierDto, TruckDto, UnassignedPlateRow } from '../shared/types';
import { plateLabel, splitPlate } from '../shared/fleet';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, ErrorLine, Field, Toast, inputClass } from './ui';

/**
 * The owner's carrier registry: «اريد ان ارى الكشف وكيف بأمكاني اضفة الناقل
 * وكيف بأمكاني توزيع السيارات». Each carrier with his fleet — plate, ترميز
 * and the usual driver — plus the distribution bench: every plate the gate
 * has written that no carrier owns yet, waiting to be assigned. Everything
 * here sits BESIDE the gate records; nothing edits a register.
 */

interface TruckDraft {
  code: string;
  number: string;
  driver: string;
}

const EMPTY_TRUCK: TruckDraft = { code: '60', number: '', driver: '' };

/** One truck's inline form — used to add and to edit alike. */
function TruckForm(props: {
  draft: TruckDraft;
  onChange: (draft: TruckDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  busy: boolean;
}): ReactElement {
  const { draft } = props;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.number.trim() === '') return;
        props.onSubmit();
      }}
    >
      <Field label={AR.truckCode} hint={<span className="text-faint">{AR.truckCodeHint}</span>}>
        <input
          dir="ltr"
          className={`${inputClass} w-20 text-start`}
          value={draft.code}
          onChange={(event) => {
            props.onChange({ ...draft, code: event.target.value });
          }}
        />
      </Field>
      <Field label={AR.truck}>
        <input
          dir="ltr"
          className={`${inputClass} w-32 text-start`}
          value={draft.number}
          onChange={(event) => {
            props.onChange({ ...draft, number: event.target.value });
          }}
        />
      </Field>
      <Field label={AR.truckDriverLabel} hint={<span className="text-faint">{AR.optional}</span>}>
        <input
          className={`${inputClass} w-44`}
          value={draft.driver}
          onChange={(event) => {
            props.onChange({ ...draft, driver: event.target.value });
          }}
        />
      </Field>
      <div className="flex gap-2 pb-0.5">
        <Button type="submit" disabled={props.busy || draft.number.trim() === ''}>
          {props.submitLabel}
        </Button>
        <Button kind="quiet" onClick={props.onCancel}>
          {AR.cancel}
        </Button>
      </div>
    </form>
  );
}

export function CarriersScreen(props: { onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [addName, setAddName] = useState('');
  const [renaming, setRenaming] = useState<CarrierDto | null>(null);
  const [renameText, setRenameText] = useState('');
  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [addDraft, setAddDraft] = useState<TruckDraft>(EMPTY_TRUCK);
  const [editingTruck, setEditingTruck] = useState<TruckDto | null>(null);
  const [editDraft, setEditDraft] = useState<TruckDraft>(EMPTY_TRUCK);
  const [removingCarrier, setRemovingCarrier] = useState<CarrierDto | null>(null);
  const [removingTruck, setRemovingTruck] = useState<TruckDto | null>(null);
  /** Where each unassigned plate is about to go, keyed by its plate text. */
  const [assignTo, setAssignTo] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fleet = useQuery({ queryKey: ['fleet'], queryFn: api.fleet });
  const unassigned = useQuery({ queryKey: ['fleet-unassigned'], queryFn: api.unassignedPlates });

  const carriers = useMemo(() => fleet.data?.carriers ?? [], [fleet.data]);
  const trucksOf = useMemo(() => {
    const grouped = new Map<number, TruckDto[]>();
    for (const truck of fleet.data?.trucks ?? []) {
      const list = grouped.get(truck.carrierId) ?? [];
      list.push(truck);
      grouped.set(truck.carrierId, list);
    }
    return grouped;
  }, [fleet.data]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const run = (work: Promise<unknown>, message: string): void => {
    setBusy(true);
    setError(null);
    work
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['fleet'] });
        void queryClient.invalidateQueries({ queryKey: ['fleet-unassigned'] });
        setToast(message);
        setBusy(false);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  /** The select every «move / assign» action shares. */
  const carrierOptions = (except?: number): ReactElement[] =>
    carriers
      .filter((carrier) => carrier.id !== except)
      .map((carrier) => (
        <option key={carrier.id} value={carrier.id}>
          {carrier.name}
        </option>
      ));

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <h1 className="text-base font-extrabold text-ink">{AR.carriersTitle}</h1>
        <span className="hidden max-w-2xl text-xs text-faint lg:block">{AR.carriersHint}</span>
        <span className="ms-auto flex items-center gap-2">
          <ThemePicker />
          <Button kind="quiet" onClick={props.onBack}>
            {AR.backToMap}
          </Button>
        </span>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <ErrorLine message={error} />

        <section className="space-y-3">
          {carriers.length === 0 && !fleet.isLoading && (
            <p className="rounded-2xl bg-surface px-4 py-8 text-center text-sm text-faint shadow-sm">
              {AR.carriersEmpty}
            </p>
          )}
          {carriers.map((carrier) => {
            const trucks = trucksOf.get(carrier.id) ?? [];
            return (
              <div key={carrier.id} className="rounded-2xl bg-surface p-4 shadow-sm">
                {renaming?.id === carrier.id ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (renameText.trim() === '') return;
                      run(api.renameCarrier(carrier.id, renameText.trim()), AR.carrierRenamed);
                      setRenaming(null);
                    }}
                  >
                    <Field label={AR.carrierName}>
                      <input
                        className={`${inputClass} w-64`}
                        value={renameText}
                        onChange={(event) => {
                          setRenameText(event.target.value);
                        }}
                        autoFocus
                      />
                    </Field>
                    <div className="flex gap-2 pb-0.5">
                      <Button type="submit" disabled={busy || renameText.trim() === ''}>
                        {AR.save}
                      </Button>
                      <Button
                        kind="quiet"
                        onClick={() => {
                          setRenaming(null);
                        }}
                      >
                        {AR.cancel}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-base font-bold text-ink">{carrier.name}</span>
                    <span className="rounded-lg bg-sunken px-2 py-0.5 text-xs font-semibold text-faint">
                      {AR.carrierTrucks(trucks.length)}
                    </span>
                    <span className="ms-auto flex gap-2">
                      <Button
                        kind="quiet"
                        disabled={busy}
                        onClick={() => {
                          setRenaming(carrier);
                          setRenameText(carrier.name);
                        }}
                      >
                        {AR.carrierRename}
                      </Button>
                      <Button
                        kind="danger"
                        disabled={busy}
                        onClick={() => {
                          setRemovingCarrier(carrier);
                        }}
                      >
                        {AR.carrierDelete}
                      </Button>
                    </span>
                  </div>
                )}

                {trucks.length > 0 && (
                  <ul className="mt-3 divide-y divide-line border-t border-line">
                    {trucks.map((truck) => (
                      <li key={truck.id} className="py-2">
                        {editingTruck?.id === truck.id ? (
                          <TruckForm
                            draft={editDraft}
                            onChange={setEditDraft}
                            busy={busy}
                            submitLabel={AR.save}
                            onSubmit={() => {
                              run(
                                api.editTruck(truck.id, {
                                  carrierId: truck.carrierId,
                                  code: editDraft.code.trim(),
                                  number: editDraft.number.trim(),
                                  driver: editDraft.driver.trim(),
                                }),
                                AR.truckSaved,
                              );
                              setEditingTruck(null);
                            }}
                            onCancel={() => {
                              setEditingTruck(null);
                            }}
                          />
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span
                              className="font-mono text-sm font-bold text-ink"
                              dir="ltr"
                            >
                              {plateLabel(truck)}
                            </span>
                            <span className="text-sm text-muted">
                              {truck.driver === '' ? '—' : truck.driver}
                            </span>
                            <span className="ms-auto flex items-center gap-2">
                              {/* «توزيع»: hand the truck to another carrier. */}
                              {carriers.length > 1 && (
                                <select
                                  className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                                  value=""
                                  disabled={busy}
                                  onChange={(event) => {
                                    const target = Number(event.target.value);
                                    const home = carriers.find((c) => c.id === target);
                                    if (home === undefined) return;
                                    run(
                                      api.editTruck(truck.id, {
                                        carrierId: target,
                                        code: truck.code,
                                        number: truck.number,
                                        driver: truck.driver,
                                      }),
                                      AR.truckMoved(home.name),
                                    );
                                  }}
                                >
                                  <option value="">{AR.truckMoveTo}</option>
                                  {carrierOptions(carrier.id)}
                                </select>
                              )}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setEditingTruck(truck);
                                  setEditDraft({
                                    code: truck.code,
                                    number: truck.number,
                                    driver: truck.driver,
                                  });
                                }}
                                className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
                              >
                                {AR.actionEdit}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setRemovingTruck(truck);
                                }}
                                className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300"
                              >
                                {AR.truckDelete}
                              </button>
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 border-t border-line pt-3">
                  {addingFor === carrier.id ? (
                    <TruckForm
                      draft={addDraft}
                      onChange={setAddDraft}
                      busy={busy}
                      submitLabel={AR.truckAdd}
                      onSubmit={() => {
                        run(
                          api.addTruck({
                            carrierId: carrier.id,
                            code: addDraft.code.trim(),
                            number: addDraft.number.trim(),
                            driver: addDraft.driver.trim(),
                          }),
                          AR.truckAdded,
                        );
                        setAddingFor(null);
                        setAddDraft(EMPTY_TRUCK);
                      }}
                      onCancel={() => {
                        setAddingFor(null);
                      }}
                    />
                  ) : (
                    <Button
                      kind="quiet"
                      disabled={busy}
                      onClick={() => {
                        setAddingFor(carrier.id);
                        setAddDraft(EMPTY_TRUCK);
                        setEditingTruck(null);
                      }}
                    >
                      {AR.truckAdd}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-ink">{AR.carrierAdd}</h2>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (addName.trim() === '') return;
              run(api.addCarrier(addName.trim()), AR.carrierAdded);
              setAddName('');
            }}
          >
            <Field label={AR.carrierName}>
              <input
                className={`${inputClass} w-64`}
                value={addName}
                onChange={(event) => {
                  setAddName(event.target.value);
                }}
              />
            </Field>
            <div className="pb-0.5">
              <Button type="submit" disabled={busy || addName.trim() === ''}>
                {AR.carrierAdd}
              </Button>
            </div>
          </form>
        </section>

        {/* «توزيع السيارات»: what the gate has seen and nobody owns yet. */}
        <section className="rounded-2xl bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-bold text-ink">{AR.unassignedTitle}</h2>
          <p className="mt-1 text-xs leading-5 text-faint">{AR.unassignedHint}</p>
          {(unassigned.data?.rows ?? []).length === 0 && !unassigned.isLoading ? (
            <p className="mt-3 text-sm text-faint">{AR.unassignedEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {(unassigned.data?.rows ?? []).map((row: UnassignedPlateRow) => (
                <li key={row.plate} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                  <span className="font-mono text-sm font-bold text-ink" dir="ltr">
                    {row.plate}
                  </span>
                  <span className="rounded-lg bg-sunken px-2 py-0.5 text-xs font-semibold text-faint">
                    {AR.unassignedTrips(row.trips)}
                  </span>
                  {row.driver !== '' && (
                    <span className="text-xs text-muted">{AR.registeredDriver(row.driver)}</span>
                  )}
                  <span className="ms-auto flex items-center gap-2">
                    <select
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                      value={assignTo[row.plate] ?? ''}
                      disabled={busy}
                      onChange={(event) => {
                        setAssignTo({ ...assignTo, [row.plate]: Number(event.target.value) });
                      }}
                    >
                      <option value="">{AR.carrierName}</option>
                      {carrierOptions()}
                    </select>
                    <Button
                      disabled={busy || (assignTo[row.plate] ?? 0) < 1}
                      onClick={() => {
                        const carrierId = assignTo[row.plate];
                        if (carrierId === undefined || carrierId < 1) return;
                        const split = splitPlate(row.plate);
                        run(
                          api.addTruck({
                            carrierId,
                            code: split.code,
                            number: split.number,
                            driver: row.driver,
                          }),
                          AR.truckAdded,
                        );
                      }}
                    >
                      {AR.assignAction}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {removingCarrier !== null && (
        <Confirm
          title={AR.confirmCarrierDeleteTitle}
          body={AR.confirmCarrierDeleteBody(removingCarrier.name)}
          confirmLabel={AR.carrierDelete}
          busy={busy}
          onConfirm={() => {
            run(api.removeCarrier(removingCarrier.id), AR.carrierDeleted);
            setRemovingCarrier(null);
          }}
          onCancel={() => {
            setRemovingCarrier(null);
          }}
        />
      )}

      {removingTruck !== null && (
        <Confirm
          title={AR.confirmTruckDeleteTitle}
          body={AR.confirmTruckDeleteBody(plateLabel(removingTruck))}
          confirmLabel={AR.truckDelete}
          busy={busy}
          onConfirm={() => {
            run(api.removeTruck(removingTruck.id), AR.truckDeleted);
            setRemovingTruck(null);
          }}
          onCancel={() => {
            setRemovingTruck(null);
          }}
        />
      )}

      {toast !== null && <Toast message={toast} />}
    </div>
  );
}
