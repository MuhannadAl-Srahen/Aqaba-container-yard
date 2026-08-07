import { useEffect, type ReactElement, type ReactNode } from 'react';
import { AR } from './ar';

/** Escape closes whatever is open — the keyboard's back button. */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [onClose]);
}

/**
 * The few shared visual atoms. One look, defined once — every panel, button
 * and field on the site comes through here.
 */

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
}): ReactElement {
  const kind = props.kind ?? 'primary';
  const base =
    'rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const look =
    kind === 'primary'
      ? 'bg-blue-700 text-white hover:bg-blue-800'
      : kind === 'danger'
        ? 'bg-red-50 text-red-700 hover:bg-red-100'
        : 'bg-slate-100 text-slate-700 hover:bg-slate-200';
  return (
    <button
      type={props.type ?? 'button'}
      className={`${base} ${look} ${props.full === true ? 'w-full' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled ?? false}
    >
      {props.children}
    </button>
  );
}

export function Field(props: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}): ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{props.label}</span>
      {props.children}
      {props.hint !== undefined && <span className="mt-1 block text-xs">{props.hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none ' +
  'focus:border-blue-500 focus:ring-2 focus:ring-blue-200';

/**
 * A panel that sits at the inline-end edge on wide screens and rises as a
 * bottom sheet on phones — the same children either way.
 */
export function Sheet(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  useEscape(props.onClose);
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center lg:items-stretch lg:justify-end">
      <div
        className={
          'pointer-events-auto flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl ' +
          'bg-white shadow-2xl lg:m-4 lg:max-h-none lg:w-[380px] lg:rounded-2xl'
        }
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-bold text-slate-900">{props.title}</h2>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={AR.close}
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{props.children}</div>
      </div>
    </div>
  );
}

export function Confirm(props: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  useEscape(props.onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-base font-bold text-slate-900">{props.title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{props.body}</p>
        <div className="mt-5 flex gap-2">
          <Button
            kind={props.danger === true ? 'danger' : 'primary'}
            onClick={props.onConfirm}
            disabled={props.busy ?? false}
          >
            {props.confirmLabel}
          </Button>
          <Button kind="quiet" onClick={props.onCancel}>
            {AR.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ErrorLine(props: { message: string | null }): ReactElement | null {
  if (props.message === null) return null;
  return (
    <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
      {props.message}
    </p>
  );
}

export function Toast(props: { message: string }): ReactElement {
  return (
    <div className="pointer-events-none fixed bottom-5 start-1/2 z-50 -translate-x-1/2 rtl:translate-x-1/2">
      <div className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
        {props.message}
      </div>
    </div>
  );
}
