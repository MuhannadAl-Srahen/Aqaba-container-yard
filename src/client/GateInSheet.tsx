import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, Handling, Position } from '../shared/types';
import { HANDLING, sizeOfBay } from '../shared/types';
import { positionLabel } from '../shared/address';
import { checkNumber } from '../shared/iso6346';
import { truckLooksOdd, weightLooksOdd } from '../shared/doubts';
import { findPlateDriver, findTruck } from '../shared/fleet';
import { billSpread, nearBillMates } from './mapModel';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { shrinkPhoto } from './photos';
import { Button, DriverHint, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * مسودة الإدخال — «احيانا بكون بدخل حاوية وبعدين حدا بطلب مني شي وانا بنص
 * عملية الأدخال ف بوقف، وبعدين بس ارجع لازم ارجع ادخل معلومات الحاوية من
 * اول». What the clerk has typed is kept on his own device, under the slot
 * he was filling, and comes back when he opens that slot again. It never
 * touches the server and never leaves the tablet.
 *
 * Twelve hours old is not an interruption any more, it is yesterday; a draft
 * that stale is dropped rather than resurrected under a new truck.
 */
interface GateInDraft {
  at: number;
  number: string;
  bill: string;
  truck: string;
  seal: string;
  driver: string;
  weight: string;
  handling: Handling | null;
  notes: string;
}

const DRAFT_LIFE_MS = 12 * 60 * 60 * 1000;

const draftKey = (position: Position): string =>
  `aqaba-gate-in-draft:${position.zone}-${String(position.bay)}-${String(position.stack)}-${position.tier}`;

/** Reading may throw in a private window; a draft is a convenience, never a duty. */
function readDraft(position: Position): GateInDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(position));
    if (raw === null) return null;
    const draft = JSON.parse(raw) as GateInDraft;
    if (typeof draft.at !== 'number' || Date.now() - draft.at > DRAFT_LIFE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

function writeDraft(position: Position, draft: GateInDraft): void {
  try {
    window.localStorage.setItem(draftKey(position), JSON.stringify(draft));
  } catch {
    // A full or blocked store costs the convenience, nothing else.
  }
}

function clearDraft(position: Position): void {
  try {
    window.localStorage.removeItem(draftKey(position));
  } catch {
    // Same: the form still works without it.
  }
}

/**
 * The gate-in card. The clerk picked the exact slot on the bay sheet first,
 * so WHERE is already the full official code — and the bay's parity already
 * decided the size: odd is a 20, even is a 40 lying across. Nothing here
 * asks a question the ground has answered.
 */
export function GateInSheet(props: {
  position: Position;
  /**
   * Their own flow puts the bill first — «بندخل رقم البوليصة في النظام على
   * خانة البحث لنرى انها دخلت مسبقا او لا ثم نقوم بمحاولة وضعها»: when the
   * gate-in starts while the search names exactly one bill, it arrives
   * here already written. The clerk sees it and can overwrite it.
   */
  initialBill?: string;
  /**
   * تسجيل من الدفعة: the armed draft writes the number in before the sheet
   * opens — the clerk walked the map to this slot carrying a listed box.
   */
  initialNumber?: string;
  /** Everything standing — so the form can say where this bill already is. */
  containers?: readonly ContainerDto[];
  onDone: (container: ContainerDto, message: string) => void;
  onClose: () => void;
}): ReactElement {
  /** What this very slot was being filled with when the clerk was pulled away. */
  const [draft] = useState<GateInDraft | null>(() => readDraft(props.position));
  const [resumed, setResumed] = useState(draft !== null);

  // An armed draft from a دفعة is the fresher intent, so it wins the number
  // and the bill; everything else comes back as it was left.
  const [number, setNumber] = useState(props.initialNumber ?? draft?.number ?? '');
  const [bill, setBill] = useState(props.initialBill ?? draft?.bill ?? '');
  const [truck, setTruck] = useState(draft?.truck ?? '');
  const [seal, setSeal] = useState(draft?.seal ?? '');
  const [driver, setDriver] = useState(draft?.driver ?? '');
  const [weight, setWeight] = useState(draft?.weight ?? '');
  /** Crane or straddle — nothing chosen yet, so the clerk has to choose. */
  const [handling, setHandling] = useState<Handling | null>(draft?.handling ?? null);
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** «بدي اقدر اضيفها عند ادخال الحاوية … وتكون اختيارية». */
  const [photos, setPhotos] = useState<ReadonlyArray<{ file: File; url: string }>>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // The preview URLs are browser resources; whatever is still held when the
  // sheet closes is released in one sweep.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    },
    [],
  );

  /**
   * Every keystroke is kept, so nothing is lost however the clerk is pulled
   * away — closing the sheet, locking the tablet, or the browser reloading
   * under him. An untouched form saves nothing: an empty draft would only
   * make the «استُئنفت» line appear over a blank page.
   */
  useEffect(() => {
    const touched =
      [number, bill, truck, seal, driver, weight, notes].some((value) => value.trim() !== '') ||
      handling !== null;
    if (!touched) return;
    writeDraft(props.position, {
      at: Date.now(),
      number,
      bill,
      truck,
      seal,
      driver,
      weight,
      handling,
      notes,
    });
  }, [number, bill, truck, seal, driver, weight, handling, notes, props.position]);

  const startOver = (): void => {
    clearDraft(props.position);
    setResumed(false);
    setNumber(props.initialNumber ?? '');
    setBill(props.initialBill ?? '');
    setTruck('');
    setSeal('');
    setDriver('');
    setWeight('');
    setHandling(null);
    setNotes('');
    autoDriver.current = '';
  };

  const pickPhotos = (files: FileList | null): void => {
    if (files === null) return;
    const usable = [...files].filter(
      (file) =>
        (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') &&
        file.size <= 40 * 1024 * 1024,
    );
    setPhotoNote(usable.length < files.length ? AR.photoBadFile : null);
    if (usable.length === 0) return;
    setPhotos((prev) => [
      ...prev,
      ...usable.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  };

  /**
   * The registry watching over the plate field: a typed plate that names a
   * registered truck fills the driver in by itself and says whose truck it
   * is. A suggestion only — whatever the clerk types over it stands, and the
   * record still stores plain text exactly as before.
   */
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: api.fleet, staleTime: 60_000 });
  /** دفتر اللوحات — some sixty rows, fetched once and matched in memory. */
  const plateBook = useQuery({ queryKey: ['plates'], queryFn: api.plates, staleTime: 60_000 });
  const knownTruck = useMemo(
    () => findTruck(fleet.data?.trucks ?? [], truck),
    [fleet.data, truck],
  );
  const knownCarrier =
    knownTruck === null
      ? null
      : (fleet.data?.carriers.find((carrier) => carrier.id === knownTruck.carrierId) ?? null);
  /** The last driver name this form itself wrote, so it never overwrites a person's typing. */
  const autoDriver = useRef('');

  const check = number.trim() === '' ? null : checkNumber(number);
  const size = sizeOfBay(props.position.bay);
  const positionText = positionLabel(props.position);

  /**
   * دفعات كشف الجمارك: once the typed number is whole (4 letters, 7 digits)
   * — not per keystroke — ask whether an open دفعة expects it, and let the
   * sheet's own word fill the bill. The same never-clobber rule as the
   * driver: only an empty field, or this form's own earlier suggestion.
   */
  const wholeNumber = check !== null && check.wellFormed ? check.normalized : '';
  const batchLookup = useQuery({
    queryKey: ['batch-lookup', wholeNumber],
    queryFn: () => api.batchLookup(wholeNumber),
    enabled: wholeNumber !== '',
    staleTime: 30_000,
  });
  const batchMatch = wholeNumber === '' ? null : (batchLookup.data?.match ?? null);
  const autoBill = useRef('');
  useEffect(() => {
    if (batchMatch !== null && batchMatch.bill !== '') {
      if (bill === '' || bill === autoBill.current) {
        setBill(batchMatch.bill);
        autoBill.current = batchMatch.bill;
      }
    } else if (autoBill.current !== '' && bill === autoBill.current) {
      // The suggestion retracts with its cause — typed work never does.
      setBill('');
      autoBill.current = '';
    }
  }, [batchMatch, bill]);

  /**
   * Where this bill already stands, and whether the picked slot is beside
   * it — the group leaves in one batch, so far-from-its-own reads amber.
   * A hint, never a bar: the slot was chosen on the ground for reasons the
   * form cannot see.
   */
  const billMates = useMemo(() => {
    const all = props.containers ?? [];
    const trimmed = bill.trim();
    if (trimmed === '') return null;
    const spread = billSpread(all, trimmed);
    if (spread.length === 0) return null;
    return {
      line: spread.map((stop) => AR.billSpreadStop(stop.zone, stop.count)).join(' · '),
      near: nearBillMates(all, trimmed, props.position) === true,
    };
  }, [props.containers, bill, props.position]);
  // Nearly everything is required, on the owner's rule: a gate record with
  // holes in it is one somebody has to chase down later. The exceptions are
  // the notes, the driver's NAME and the weight — the scale ticket does not
  // always arrive with the truck, and refusing the whole record over a name
  // the gate does not have only teaches the gate to invent one.
  const ready =
    [number, bill, truck, seal].every((value) => value.trim() !== '') &&
    handling !== null &&
    !busy;

  const submit = (): void => {
    if (!ready || handling === null) return;
    setBusy(true);
    setError(null);
    api
      .gateIn({
        number,
        size,
        bill: bill.trim(),
        // The gate question «فردية أم على كشف» was tried and the owner
        // removed it — «ازلها لا مشكلة»: one tap too many at the gate. The
        // field lives on in the schema; nothing asks it any more.
        billKind: null,
        notes: notes.trim(),
        position: props.position,
        truck: truck.trim(),
        seal: seal.trim(),
        driver: driver.trim(),
        weight: weight.trim(),
        handling,
      })
      .then(async (container) => {
        // The photos ride the same confirmation — optional, and their
        // failure never fails the record: the box IS in; a picture that
        // did not upload can follow later from the card.
        let failed = false;
        for (const photo of photos) {
          try {
            await api.addPhoto(container.id, await shrinkPhoto(photo.file));
          } catch {
            failed = true;
            break;
          }
        }
        // The box is in the book, so the draft has nothing left to hold.
        clearDraft(props.position);
        // The container itself goes up, not just the message: the screen
        // above puts its entry card on the desk at once.
        const done = AR.gateInDone(container.number, positionText);
        props.onDone(container, failed ? `${done} ${AR.photoUploadFailed}` : done);
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

        {/* استئناف مسودة: never silent. The clerk must be able to tell at a
            glance that these fields are last night's work and not this
            truck's, and to sweep them away in one tap if they are. */}
        {resumed && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <span>{AR.gateInResumed}</span>
            <Button kind="quiet" onClick={startOver}>
              {AR.gateInStartOver}
            </Button>
          </div>
        )}

        {/* The expected shape is stated before anything is typed — four
            letters and seven digits — and the check answers once it is. */}
        <Field
          label={AR.containerNumber}
          hint={
            <>
              {check === null ? (
                <span className="text-faint">{AR.numberForm}</span>
              ) : check.valid ? (
                <span className="text-emerald-600">{AR.numberOk}</span>
              ) : (
                <span className="text-amber-600">{AR.numberBad(check.expectedDigit)}</span>
              )}
              {/* The sheet knows this box: its bill is filled from the دفعة —
                  and a size that disagrees with the picked bay says so. */}
              {batchMatch !== null &&
                (batchMatch.size !== null && batchMatch.size !== size ? (
                  <span className="block font-semibold text-amber-600">
                    {AR.batchSizeMismatch(batchMatch.size, size)}
                  </span>
                ) : (
                  <span className="block font-semibold text-emerald-600">
                    {AR.batchHint(batchMatch.batchName)}
                  </span>
                ))}
            </>
          }
        >
          <input
            dir="ltr"
            className={`${inputClass} text-start font-mono tracking-wider`}
            maxLength={20}
            value={number}
            onChange={(event) => {
              setNumber(event.target.value);
            }}
            /* أربعة أحرف لاتينية كبيرة وسبعة أرقام: لوحة المفاتيح تفتح
               بالحروف الكبيرة والتصحيح التلقائي مطفأ. */
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="MSCU1234566"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={AR.truck}
            hint={
              knownCarrier !== null ? (
                <span className="font-semibold text-emerald-600">
                  {AR.carrierChip(knownCarrier.name)}
                </span>
              ) : truckLooksOdd(truck) ? (
                // A doubt, never a refusal — «لحتى الي يدخل ينتبه».
                <span className="font-semibold text-amber-600">{AR.doubtTruck}</span>
              ) : undefined
            }
          >
            <input
              dir="ltr"
              className={`${inputClass} text-start`}
              maxLength={30}
              inputMode="tel"
              autoCorrect="off"
              spellCheck={false}
              value={truck}
              onChange={(event) => {
                setTruck(event.target.value);
                // Fill the driver only into an empty field or over this
                // form's own earlier suggestion — never over typed work.
                // The registry answers first (someone WROTE that pairing);
                // failing that, the gate's own book — the driver this very
                // plate carried last time: «بدي مجرد ما كتبت رقم سيارته خلص
                // يكتب اسمه تلقائي». A suggestion and nothing more: the same
                // truck carries different drivers, so it is right about four
                // times in five and the clerk types over the fifth.
                const match = findTruck(fleet.data?.trucks ?? [], event.target.value);
                const guess =
                  match !== null && match.driver !== ''
                    ? match.driver
                    : findPlateDriver(plateBook.data?.plates ?? [], event.target.value);
                if (guess !== '' && (driver === '' || driver === autoDriver.current)) {
                  setDriver(guess);
                  autoDriver.current = guess;
                }
              }}
            />
          </Field>
          <Field label={AR.seal} hint={<span className="text-faint">{AR.sealHint}</span>}>
            <input
              dir="ltr"
              className={`${inputClass} text-start font-mono`}
              maxLength={30}
              value={seal}
              onChange={(event) => {
                setSeal(event.target.value);
              }}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={AR.bill}
            hint={
              billMates !== null ? (
                <span
                  className={
                    'font-semibold ' +
                    (billMates.near ? 'text-emerald-600' : 'text-amber-600')
                  }
                >
                  {billMates.near
                    ? AR.billNearHint(billMates.line)
                    : AR.billFarHint(billMates.line)}
                </span>
              ) : (
                <span className="text-faint">{AR.billHint}</span>
              )
            }
          >
            <input
              dir="ltr"
              className={`${inputClass} text-start font-mono`}
              maxLength={40}
              value={bill}
              onChange={(event) => {
                setBill(event.target.value);
              }}
            />
          </Field>
          <Field
            label={AR.weight}
            hint={
              weightLooksOdd(weight) ? (
                <span className="font-semibold text-amber-600">{AR.doubtWeight}</span>
              ) : (
                <span className="text-faint">{AR.optional}</span>
              )
            }
          >
            <input
              dir="ltr"
              inputMode="numeric"
              className={`${inputClass} text-start`}
              maxLength={20}
              value={weight}
              onChange={(event) => {
                setWeight(event.target.value);
              }}
            />
          </Field>
        </div>

        {/* What lifted it off the truck. Two buttons rather than a list: the
            answer is one of two things and the crew is standing there. */}
        <Field label={AR.handling} hint={<span className="text-faint">{AR.handlingHint}</span>}>
          <div className="grid grid-cols-2 gap-2">
            {HANDLING.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setHandling(option);
                }}
                className={
                  'rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition ' +
                  (handling === option
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-line bg-surface text-muted hover:border-blue-400')
                }
              >
                {AR.handlingName[option]}
              </button>
            ))}
          </div>
        </Field>

        <Field label={AR.driver} hint={<DriverHint value={driver} />}>
          <input
            className={inputClass}
            maxLength={60}
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

        <Field
          label={AR.gatePhotosLabel}
          hint={<span className="text-faint">{AR.gatePhotosHint}</span>}
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((photo, index) => (
                <div key={photo.url} className="relative">
                  <img
                    src={photo.url}
                    alt={AR.photoView}
                    className="h-16 w-16 rounded-lg border border-line object-cover"
                  />
                  <button
                    type="button"
                    aria-label={AR.photoRemovePick}
                    onClick={() => {
                      URL.revokeObjectURL(photo.url);
                      setPhotos(photos.filter((_, at) => at !== index));
                    }}
                    className="absolute -start-1.5 -top-1.5 h-5 w-5 rounded-full bg-red-600 text-[11px] font-bold leading-5 text-white shadow"
                  >
                    ×
                  </button>
                </div>
              ))}
              <label className="cursor-pointer rounded-xl border border-dashed border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-muted hover:border-blue-500">
                {AR.photoAdd}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    pickPhotos(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
            {photoNote !== null && (
              <p className="mt-1 text-xs font-semibold text-red-600">{photoNote}</p>
            )}
          </div>
        </Field>

        <ErrorLine message={error} />

        <Button type="submit" full disabled={!ready}>
          {AR.confirmGateIn}
        </Button>
      </form>
    </Sheet>
  );
}
