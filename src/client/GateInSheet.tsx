import { useState, type ReactElement } from 'react';
import type { BlockSize, Position, Size } from '../shared/types';
import { MIXED_SIZE } from '../shared/types';
import { placesFor } from '../shared/rules';
import { checkNumber } from '../shared/iso6346';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * The gate-in card. The clerk tapped a location first, so the destination is
 * already decided by WHERE. A sized column decides the size too; in a mixed
 * column the card asks 20 or 40 — and offers 40 only while two places are
 * still open, because a 40 fills two.
 */
export function GateInSheet(props: {
  position: Position;
  /** The tapped column's policy — the position itself only carries the block id. */
  blockSize: BlockSize;
  /** The location spoken: `A-01`. */
  positionText: string;
  /** Twenty-foot places still open in that location. */
  freePlaces: number;
  customers: readonly string[];
  onDone: (message: string) => void;
  onClose: () => void;
}): ReactElement {
  const [number, setNumber] = useState('');
  const [customer, setCustomer] = useState('');
  const [chosenSize, setChosenSize] = useState<Size>(
    props.blockSize === MIXED_SIZE ? 20 : props.blockSize,
  );
  const [truck, setTruck] = useState('');
  const [seal, setSeal] = useState('');
  const [driver, setDriver] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = number.trim() === '' ? null : checkNumber(number);
  const mixed = props.blockSize === MIXED_SIZE;
  // A 40 needs two places; if only one is left the card falls back to a 20
  // rather than letting the clerk fill the form and be refused at the end.
  const fits = (option: Size): boolean => placesFor(option) <= props.freePlaces;
  const size = mixed ? (fits(chosenSize) ? chosenSize : 20) : (props.blockSize as Size);
  const ready =
    number.trim() !== '' &&
    customer.trim() !== '' &&
    truck.trim() !== '' &&
    seal.trim() !== '' &&
    !busy;

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    api
      .gateIn({
        number,
        size,
        customer: customer.trim(),
        notes: notes.trim(),
        position: props.position,
        truck: truck.trim(),
        seal: seal.trim(),
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
        <div className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-100">
          <span>
            {AR.gateInAt}: <span dir="ltr">{props.positionText}</span>
          </span>
          <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
            {AR.freePlaces(props.freePlaces)}
          </span>
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
          <Field label={AR.seal} hint={<span className="text-faint">{AR.sealHint}</span>}>
            <input
              dir="ltr"
              className={`${inputClass} text-start font-mono`}
              value={seal}
              onChange={(event) => {
                setSeal(event.target.value);
              }}
            />
          </Field>
        </div>

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

        <Field label={AR.driver}>
          <input
            className={inputClass}
            value={driver}
            onChange={(event) => {
              setDriver(event.target.value);
            }}
          />
        </Field>

        <Field label={AR.customer} hint={<span className="text-faint">{AR.customerHint}</span>}>
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
                  disabled={!fits(option)}
                  onClick={() => {
                    setChosenSize(option);
                  }}
                  className={
                    'rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ' +
                    'disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-faint ' +
                    (size === option
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-line-strong bg-surface text-muted hover:border-blue-400')
                  }
                >
                  {option} قدم
                </button>
              ))}
            </div>
          </Field>
        )}

        {/* The notes carry the container's condition now — dents, an opened
            lock, a customs hold — so they get room to be written in. */}
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

        <ErrorLine message={error} />

        <Button type="submit" full disabled={!ready}>
          {AR.confirmGateIn}
        </Button>
      </form>
    </Sheet>
  );
}
