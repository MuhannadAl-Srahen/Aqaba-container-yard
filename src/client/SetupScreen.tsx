import { useMemo, useState, type ReactElement } from 'react';
import type { YardConfig } from '../shared/types';
import {
  DEFAULT_PLACES_PER_TIER,
  DEFAULT_TIERS,
  MAX_LOCATIONS,
  MAX_PLACES_PER_TIER,
  MAX_TIERS,
} from '../shared/types';
import { defaultLayout } from '../shared/geometry';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, ErrorLine, Field, inputClass } from './ui';
import { YardMap, computeLayout } from './YardMap';

/**
 * First run: one password and the yard's shape, drawn live as it is typed so
 * the numbers mean something before they are saved.
 */
export function SetupScreen(props: { onDone: () => void }): ReactElement {
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [twenty, setTwenty] = useState({
    rows: 15,
    placesPerTier: DEFAULT_PLACES_PER_TIER,
    tiers: DEFAULT_TIERS,
  });
  // A 40 column is entered in whole 40s, so its places are always even.
  const [forty, setForty] = useState({ rows: 15, placesPerTier: 4, tiers: DEFAULT_TIERS });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The preview builds the exact two columns the server will create.
  const yard: YardConfig = useMemo(
    () => ({ blocks: defaultLayout(twenty, forty) }),
    [twenty, forty],
  );

  const layout = useMemo(() => computeLayout(yard), [yard]);
  const previewScale = Math.min(1, 560 / layout.width);

  const passwordShort = password !== '' && password.length < 6;
  const mismatch = passwordAgain !== '' && password !== passwordAgain;
  const ready = password.length >= 6 && password === passwordAgain && !busy;

  const submit = (): void => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    api
      .setup(password, { twenty, forty })
      .then(props.onDone)
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  const dimensionField = (
    label: string,
    value: number,
    max: number,
    set: (value: number) => void,
  ): ReactElement => (
    <Field label={label}>
      <input
        type="number"
        min={1}
        max={max}
        className={inputClass}
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isInteger(parsed)) set(Math.max(1, Math.min(max, parsed)));
        }}
      />
    </Field>
  );

  return (
    <div className="min-h-dvh bg-canvas p-4 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl bg-surface p-6 shadow-xl">
          <h1 className="text-xl font-extrabold text-ink">{AR.setupTitle}</h1>
          <p className="mt-1 text-sm text-muted">{AR.setupOnce}</p>

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

            <div className="grid gap-5 lg:grid-cols-2">
              {(
                [
                  [AR.zone20Title, 20, twenty, setTwenty],
                  [AR.zone40Title, 40, forty, setForty],
                ] as const
              ).map(([title, size, shape, set]) => {
                // A 40 column is typed in whole 40s and stored in places.
                const unit = size === 40 ? 2 : 1;
                return (
                  <fieldset key={size} className="space-y-3 rounded-xl border border-line p-4">
                    <legend className="px-1 text-sm font-bold text-ink">{title}</legend>
                    {dimensionField(AR.rowsLabel, shape.rows, MAX_LOCATIONS, (rows) => {
                      set({ ...shape, rows });
                    })}
                    {dimensionField(
                      AR.editorCapacity(size),
                      shape.placesPerTier / unit,
                      Math.floor(MAX_PLACES_PER_TIER / unit),
                      (perTier) => {
                        set({ ...shape, placesPerTier: perTier * unit });
                      },
                    )}
                    {dimensionField(AR.editorTiers, shape.tiers, MAX_TIERS, (tiers) => {
                      set({ ...shape, tiers });
                    })}
                  </fieldset>
                );
              })}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-ink">{AR.setupPreview}</p>
              <div className="overflow-hidden rounded-xl border border-line bg-sunken p-2">
                <div
                  style={{
                    transform: `scale(${String(previewScale)})`,
                    transformOrigin: 'top right',
                    width: layout.width,
                    height: layout.height * previewScale,
                  }}
                >
                  <YardMap
                    layout={layout}
                    freeLabels={new Map()}
                    map={{
                      yard,
                      loads: new Map(),
                      selectedId: null,
                      matches: new Set(),
                      searchActive: false,
                      targets: null,
                      movingId: null,
                      onCellClick: () => undefined,
                    }}
                  />
                </div>
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
