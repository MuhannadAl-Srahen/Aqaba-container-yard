import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContainerDto, Handling, Position } from '../shared/types';
import { HANDLING, sizeOfBay } from '../shared/types';
import { positionLabel } from '../shared/address';
import { checkNumber } from '../shared/iso6346';
import { truckLooksOdd, weightLooksOdd } from '../shared/doubts';
import { findTruck } from '../shared/fleet';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { shrinkPhoto } from './photos';
import { Button, ErrorLine, Field, Sheet, inputClass } from './ui';

/**
 * The gate-in card. The clerk picked the exact slot on the bay sheet first,
 * so WHERE is already the full official code — and the bay's parity already
 * decided the size: odd is a 20, even is a 40 lying across. Nothing here
 * asks a question the ground has answered.
 */
export function GateInSheet(props: {
  position: Position;
  onDone: (container: ContainerDto, message: string) => void;
  onClose: () => void;
}): ReactElement {
  const [number, setNumber] = useState('');
  const [bill, setBill] = useState('');
  const [truck, setTruck] = useState('');
  const [seal, setSeal] = useState('');
  const [driver, setDriver] = useState('');
  const [weight, setWeight] = useState('');
  /** Crane or straddle — nothing chosen yet, so the clerk has to choose. */
  const [handling, setHandling] = useState<Handling | null>(null);
  const [notes, setNotes] = useState('');
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
              value={truck}
              onChange={(event) => {
                setTruck(event.target.value);
                // Fill the driver only into an empty field or over this
                // form's own earlier suggestion — never over typed work.
                const match = findTruck(fleet.data?.trucks ?? [], event.target.value);
                if (
                  match !== null &&
                  match.driver !== '' &&
                  (driver === '' || driver === autoDriver.current)
                ) {
                  setDriver(match.driver);
                  autoDriver.current = match.driver;
                }
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
