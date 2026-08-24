import { useEffect, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { ContainerDto, PhotoDto } from '../shared/types';
import { AR } from './ar';
import { formatDateOnly } from './api';
import { Button, useEscape } from './ui';

/**
 * صور الحاوية على الورق — «بدي كمان طريقة لطباعة الصور المرفقة مع الحاوية».
 * One paper per container: its facts on the head, then every photo at full
 * width, breaking onto as many pages as they need through the same
 * permit-print flow CSS the long papers use.
 */
export function PrintPhotos(props: {
  container: ContainerDto;
  photos: readonly PhotoDto[];
  onClose: () => void;
}): ReactElement {
  useEscape(props.onClose);
  useEffect(() => {
    document.documentElement.classList.add('printing-card');
    return () => {
      document.documentElement.classList.remove('printing-card');
    };
  }, []);
  const { container } = props;
  // At the body, not inside the card: an overlay nested under clipping or
  // transformed ancestors prints exactly one page and swallows the rest.
  return createPortal(
    <div className="permit-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto">
        <div className="print-area gate-card paper-light overflow-hidden rounded-xl border-2 border-rule-strong bg-surface shadow-2xl">
          <div className="border-b-2 border-rule-strong px-3 py-3 text-center">
            <p className="text-sm font-semibold text-muted">{AR.appName}</p>
            <p className="mt-1 text-base font-bold text-ink">
              {AR.photosOnPaper(container.number)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {container.bill !== '' && (
                <span>
                  {AR.colBill}: <bdi dir="ltr">{container.bill}</bdi>
                  {' · '}
                </span>
              )}
              <bdi dir="ltr">{formatDateOnly(container.enteredAt)}</bdi>
            </p>
          </div>
          <div className="space-y-4 p-4">
            {props.photos.map((photo) => (
              <img
                key={photo.id}
                src={`/api/photos/${String(photo.id)}`}
                alt={AR.photoView}
                className="mx-auto block max-h-[150mm] w-auto max-w-full break-inside-avoid rounded-lg border border-rule"
              />
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
    </div>,
    document.body,
  );
}
