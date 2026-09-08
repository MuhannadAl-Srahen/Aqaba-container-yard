import { useEffect, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { cardSerialText } from '../shared/types';
import { AR } from './ar';
import { Button, useEscape } from './ui';

/**
 * بطاقة ملغاة — the paper stub of a serial the book issued and nothing
 * carries: its record was struck out, or the paper was voided. The owner
 * wants it printable so the physical file has a page where that number
 * belongs — «اريد القدرة على طباعة البطاقة الملغاة».
 *
 * It wears the gate card's own shape, ruling and signature box so it files
 * beside its siblings, and every box on it is empty on purpose: nothing was
 * ever written on this paper, and nothing may be invented for it now. It is
 * a separate component rather than a mode of `PrintCard` precisely because
 * it has no container behind it — no number, no bill, no slot, no dates.
 */

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeZone: 'Asia/Amman',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

/** One labelled box of the grid, empty — the twin of PrintCard's `row`. */
const row = (label: string, wide = false): ReactElement => (
  <div
    key={label}
    className={`flex items-stretch border-b border-line-strong${wide ? ' sm:col-span-2' : ' border-e'}`}
  >
    <span className="gate-label flex w-32 shrink-0 items-center border-e border-line-strong bg-sunken px-3 py-2 text-[13px] font-bold text-ink">
      {label}
    </span>
    <span className="gate-value flex min-w-0 flex-1 items-center px-3 py-2 text-sm font-semibold leading-6 text-ink">
      —
    </span>
  </div>
);

export function PrintVoidCard(props: {
  serial: number;
  serialYear: number | null;
  onClose: () => void;
}): ReactElement {
  useEscape(props.onClose);

  // The card wins the printer while it is up, exactly as a real one does.
  useEffect(() => {
    document.documentElement.classList.add('printing-card');
    return () => {
      document.documentElement.classList.remove('printing-card');
    };
  }, []);

  const serialText = cardSerialText(props.serial);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto">
        <div className="print-area gate-card paper-light overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          {/* The voucher strip: the number is the whole point of this paper,
              so it stands where it always stands, and the date box is empty
              because no gate act ever happened. */}
          <div className="flex items-stretch border-b-2 border-rule-strong bg-surface text-ink">
            <div className="flex min-w-28 flex-col items-center justify-center gap-0.5 border-e border-rule-strong px-2 py-2.5">
              <span className="text-[10px] font-semibold text-muted">{AR.cardNumber}</span>
              <span
                className="gate-serial rounded-md border border-rule-strong px-2 font-mono text-2xl font-extrabold tabular-nums whitespace-nowrap leading-7"
                dir="ltr"
              >
                {serialText}
              </span>
              {props.serialYear !== null && (
                <span className="gate-serial-year text-[10px] font-bold text-muted" dir="ltr">
                  {String(props.serialYear)}
                </span>
              )}
            </div>
            <div className="flex flex-1 items-center justify-center px-2 py-2.5">
              <span className="text-lg font-extrabold leading-6">{AR.cardVoidTitle}</span>
            </div>
            <div className="gate-stamp flex w-40 flex-col justify-center gap-0.5 border-s border-rule-strong px-3 py-2.5 text-[12px]">
              <span className="text-[10px] font-semibold text-muted">{AR.cardIssuedAt}</span>
              <span className="font-bold">—</span>
            </div>
          </div>

          {/* Why the paper is empty, in one sentence — so nobody reading the
              file later takes a blank card for a lost one. */}
          <p className="gate-statement border-b-2 border-rule-strong px-3.5 py-3 text-[13px] font-semibold leading-7 text-ink">
            {AR.cardVoidNote}
          </p>

          <div className="gate-hero border-b-2 border-rule-strong px-3 py-2.5 text-center">
            <p className="text-[10px] font-bold text-muted">{AR.containerNumber}</p>
            <p className="font-mono text-3xl font-extrabold tracking-widest text-ink" dir="ltr">
              —
            </p>
          </div>

          <div className="grid sm:grid-cols-2">
            {row(AR.cardBill)}
            {row(AR.cardSize)}
            {row(AR.cardSlot)}
            {row(AR.cardWeight)}
            {row(AR.cardSeal)}
            {row(AR.cardStoredAt)}
            {row(AR.cardTruck)}
            {row(AR.cardDriver)}
            {row(AR.cardUser)}
            {row(AR.cardNotes, true)}
          </div>

          <div className="flex border-t-2 border-rule-strong">
            <div className="gate-sign h-24 flex-1 p-2.5">
              <p className="text-[12px] font-bold text-muted">{AR.cardWorkerSign}</p>
            </div>
          </div>

          <p className="border-t border-line px-3 py-1 text-[10px] text-faint">
            {AR.printedAt}{' '}
            <span dir="ltr">{`${dateFormat.format(new Date())} ${timeFormat.format(new Date())}`}</span>
          </p>
        </div>

        <div className="print-hidden mt-3 flex justify-center gap-2">
          <Button
            onClick={() => {
              window.print();
            }}
          >
            {AR.print}
          </Button>
          <Button kind="quiet" onClick={props.onClose}>
            {AR.close}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
