import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PermitDto } from '../shared/types';
import { cardSerial, cardSerialText } from '../shared/types';
import { AR } from './ar';
import { ApiFailure, api, formatDateOnly } from './api';
import { Button, ErrorLine, Sheet } from './ui';

/**
 * تعديل تصريح مُصدَر — «اجاني مخلص قلي انا بدي اخرج 15 حاوية اليوم وكذب،
 * قام جاب فقط 5 سيارات ل 5 حاويات فقط … اريد ان استطيع ان اعدل على التصريح
 * بحيث فقط اضع الخمس حاويات دون الحاجة لحذف التصريح».
 *
 * The paper keeps its number, its date and its bill; the clerk unmarks the
 * containers that never left and they are struck off it. Everything opens
 * MARKED here — the opposite of the issue sheet, and for the same reason:
 * what is on the paper today is the starting point, and the work is taking
 * some of it off.
 */
export function PermitEditSheet(props: {
  permitId: number;
  onDone: (permit: PermitDto, message: string) => void;
  onClose: () => void;
}): ReactElement {
  const permit = useQuery({
    queryKey: ['permit', props.permitId],
    queryFn: () => api.permit(props.permitId),
  });
  /** Null until the paper is in hand: everything it carries starts marked. */
  const [kept, setKept] = useState<ReadonlySet<number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items = permit.data?.items ?? [];
  const marked = kept ?? new Set(items.map((item) => item.containerId));
  const removed = items.filter((item) => !marked.has(item.containerId));

  const toggle = (containerId: number): void => {
    const next = new Set(marked);
    if (next.has(containerId)) next.delete(containerId);
    else next.add(containerId);
    setKept(next);
  };

  const submit = (): void => {
    if (removed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    api
      .editPermit(
        props.permitId,
        removed.map((item) => item.containerId),
      )
      .then((after) => {
        props.onDone(after, AR.permitEditedToast(removed.length, after.items.length));
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  // The storage book's paper is corrected the same way; only its name and
  // what striking a line means — the box loses «منقولة للتخزين» — differ.
  const storage = permit.data?.kind === 'STORAGE';
  const heading = storage ? AR.storagePermitEdit : AR.permitEdit;
  const title =
    permit.data === undefined
      ? heading
      : `${heading} — ${cardSerialText(permit.data.serial)}/${String(permit.data.serialYear)}`;

  return (
    <Sheet title={title} onClose={props.onClose}>
      {permit.isPending ? (
        <p className="py-8 text-center text-sm text-faint">{AR.loading}</p>
      ) : permit.data === undefined ? (
        <ErrorLine message={AR.networkError} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="text-xs leading-5 text-faint">
            {storage ? AR.storagePermitEditHint : AR.permitEditHint}
          </p>

          <ul className="divide-y divide-line rounded-xl border border-line">
            {items.map((item) => {
              const on = marked.has(item.containerId);
              return (
                <li key={item.containerId} className={on ? 'px-3 py-2.5' : 'bg-sunken px-3 py-2.5'}>
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-blue-700"
                      checked={on}
                      onChange={() => {
                        toggle(item.containerId);
                      }}
                    />
                    <span
                      className={
                        'truncate font-mono text-sm font-bold ' +
                        (on ? 'text-ink' : 'text-faint line-through')
                      }
                      dir="ltr"
                    >
                      {item.number}
                    </span>
                    <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-bold text-muted">
                      {AR.feet(item.size)}
                    </span>
                    <span className="ms-auto shrink-0 font-mono text-xs text-muted" dir="ltr">
                      {cardSerial(item.cardIn, item.cardInYear) ?? '—'}
                    </span>
                    <span className="shrink-0 text-xs text-muted" dir="ltr">
                      {item.enteredAt === '' ? '—' : formatDateOnly(item.enteredAt)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <p className="text-sm font-bold text-ink">
            {AR.permitEditTally(removed.length, items.length - removed.length)}
          </p>

          <ErrorLine message={error} />

          <Button type="submit" full disabled={busy || removed.length === 0}>
            {AR.permitEditApply}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
