import { useMemo, useState, type ReactElement } from 'react';
import type { YardConfig } from '../shared/types';
import { MAX_ZONE_COLS, MAX_ZONE_ROWS } from '../shared/types';
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
  const [twentyRows, setTwentyRows] = useState(4);
  const [twentyCols, setTwentyCols] = useState(10);
  const [fortyRows, setFortyRows] = useState(3);
  const [fortyCols, setFortyCols] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The preview builds the exact two blocks the server will create.
  const yard: YardConfig = useMemo(
    () => ({
      blocks: defaultLayout(
        { rows: twentyRows, cols: twentyCols },
        { rows: fortyRows, cols: fortyCols },
      ),
    }),
    [twentyRows, twentyCols, fortyRows, fortyCols],
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
      .setup(password, {
        twenty: { rows: twentyRows, cols: twentyCols },
        forty: { rows: fortyRows, cols: fortyCols },
      })
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
    <div className="min-h-dvh bg-slate-100 p-4 lg:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h1 className="text-xl font-extrabold text-slate-900">{AR.setupTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">{AR.setupOnce}</p>

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
              <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
                <legend className="px-1 text-sm font-bold text-slate-700">{AR.zone20Title}</legend>
                {dimensionField(AR.rowsLabel, twentyRows, MAX_ZONE_ROWS, setTwentyRows)}
                {dimensionField(AR.colsLabel, twentyCols, MAX_ZONE_COLS, setTwentyCols)}
              </fieldset>
              <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
                <legend className="px-1 text-sm font-bold text-slate-700">{AR.zone40Title}</legend>
                {dimensionField(AR.rowsLabel, fortyRows, MAX_ZONE_ROWS, setFortyRows)}
                {dimensionField(AR.colsLabel, fortyCols, MAX_ZONE_COLS, setFortyCols)}
              </fieldset>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">{AR.setupPreview}</p>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2">
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
                      stacks: new Map(),
                      tier: 1,
                      selectedId: null,
                      matches: new Set(),
                      searchActive: false,
                      targets: null,
                      movingId: null,
                      slotStates: {},
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
