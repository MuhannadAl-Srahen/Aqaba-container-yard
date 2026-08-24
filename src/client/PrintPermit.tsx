import { useEffect, type ReactElement } from 'react';
import type { PermitDto } from '../shared/types';
import { cardSerial } from '../shared/types';
import { AR } from './ar';
import { Button, useEscape } from './ui';

/**
 * تصريح تحميل وخروج داخلي — the permission paper مؤسسة الحق issues for one
 * bill: the containers listed below may be loaded and taken out of the yard,
 * to موقع المقص only. Headed by the organisation and the permission sentence,
 * numbered per year like the gate cards, and closed by the storage
 * directorate's signature and stamp. Rendered as an overlay; printing
 * isolates it through the same .print-area CSS the cards use.
 */

const dayFormat = new Intl.DateTimeFormat('ar-JO', { weekday: 'long', timeZone: 'Asia/Amman' });
// Latin digit order (dd/mm/yyyy) so the date never scrambles inside RTL text.
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeZone: 'Asia/Amman',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

export function PrintPermit(props: { permit: PermitDto; onClose: () => void }): ReactElement {
  const { permit } = props;
  useEscape(props.onClose);

  // The permit wins the printer while it is up, exactly as a card does over
  // an open register behind it.
  useEffect(() => {
    document.documentElement.classList.add('printing-card');
    return () => {
      document.documentElement.classList.remove('printing-card');
    };
  }, []);

  // The paper names the yard it was issued for — pinned on the permit at
  // issue time, like every other fact the stamp made true.
  const yard = permit.yard;
  // The serial prints the way the gate cards print theirs: the number big,
  // the year on its own small line — sized for the box on paper.
  const serialText = String(permit.serial).padStart(4, '0');

  // The table wears the register's own ruling — «تماما مثل كشف البوليصة»,
  // the owner's word: the same header band, the same alternating rows, and
  // the bill sheet's totals row closing the table before the signature.
  const headCell =
    'border border-rule border-b-2 border-b-rule-strong bg-sunken px-2 py-1.5 text-center text-[13px] font-bold text-ink';
  const bodyCell = 'border border-rule px-2 py-1.5 text-center text-[13px] text-ink';
  const t20 = permit.items.filter((item) => item.size === 20).length;
  const t40 = permit.items.length - t20;

  return (
    // permit-print: on paper this overlay leaves the viewport and lies at the
    // top of the document, so a long table breaks onto page 2 and onward —
    // an overlay pinned to the screen prints exactly one page and swallows
    // the rest.
    <div className="permit-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      {/* The permit prints upright, like the gate cards. */}
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto">
        <div className="print-area gate-card paper-light overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          {/* The organisation over the title, as the owner spelled the head:
              «مؤسسة الحق» then the permit's own name with its yard. No fill
              behind it — «ما بدي يصرف حبر» applies to every paper alike. */}
          <div className="border-b-2 border-rule-strong px-3 py-3 text-center">
            <p className="text-xl font-extrabold text-ink">{AR.permitOrg}</p>
            <p className="mt-1 text-base font-bold text-ink">{AR.permitTitle(yard)}</p>
          </div>

          {/* The voucher strip: serial | bill | date. */}
          <div className="flex items-stretch border-b-2 border-rule-strong text-ink">
            <div className="flex w-36 flex-col items-center justify-center gap-0.5 border-e border-rule-strong px-2 py-2">
              <span className="text-[10px] font-semibold text-muted">{AR.permitSerial}</span>
              <span
                className="gate-serial rounded-md border border-rule-strong px-2 font-mono text-xl font-extrabold tabular-nums leading-7"
                dir="ltr"
              >
                {serialText}
              </span>
              <span className="gate-serial-year text-[10px] font-bold text-muted" dir="ltr">
                {String(permit.serialYear)}
              </span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2">
              <span className="text-[10px] font-semibold text-muted">{AR.permitBill}</span>
              <span className="font-mono text-2xl font-extrabold tracking-wider" dir="ltr">
                {permit.bill}
              </span>
            </div>
            <div className="flex w-40 flex-col items-center justify-center gap-0.5 border-s border-rule-strong px-3 py-2 text-center text-[12px]">
              <span className="text-[10px] font-semibold text-muted">{AR.permitDate}</span>
              <span className="font-bold">{dayFormat.format(new Date(permit.at))}</span>
              <span dir="ltr" className="text-muted">
                {dateFormat.format(new Date(permit.at))}
              </span>
            </div>
          </div>

          {/* The permission sentence — what the stamp below makes true. */}
          <p className="border-b-2 border-rule-strong px-3.5 py-3 text-[13px] font-semibold leading-7 text-ink">
            {AR.permitSentence(yard)}
          </p>

          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${headCell} w-10`}>{AR.colSeq}</th>
                <th className={headCell}>{AR.colEntryCard}</th>
                <th className={headCell}>{AR.colNumber}</th>
                <th className={headCell}>{AR.colEnteredAt}</th>
                <th className={headCell}>{AR.colPermitTruck}</th>
              </tr>
            </thead>
            <tbody>
              {permit.items.map((item, index) => (
                <tr key={item.containerId} className="odd:bg-surface even:bg-sunken">
                  <td className={bodyCell}>{String(index + 1)}</td>
                  <td className={`${bodyCell} font-mono`} dir="ltr">
                    {cardSerial(item.cardIn, item.cardInYear) ?? '—'}
                  </td>
                  <td className={`${bodyCell} font-mono tracking-wider`} dir="ltr">
                    {item.number}
                  </td>
                  <td className={bodyCell} dir="ltr">
                    {dateFormat.format(new Date(item.enteredAt))}
                  </td>
                  {/* A blank truck cell stays BLANK, not dashed: the plate is
                      written there by hand at loading time. */}
                  <td className={`${bodyCell} font-mono`} dir="ltr">
                    {item.truck}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunken">
                <td className={`${bodyCell} border-t-2 border-t-rule-strong font-bold`}>
                  {AR.totalRow}
                </td>
                <td
                  colSpan={4}
                  className={`${bodyCell} border-t-2 border-t-rule-strong font-bold`}
                >
                  {AR.billTotals(permit.items.length, t20, t40)}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* The storage directorate's closing block — the label centred over
              an open space for the pen and the stamp. */}
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
    </div>
  );
}
