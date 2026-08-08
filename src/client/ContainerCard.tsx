import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, MovementDto, Position } from '../shared/types';
import { CONTAINER_STATUSES, GROUND_TIER } from '../shared/types';
import { AR } from './ar';
import { ApiFailure, api, dwellDays, formatDate, formatDateOnly, formatTimeOnly } from './api';
import { Button, Confirm, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * Everything about one container, and everything that can be done to it —
 * opened by tapping it on the map or in a search result.
 */

function Badge(props: {
  text: string;
  tone: 'blue' | 'sky' | 'amber' | 'slate' | 'red' | 'emerald' | 'violet' | 'dark';
}): ReactElement {
  const tones = {
    blue: 'bg-blue-100 text-blue-800',
    sky: 'bg-sky-100 text-sky-800',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-100 text-slate-600',
    red: 'bg-red-100 text-red-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    violet: 'bg-violet-100 text-violet-800',
    dark: 'bg-slate-800 text-white',
  } as const;
  return (
    <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${tones[props.tone]}`}>
      {props.text}
    </span>
  );
}

const MOVEMENT_TONES = {
  IN: 'blue',
  MOVE: 'sky',
  OUT: 'slate',
  EDIT: 'amber',
  DELETE: 'red',
  RESTORE: 'emerald',
} as const;

/** Addresses live in one isolated LTR run: nothing fuses, no arrow flips. */
function Addr(props: { text: string }): ReactElement {
  return (
    <bdi dir="ltr" className="font-mono text-[13px] font-semibold text-slate-800">
      {props.text}
    </bdi>
  );
}

function MovementRow(props: {
  movement: MovementDto;
  label: (p: Position) => string;
}): ReactElement {
  const { movement, label } = props;

  let detail: ReactElement | null = null;
  switch (movement.type) {
    case 'IN':
      detail = movement.to === null ? null : <Addr text={label(movement.to)} />;
      break;
    case 'MOVE':
      detail =
        movement.from !== null && movement.to !== null ? (
          <Addr text={`${label(movement.from)} → ${label(movement.to)}`} />
        ) : null;
      break;
    case 'OUT':
      detail = movement.from === null ? null : <Addr text={label(movement.from)} />;
      break;
    case 'EDIT':
      detail =
        movement.note === '' ? null : (
          <span className="min-w-0 text-xs leading-5 text-slate-600 wrap-anywhere">
            {AR.editedFields(movement.note)}
          </span>
        );
      break;
    case 'DELETE':
    case 'RESTORE':
      detail = null;
      break;
  }

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Badge
        text={AR.operationName[movement.type] ?? movement.type}
        tone={MOVEMENT_TONES[movement.type]}
      />
      {detail}
      <span className="ms-auto whitespace-nowrap text-xs text-slate-400">
        <span dir="ltr">{formatDateOnly(movement.at)}</span>
        {' · '}
        <span dir="ltr">{formatTimeOnly(movement.at)}</span>
      </span>
    </li>
  );
}

export function ContainerCard(props: {
  container: ContainerDto;
  /** The container standing on top of this one, when there is one. */
  above: ContainerDto | null;
  /** The container this one stands on, when on the upper tier. */
  below: ContainerDto | null;
  /** Position → spoken address, with the block's name resolved. */
  label: (position: Position) => string;
  onStartMove: (container: ContainerDto) => void;
  /** Start a gate-in on the empty slot directly above this container. */
  onStackOnTop: (position: Position) => void;
  /** Open the printable gate card. */
  onPrint: (kind: 'in' | 'out', container: ContainerDto) => void;
  /** The container just left: refresh AND hand over its exit card to print. */
  onExited: (container: ContainerDto, message: string) => void;
  onChanged: (message: string) => void;
  onClose: () => void;
}): ReactElement {
  const { container } = props;
  const [confirming, setConfirming] = useState<'exit' | 'delete' | null>(null);
  const [editing, setEditing] = useState(false);
  const [truckOut, setTruckOut] = useState('');
  const [driverOut, setDriverOut] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ['container', container.id],
    queryFn: () => api.detail(container.id),
  });

  const buried = props.above !== null;
  const held = container.status === 'HOLD';
  const inYard = container.position !== null;

  const run = (work: Promise<unknown>, message: string): void => {
    setBusy(true);
    setError(null);
    work
      .then(() => {
        props.onChanged(message);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
        setConfirming(null);
      });
  };

  return (
    <Sheet title={container.number} onClose={props.onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge text={`${String(container.size)} قدم`} tone="slate" />
          <Badge
            text={container.cargo === 'LADEN' ? AR.cargoLaden : AR.cargoEmpty}
            tone={container.cargo === 'LADEN' ? 'blue' : 'sky'}
          />
          {!container.numberValid && <Badge text={AR.numberNotVerified} tone="amber" />}
          {!inYard && <Badge text={AR.outOfYard} tone="slate" />}
          {container.status !== 'NORMAL' && (
            <Badge
              text={AR.containerStatusName[container.status]}
              tone={
                container.status === 'DAMAGED'
                  ? 'red'
                  : container.status === 'HOLD'
                    ? 'dark'
                    : container.status === 'REPAIR'
                      ? 'violet'
                      : 'amber'
              }
            />
          )}
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-slate-500">{AR.customer}</dt>
            <dd className="min-w-0 font-semibold text-slate-900 wrap-anywhere">
              {container.customer}
            </dd>
          </div>
          {container.position !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.slot}</dt>
              <dd className="font-semibold text-slate-900" dir="ltr">
                {props.label(container.position)}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{AR.enteredAt}</dt>
            <dd className="font-semibold text-slate-900" dir="ltr">
              {formatDate(container.enteredAt)}
            </dd>
          </div>
          {container.exitedAt !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.exitedAt}</dt>
              <dd className="font-semibold text-slate-900" dir="ltr">
                {formatDate(container.exitedAt)}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500" />
              <dd className="font-semibold text-blue-700">
                {AR.dwell(dwellDays(container.enteredAt))}
              </dd>
            </div>
          )}
          {container.truckIn !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.cardTruck}</dt>
              <dd className="font-semibold text-slate-900" dir="ltr">
                {container.truckIn}
              </dd>
            </div>
          )}
          {container.driverIn !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.cardDriver}</dt>
              <dd className="text-slate-700">{container.driverIn}</dd>
            </div>
          )}
          {container.weight !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.cardWeight}</dt>
              <dd className="text-slate-700" dir="ltr">
                {container.weight}
              </dd>
            </div>
          )}
          {container.notes !== '' && (
            <div>
              <dt className="mb-1 text-slate-500">{AR.notes}</dt>
              <dd className="whitespace-pre-wrap rounded-lg bg-slate-50 px-2.5 py-1.5 leading-6 text-slate-700 wrap-anywhere">
                {container.notes}
              </dd>
            </div>
          )}
        </dl>

        {inYard && !editing && (
          <div>
            <p className="mb-1.5 text-sm text-slate-500">{AR.statusLabel}</p>
            <div className="flex flex-wrap gap-1.5">
              {CONTAINER_STATUSES.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={busy || option === container.status}
                  onClick={() => {
                    run(api.setStatus(container.id, option), AR.statusSaved);
                  }}
                  className={
                    'rounded-xl border px-2.5 py-1.5 text-xs font-semibold ' +
                    (option === container.status
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white text-slate-600')
                  }
                >
                  {AR.containerStatusName[option]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            kind="quiet"
            onClick={() => {
              props.onPrint('in', container);
            }}
          >
            {AR.printCardIn}
          </Button>
          {container.exitedAt !== null && (
            <Button
              kind="quiet"
              onClick={() => {
                props.onPrint('out', container);
              }}
            >
              {AR.printCardOut}
            </Button>
          )}
        </div>

        {buried && props.above !== null && (
          <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800">
            {AR.stackedUnder(props.above.number)}
          </p>
        )}
        {inYard && container.status === 'HOLD' && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">
            {AR.errors.CONTAINER_HOLD}
          </p>
        )}
        {props.below !== null && (
          <p className="text-xs text-slate-500">{AR.stackedOver(props.below.number)}</p>
        )}

        <ErrorLine message={error} />

        {inYard &&
          !editing &&
          container.position !== null &&
          container.position.tier === GROUND_TIER &&
          props.above === null && (
            <Button
              full
              kind="quiet"
              disabled={busy}
              onClick={() => {
                if (container.position !== null) {
                  props.onStackOnTop({ ...container.position, tier: 2 });
                }
              }}
            >
              {AR.stackOnTop}
            </Button>
          )}

        {inYard && !editing && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => {
                props.onStartMove(container);
              }}
              disabled={buried || held || busy}
            >
              {AR.actionMove}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                setConfirming('exit');
              }}
              disabled={buried || held || busy}
            >
              {AR.actionExit}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                setEditing(true);
              }}
              disabled={busy}
            >
              {AR.actionEdit}
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                setConfirming('delete');
              }}
              disabled={buried || held || busy}
            >
              {AR.actionDelete}
            </Button>
          </div>
        )}

        {editing && (
          <EditForm
            container={container}
            busy={busy}
            onCancel={() => {
              setEditing(false);
            }}
            onSave={(input) => {
              run(api.edit(container.id, input), AR.save);
            }}
          />
        )}

        <div>
          <h3 className="mb-2 text-sm font-bold text-slate-700">{AR.movementsTitle}</h3>
          <ol className="space-y-2 border-s-2 border-slate-100 ps-3">
            {(detail.data?.movements ?? []).map((movement) => (
              <MovementRow key={movement.id} movement={movement} label={props.label} />
            ))}
          </ol>
        </div>
      </div>

      {confirming === 'exit' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">{AR.confirmExitTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {AR.confirmExitBody(container.number)}
            </p>
            <div className="mt-4 space-y-3">
              <Field label={AR.truck}>
                <input
                  dir="ltr"
                  className={`${inputClass} text-start`}
                  value={truckOut}
                  onChange={(event) => {
                    setTruckOut(event.target.value);
                  }}
                  autoFocus
                />
              </Field>
              <Field label={AR.driver}>
                <input
                  className={inputClass}
                  value={driverOut}
                  onChange={(event) => {
                    setDriverOut(event.target.value);
                  }}
                />
              </Field>
            </div>
            <div className="mt-5 flex gap-2">
              <Button
                disabled={busy || truckOut.trim() === ''}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  api
                    .exit(container.id, {
                      truck: truckOut.trim(),
                      driver: driverOut.trim(),
                    })
                    .then((departed) => {
                      // Straight to its exit card — the paper the driver takes.
                      props.onExited(departed, AR.exitDone(departed.number));
                    })
                    .catch((failure: unknown) => {
                      setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
                      setBusy(false);
                      setConfirming(null);
                    });
                }}
              >
                {AR.actionExit}
              </Button>
              <Button
                kind="quiet"
                onClick={() => {
                  setConfirming(null);
                }}
              >
                {AR.cancel}
              </Button>
            </div>
          </div>
        </div>
      )}
      {confirming === 'delete' && (
        <Confirm
          title={AR.confirmDeleteTitle}
          body={AR.confirmDeleteBody(container.number)}
          confirmLabel={AR.actionDelete}
          danger
          busy={busy}
          onConfirm={() => {
            run(api.remove(container.id), AR.deleteDone);
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
    </Sheet>
  );
}

function EditForm(props: {
  container: ContainerDto;
  busy: boolean;
  onSave: (input: {
    number: string;
    customer: string;
    cargo: 'EMPTY' | 'LADEN';
    size: 20 | 40;
    notes: string;
  }) => void;
  onCancel: () => void;
}): ReactElement {
  const [number, setNumber] = useState(props.container.number);
  const [customer, setCustomer] = useState(props.container.customer);
  const [cargo, setCargo] = useState<'EMPTY' | 'LADEN'>(props.container.cargo);
  const [size, setSize] = useState<20 | 40>(props.container.size);
  const [notes, setNotes] = useState(props.container.notes);

  const ready = number.trim() !== '' && customer.trim() !== '' && !props.busy;

  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-3.5">
      <Field label={AR.containerNumber}>
        <input
          dir="ltr"
          className={`${inputClass} text-start font-mono`}
          value={number}
          onChange={(event) => {
            setNumber(event.target.value);
          }}
        />
      </Field>
      <Field label={AR.customer}>
        <input
          className={inputClass}
          value={customer}
          onChange={(event) => {
            setCustomer(event.target.value);
          }}
        />
      </Field>
      <Field label={AR.cargo}>
        <div className="grid grid-cols-2 gap-2">
          {(['LADEN', 'EMPTY'] as const).map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => {
                setCargo(state);
              }}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold ' +
                (cargo === state
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600')
              }
            >
              {state === 'LADEN' ? AR.cargoLaden : AR.cargoEmpty}
            </button>
          ))}
        </div>
      </Field>
      <Field label={AR.cardSize}>
        <div className="grid grid-cols-2 gap-2">
          {([20, 40] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setSize(option);
              }}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold ' +
                (size === option
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600')
              }
            >
              {option} قدم
            </button>
          ))}
        </div>
      </Field>
      <Field label={AR.notes}>
        <textarea
          className={`${inputClass} min-h-16 resize-y`}
          rows={2}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </Field>
      <div className="flex gap-2">
        <Button
          disabled={!ready}
          onClick={() => {
            props.onSave({
              number: number.trim(),
              customer: customer.trim(),
              cargo,
              size,
              notes: notes.trim(),
            });
          }}
        >
          {AR.save}
        </Button>
        <Button kind="quiet" onClick={props.onCancel}>
          {AR.cancel}
        </Button>
      </div>
    </div>
  );
}
