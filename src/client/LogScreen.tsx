import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LogReportRow } from '../shared/types';
import { positionLabel } from '../shared/address';
import { AR } from './ar';
import type { ContainerEditInput } from './api';
import { ApiFailure, api, editPayloadOf } from './api';
import { downloadCardsBook } from './cardsPrint';
import { Button, Toast } from './ui';
import {
  SheetScreen,
  ammanToday,
  cellLtr,
  cellText,
  cellWrap,
  dash,
  sheetStart,
  rangeInstants,
  stampCells,
  type TableModel,
} from './sheetKit';

/**
 * سجل العمليات — its own place, not a report tab: the complete audit of
 * everything that ever happened, deletions and deleted records included —
 * and the place where a mistake walks back: restore a deleted record,
 * revert an edit to the values it overwrote, cancel an exit that was
 * recorded by mistake — «التراجع عن طريق السجل».
 */

interface EditNote {
  readonly keys: readonly string[];
  readonly before: Readonly<Record<string, string | number>>;
}

/** Newer EDIT notes are JSON {k, b}; the old CSV form has nothing to revert. */
function parseEditNote(note: string): EditNote | null {
  try {
    const parsed = JSON.parse(note) as { k?: string[]; b?: Record<string, string | number> };
    // `correctMove` writes its «before» as an ARRAY, and an array passed this
    // guard: the «تراجع» button appeared, resolved every field to undefined,
    // sent an unchanged payload and reported success having done nothing.
    if (!Array.isArray(parsed.k) || parsed.b === undefined || Array.isArray(parsed.b))
      return null;
    return { keys: parsed.k, before: parsed.b };
  } catch {
    return null;
  }
}

/** How many containers a MOVE brought down with it, off its own note. */
function countDrops(note: string): number {
  try {
    const parsed = JSON.parse(note) as { d?: unknown[] };
    return Array.isArray(parsed.d) ? parsed.d.length : 0;
  } catch {
    return 0;
  }
}

function logModel(rows: readonly LogReportRow[]): TableModel {
  const head = [
    AR.colSeq,
    AR.colOperation,
    AR.colDay,
    AR.colDate,
    AR.colTime,
    AR.colNumber,
    AR.colFrom,
    AR.colTo,
    AR.colUser,
    AR.colNote,
  ];
  const body = rows.map((row, index) => {
    const noteParts: string[] = [];
    if (row.type === 'EDIT' && row.note !== '') noteParts.push(AR.editedFields(row.note));
    // A move carries the descents its lift caused, as the card prints them.
    // The register says how many; the card in hand names them one by one.
    else if (row.type === 'MOVE' && row.note !== '') {
      const dropped = countDrops(row.note);
      if (dropped > 0) noteParts.push(AR.movedDropped(dropped));
    } else if (row.note !== '') noteParts.push(row.note);
    if (row.deleted) noteParts.push(AR.deletedRecord);
    return [
      cellText(String(index + 1)),
      cellText(AR.operationName[row.type] ?? row.type),
      ...stampCells(new Date(row.at)),
      cellLtr(row.number),
      cellLtr(row.from === null ? dash : positionLabel(row.from)),
      cellLtr(row.to === null ? dash : positionLabel(row.to)),
      // A blank hand is nobody's: the 24-hour clock clearing a box nobody
      // confirmed loaded, and what came down with it. Said as such — it must
      // never read as a person, least of all as the owner.
      cellText(row.user === '' ? AR.systemHand : row.user),
      noteParts.length === 0 ? cellText(dash) : cellWrap(noteParts.join(' — ')),
    ];
  });
  const footer =
    rows.length === 0
      ? null
      : [cellText(AR.totalRow), cellText(AR.movementsCount(rows.length))];
  return { head, body, footer, counted: true };
}

export function LogScreen(props: {
  /**
   * Undoing a deletion or an edit reaches back into what the log already
   * records, so it is the owner's alone — «اجعل التراجع فقط عند المالك
   * لعمليات الحذف او التعديل». The server refuses it for anyone else; this
   * keeps a button off the screen rather than promising what will be refused.
   */
  isOwner: boolean;
  onBack: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(sheetStart());
  const [to, setTo] = useState(ammanToday());
  /** «عرض الكل»: the whole log regardless of the period pickers. */
  const [all, setAll] = useState(false);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const { fromIso, toIso } = useMemo(
    () => (all ? rangeInstants('2000-01-01', ammanToday()) : rangeInstants(from, to)),
    [all, from, to],
  );
  const valid = all || (from !== '' && to !== '' && from <= to);

  /**
   * بطاقات النقل دفعة واحدة — the move papers live in this log, so their
   * book is printed from here: every numbered MOVE of the shown period,
   * one page per card, the owner's alone.
   */
  const [cardsBusy, setCardsBusy] = useState(false);
  const printMoveCards = (): void => {
    if (cardsBusy || !valid) return;
    setCardsBusy(true);
    setToast(AR.bulkCardsWorking);
    const period = all ? AR.bulkCardsAllPeriod : AR.bulkCardsPeriod(from, to);
    downloadCardsBook('move', fromIso, toIso, false, AR.bulkCardsTitle('move', period))
      .then((count) => {
        setToast(count === 0 ? AR.bulkCardsNone : AR.bulkCardsDone(count));
      })
      .catch((failure: unknown) => {
        setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
      })
      .finally(() => {
        setCardsBusy(false);
      });
  };

  const log = useQuery({
    queryKey: ['report-log', fromIso, toIso],
    queryFn: () => api.reportLog(fromIso, toIso),
    enabled: valid,
    // The audit trail of a yard three people are working at once — and a
    // LONG log breathes slower, so «عرض الكل» stops rebuilding thousands
    // of cells every twenty seconds.
    refetchInterval: (query) => ((query.state.data?.rows.length ?? 0) > 300 ? 90_000 : 20_000),
  });
  const rows = useMemo(() => log.data?.rows ?? [], [log.data]);

  const model = useMemo<TableModel>(() => logModel(rows), [rows]);

  const finish = (message: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['report-log'] });
    void queryClient.invalidateQueries({ queryKey: ['state'] });
    void queryClient.invalidateQueries({ queryKey: ['container'] });
    setToast(message);
    setBusyRow(null);
  };

  const fail = (failure: unknown): void => {
    setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
    setBusyRow(null);
  };

  const restore = (row: LogReportRow, index: number): void => {
    setBusyRow(index);
    api
      .restore(row.containerId)
      .then(() => {
        finish(AR.restoredDone);
      })
      .catch(fail);
  };

  const revert = (row: LogReportRow, index: number): void => {
    const parsed = parseEditNote(row.note);
    if (parsed === null) return;
    setBusyRow(index);

    api
      .detail(row.containerId)
      .then(({ container }) => {
        const before = parsed.before;
        // Start from the container as it stands and lay the recorded old
        // values back over it, whichever fields they happen to be. Anything
        // the edit did not touch is sent back unchanged.
        const payload = editPayloadOf(container);
        const text = (key: keyof ContainerEditInput): string | undefined =>
          typeof before[key] === 'string' ? before[key] : undefined;
        return api.edit(row.containerId, {
          ...payload,
          number: text('number') ?? payload.number,
          bill: text('bill') ?? payload.bill,
          size: before['size'] === 20 || before['size'] === 40 ? before['size'] : payload.size,
          notes: text('notes') ?? payload.notes,
          weight: text('weight') ?? payload.weight,
          truckIn: text('truckIn') ?? payload.truckIn,
          driverIn: text('driverIn') ?? payload.driverIn,
          sealIn: text('sealIn') ?? payload.sealIn,
          truckOut: text('truckOut') ?? payload.truckOut,
          driverOut: text('driverOut') ?? payload.driverOut,
          enteredAt: text('enteredAt') ?? payload.enteredAt,
          // A blank recorded exit means it had not left yet at the time.
          exitedAt:
            before['exitedAt'] === undefined
              ? payload.exitedAt
              : before['exitedAt'] === ''
                ? null
                : String(before['exitedAt']),
        });
      })
      .then(() => {
        finish(AR.revertedDone);
      })
      .catch(fail);
  };

  /**
   * An exit recorded by mistake, walked back from its own log line: the
   * same undoing the container card offers, reachable from the register the
   * owner is already reading. The server is the one authority on whether
   * the slot is still free — a refusal comes back as its Arabic sentence.
   */
  const unexit = (row: LogReportRow, index: number): void => {
    setBusyRow(index);
    api
      .unexit(row.containerId)
      .then((container) => {
        finish(
          AR.unexitDone(
            container.number,
            container.position === null ? dash : positionLabel(container.position),
          ),
        );
      })
      .catch(fail);
  };

  const actionButton = 'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors';

  return (
    <>
      <SheetScreen
        screenTitle={AR.reportLog}
        sheetTitle={AR.reportLog}
        model={model}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onBack={props.onBack}
        allRange={{
          on: all,
          toggle: () => {
            setAll((value) => !value);
          },
        }}
        extraFilters={
          props.isOwner ? (
            <Button
              kind="quiet"
              disabled={cardsBusy || !valid}
              onClick={() => {
                printMoveCards();
              }}
            >
              {AR.bulkCardsMove}
            </Button>
          ) : undefined
        }
        actions={{
          header: AR.actionColumn,
          render: (rowIndex) => {
            const row = rows[rowIndex];
            if (row === undefined) return null;
            const busy = busyRow !== null;
            if (!props.isOwner) return null;
            if (row.type === 'DELETE' && row.deleted) {
              return (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    restore(row, rowIndex);
                  }}
                  className={`${actionButton} bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40`}
                >
                  {AR.restoreAction}
                </button>
              );
            }
            if (row.type === 'EDIT' && !row.deleted && parseEditNote(row.note) !== null) {
              return (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    revert(row, rowIndex);
                  }}
                  className={`${actionButton} bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40`}
                >
                  {AR.revertAction}
                </button>
              );
            }
            if (row.type === 'OUT' && !row.deleted) {
              return (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    unexit(row, rowIndex);
                  }}
                  className={`${actionButton} bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40`}
                >
                  {AR.actionUnexit}
                </button>
              );
            }
            return null;
          },
        }}
      />
      {toast !== null && <Toast message={toast} />}
    </>
  );
}
