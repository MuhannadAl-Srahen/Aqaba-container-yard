import { useEffect, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HANDLING, type Handling, type TaskDto, type TaskStatus } from '../shared/types';
import { positionLabel } from '../shared/address';
import { ApiFailure, api, formatDate } from './api';
import { AR } from './ar';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, Toast } from './ui';

/**
 * «مهام الآليات» عند المكتب: the desk watches both queues live, hurries a
 * task to the head of its line, closes one a driver could not, and hands
 * work across when a machine breaks down — «ممكن اودي الحاوية من الونش
 * للعقرب». Re-routing an IN task corrects the recorded المناولة too.
 */
export function TaskMonitorScreen(props: { onBack: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [machineFilter, setMachineFilter] = useState<Handling | 'ALL'>('ALL');
  const [status, setStatus] = useState<TaskStatus>('PENDING');
  const [rerouting, setRerouting] = useState<TaskDto | null>(null);
  /** «تحديد الكل ثم تم»: the desk's selection, pending tasks only. */
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [confirmingMany, setConfirmingMany] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const query = useQuery({
    queryKey: ['tasks', status, machineFilter],
    queryFn: () => api.tasks(status, machineFilter === 'ALL' ? undefined : machineFilter),
    refetchInterval: 10_000,
  });
  const rows = query.data?.tasks ?? [];

  // A selection belongs to the list it was made on: another filter, another
  // status, and it starts empty — a stale tick must never close a task the
  // desk is not looking at. Ids the poll has since removed fall away too.
  useEffect(() => {
    setSelected(new Set());
  }, [status, machineFilter]);
  const pendingIds = rows.filter((task) => task.status === 'PENDING').map((task) => task.id);
  const chosen = pendingIds.filter((id) => selected.has(id));

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finishMany = (ids: readonly number[]): void => {
    setBusy(true);
    api
      .taskDoneMany(ids)
      .then((result) => {
        setToast(AR.taskDoneManyToast(result.done, result.skipped));
        setSelected(new Set());
      })
      .catch((failure: unknown) => {
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setBusy(false);
        setConfirmingMany(false);
        void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      });
  };

  const run = (work: Promise<unknown>, message: string): void => {
    setBusy(true);
    work
      .then(() => {
        setToast(message);
      })
      .catch((failure: unknown) => {
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setBusy(false);
        setRerouting(null);
        void queryClient.invalidateQueries({ queryKey: ['tasks'] });
        // An IN re-route rewrites the container's المناولة — the map and any
        // open card must read the corrected record.
        void queryClient.invalidateQueries({ queryKey: ['state'] });
        void queryClient.invalidateQueries({ queryKey: ['container'] });
      });
  };

  const other = (machine: Handling): Handling => (machine === 'CRANE' ? 'STRADDLE' : 'CRANE');

  const chip = (active: boolean): string =>
    'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ' +
    (active ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-muted hover:bg-line');

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <h1 className="text-lg font-extrabold text-ink">{AR.tasksButton}</h1>
        <span className="text-xs font-bold text-muted">{AR.tasksCount(rows.length)}</span>
        <div className="ms-auto flex items-center gap-1.5">
          <ThemePicker />
          <Button kind="quiet" onClick={props.onBack}>
            {AR.backToMap}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-xl border border-line bg-sunken p-0.5">
            <button type="button" className={chip(machineFilter === 'ALL')} onClick={() => { setMachineFilter('ALL'); }}>
              {AR.filterAll}
            </button>
            {HANDLING.map((machine) => (
              <button
                key={machine}
                type="button"
                className={chip(machineFilter === machine)}
                onClick={() => {
                  setMachineFilter(machine);
                }}
              >
                {AR.machineName[machine]}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-xl border border-line bg-sunken p-0.5">
            {(['PENDING', 'DONE'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={chip(status === value)}
                onClick={() => {
                  setStatus(value);
                }}
              >
                {AR.taskStatusName[value]}
              </button>
            ))}
          </div>
        </div>

        {/* The sweep: tick some or all, one «تم» for the lot. */}
        {status === 'PENDING' && pendingIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
            <Button
              kind="quiet"
              disabled={busy}
              onClick={() => {
                setSelected(
                  chosen.length === pendingIds.length ? new Set() : new Set(pendingIds),
                );
              }}
            >
              {chosen.length === pendingIds.length ? AR.taskSelectNone : AR.taskSelectAll}
            </Button>
            <span className="ms-auto">
              <Button
                disabled={busy || chosen.length === 0}
                onClick={() => {
                  setConfirmingMany(true);
                }}
              >
                {AR.taskDoneSelected(chosen.length)}
              </Button>
            </span>
          </div>
        )}
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-faint">
            {AR.taskEmpty}
          </p>
        )}
        {rows.map((task) => (
          <div
            key={task.id}
            className={
              'rounded-xl border bg-surface p-3 shadow-sm ' +
              (task.urgent && task.status === 'PENDING' ? 'border-red-400' : 'border-line')
            }
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {task.status === 'PENDING' && (
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-blue-600"
                  aria-label={AR.taskSelectOne}
                  checked={selected.has(task.id)}
                  disabled={busy}
                  onChange={() => {
                    toggle(task.id);
                  }}
                />
              )}
              <span
                className={
                  'rounded-lg px-2 py-0.5 text-xs font-extrabold ' +
                  (task.kind === 'IN'
                    ? 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200'
                    : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200')
                }
              >
                {AR.taskKindName[task.kind]}
              </span>
              <span className="rounded-lg bg-sunken px-2 py-0.5 text-xs font-bold text-muted">
                {AR.machineName[task.machine]}
              </span>
              {task.urgent && task.status === 'PENDING' && (
                <span className="rounded-lg bg-red-600 px-2 py-0.5 text-xs font-extrabold text-white">
                  {AR.taskUrgentChip}
                </span>
              )}
              <span className="font-mono text-base font-extrabold text-ink" dir="ltr">
                {task.number}
              </span>
              <span className="font-mono text-sm font-bold text-blue-700 dark:text-blue-300" dir="ltr">
                {task.position === null ? '' : positionLabel(task.position)}
              </span>
              <span className="ms-auto text-xs text-faint" dir="ltr">
                {formatDate(task.createdAt)}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-faint">
              <span>{AR.taskCreatedBy(task.createdBy)}</span>
              {task.status === 'DONE' && task.doneBy !== null && (
                <span>
                  ·{' '}
                  {task.closedNote !== ''
                    ? `${AR.taskClosedNote[task.closedNote]} (${task.doneBy})`
                    : AR.taskDoneBy(task.doneBy)}
                  {task.doneAt !== null && (
                    <span dir="ltr"> — {formatDate(task.doneAt)}</span>
                  )}
                </span>
              )}
              {task.status === 'PENDING' && (
                <span className="ms-auto flex gap-1.5">
                  <Button
                    kind="quiet"
                    disabled={busy}
                    onClick={() => {
                      run(api.taskUrgent(task.id, !task.urgent), AR.taskUrgentToast);
                    }}
                  >
                    {task.urgent ? AR.taskClearUrgent : AR.taskMakeUrgent}
                  </Button>
                  <Button
                    kind="quiet"
                    disabled={busy}
                    onClick={() => {
                      setRerouting(task);
                    }}
                  >
                    {AR.taskRerouteAction}
                  </Button>
                  <Button
                    kind="quiet"
                    disabled={busy}
                    onClick={() => {
                      run(api.taskDone(task.id), AR.taskDoneToast);
                    }}
                  >
                    {AR.taskDoneAction}
                  </Button>
                </span>
              )}
            </div>
          </div>
        ))}
      </main>

      {confirmingMany && chosen.length > 0 && (
        <Confirm
          title={AR.taskDoneManyTitle}
          body={AR.taskDoneManyBody(chosen.length)}
          confirmLabel={AR.taskDoneAction}
          busy={busy}
          onConfirm={() => {
            finishMany(chosen);
          }}
          onCancel={() => {
            setConfirmingMany(false);
          }}
        />
      )}
      {rerouting !== null && (
        <Confirm
          title={AR.taskRerouteTitle}
          body={AR.taskRerouteBody(rerouting.number, AR.machineName[other(rerouting.machine)])}
          confirmLabel={AR.taskRerouteAction}
          busy={busy}
          onConfirm={() => {
            run(api.taskMachine(rerouting.id, other(rerouting.machine)), AR.taskRerouted);
          }}
          onCancel={() => {
            setRerouting(null);
          }}
        />
      )}
      {toast !== null && <Toast message={toast} />}
    </div>
  );
}
