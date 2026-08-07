import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, MovementDto } from '../shared/types';
import { positionLabel } from '../shared/address';
import { AR } from './ar';
import { ApiFailure, api, dwellDays, formatDate } from './api';
import { Button, Confirm, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * Everything about one container, and everything that can be done to it —
 * opened by tapping it on the map or in a search result.
 */

function movementLine(movement: MovementDto): string {
  switch (movement.type) {
    case 'IN':
      return movement.to === null
        ? AR.movementIn
        : `${AR.movementIn} → ${positionLabel(movement.to)}`;
    case 'MOVE':
      return movement.from !== null && movement.to !== null
        ? `${AR.movementMove}: ${positionLabel(movement.from)} → ${positionLabel(movement.to)}`
        : AR.movementMove;
    case 'OUT':
      return movement.from === null
        ? AR.movementOut
        : `${AR.movementOut} من ${positionLabel(movement.from)}`;
    case 'EDIT':
      return movement.note === '' ? AR.movementEdit : AR.editedFields(movement.note);
  }
}

function Badge(props: { text: string; tone: 'blue' | 'sky' | 'amber' | 'slate' }): ReactElement {
  const tones = {
    blue: 'bg-blue-100 text-blue-800',
    sky: 'bg-sky-100 text-sky-800',
    amber: 'bg-amber-100 text-amber-800',
    slate: 'bg-slate-100 text-slate-600',
  } as const;
  return (
    <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${tones[props.tone]}`}>
      {props.text}
    </span>
  );
}

export function ContainerCard(props: {
  container: ContainerDto;
  /** The container standing on top of this one, when there is one. */
  above: ContainerDto | null;
  /** The container this one stands on, when on the upper tier. */
  below: ContainerDto | null;
  onStartMove: (container: ContainerDto) => void;
  onChanged: (message: string) => void;
  onClose: () => void;
}): ReactElement {
  const { container } = props;
  const [confirming, setConfirming] = useState<'exit' | 'delete' | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ['container', container.id],
    queryFn: () => api.detail(container.id),
  });

  const buried = props.above !== null;
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
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{AR.customer}</dt>
            <dd className="font-semibold text-slate-900">{container.customer}</dd>
          </div>
          {container.position !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.slot}</dt>
              <dd className="font-semibold text-slate-900" dir="ltr">
                {positionLabel(container.position)}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">{AR.enteredAt}</dt>
            <dd className="font-semibold text-slate-900">{formatDate(container.enteredAt)}</dd>
          </div>
          {container.exitedAt !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.exitedAt}</dt>
              <dd className="font-semibold text-slate-900">{formatDate(container.exitedAt)}</dd>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500" />
              <dd className="font-semibold text-blue-700">
                {AR.dwell(dwellDays(container.enteredAt))}
              </dd>
            </div>
          )}
          {container.notes !== '' && (
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{AR.notes}</dt>
              <dd className="text-slate-700">{container.notes}</dd>
            </div>
          )}
        </dl>

        {buried && props.above !== null && (
          <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800">
            {AR.stackedUnder(props.above.number)}
          </p>
        )}
        {props.below !== null && (
          <p className="text-xs text-slate-500">{AR.stackedOver(props.below.number)}</p>
        )}

        <ErrorLine message={error} />

        {inYard && !editing && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => {
                props.onStartMove(container);
              }}
              disabled={buried || busy}
            >
              {AR.actionMove}
            </Button>
            <Button
              kind="quiet"
              onClick={() => {
                setConfirming('exit');
              }}
              disabled={buried || busy}
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
              disabled={buried || busy}
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
          <ol className="space-y-1.5 border-s-2 border-slate-100 ps-3">
            {(detail.data?.movements ?? []).map((movement) => (
              <li key={movement.id} className="text-xs leading-5">
                <span className="font-semibold text-slate-700">{movementLine(movement)}</span>
                <span className="ms-2 text-slate-400">{formatDate(movement.at)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {confirming === 'exit' && (
        <Confirm
          title={AR.confirmExitTitle}
          body={AR.confirmExitBody(container.number)}
          confirmLabel={AR.actionExit}
          busy={busy}
          onConfirm={() => {
            run(api.exit(container.id), AR.exitDone(container.number));
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
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
    notes: string;
  }) => void;
  onCancel: () => void;
}): ReactElement {
  const [number, setNumber] = useState(props.container.number);
  const [customer, setCustomer] = useState(props.container.customer);
  const [cargo, setCargo] = useState<'EMPTY' | 'LADEN'>(props.container.cargo);
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
      <Field label={AR.notes}>
        <input
          className={inputClass}
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
