import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, Position } from '../shared/types';
import { AR } from './ar';
import { api } from './api';
import { Button, useEscape } from './ui';

/**
 * The gate card, a proper voucher: serial and date strip, the paperwork in a
 * clean two-column grid, and the two signature boxes. Rendered as an
 * overlay; printing isolates it through the .print-area CSS.
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

export function PrintCard(props: {
  kind: 'in' | 'out';
  container: ContainerDto;
  label: (position: Position) => string;
  onClose: () => void;
}): ReactElement {
  const { kind, container } = props;
  useEscape(props.onClose);

  // The card names the slot of the gate moment itself: where the container
  // landed on entry, or stood right before it left.
  const detail = useQuery({
    queryKey: ['container', container.id],
    queryFn: () => api.detail(container.id),
  });
  const movements = detail.data?.movements ?? [];
  const gateMove =
    kind === 'in'
      ? movements.find((m) => m.type === 'IN')
      : [...movements].reverse().find((m) => m.type === 'OUT');
  const slot = kind === 'in' ? (gateMove?.to ?? container.position) : (gateMove?.from ?? null);

  const at = kind === 'in' ? container.enteredAt : container.exitedAt;
  const serial = kind === 'in' ? container.cardIn : container.cardOut;
  const truck = kind === 'in' ? container.truckIn : container.truckOut;
  const driver = kind === 'in' ? container.driverIn : container.driverOut;
  const sealShown = kind === 'in' ? container.sealIn : container.sealOut;
  const accent = kind === 'in' ? 'bg-blue-700' : 'bg-slate-700';

  const row = (label: string, value: string, mono = false): ReactElement => (
    <div className="flex items-stretch border-b border-line-strong last:border-b-0">
      <span className="gate-label flex w-32 shrink-0 items-center border-e border-line-strong bg-sunken px-3 py-2 text-[13px] font-bold text-ink">
        {label}
      </span>
      <span
        className={`gate-value flex flex-1 items-center px-3 py-2 text-sm font-semibold text-ink${mono ? ' font-mono tracking-wide' : ''}`}
        dir="ltr"
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      {/* The card prints upright, unlike the wide report sheets. */}
      <style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style>
      <div className="max-h-full w-full max-w-md overflow-y-auto">
        <div className="print-area gate-card overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          {/* The voucher strip: serial | title | day+date. */}
          <div className={`flex items-stretch ${accent} text-white`}>
            <div className="flex w-24 flex-col items-center justify-center gap-0.5 border-e border-white/25 px-2 py-2.5">
              <span className="text-[10px] font-semibold opacity-80">{AR.cardNumber}</span>
              <span
                className="gate-serial rounded-md border border-white/40 px-2 font-mono text-2xl font-extrabold tabular-nums leading-7"
                dir="ltr"
              >
                {serial ?? '—'}
              </span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-2 py-2.5">
              <span className="text-lg font-extrabold leading-6">
                {kind === 'in' ? AR.cardInTitle : AR.cardOutTitle}
              </span>
              <span className="text-[10px] font-semibold opacity-80">{AR.appName}</span>
            </div>
            <div className="gate-stamp flex w-36 flex-col justify-center gap-0.5 border-s border-white/25 px-3 py-2.5 text-[12px]">
              <span className="font-bold">{at === null ? '—' : dayFormat.format(new Date(at))}</span>
              <span dir="ltr" className="opacity-90">
                {at === null ? '—' : dateFormat.format(new Date(at))}
              </span>
              <span dir="ltr" className="opacity-90">
                {at === null ? '—' : timeFormat.format(new Date(at))}
              </span>
            </div>
          </div>

          {/* The container number is what the gate checker actually reads —
              it stands alone, big, above the table. */}
          <div className="gate-hero border-b-2 border-rule-strong px-3 py-2.5 text-center">
            <p className="text-[10px] font-bold text-muted">{AR.containerNumber}</p>
            <p className="font-mono text-3xl font-extrabold tracking-widest text-ink" dir="ltr">
              {container.number}
            </p>
          </div>

          {row(AR.cardSize, `${String(container.size)} قدم`)}
          {row(AR.cardCompany, container.customer)}
          {row(AR.cardTruck, truck === '' ? '—' : truck)}
          {row(AR.cardDriver, driver === '' ? '—' : driver)}
          {row(AR.cardWeight, container.weight === '' ? '—' : container.weight)}
          {/* The seal of THIS gate moment: the one it came under on the entry
              card, the one it leaves under on the exit card. */}
          {row(AR.cardSeal, sealShown === '' ? '—' : sealShown, true)}
          {row(AR.cardSlot, slot === null ? '—' : props.label(slot), true)}
          {container.notes !== '' && row(AR.cardNotes, container.notes)}

          <div className="flex border-t-2 border-rule-strong">
            {[AR.cardWorkerSign, AR.cardSupervisorSign].map((sign, index) => (
              <div
                key={sign}
                className={`gate-sign h-24 flex-1 p-2.5${index === 0 ? ' border-e border-line-strong' : ''}`}
              >
                <p className="text-[12px] font-bold text-muted">{sign}</p>
              </div>
            ))}
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
