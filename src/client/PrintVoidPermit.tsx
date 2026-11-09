import { useEffect, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { PermitKind } from '../shared/types';
import { cardSerialText } from '../shared/types';
import { AR } from './ar';
import { Button, useEscape } from './ui';

/**
 * تصريح ملغى — the paper of a permit number the book issued and no live
 * permit carries. «بدي اذا حذفت تصريح بدي يعمل مثل ما بعمل ببطاقات الخروج
 * بحيث يحط تصريح ملغي بس اقدر اطبعه لحتى ما يكون في فجوات بالتسلسل».
 *
 * It wears the permit's own head, voucher strip, table ruling and signature
 * block so it files in the drawer beside its siblings, and every box on it
 * is empty on purpose: this paper permits nothing, and nothing may be
 * invented for it now. The twin of `PrintVoidCard`, in the permit's shape.
 */

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeZone: 'Asia/Amman',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

export function PrintVoidPermit(props: {
  /** Which book's stub — each kind voids its own numbers. */
  kind: PermitKind;
  serial: number;
  serialYear: number;
  yard: number;
  onClose: () => void;
}): ReactElement {
  useEscape(props.onClose);
  const storage = props.kind === 'STORAGE';

  // The paper wins the printer while it is up, exactly as a real one does.
  useEffect(() => {
    document.documentElement.classList.add('printing-card');
    return () => {
      document.documentElement.classList.remove('printing-card');
    };
  }, []);

  const headCell =
    'border border-rule border-b-2 border-b-rule-strong bg-sunken px-2 py-1.5 text-center text-[13px] font-bold text-ink';
  const bodyCell = 'border border-rule px-2 py-1.5 text-center text-[13px] text-ink';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto">
        <div className="print-area gate-card paper-light overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          <div className="border-b-2 border-rule-strong px-3 py-3 text-center">
            <p className="text-xl font-extrabold text-ink">
              {storage ? AR.storagePermitTitle(props.yard) : AR.permitTitle(props.yard)}
            </p>
          </div>

          {/* The voucher strip: the number is the whole point of this paper,
              so it stands where it always stands; the bill and the date are
              empty because no permission was ever given on it. */}
          <div className="flex items-stretch border-b-2 border-rule-strong text-ink">
            <div className="flex min-w-36 flex-col items-center justify-center gap-0.5 border-e border-rule-strong px-2 py-2">
              <span className="text-[10px] font-semibold text-muted">{AR.permitSerial}</span>
              <span
                className="gate-serial rounded-md border border-rule-strong px-2 font-mono text-xl font-extrabold tabular-nums whitespace-nowrap leading-7"
                dir="ltr"
              >
                {cardSerialText(props.serial)}
              </span>
              <span className="gate-serial-year text-[10px] font-bold text-muted" dir="ltr">
                {String(props.serialYear)}
              </span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2">
              <span className="text-[10px] font-semibold text-muted">
                {storage ? AR.colPermitCount : AR.permitBill}
              </span>
              <span className="text-2xl font-extrabold">
                {storage ? AR.storagePermitVoidTitle : AR.permitVoidTitle}
              </span>
            </div>
            <div className="flex w-40 flex-col items-center justify-center gap-0.5 border-s border-rule-strong px-3 py-2 text-center text-[12px]">
              <span className="text-[10px] font-semibold text-muted">{AR.permitDate}</span>
              <span className="font-bold">—</span>
            </div>
          </div>

          {/* Why the paper is empty, in one sentence — so nobody reading the
              drawer later takes a blank permit for a lost one. */}
          <p className="border-b-2 border-rule-strong px-3.5 py-3 text-[13px] font-semibold leading-7 text-ink">
            {storage ? AR.storagePermitVoidNote : AR.permitVoidNote}
          </p>

          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${headCell} w-10`}>{AR.colSeq}</th>
                <th className={headCell}>{AR.colEntryCard}</th>
                <th className={headCell}>{AR.colNumber}</th>
                <th className={headCell}>{AR.colWeight}</th>
                <th className={headCell}>{AR.colEnteredAt}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={bodyCell}>—</td>
                <td className={bodyCell}>—</td>
                <td className={bodyCell}>—</td>
                <td className={bodyCell}>—</td>
                <td className={bodyCell}>—</td>
              </tr>
            </tbody>
          </table>

          <div className="gate-sign h-28 border-t-2 border-rule-strong p-3">
            <p className="text-center text-[13px] font-bold text-ink">{AR.permitSignature}</p>
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
