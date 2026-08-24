import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, MovementDto } from '../shared/types';
import { positionLabel } from '../shared/address';
import { AR } from './ar';
import { api } from './api';
import { Button, useEscape } from './ui';

/**
 * The gate card, a proper voucher: serial and date strip, the paperwork in a
 * clean two-column grid, and the two signature boxes. Rendered as an
 * overlay; printing isolates it through the .print-area CSS.
 *
 * Three papers come off this one shape: the entry card, the exit card, and
 * the MOVE card the crane is handed. A move card is tied to a movement rather
 * than to the container — one container is moved many times — so `kind:
 * 'move'` carries the movement it prints.
 */

/** What a MOVE movement's note carries when the lift brought others down. */
interface DropNote {
  readonly n: string;
  readonly f: string;
  readonly t: string;
}

function dropsOf(note: string): readonly DropNote[] {
  if (note === '') return [];
  try {
    const parsed = JSON.parse(note) as { d?: DropNote[] };
    return Array.isArray(parsed.d) ? parsed.d : [];
  } catch {
    return [];
  }
}

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

export type CardJob = { container: ContainerDto } & (
  | { kind: 'in' | 'out' }
  | { kind: 'move'; move: MovementDto }
);

export function PrintCard(props: CardJob & { onClose: () => void }): ReactElement {
  const { kind, container } = props;
  const move = props.kind === 'move' ? props.move : null;
  useEscape(props.onClose);

  // A card can now be opened on top of an open register, and both carry the
  // .print-area class that survives printing — without this the printer would
  // spit out the whole register behind the card. The card wins while it is up.
  useEffect(() => {
    document.documentElement.classList.add('printing-card');
    return () => {
      document.documentElement.classList.remove('printing-card');
    };
  }, []);

  /**
   * WHERE THE CONTAINER IS — not where it was first set down.
   *
   * The card used to name the slot of the gate moment, so a box carried across
   * the yard went on being described by a card that sent the driver to an
   * empty stack: «في حال تعديل على مكان الحاوية بطاقة الدخول والخروج لا يتم
   * التعديل عليها». Reprinting it now gives the current slot. Once it has
   * left there is no current slot, so the card falls back to the one it stood
   * in as it went — the last thing that was true of it. The move itself is
   * not lost: every one is a line in سجل العمليات, from and to.
   */
  const detail = useQuery({
    queryKey: ['container', container.id],
    queryFn: () => api.detail(container.id),
  });
  const movements = detail.data?.movements ?? [];
  const lastGate = [...movements].reverse().find((m) => m.type === 'OUT' || m.type === 'IN');
  const gateMove =
    kind === 'in'
      ? movements.find((m) => m.type === 'IN')
      : [...movements].reverse().find((m) => m.type === 'OUT');
  const slot = container.position ?? gateMove?.from ?? lastGate?.to ?? null;

  // The moment the paper is about: the gate moment, or the lift itself.
  const at = move !== null ? move.at : kind === 'in' ? container.enteredAt : container.exitedAt;
  // Four places, and the year the count runs in beneath it: the serial starts
  // again at 1 every January, so «0091» alone names no card.
  // «لحتى ارفقها بالمعاملة عند طباعة بطاقة الدخول»: the entry card offers
  // the container's photos as pages of the same print — on by default when
  // photos exist, one press turns the paper back to the card alone.
  const photosQuery = useQuery({
    queryKey: ['photos', container.id],
    queryFn: () => api.photos(container.id),
    enabled: kind === 'in',
  });
  const photos = kind === 'in' ? (photosQuery.data?.photos ?? []) : [];
  const [attach, setAttach] = useState(true);
  const attaching = kind === 'in' && attach && photos.length > 0;

  const serial = move !== null ? move.card : kind === 'in' ? container.cardIn : container.cardOut;
  const serialYear =
    move !== null ? move.cardYear : kind === 'in' ? container.cardInYear : container.cardOutYear;
  const serialText = serial === null ? '—' : String(serial).padStart(4, '0');
  const truck = kind === 'in' ? container.truckIn : container.truckOut;
  const driver = kind === 'in' ? container.driverIn : container.driverOut;
  const drops = move === null ? [] : dropsOf(move.note);
  // One seal, recorded at entry: the exit stopped asking for a second.
  const sealShown = container.sealIn;

  /**
   * One labelled cell of the voucher grid. `wide` spans both columns for the
   * long free-text values; `danger` paints the hazardous-goods line red so it
   * is the first thing read on paper as well as on screen.
   *
   * Only codes and figures are forced left-to-right. An owner's name or a note
   * about a dented door is Arabic, and reading it out of an LTR paragraph put
   * its full stop at the wrong end of the sentence — `auto` lets the text
   * itself decide, which for «—» and for Arabic and for a plate number is
   * right every time.
   */
  const row = (
    label: string,
    value: ReactNode,
    options: { mono?: boolean; wide?: boolean; danger?: boolean; ltr?: boolean } = {},
  ): ReactElement => (
    <div
      className={`flex items-stretch border-b border-line-strong${options.wide === true ? ' sm:col-span-2' : ' border-e'}`}
    >
      <span className="gate-label flex w-32 shrink-0 items-center border-e border-line-strong bg-sunken px-3 py-2 text-[13px] font-bold text-ink">
        {label}
      </span>
      {/* Free text is given room to wrap rather than to overflow: a long
          company name or a paragraph of notes grows the row and stays inside
          its box, on screen and on the paper alike. */}
      <span
        className={`gate-value flex min-w-0 flex-1 items-center px-3 py-2 text-sm font-semibold leading-6 break-words${
          options.danger === true ? ' bg-danger-soft font-extrabold text-danger' : ' text-ink'
        }${options.mono === true ? ' font-mono tracking-wide' : ''}`}
        dir={options.ltr === true || options.mono === true ? 'ltr' : 'auto'}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div
      className={`${attaching ? 'permit-print ' : ''}fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4`}
    >
      {/* The card prints upright, unlike the wide report sheets. */}
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto">
        <div className="print-area gate-card paper-light overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          {/*
            The voucher strip: serial | title | day+date.

            No fill behind it, on the owner's instruction — «ما بدي يصرف حبر».
            A band of solid colour across the head of every card is a cartridge
            emptied a page at a time, and it was carrying nothing the ruling
            and the weight of the type cannot carry. Entry and exit are told
            apart by their titles, which is how a person reads them anyway.
          */}
          <div className="flex items-stretch border-b-2 border-rule-strong bg-surface text-ink">
            <div className="flex w-28 flex-col items-center justify-center gap-0.5 border-e border-rule-strong px-2 py-2.5">
              <span className="text-[10px] font-semibold text-muted">{AR.cardNumber}</span>
              <span
                className="gate-serial rounded-md border border-rule-strong px-2 font-mono text-2xl font-extrabold tabular-nums leading-7"
                dir="ltr"
              >
                {serialText}
              </span>
              {/* The count restarts each January, so the year is part of the
                  number: card 0091 of 2026 is not card 0091 of 2027. */}
              {serialYear !== null && (
                <span className="gate-serial-year text-[10px] font-bold text-muted" dir="ltr">
                  {String(serialYear)}
                </span>
              )}
            </div>
            {/* The title alone. The yard's name was printed under it, and it
                is already on the page in the screen behind, in the browser's
                own print header, and in the receipt clause below — «موجودة
                كثير في بطاقة الدخول». Nobody handed this card is in doubt
                about which yard issued it. */}
            <div className="flex flex-1 items-center justify-center px-2 py-2.5">
              <span className="text-lg font-extrabold leading-6">
                {kind === 'move'
                  ? AR.cardMoveTitle
                  : kind === 'in'
                    ? AR.cardInTitle
                    : AR.cardOutTitle}
              </span>
            </div>
            <div className="gate-stamp flex w-40 flex-col justify-center gap-0.5 border-s border-rule-strong px-3 py-2.5 text-[12px]">
              {/* Two dates live on this card and they are not the same thing:
                  this one is when the card itself was issued, the one in the
                  table is when the container went into store. */}
              <span className="text-[10px] font-semibold text-muted">
                {kind === 'move' ? AR.cardMovedAt : AR.cardIssuedAt}
              </span>
              <span className="font-bold">{at === null ? '—' : dayFormat.format(new Date(at))}</span>
              <span dir="ltr" className="text-muted">
                {at === null ? '—' : dateFormat.format(new Date(at))}
              </span>
              <span dir="ltr" className="text-muted">
                {at === null ? '—' : timeFormat.format(new Date(at))}
              </span>
            </div>
          </div>

          {/* The receipt itself: what the two signatures below attest to. It
              says «المبينة معلوماتها أدناه», so it stands above the table —
              and only on the entry card, since it attests to taking the
              container IN. A departure receipts nothing. */}
          {kind === 'in' && (
            <p className="gate-statement border-b-2 border-rule-strong px-3.5 py-3 text-[13px] font-semibold leading-7 text-ink">
              {AR.cardStatement}
            </p>
          )}

          {/* The container number is what the gate checker actually reads —
              it stands alone, big, above the table. */}
          <div className="gate-hero border-b-2 border-rule-strong px-3 py-2.5 text-center">
            <p className="text-[10px] font-bold text-muted">{AR.containerNumber}</p>
            <p className="font-mono text-3xl font-extrabold tracking-widest text-ink" dir="ltr">
              {container.number}
            </p>
          </div>

          <div className="grid sm:grid-cols-2">
            {/* The move card leads with the two slots — they are the reason
                the paper exists: which stack it leaves, which it lands on. */}
            {move !== null && (
              <>
                {row(AR.cardFrom, move.from === null ? '—' : positionLabel(move.from), {
                  mono: true,
                })}
                {row(AR.cardTo, move.to === null ? '—' : positionLabel(move.to), { mono: true })}
              </>
            )}
            {row(AR.cardBill, container.bill === '' ? '—' : container.bill, { mono: true })}
            {row(AR.cardSize, AR.feet(container.size))}
            {move === null && row(AR.cardSlot, slot === null ? '—' : positionLabel(slot), { mono: true })}
            {/* The weight and the driver's name are the gate's optional
                fields; a dash on the card is what "not recorded" looks like. */}
            {row(AR.cardWeight, container.weight === '' ? '—' : container.weight, { ltr: true })}
            {/* Crane or straddle, on the ENTRY card and nowhere else — not on
                the exit card and not on any register. The owner's own scope:
                «بدي اياها تبين ب ورقة الدخول فقط». */}
            {kind === 'in' &&
              row(
                AR.cardHandling,
                container.handling === null ? '—' : (AR.handlingName[container.handling] ?? '—'),
              )}
            {row(AR.cardSeal, sealShown === '' ? '—' : sealShown, { mono: true })}
            {/* Always the date it went INTO store — on the exit card too,
                where `at` is the departure and would be the wrong answer. */}
            {row(AR.cardStoredAt, dateFormat.format(new Date(container.enteredAt)), { ltr: true })}
            {/* No truck and no driver on a move: nothing left the yard. The
                weight stays, because the crane wants to know what it lifts. */}
            {move === null && row(AR.cardTruck, truck === '' ? '—' : truck, { ltr: true })}
            {move === null && row(AR.cardDriver, driver === '' ? '—' : driver)}
            {row(AR.cardNotes, container.notes === '' ? '—' : container.notes, { wide: true })}
            {/* Gravity: lifting this one brought the stack above it down a
                tier, and the crew needs the paper to say which ones and where
                to. Printed only when something actually came down. */}
            {drops.length > 0 &&
              row(
                AR.cardDrops,
                <span className="flex w-full flex-col gap-0.5">
                  {drops.map((drop) => (
                    <span key={drop.n} className="flex flex-wrap items-center gap-x-1.5">
                      {/* Every code is its own unbreakable left-to-right word,
                          so no address is ever cut in half by the wrap. */}
                      <span className="whitespace-nowrap font-mono font-bold" dir="ltr">
                        {drop.n}
                      </span>
                      <span>{AR.dropFrom}</span>
                      <span className="whitespace-nowrap font-mono" dir="ltr">
                        {drop.f}
                      </span>
                      <span>{AR.dropTo}</span>
                      <span className="whitespace-nowrap font-mono" dir="ltr">
                        {drop.t}
                      </span>
                    </span>
                  ))}
                </span>,
                { wide: true },
              )}
          </div>

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

          {/* The photos as pages of this same paper, page-broken after the
              card — the file the clerk staples is one print job. */}
          {attaching && (
            <div className="space-y-4 border-t-2 border-rule-strong p-4">
              <p className="text-center text-sm font-bold text-ink">
                {AR.photosOnPaper(container.number)}
              </p>
              {photos.map((photo) => (
                <img
                  key={photo.id}
                  src={`/api/photos/${String(photo.id)}`}
                  alt={AR.photoView}
                  className="mx-auto block max-h-[150mm] w-auto max-w-full break-inside-avoid rounded-lg border border-rule"
                />
              ))}
            </div>
          )}
        </div>

        <div className="print-hidden mt-3 flex justify-center gap-2">
          <Button
            onClick={() => {
              window.print();
            }}
          >
            {AR.print}
          </Button>
          {kind === 'in' && photos.length > 0 && (
            <Button
              kind="quiet"
              onClick={() => {
                setAttach(!attach);
              }}
            >
              {attach ? AR.detachPhotos : AR.attachPhotos(photos.length)}
            </Button>
          )}
          <Button kind="quiet" onClick={props.onClose}>
            {AR.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
