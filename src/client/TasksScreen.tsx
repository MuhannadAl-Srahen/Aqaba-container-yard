import { useEffect, useRef, useState, type ReactElement } from 'react';
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
 * first, each task a card big enough for a gloved thumb. A new task rings
 * and buzzes; «تم» closes it under the driver's name.
 */

/** A short beep through WebAudio — no asset, no permission, no Notification
 *  API (flaky inside Android WebViews). The sign-in tap already satisfied
 *  the autoplay policy; where it did not, silence is not a fault. */
function chime(): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);
    oscillator.onended = (): void => {
      void context.close();
    };
  } catch {
    // No audio here — the count badge still tells the story.
  }
  try {
    navigator.vibrate?.(200);
  } catch {
    // Same: vibration is a courtesy, not a requirement.
  }
}

export function TasksScreen(props: {
  machine: Handling;
  onShowSlot: (task: TaskDto) => void;
  /** «العودة إلى الخريطة» — drivers hold MOVE and need the map to use it. */
  onBack: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TaskDto | null>(null);
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
  // More work than a moment ago = the gate acted: ring. First load stays
  // quiet — signing in to a full queue is not news.
  const knownCount = useRef<number | null>(null);
  useEffect(() => {
    if (pending.data === undefined) return;
    const count = pending.data.tasks.length;
    if (knownCount.current !== null && count > knownCount.current) chime();
    knownCount.current = count;
  }, [pending.data]);

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
              {task.truck !== '' && <p>{AR.taskTruckLine(task.truck)}</p>}
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
      {toast !== null && <Toast message={toast} />}
    </div>
  );
}
