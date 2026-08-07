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
  const accent = kind === 'in' ? 'bg-blue-700' : 'bg-slate-700';

  const row = (label: string, value: string, mono = false): ReactElement => (
    <div className="flex items-stretch border-b border-slate-300 last:border-b-0">
      <span className="flex w-32 shrink-0 items-center border-e border-slate-300 bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-700">
        {label}
      </span>
      <span
        className={`flex flex-1 items-center px-3 py-2 text-sm font-semibold text-slate-900${mono ? ' font-mono tracking-wide' : ''}`}
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
      <div className="w-full max-w-md">
        <div className="print-area overflow-hidden rounded-xl border-2 border-slate-800 bg-white shadow-2xl">
          {/* The voucher strip: serial | title | day+date. */}
          <div className={`flex items-stretch ${accent} text-white`}>
            <div className="flex w-24 flex-col items-center justify-center border-e border-white/25 px-2 py-2.5">
              <span className="text-[10px] font-semibold opacity-80">{AR.cardNumber}</span>
              <span className="text-2xl font-extrabold leading-6" dir="ltr">
                {serial ?? '—'}
              </span>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-2 py-2.5">
              <span className="text-lg font-extrabold leading-6">
                {kind === 'in' ? AR.cardInTitle : AR.cardOutTitle}
              </span>
              <span className="text-[10px] font-semibold opacity-80">{AR.appName}</span>
            </div>
            <div className="flex w-36 flex-col justify-center gap-0.5 border-s border-white/25 px-3 py-2.5 text-[12px]">
              <span className="font-bold">{at === null ? '—' : dayFormat.format(new Date(at))}</span>
              <span dir="ltr" className="opacity-90">
                {at === null ? '—' : dateFormat.format(new Date(at))}
              </span>
              <span dir="ltr" className="opacity-90">
                {at === null ? '—' : timeFormat.format(new Date(at))}
              </span>
            </div>
          </div>

          {row(AR.containerNumber, container.number, true)}
          {row(AR.cardSize, `${String(container.size)} قدم`)}
          {row(AR.cardCompany, container.customer)}
          {row(AR.cardTruck, truck === '' ? '—' : truck)}
          {row(AR.cardDriver, driver === '' ? '—' : driver)}
          {row(AR.cardWeight, container.weight === '' ? '—' : container.weight)}
          {row(AR.cardSlot, slot === null ? '—' : props.label(slot), true)}

          <div className="flex border-t-2 border-slate-800">
            {[AR.cardWorkerSign, AR.cardSupervisorSign].map((sign, index) => (
              <div
                key={sign}
                className={`h-24 flex-1 p-2.5${index === 0 ? ' border-e border-slate-300' : ''}`}
              >
                <p className="text-[12px] font-bold text-slate-600">{sign}</p>
              </div>
            ))}
          </div>
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
