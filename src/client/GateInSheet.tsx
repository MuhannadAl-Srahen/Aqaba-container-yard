import { useState, type ReactElement } from 'react';
import type { BlockSize, Position, Size } from '../shared/types';
import { MIXED_SIZE } from '../shared/types';
import { checkNumber } from '../shared/iso6346';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * The gate-in card. The clerk tapped an empty position first, so the
 * destination is already decided by WHERE. A sized block decides the size
 * too; in a mixed block the card asks 20 or 40.
 */
export function GateInSheet(props: {
  position: Position;
  /** The tapped block's policy — the position itself only carries the block id. */
  blockSize: BlockSize;
  /** The position spoken: `A1-5-L`. */
  positionText: string;
  customers: readonly string[];
  onDone: (message: string) => void;
  onClose: () => void;
}): ReactElement {
  const [number, setNumber] = useState('');
  const [customer, setCustomer] = useState('');
  const [cargo, setCargo] = useState<'EMPTY' | 'LADEN'>('LADEN');
  const [chosenSize, setChosenSize] = useState<Size>(
    props.blockSize === MIXED_SIZE ? 20 : props.blockSize,
  );
  const [truck, setTruck] = useState('');
  const [driver, setDriver] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = number.trim() === '' ? null : checkNumber(number);
  const mixed = props.blockSize === MIXED_SIZE;
  const size = mixed ? chosenSize : (props.blockSize as Size);
  const ready = number.trim() !== '' && customer.trim() !== '' && truck.trim() !== '' && !busy;

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
        truck: truck.trim(),
        driver: driver.trim(),
        weight: weight.trim(),
      })
      .then((container) => {
        props.onDone(AR.gateInDone(container.number, props.positionText));
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  return (
    <Sheet title={mixed ? AR.gateInTitleMixed : AR.gateInTitle(size)} onClose={props.onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm font-semibold text-blue-900">
          {AR.gateInAt}: <span dir="ltr">{props.positionText}</span>
        </div>

        <Field
          label={AR.containerNumber}
          hint={
            check === null ? undefined : check.local ? (
              <span className="text-emerald-600">{AR.numberLocal}</span>
            ) : check.valid ? (
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
            placeholder="MSCU 1234"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={AR.truck}>
            <input
              dir="ltr"
              className={`${inputClass} text-start`}
              value={truck}
              onChange={(event) => {
                setTruck(event.target.value);
              }}
            />
          </Field>
          <Field label={AR.weight}>
            <input
              dir="ltr"
              className={`${inputClass} text-start`}
              value={weight}
              onChange={(event) => {
                setWeight(event.target.value);
              }}
            />
          </Field>
        </div>

        <Field label={AR.driver}>
          <input
            className={inputClass}
            value={driver}
            onChange={(event) => {
              setDriver(event.target.value);
            }}
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

        {mixed && (
          <Field label={AR.cardSize}>
            <div className="grid grid-cols-2 gap-2">
              {([20, 40] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setChosenSize(option);
                  }}
                  className={
                    'rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ' +
                    (chosenSize === option
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-blue-400')
                  }
                >
                  {option} قدم
                </button>
              ))}
            </div>
          </Field>
        )}

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
          <textarea
            className={`${inputClass} min-h-16 resize-y`}
            rows={2}
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
