import { useState, type ReactElement } from 'react';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, inputClass } from './ui';

/**
 * Two doors. The staff tap their own name and key a PIN — the fastest thing
 * a gate clerk can do with one hand — and the owner takes the small link at
 * the bottom to the site password.
 */
export function LoginScreen(props: {
  staff: ReadonlyArray<{ id: number; name: string }>;
  onDone: () => void;
}): ReactElement {
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [asOwner, setAsOwner] = useState(props.staff.length === 0);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = (work: Promise<unknown>): void => {
    setBusy(true);
    setError(null);
    work
      .then(props.onDone)
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setSecret('');
        setBusy(false);
      });
  };

  const submit = (): void => {
    if (secret === '' || busy) return;
    if (asOwner) start(api.login(secret));
    else if (picked !== null) start(api.loginAs(picked.id, secret));
  };

  const reset = (): void => {
    setPicked(null);
    setAsOwner(false);
    setSecret('');
    setError(null);
  };

  const asking = asOwner || picked !== null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h1 className="text-xl font-extrabold text-ink">{AR.appName}</h1>
        <p className="mt-1 text-sm text-muted">
          {asOwner ? AR.loginHint : picked === null ? AR.loginWho : AR.loginPinFor(picked.name)}
        </p>

        {!asking && (
          <div className="mt-5 grid grid-cols-2 gap-2">
            {props.staff.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  setPicked(user);
                  setError(null);
                }}
                className={
                  'rounded-xl border border-line-strong bg-sunken px-3 py-5 text-base font-bold ' +
                  'text-ink transition-colors hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950'
                }
              >
                {user.name}
              </button>
            ))}
          </div>
        )}

        {asking && (
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Field label={asOwner ? AR.password : AR.pin}>
              <input
                type="password"
                dir="ltr"
                inputMode={asOwner ? 'text' : 'numeric'}
                autoComplete={asOwner ? 'current-password' : 'one-time-code'}
                className={`${inputClass} ${asOwner ? '' : 'text-center text-2xl tracking-[0.5em]'}`}
                value={secret}
                onChange={(event) => {
                  setSecret(event.target.value);
                }}
                autoFocus
              />
            </Field>
            <ErrorLine message={error} />
            <Button type="submit" full disabled={secret === '' || busy}>
              {AR.enter}
            </Button>
          </form>
        )}

        <div className="mt-5 border-t border-line pt-3 text-center">
          {asking && props.staff.length > 0 ? (
            <button
              type="button"
              className="text-xs font-semibold text-muted hover:text-ink"
              onClick={reset}
            >
              {AR.loginBack}
            </button>
          ) : (
            <button
              type="button"
              className="text-xs font-semibold text-muted hover:text-ink"
              onClick={() => {
                setAsOwner(true);
                setPicked(null);
                setError(null);
              }}
            >
              {AR.loginAsOwner}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
