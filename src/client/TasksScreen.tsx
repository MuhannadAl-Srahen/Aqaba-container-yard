import { useEffect, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Handling, TaskDto } from '../shared/types';
import { positionLabel } from '../shared/address';
import { ltrCode } from '../shared/bidi';
import { ApiFailure, api, formatDate, formatDateOnly } from './api';
import { AR } from './ar';
import { ThemePicker } from './ThemePicker';
import { Button, Confirm, Toast } from './ui';

/**
 * شاشة سائق الآلية — بديل قروب الواتساب: the tablet mounted on the crane or
 * the straddle shows the machine's own queue, urgent first then oldest
 * first, each task a card big enough for a gloved thumb. The ring and the
 * arrival banner live in YardScreen — they must sound on EVERY screen, not
 * only this one; «تم» here closes the task under the driver's name.
 */

export function TasksScreen(props: {
  machine: Handling;
  onShowSlot: (task: TaskDto) => void;
  /**
   * «اظهار بطاقة الدخول عند المهام»: open the container's printed card —
   * the very paper the WhatsApp photo used to carry. An entry task shows
   * the entry card; an exit-born task shows the exit card.
   */
  onShowCard: (task: TaskDto) => void;
  /** «العودة إلى الخريطة» — drivers hold MOVE and need the map to use it. */
  onBack: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TaskDto | null>(null);
  /** 'BARE' = a truck with no task of its own; a task = the box it waits on. */
  const [callingGate, setCallingGate] = useState<TaskDto | 'BARE' | null>(null);
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

  const pending = useQuery({
    queryKey: ['tasks', 'PENDING', props.machine],
    queryFn: () => api.tasks('PENDING', props.machine),
    refetchInterval: 10_000,
  });
  const finished = useQuery({
    queryKey: ['tasks', 'DONE', props.machine],
    queryFn: () => api.tasks('DONE', props.machine, 30),
    refetchInterval: 30_000,
  });

  const rows = pending.data?.tasks ?? [];

  /**
   * «كبسة ادخال الشاحنة»: the call runs the other way — the machine tells
   * the office a truck is standing here to be recorded. His own pending
   * call shows on the button, so a second press is never a second truck.
   */
  const calls = useQuery({
    queryKey: ['gate-calls', props.machine],
    queryFn: () => api.gateCalls('PENDING'),
    refetchInterval: 15_000,
  });
  const myCalls = calls.data?.calls ?? [];
  /** The bare call — the truck that arrived before any task names it. */
  const myCall = myCalls.find((call) => call.taskId === null) ?? null;
  /** Which boxes already have a call standing, so a second press is quiet. */
  const calledTasks = new Set(
    myCalls.map((call) => call.taskId).filter((id): id is number => id !== null),
  );

  const callGate = (taskId?: number): void => {
    setBusy(true);
    api
      .callGate(taskId)
      .then(() => {
        setToast(AR.callGateSent);
      })
      .catch((failure: unknown) => {
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setBusy(false);
        setCallingGate(null);
        void queryClient.invalidateQueries({ queryKey: ['gate-calls'] });
      });
  };

  const doneToday = (finished.data?.tasks ?? []).filter(
    (task) => task.doneAt !== null && formatDateOnly(task.doneAt) === formatDateOnly(new Date().toISOString()),
  );

  const finish = (task: TaskDto): void => {
    setBusy(true);
    api
      .taskDone(task.id)
      .then(() => {
        setToast(AR.taskDoneToast);
      })
      .catch((failure: unknown) => {
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setBusy(false);
        setConfirming(null);
        void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      });
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 shadow-sm lg:px-5">
        <h1 className="text-lg font-extrabold text-ink">
          {AR.tasksScreenTitle(AR.machineName[props.machine])}
        </h1>
        <span className="text-xs font-bold text-muted">{AR.tasksCount(rows.length)}</span>
        <div className="ms-auto flex items-center gap-1.5">
          <ThemePicker />
          <Button kind="quiet" onClick={props.onBack}>
            {AR.backToMap}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        {/* The call to the office stands above the queue: it is the one thing
            on this screen the driver starts himself. */}
        <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
          <Button
            full
            disabled={busy || myCall !== null}
            onClick={() => {
              setCallingGate('BARE');
            }}
          >
            {AR.callGateAction}
          </Button>
          {myCall !== null && (
            <p className="mt-2 text-center text-sm font-bold text-amber-700 dark:text-amber-300">
              {AR.callGateStanding}
            </p>
          )}
        </div>

        <h2 className="text-sm font-extrabold text-muted">{AR.taskPendingTitle}</h2>
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-faint">
            {AR.taskEmpty}
          </p>
        )}
        {rows.map((task) => (
          <div
            key={task.id}
            className={
              'rounded-2xl border bg-surface p-4 shadow-sm ' +
              (task.urgent ? 'border-red-400' : 'border-line')
            }
          >
            <div className="flex flex-wrap items-center gap-2">
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
              {task.urgent && (
                <span className="rounded-lg bg-red-600 px-2 py-0.5 text-xs font-extrabold text-white">
                  {AR.taskUrgentChip}
                </span>
              )}
              <span className="ms-auto text-xs text-faint" dir="ltr">
                {formatDate(task.createdAt)}
              </span>
            </div>

            <p className="mt-2 font-mono text-2xl font-extrabold tracking-wide text-ink" dir="ltr">
              {task.number}
            </p>
            <p className="mt-1 font-mono text-lg font-bold text-blue-700 dark:text-blue-300" dir="ltr">
              {task.position === null ? '—' : positionLabel(task.position)}
            </p>

            <div className="mt-2 space-y-0.5 text-sm leading-6 text-muted">
              <p>
                {AR.feet(task.size)}
                {task.bill !== '' && <> · {AR.cardBill}: {ltrCode(task.bill)}</>}
              </p>
              {/* What the machine is about to lift — «لانها مهمة». */}
              {task.weight !== '' && (
                <p className="font-semibold text-ink">{AR.taskWeightLine(task.weight)}</p>
              )}
              {task.truck !== '' && <p>{AR.taskTruckLine(task.truck)}</p>}
              {/* الشاحنة التي ينتظرها هذا العمل — يقرؤها السائق قبل أن
                  ينادي المكتب ليُدخِل هذه السيارة بعينها. */}
              {task.gateTruck !== '' && task.gateTruck !== task.truck && (
                <p className="font-semibold text-ink">
                  {AR.callGateTruckLine(task.gateTruck, task.gateDriver)}
                </p>
              )}
              {task.notes !== '' && <p>{task.notes}</p>}
              <p className="text-xs text-faint">{AR.taskCreatedBy(task.createdBy)}</p>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                full
                onClick={() => {
                  setConfirming(task);
                }}
              >
                {AR.taskDoneAction}
              </Button>
              {task.position !== null && (
                <Button
                  kind="quiet"
                  onClick={() => {
                    props.onShowSlot(task);
                  }}
                >
                  {AR.taskShowSlot}
                </Button>
              )}
              <Button
                kind="quiet"
                onClick={() => {
                  props.onShowCard(task);
                }}
              >
                {task.kind === 'IN' ? AR.taskEntryCard : AR.taskOutCard}
              </Button>
            </div>

            {/* «بدي احط ادخال الشاحنة على كل حاوية»: the call is per box, so
                the clerk at the barrier is told WHICH truck to admit and for
                which container. A second press on the same box is the same
                truck, so the button goes quiet once its call stands. */}
            <div className="mt-2">
              <Button
                full
                kind="quiet"
                disabled={busy || calledTasks.has(task.id)}
                onClick={() => {
                  setCallingGate(task);
                }}
              >
                {AR.callGateForTask}
              </Button>
              {calledTasks.has(task.id) && (
                <p className="mt-1 text-center text-xs font-bold text-amber-700 dark:text-amber-300">
                  {AR.callGateForTaskStanding}
                </p>
              )}
            </div>
          </div>
        ))}

        {doneToday.length > 0 && (
          <>
            <h2 className="pt-2 text-sm font-extrabold text-muted">{AR.taskDoneTodayTitle}</h2>
            <div className="space-y-1.5">
              {doneToday.map((task) => (
                <div
                  key={task.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                >
                  <span className="text-xs font-bold text-faint">{AR.taskKindName[task.kind]}</span>
                  <span className="font-mono font-bold text-ink" dir="ltr">
                    {task.number}
                  </span>
                  <span className="ms-auto text-xs text-faint">
                    {task.closedNote !== ''
                      ? AR.taskClosedNote[task.closedNote]
                      : task.doneBy === null
                        ? ''
                        : AR.taskDoneBy(task.doneBy)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {confirming !== null && (
        <Confirm
          title={AR.taskDoneTitle}
          body={AR.taskDoneBody(confirming.number)}
          confirmLabel={AR.taskDoneAction}
          busy={busy}
          onConfirm={() => {
            finish(confirming);
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
      {callingGate !== null && (
        <Confirm
          title={AR.callGateTitle}
          body={
            callingGate === 'BARE'
              ? AR.callGateBody
              : `${AR.callGateContainerLine(callingGate.number)} — ${
                  callingGate.gateTruck === ''
                    ? AR.callGateNoTruck
                    : AR.callGateTruckLine(callingGate.gateTruck, callingGate.gateDriver)
                }`
          }
          confirmLabel={AR.callGateAction}
          busy={busy}
          onConfirm={() => {
            callGate(callingGate === 'BARE' ? undefined : callingGate.id);
          }}
          onCancel={() => {
            setCallingGate(null);
          }}
        />
      )}
      {toast !== null && <Toast message={toast} />}
    </div>
  );
}
