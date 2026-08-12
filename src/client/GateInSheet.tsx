import { useState, type ReactElement } from 'react';
import type { Position } from '../shared/types';
import { sizeOfBay } from '../shared/types';
import { positionLabel } from '../shared/address';
import { checkNumber } from '../shared/iso6346';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * The gate-in card. The clerk picked the exact slot on the bay sheet first,
 * so WHERE is already the full official code — and the bay's parity already
 * decided the size: odd is a 20, even is a 40 lying across. Nothing here
 * asks a question the ground has answered.
 */
export function GateInSheet(props: {
  position: Position;
  onDone: (message: string) => void;
  onClose: () => void;
}): ReactElement {
  const [number, setNumber] = useState('');
  const [bill, setBill] = useState('');
  const [truck, setTruck] = useState('');
  const [seal, setSeal] = useState('');
  const [driver, setDriver] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = number.trim() === '' ? null : checkNumber(number);
  const size = sizeOfBay(props.position.bay);
  const positionText = positionLabel(props.position);
  // Nearly everything is required, on the owner's rule: a gate record with
  // holes in it is one somebody has to chase down later. The exceptions are
  // the notes, the driver's NAME and the weight — the scale ticket does not
  // always arrive with the truck, and refusing the whole record over a name
  // the gate does not have only teaches the gate to invent one.
  const ready = [number, bill, truck, seal].every((value) => value.trim() !== '') && !busy;

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    api
      .gateIn({
        number,
        size,
        bill: bill.trim(),
        notes: notes.trim(),
        position: props.position,
        truck: truck.trim(),
        seal: seal.trim(),
        driver: driver.trim(),
        weight: weight.trim(),
      })
      .then((container) => {
        props.onDone(AR.gateInDone(container.number, positionText));
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
        <div className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-100">
          <span>
            {AR.gateInAt}: <span dir="ltr">{positionText}</span>
          </span>
          <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
            {size === 40 ? AR.fortySpans : ''}
          </span>
        </div>

        {/* The expected shape is stated before anything is typed — four
            letters and seven digits — and the check answers once it is. */}
        <Field
          label={AR.containerNumber}
          hint={
            check === null ? (
              <span className="text-faint">{AR.numberForm}</span>
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
            placeholder="MSCU1234566"
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

        <div className="grid grid-cols-2 gap-3">
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
          <Field label={AR.weight} hint={<span className="text-faint">{AR.optional}</span>}>
            <input
              dir="ltr"
              inputMode="numeric"
              className={`${inputClass} text-start`}
              value={weight}
              onChange={(event) => {
                setWeight(event.target.value);
              }}
            />
          </Field>
        </div>

        <Field label={AR.driver} hint={<span className="text-faint">{AR.optional}</span>}>
          <input
            className={inputClass}
            value={driver}
            onChange={(event) => {
              setDriver(event.target.value);
            }}
          />
        </Field>

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
