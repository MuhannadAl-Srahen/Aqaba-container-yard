import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AR } from './ar';
import { ApiFailure, api, formatDate } from './api';
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

type Pending = 'seed' | 'restore' | null;

export function OwnerToolsScreen(props: { onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const boot = useQuery({ queryKey: ['boot'], queryFn: api.boot });
  /** تغيير كلمة سر المالك — typed by his own hand, never seen by anyone else. */
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordAgain, setNewPasswordAgain] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Longer than the map's three and a half seconds: these messages carry
  // counts the owner is meant to read, not just an acknowledgement.
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 7000);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  /**
   * Anything here can change the whole yard, so everything is re-read after.
   *
   * A refusal is raised as a TOAST as well as a line at the top of the page.
   * The wipe sits at the bottom of a long screen, so its «كلمة السر غير
   * صحيحة» appeared above the fold, out of sight, and a refused wipe was
   * indistinguishable from a button that did nothing at all.
   */
  const run = (work: Promise<unknown>, done: (result: unknown) => string): void => {
    setBusy(true);
    setError(null);
    work
      .then((result) => {
        // INVALIDATE, never reset. `resetQueries` puts every query back to
        // having no data at all — including `['me']`, and the yard screen
        // decides whether to show this screen from `me.owner`. So the owner
        // stopped being the owner for the length of one refetch, this screen
        // was torn off the page mid-operation, and its message went with it:
        // the wipe ran, said nothing, and dropped him back on the map, which
        // is exactly «الحذف ما بيحذف» from the other side of the screen.
        // Invalidating refetches everything just the same while the answers
        // already in hand stay in hand.
        void queryClient.invalidateQueries();
        setToast(done(result));
      })
      .catch((failure: unknown) => {
        const message = failure instanceof ApiFailure ? failure.arabic : AR.networkError;
        setError(message);
        setToast(message);
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
        {/* After an update the first question is «نزلت التعديلات؟». This is
            read from the running build itself, so it cannot claim otherwise. */}
        <p className="rounded-2xl bg-surface px-4 py-2.5 text-sm text-muted shadow-sm">
          {AR.systemVersion}{' '}
          <span dir="ltr" className="font-mono font-bold text-ink">
            {boot.data?.build === undefined || boot.data.build === ''
              ? AR.versionDev
              : formatDate(boot.data.build)}
          </span>
        </p>
        <ErrorLine message={error} />

        <section className={panel}>
          <h2 className="text-sm font-extrabold text-ink">{AR.toolsPasswordTitle}</h2>
          <p className="text-sm text-muted">{AR.toolsPasswordBody}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={AR.toolsPasswordCurrent}>
              <input
                type="password"
                className={inputClass}
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                }}
              />
            </Field>
            <Field
              label={AR.toolsPasswordNew}
              hint={
                newPassword !== '' && newPassword.length < 6 ? (
                  <span className="text-red-600">{AR.setupPasswordShort}</span>
                ) : undefined
              }
            >
              <input
                type="password"
                className={inputClass}
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                }}
              />
            </Field>
            <Field
              label={AR.setupPasswordAgain}
              hint={
                newPasswordAgain !== '' && newPassword !== newPasswordAgain ? (
                  <span className="text-red-600">{AR.setupPasswordMismatch}</span>
                ) : undefined
              }
            >
              <input
                type="password"
                className={inputClass}
                value={newPasswordAgain}
                onChange={(event) => {
                  setNewPasswordAgain(event.target.value);
                }}
              />
            </Field>
          </div>
          <Button
            disabled={
              busy ||
              currentPassword === '' ||
              newPassword.length < 6 ||
              newPassword !== newPasswordAgain
            }
            onClick={() => {
              run(
                api.changeOwnerPassword(currentPassword, newPassword).then(() => {
                  setCurrentPassword('');
                  setNewPassword('');
                  setNewPasswordAgain('');
                }),
                () => AR.toolsPasswordDone,
              );
            }}
          >
            {AR.toolsPasswordChange}
          </Button>
        </section>

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

      </main>

      {confirming === 'seed' && (
        <Confirm
          title={AR.toolsSeedTitle}
          body={AR.toolsSeedConfirm}
          confirmLabel={AR.toolsSeedAction}
          busy={busy}
          onConfirm={() => {
            run(api.seedDemo(), (result) => {
              const counts = result as {
                added: number;
                departed: number;
                fullBay: string | null;
              };
              return AR.toolsSeedDone(counts.added, counts.departed, counts.fullBay);
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
              const counts = result as {
                containers: number;
                movements: number;
                users: number;
                carriers: number;
                trucks: number;
                permits: number;
                zones: number;
              };
              setFile(null);
              return AR.toolsRestoreDone(counts);
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
