import { useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { Button, Confirm, ErrorLine, Field, Toast, inputClass } from './ui';
import { ThemePicker } from './ThemePicker';

/**
 * أدوات التدريب — the owner's tools for the period his staff are learning the
 * system on the live yard: fill it with practice data, clear what they did,
 * and put a real backup back if the wrong thing got cleared.
 *
 * Temporary by design. This file and the one line that reaches it from the
 * yard header are the whole feature on the client side; `src/server/
 * ownerTools.ts` and its one registration line are the whole of it on the
 * server. When the training is over, all four go together.
 *
 * Everything destructive here takes a snapshot of the live database before it
 * runs, so nothing done from this screen is ever the last word.
 */

type Pending = 'wipe' | 'seed' | 'restore' | null;

export function OwnerToolsScreen(props: { onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const tools = useQuery({ queryKey: ['owner-tools'], queryFn: api.ownerTools });
  const wipePasswordSet = tools.data?.wipePasswordSet ?? false;

  const [newWord, setNewWord] = useState('');
  const [wipeWord, setWipeWord] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** Anything here can change the whole yard, so everything is re-read after. */
  const run = (work: Promise<unknown>, done: (result: unknown) => string): void => {
    setBusy(true);
    setError(null);
    work
      .then((result) => {
        void queryClient.resetQueries();
        setToast(done(result));
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setBusy(false);
        setConfirming(null);
      });
  };

  const panel = 'space-y-3 rounded-2xl bg-surface p-4 shadow-sm';

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <h1 className="text-base font-extrabold text-ink">{AR.toolsTitle}</h1>
        <span className="ms-auto flex items-center gap-2">
          <ThemePicker />
          <Button kind="quiet" onClick={props.onBack}>
            {AR.backToMap}
          </Button>
        </span>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <p className="rounded-2xl border-2 border-danger-line bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {AR.toolsWarning}
        </p>
        <ErrorLine message={error} />

        <section className={panel}>
          <h2 className="text-sm font-extrabold text-ink">{AR.toolsSeedTitle}</h2>
          <p className="text-sm text-muted">{AR.toolsSeedBody}</p>
          <Button
            disabled={busy}
            onClick={() => {
              setConfirming('seed');
            }}
          >
            {AR.toolsSeedAction}
          </Button>
        </section>

        <section className={panel}>
          <h2 className="text-sm font-extrabold text-ink">{AR.toolsBackupTitle}</h2>
          <p className="text-sm text-muted">{AR.toolsBackupBody}</p>
          <Button
            disabled={busy}
            onClick={() => {
              run(
                api.backup().then(({ blob, filename }) => {
                  downloadFile(blob, filename);
                }),
                () => AR.backupDone,
              );
            }}
          >
            {AR.backup}
          </Button>
        </section>

        <section className={panel}>
          <h2 className="text-sm font-extrabold text-ink">{AR.toolsRestoreTitle}</h2>
          <p className="text-sm text-muted">{AR.toolsRestoreBody}</p>
          <input
            ref={filePicker}
            type="file"
            accept=".db"
            className="hidden"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              kind="quiet"
              disabled={busy}
              onClick={() => {
                filePicker.current?.click();
              }}
            >
              {AR.toolsPickFile}
            </Button>
            <span className="text-sm text-muted" dir="ltr">
              {file?.name ?? AR.toolsNoFile}
            </span>
          </div>
          <Button
            kind="danger"
            disabled={busy || file === null}
            onClick={() => {
              setConfirming('restore');
            }}
          >
            {AR.toolsRestoreAction}
          </Button>
        </section>

        <section className={panel}>
          <h2 className="text-sm font-extrabold text-ink">{AR.toolsWipeTitle}</h2>
          <p className="text-sm text-muted">{AR.toolsWipeBody}</p>

          <Field
            label={wipePasswordSet ? AR.toolsWipeWordChange : AR.toolsWipeWordSet}
            hint={<span className="text-faint">{AR.toolsWipeWordHint}</span>}
          >
            <input
              type="password"
              className={inputClass}
              value={newWord}
              onChange={(event) => {
                setNewWord(event.target.value);
              }}
            />
          </Field>
          <Button
            kind="quiet"
            disabled={busy || newWord.trim().length < 4}
            onClick={() => {
              run(api.setWipePassword(newWord.trim()), () => {
                setNewWord('');
                return AR.toolsWipeWordSaved;
              });
            }}
          >
            {AR.save}
          </Button>

          {wipePasswordSet && (
            <>
              <hr className="border-line" />
              <Field label={AR.toolsWipeConfirmWord}>
                <input
                  type="password"
                  className={inputClass}
                  value={wipeWord}
                  onChange={(event) => {
                    setWipeWord(event.target.value);
                  }}
                />
              </Field>
              <Button
                kind="danger"
                disabled={busy || wipeWord === ''}
                onClick={() => {
                  setConfirming('wipe');
                }}
              >
                {AR.toolsWipeAction}
              </Button>
            </>
          )}
        </section>
      </main>

      {confirming === 'seed' && (
        <Confirm
          title={AR.toolsSeedTitle}
          body={AR.toolsSeedConfirm}
          confirmLabel={AR.toolsSeedAction}
          busy={busy}
          onConfirm={() => {
            run(api.seedDemo(), (result) => {
              const counts = result as { added: number; departed: number };
              return AR.toolsSeedDone(counts.added, counts.departed);
            });
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}

      {confirming === 'wipe' && (
        <Confirm
          title={AR.toolsWipeTitle}
          body={AR.toolsWipeConfirm}
          confirmLabel={AR.toolsWipeAction}
          danger
          busy={busy}
          onConfirm={() => {
            run(api.wipeData(wipeWord), () => {
              setWipeWord('');
              return AR.toolsWipeDone;
            });
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}

      {confirming === 'restore' && file !== null && (
        <Confirm
          title={AR.toolsRestoreTitle}
          body={AR.toolsRestoreConfirm(file.name)}
          confirmLabel={AR.toolsRestoreAction}
          danger
          busy={busy}
          onConfirm={() => {
            run(api.restoreBackup(file), (result) => {
              const counts = result as { containers: number; users: number };
              setFile(null);
              return AR.toolsRestoreDone(counts.containers, counts.users);
            });
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}

      {toast !== null && <Toast message={toast} />}
    </div>
  );
}

/** Hand a blob to the browser as a download. */
function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
