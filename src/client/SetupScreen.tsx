import { useMemo, useState, type ReactElement } from 'react';
import { ASEZA } from '../shared/asezaLayout';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, inputClass } from './ui';
import { YardMap, computeLayout } from './YardMap';

/**
 * First run: one password and nothing else. The yard needs no drawing — it
 * IS the official ASEZA layout, shown here as a preview so the owner sees
 * the ground before the door even opens.
 */
export function SetupScreen(props: { onDone: () => void }): ReactElement {
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const layout = useMemo(() => computeLayout(ASEZA), []);
  const previewScale = Math.min(1, 660 / layout.width);

  const passwordShort = password !== '' && password.length < 6;
  const mismatch = passwordAgain !== '' && password !== passwordAgain;
  const ready = password.length >= 6 && password === passwordAgain && !busy;

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    api
      .setup(password)
      .then(props.onDone)
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  return (
    <div className="min-h-dvh bg-canvas p-4 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl bg-surface p-6 shadow-xl">
          <h1 className="text-xl font-extrabold text-ink">{AR.setupTitle}</h1>
          <p className="mt-1 text-sm leading-6 text-muted">{AR.setupOnce}</p>

          <form
            className="mt-6 space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Field
                label={AR.setupPassword}
                hint={
                  passwordShort ? (
                    <span className="text-red-600">{AR.setupPasswordShort}</span>
                  ) : undefined
                }
              >
                <input
                  type="password"
                  className={inputClass}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  autoFocus
                />
              </Field>
              <Field
                label={AR.setupPasswordAgain}
                hint={
                  mismatch ? (
                    <span className="text-red-600">{AR.setupPasswordMismatch}</span>
                  ) : undefined
                }
              >
                <input
                  type="password"
                  className={inputClass}
                  value={passwordAgain}
                  onChange={(event) => {
                    setPasswordAgain(event.target.value);
                  }}
                />
              </Field>
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-sunken p-2">
              <div
                style={{
                  transform: `scale(${String(previewScale)})`,
                  transformOrigin: 'top left',
                  width: layout.width,
                  height: layout.height * previewScale,
                }}
              >
                <YardMap
                  layout={layout}
                  map={{
                    loads: new Map(),
                    selectedId: null,
                    matches: new Set(),
                    searchActive: false,
                    dragZones: null,
                    targets: null,
                    movingId: null,
                    onBayClick: () => undefined,
                  }}
                />
              </div>
            </div>

            <ErrorLine message={error} />

            <Button type="submit" full disabled={!ready}>
              {busy ? AR.setupWorking : AR.setupSubmit}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
