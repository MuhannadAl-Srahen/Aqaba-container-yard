import { useState, type ReactElement } from 'react';
import type { Position } from '../shared/types';
import { positionLabel } from '../shared/address';
import { checkNumber } from '../shared/iso6346';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * The gate-in card. The clerk tapped an empty position first, so the size and
 * the destination are already decided by WHERE — the card only asks what the
 * paper docket knows: number, customer, laden or empty.
 */
export function GateInSheet(props: {
  position: Position;
  customers: readonly string[];
  onDone: (message: string) => void;
  onClose: () => void;
}): ReactElement {
  const [number, setNumber] = useState('');
  const [customer, setCustomer] = useState('');
  const [cargo, setCargo] = useState<'EMPTY' | 'LADEN'>('LADEN');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = number.trim() === '' ? null : checkNumber(number);
  const size = props.position.zone;
  const ready = number.trim() !== '' && customer.trim() !== '' && !busy;

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    api
      .gateIn({
        number,
        size,
        customer: customer.trim(),
        cargo,
        notes: notes.trim(),
        position: props.position,
      })
      .then((container) => {
        props.onDone(AR.gateInDone(container.number, positionLabel(props.position)));
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  return (
    <Sheet title={AR.gateInTitle(size)} onClose={props.onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm font-semibold text-blue-900">
          {AR.gateInAt}: <span dir="ltr">{positionLabel(props.position)}</span>
        </div>

        <Field
          label={AR.containerNumber}
          hint={
            check === null ? undefined : check.valid ? (
              <span className="text-emerald-600">{AR.numberOk}</span>
            ) : (
              <span className="text-amber-600">{AR.numberBad(check.expectedDigit)}</span>
            )
          }
        >
          <input
            dir="ltr"
            className={`${inputClass} text-start font-mono tracking-wider`}
            value={number}
            onChange={(event) => {
              setNumber(event.target.value);
            }}
            placeholder="MSCU 123456-6"
            autoFocus
          />
        </Field>

        <Field label={AR.customer} hint={<span className="text-slate-400">{AR.customerHint}</span>}>
          <input
            className={inputClass}
            value={customer}
            onChange={(event) => {
              setCustomer(event.target.value);
            }}
            list="customer-names"
          />
          <datalist id="customer-names">
            {props.customers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
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
                  'rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ' +
                  (cargo === state
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400')
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

        <ErrorLine message={error} />

        <Button type="submit" full disabled={!ready}>
          {AR.confirmGateIn}
        </Button>
      </form>
    </Sheet>
  );
}
