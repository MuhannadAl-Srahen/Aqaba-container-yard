import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, MovementDto, Permission } from '../shared/types';
import { positionLabel } from '../shared/address';
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
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    sky: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
    slate: 'bg-sunken text-muted',
    red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    violet: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
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
    <bdi dir="ltr" className="font-mono text-[13px] font-semibold text-ink">
      {props.text}
    </bdi>
  );
}

function MovementRow(props: { movement: MovementDto }): ReactElement {
  const { movement } = props;

  let detail: ReactElement | null = null;
  switch (movement.type) {
    case 'IN':
      detail = movement.to === null ? null : <Addr text={positionLabel(movement.to)} />;
      break;
    case 'MOVE':
      detail =
        movement.from !== null && movement.to !== null ? (
          <Addr text={`${positionLabel(movement.from)} → ${positionLabel(movement.to)}`} />
        ) : null;
      break;
    case 'OUT':
      detail = movement.from === null ? null : <Addr text={positionLabel(movement.from)} />;
      break;
    case 'EDIT':
      detail =
        movement.note === '' ? null : (
          <span className="min-w-0 text-xs leading-5 text-muted wrap-anywhere">
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
      <span className="ms-auto whitespace-nowrap text-xs text-faint">
        <span dir="ltr">{formatDateOnly(movement.at)}</span>
        {' · '}
        <span dir="ltr">{formatTimeOnly(movement.at)}</span>
      </span>
    </li>
  );
}

export function ContainerCard(props: {
  container: ContainerDto;
  /** What the signed-in employee is allowed to do. */
  may: (permission: Permission) => boolean;
  onStartMove: (container: ContainerDto) => void;
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
  // Pre-filled with the seal it came in under: the common case is unchanged,
  // and an actual change is then a deliberate edit, not a typo.
  const [sealOut, setSealOut] = useState(props.container.sealIn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ['container', container.id],
    queryFn: () => api.detail(container.id),
  });

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
          {!container.numberValid && <Badge text={AR.numberNotVerified} tone="amber" />}
          {!inYard && <Badge text={AR.outOfYard} tone="slate" />}
          {/* Two different seals means the door was opened inside the yard. */}
          {container.sealOut !== '' && container.sealOut !== container.sealIn && (
            <Badge text={AR.sealChanged} tone="red" />
          )}
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted">{AR.customer}</dt>
            <dd className="min-w-0 font-semibold text-ink wrap-anywhere">
              {container.customer}
            </dd>
          </div>
          {container.position !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.slot}</dt>
              {/* The official code, big and mono — this is what gets radioed. */}
              <dd className="font-mono text-base font-extrabold text-blue-800 dark:text-blue-300" dir="ltr">
                {positionLabel(container.position)}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{AR.enteredAt}</dt>
            <dd className="font-semibold text-ink" dir="ltr">
              {formatDate(container.enteredAt)}
            </dd>
          </div>
          {container.exitedAt !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.exitedAt}</dt>
              <dd className="font-semibold text-ink" dir="ltr">
                {formatDate(container.exitedAt)}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="text-muted" />
              <dd className="font-semibold text-blue-700">
                {AR.dwell(dwellDays(container.enteredAt))}
              </dd>
            </div>
          )}
          {container.bill !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.bill}</dt>
              <dd className="font-mono font-semibold text-ink" dir="ltr">
                {container.bill}
              </dd>
            </div>
          )}
          {container.truckIn !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.cardTruck}</dt>
              <dd className="font-semibold text-ink" dir="ltr">
                {container.truckIn}
              </dd>
            </div>
          )}
          {container.sealIn !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.seal}</dt>
              <dd className="font-mono font-semibold text-ink" dir="ltr">
                {container.sealIn}
              </dd>
            </div>
          )}
          {container.sealOut !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.sealOut}</dt>
              <dd
                className={
                  'font-mono font-semibold ' +
                  (container.sealOut === container.sealIn ? 'text-ink' : 'text-red-600')
                }
                dir="ltr"
              >
                {container.sealOut}
              </dd>
            </div>
          )}
          {container.driverIn !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.cardDriver}</dt>
              <dd className="text-ink">{container.driverIn}</dd>
            </div>
          )}
          {container.weight !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{AR.cardWeight}</dt>
              <dd className="text-ink" dir="ltr">
                {container.weight}
              </dd>
            </div>
          )}
          {/* The notes hold the condition now, so they get the room a
              paragraph needs and never get clipped. */}
          {container.notes !== '' && (
            <div>
              <dt className="mb-1 text-muted">{AR.notes}</dt>
              <dd className="whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 leading-7 text-ink wrap-anywhere dark:border-amber-900 dark:bg-amber-950/40">
                {container.notes}
              </dd>
            </div>
          )}
        </dl>

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

        <ErrorLine message={error} />

        {/* Only what this employee may do is offered. The refusal still lives
            on the server; this only keeps dead buttons off the screen. */}
        {inYard && !editing && (
          <div className="grid grid-cols-2 gap-2">
            {props.may('MOVE') && (
              <Button
                onClick={() => {
                  props.onStartMove(container);
                }}
                disabled={busy}
              >
                {AR.actionMove}
              </Button>
            )}
            {props.may('GATE_OUT') && (
              <Button
                kind="quiet"
                onClick={() => {
                  setConfirming('exit');
                }}
                disabled={busy}
              >
                {AR.actionExit}
              </Button>
            )}
            {props.may('EDIT') && (
              <Button
                kind="quiet"
                onClick={() => {
                  setEditing(true);
                }}
                disabled={busy}
              >
                {AR.actionEdit}
              </Button>
            )}
            {props.may('DELETE') && (
              <Button
                kind="danger"
                onClick={() => {
                  setConfirming('delete');
                }}
                disabled={busy}
              >
                {AR.actionDelete}
              </Button>
            )}
          </div>
        )}

        {editing && (
          <EditForm
            container={container}
            standing={inYard}
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
          <h3 className="mb-2 text-sm font-bold text-ink">{AR.movementsTitle}</h3>
          <ol className="space-y-2 border-s-2 border-line ps-3">
            {(detail.data?.movements ?? []).map((movement) => (
              <MovementRow key={movement.id} movement={movement} />
            ))}
          </ol>
        </div>
      </div>

      {confirming === 'exit' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl">
            <h3 className="text-base font-bold text-ink">{AR.confirmExitTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
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
              <Field
                label={AR.sealOut}
                hint={
                  container.sealIn !== '' ? (
                    <span className="text-faint">{AR.sealWas(container.sealIn)}</span>
                  ) : undefined
                }
              >
                <input
                  dir="ltr"
                  className={`${inputClass} text-start font-mono`}
                  value={sealOut}
                  onChange={(event) => {
                    setSealOut(event.target.value);
                  }}
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
                disabled={busy || truckOut.trim() === '' || sealOut.trim() === ''}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  api
                    .exit(container.id, {
                      truck: truckOut.trim(),
                      seal: sealOut.trim(),
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
  /** While it stands, the bay's parity IS the size — the toggle locks. */
  standing: boolean;
  busy: boolean;
  onSave: (input: { number: string; customer: string; bill: string; size: 20 | 40; notes: string }) => void;
  onCancel: () => void;
}): ReactElement {
  const [number, setNumber] = useState(props.container.number);
  const [customer, setCustomer] = useState(props.container.customer);
  const [bill, setBill] = useState(props.container.bill);
  const [size, setSize] = useState<20 | 40>(props.container.size);
  const [notes, setNotes] = useState(props.container.notes);

  const ready = number.trim() !== '' && customer.trim() !== '' && !props.busy;

  return (
    <div className="space-y-3 rounded-xl bg-sunken p-3.5">
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
      <Field label={AR.bill} hint={<span className="text-faint">{AR.billHint}</span>}>
        <input
          dir="ltr"
          className={`${inputClass} text-start font-mono`}
          value={bill}
          onChange={(event) => {
            setBill(event.target.value);
          }}
        />
      </Field>
      <Field
        label={AR.cardSize}
        hint={props.standing ? <span className="text-faint">{AR.sizeLockedStanding}</span> : undefined}
      >
        <div className="grid grid-cols-2 gap-2">
          {([20, 40] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={props.standing && option !== props.container.size}
              onClick={() => {
                setSize(option);
              }}
              className={
                'rounded-xl border px-3 py-2 text-sm font-semibold ' +
                'disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-faint ' +
                (size === option
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-line-strong bg-surface text-muted')
              }
            >
              {option} قدم
            </button>
          ))}
        </div>
      </Field>
      <Field label={AR.notes} hint={<span className="text-faint">{AR.notesHint}</span>}>
        <textarea
          className={`${inputClass} min-h-24 resize-y leading-7`}
          rows={3}
          maxLength={2000}
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
              bill: bill.trim(),
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
