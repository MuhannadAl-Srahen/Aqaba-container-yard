import { useEffect, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Handling, Permission, UserDto } from '../shared/types';
import { HANDLING, PERMISSIONS } from '../shared/types';
import { AR } from './ar';
import { ApiFailure, api } from './api';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, ErrorLine, Field, Toast, inputClass } from './ui';

/**
 * The owner's own screen: who works here, what each of them may do, and the
 * PIN they sign in with. A PIN is never readable back — it is stored hashed,
 * so a forgotten one is replaced, not recovered.
 */

interface Draft {
  name: string;
  pin: string;
  permissions: Permission[];
  machine: Handling | '';
}

const EMPTY: Draft = { name: '', pin: '', permissions: ['GATE_IN', 'MOVE', 'GATE_OUT'], machine: '' };

/**
 * «بلا آلية / الونش / العقرب»: a driver account is an ordinary account that
 * names its machine — the tablet then lands on that machine's task queue
 * and holds a shift-long session.
 */
function MachinePicker(props: {
  value: Handling | '';
  onChange: (next: Handling | '') => void;
}): ReactElement {
  const options: Array<[Handling | '', string]> = [
    ['', AR.machineNone],
    ...HANDLING.map((machine): [Handling | '', string] => [machine, AR.machineName[machine]]),
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-line bg-sunken p-0.5">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            props.onChange(value);
          }}
          className={
            'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ' +
            (props.value === value
              ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
              : 'text-muted hover:bg-line')
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PermissionBoxes(props: {
  value: readonly Permission[];
  onChange: (next: Permission[]) => void;
}): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {PERMISSIONS.map((code) => {
        const on = props.value.includes(code);
        return (
          <label key={code} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-700"
              checked={on}
              onChange={() => {
                props.onChange(
                  on ? props.value.filter((c) => c !== code) : [...props.value, code],
                );
              }}
            />
            {AR.permissionName[code]}
          </label>
        );
      })}
    </div>
  );
}

export function UsersScreen(props: { onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [removing, setRemoving] = useState<UserDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useQuery({ queryKey: ['users'], queryFn: api.users });
  const users = list.data?.users ?? [];

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const run = (work: Promise<unknown>, message: string): void => {
    setBusy(true);
    setError(null);
    work
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['users'] });
        void queryClient.invalidateQueries({ queryKey: ['boot'] });
        setToast(message);
        setBusy(false);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  const validPin = (pin: string): boolean => /^\d{4,6}$/.test(pin);

  const startEdit = (user: UserDto): void => {
    setEditing(user);
    setEditDraft({
      name: user.name,
      pin: '',
      permissions: [...user.permissions],
      machine: user.machine,
    });
    setError(null);
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <h1 className="text-base font-extrabold text-ink">{AR.usersTitle}</h1>
        <span className="hidden text-xs text-faint lg:block">{AR.usersHint}</span>
        <span className="ms-auto flex items-center gap-2">
          <ThemePicker />
          <Button kind="quiet" onClick={props.onBack}>
            {AR.backToMap}
          </Button>
        </span>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <ErrorLine message={error} />

        <section className="space-y-2">
          {users.length === 0 && (
            <p className="rounded-2xl bg-surface px-4 py-8 text-center text-sm text-faint shadow-sm">
              {AR.usersEmpty}
            </p>
          )}
          {users.map((user) => (
            <div key={user.id} className="rounded-2xl bg-surface p-4 shadow-sm">
              {editing?.id === user.id ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (editDraft.pin !== '' && !validPin(editDraft.pin)) return;
                    run(
                      api.editUser(user.id, {
                        name: editDraft.name.trim(),
                        permissions: editDraft.permissions,
                        machine: editDraft.machine,
                        ...(editDraft.pin === '' ? {} : { pin: editDraft.pin }),
                      }),
                      AR.userSaved,
                    );
                    setEditing(null);
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={AR.userName}>
                      <input
                        className={inputClass}
                        value={editDraft.name}
                        maxLength={40}
                        onChange={(event) => {
                          setEditDraft({ ...editDraft, name: event.target.value });
                        }}
                      />
                    </Field>
                    <Field
                      label={AR.userNewPin}
                      hint={<span className="text-faint">{AR.userPinKeep}</span>}
                    >
                      <input
                        dir="ltr"
                        inputMode="numeric"
                        className={`${inputClass} text-center tracking-[0.4em]`}
                        value={editDraft.pin}
                        maxLength={6}
                        onChange={(event) => {
                          setEditDraft({ ...editDraft, pin: event.target.value });
                        }}
                      />
                    </Field>
                  </div>
                  <PermissionBoxes
                    value={editDraft.permissions}
                    onChange={(permissions) => {
                      setEditDraft({ ...editDraft, permissions });
                    }}
                  />
                  <Field label={AR.userMachine} hint={<span className="text-faint">{AR.userMachineHint}</span>}>
                    <MachinePicker
                      value={editDraft.machine}
                      onChange={(machine) => {
                        setEditDraft({ ...editDraft, machine });
                      }}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={busy || editDraft.name.trim() === ''}
                    >
                      {AR.save}
                    </Button>
                    <Button
                      kind="quiet"
                      onClick={() => {
                        setEditing(null);
                      }}
                    >
                      {AR.cancel}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-base font-bold text-ink">{user.name}</span>
                  {user.machine !== '' && (
                    <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      {AR.machineName[user.machine]}
                    </span>
                  )}
                  <span className="flex flex-wrap gap-1">
                    {user.permissions.length === 0 ? (
                      <span className="rounded-lg bg-sunken px-2 py-0.5 text-xs font-semibold text-faint">
                        {AR.permissionsNone}
                      </span>
                    ) : (
                      user.permissions.map((code) => (
                        <span
                          key={code}
                          className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                        >
                          {AR.permissionName[code]}
                        </span>
                      ))
                    )}
                  </span>
                  <span className="ms-auto flex gap-2">
                    <Button
                      kind="quiet"
                      onClick={() => {
                        startEdit(user);
                      }}
                    >
                      {AR.actionEdit}
                    </Button>
                    <Button
                      kind="danger"
                      onClick={() => {
                        setRemoving(user);
                      }}
                    >
                      {AR.userRemove}
                    </Button>
                  </span>
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="rounded-2xl bg-surface p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-ink">{AR.userAdd}</h2>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.name.trim() === '' || !validPin(draft.pin)) return;
              run(
                api.addUser({
                  name: draft.name.trim(),
                  pin: draft.pin,
                  permissions: draft.permissions,
                  machine: draft.machine,
                }),
                AR.userAdded,
              );
              setDraft(EMPTY);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={AR.userName}>
                <input
                  className={inputClass}
                  value={draft.name}
                  maxLength={40}
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.target.value });
                  }}
                />
              </Field>
              <Field
                label={AR.userPin}
                hint={
                  draft.pin !== '' && !validPin(draft.pin) ? (
                    <span className="text-red-600">{AR.userPinRule}</span>
                  ) : (
                    <span className="text-faint">{AR.userPinRule}</span>
                  )
                }
              >
                <input
                  dir="ltr"
                  inputMode="numeric"
                  className={`${inputClass} text-center tracking-[0.4em]`}
                  value={draft.pin}
                  maxLength={6}
                  onChange={(event) => {
                    setDraft({ ...draft, pin: event.target.value });
                  }}
                />
              </Field>
            </div>
            <PermissionBoxes
              value={draft.permissions}
              onChange={(permissions) => {
                setDraft({ ...draft, permissions });
              }}
            />
            <Field label={AR.userMachine} hint={<span className="text-faint">{AR.userMachineHint}</span>}>
              <MachinePicker
                value={draft.machine}
                onChange={(machine) => {
                  setDraft({ ...draft, machine });
                }}
              />
            </Field>
            <Button
              type="submit"
              disabled={busy || draft.name.trim() === '' || !validPin(draft.pin)}
            >
              {AR.userAdd}
            </Button>
          </form>
        </section>

        <p className="px-1 text-xs leading-6 text-faint">{AR.usersOwnerOnly}</p>
      </main>

      {removing !== null && (
        <Confirm
          title={AR.userRemoveTitle}
          body={AR.userRemoveBody(removing.name)}
          confirmLabel={AR.userRemove}
          danger
          busy={busy}
          onConfirm={() => {
            run(api.removeUser(removing.id), AR.userRemoved);
            setRemoving(null);
          }}
          onCancel={() => {
            setRemoving(null);
          }}
        />
      )}
      {toast !== null && <Toast message={toast} />}
    </div>
  );
}
