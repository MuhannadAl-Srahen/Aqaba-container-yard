import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContainerDto,
  DailyReportRow,
  GateReportRow,
  Handling,
  MachineReportRow,
  PermitReportRow,
  StandingReportRow,
} from '../shared/types';
import { HANDLING, cardSerial } from '../shared/types';
import { carrierOfPlate } from '../shared/fleet';
import { ltrCode } from '../shared/bidi';
import { ApiFailure } from './api';
import { downloadCardsBook } from './cardsPrint';
import { Button, Confirm, Toast } from './ui';
import { positionLabel } from '../shared/address';
import { AR } from './ar';
import { api, dwellDays } from './api';
import {
  SheetScreen,
  ammanToday,
  cellLtr,
  cellText,
  cellNumeric,
  cellWrap,
  dash,
  dayFormat,
  dateFormat,
  monthStart,
  rangeInstants,
  stampCells,
  type TableCell,
  type TableModel,
} from './sheetKit';

/**
 * The office's registers: entry and exit movements, the standing snapshot,
 * the daily summary, the per-truck sheet and the per-bill sheet. The
 * operations log lives on its own screen.
 */

type Tab = 'in' | 'out' | 'standing' | 'daily' | 'machines' | 'truck' | 'bill' | 'permits';

/** The bill cell is a doorway: tap it, get that bill's own sheet. */
const billCell = (bill: string, onBill: (bill: string) => void): TableCell =>
  bill === ''
    ? cellLtr(dash)
    : {
        ...cellLtr(bill),
        onClick: () => {
          onBill(bill);
        },
      };

function gateModel(
  rows: readonly GateReportRow[],
  out: boolean,
  onTruck: (truck: string) => void,
  onBill: (bill: string) => void,
): TableModel {
  const head = [
    AR.colSeq,
    AR.colStatement,
    AR.colDay,
    AR.colDate,
    AR.colTime,
    AR.colTruck,
    out ? AR.colCardOut : AR.colCardIn,
    AR.colNumber,
    AR.colBill,
    AR.colSeal,
    AR.colWeight,
    AR.colSize,
    AR.colSlot,
    ...(out ? [AR.colDwell] : []),
    AR.colUser,
    AR.colNotes,
  ];
  const body = rows.map((row, index) => [
    cellText(String(index + 1)),
    cellText(out ? AR.statementOut : AR.statementIn),
    ...stampCells(new Date(row.at)),
    // The plate is a doorway: tap it, get that truck's own register.
    row.truck === ''
      ? cellLtr(dash)
      : {
          ...cellLtr(row.truck),
          onClick: () => {
            onTruck(row.truck);
          },
        },
    // Serial and year together: the count restarts every January, so «0091»
    // on its own would name two different cards a year apart.
    cellLtr(cardSerial(row.card, row.cardYear) ?? dash),
    cellLtr(row.number),
    billCell(row.bill, onBill),
    cellLtr(row.seal === '' ? dash : row.seal),
    cellNumeric(row.weight, dash),
    cellText(String(row.size)),
    cellLtr(row.position === null ? dash : positionLabel(row.position)),
    ...(out
      ? [cellText(row.dwellDays === null ? dash : AR.daysCount(row.dwellDays), row.dwellDays ?? -1)]
      : []),
    cellText(row.user),
    cellWrap(row.notes === '' ? dash : row.notes),
  ]);
  const footer =
    rows.length === 0
      ? null
      : [cellText(AR.totalRow), cellText(AR.movementsCount(rows.length))];
  return { head, body, footer, counted: true };
}

/** كشف الحاويات بالساحة — what is standing now, oldest first. */
function standingModel(
  rows: readonly StandingReportRow[],
  onBill: (bill: string) => void,
): TableModel {
  const head = [
    AR.colSeq,
    AR.colNumber,
    AR.colSlot,
    AR.colSize,
    AR.colBill,
    AR.colSeal,
    AR.colDate,
    AR.colDwell,
    AR.colUser,
    AR.colNotes,
  ];
  const body = rows.map((row, index) => [
    cellText(String(index + 1)),
    cellLtr(row.number),
    cellLtr(row.position === null ? dash : positionLabel(row.position)),
    cellText(String(row.size)),
    billCell(row.bill, onBill),
    cellLtr(row.seal === '' ? dash : row.seal),
    // Ordered by the instant, not by the two digits the text starts with.
    cellLtr(dateFormat.format(new Date(row.enteredAt)), Date.parse(row.enteredAt)),
    cellText(AR.daysCount(row.dwellDays), row.dwellDays),
    cellText(row.user),
    cellWrap(row.notes === '' ? dash : row.notes),
  ]);
  const footer =
    rows.length === 0 ? null : [cellText(AR.totalRow), cellText(AR.standingCount(rows.length))];
  return { head, body, footer, counted: true };
}

function truckModel(
  rows: ReadonlyArray<GateReportRow & { statement: 'IN' | 'OUT' }>,
  onBill: (bill: string) => void,
  /**
   * Set in carrier mode, where the rows span the whole fleet: the plate gets
   * a column of its own, and tapping one drills into that truck's register.
   * Null in single-plate mode — the sheet's title already names the truck.
   */
  onTruck: ((truck: string) => void) | null,
): TableModel {
  const carrierMode = onTruck !== null;
  const head = [
    AR.colSeq,
    AR.colStatement,
    AR.colDay,
    AR.colDate,
    AR.colTime,
    ...(carrierMode ? [AR.colTruck] : []),
    AR.colNumber,
    // Who drove it. The gate records the name already; the truck's own
    // register is where it is wanted — «لغايات حسابهم».
    AR.colDriver,
    AR.colBill,
    AR.colSeal,
    AR.colWeight,
    AR.colSize,
    AR.colSlot,
    AR.colUser,
  ];
  const body = rows.map((row, index) => [
    cellText(String(index + 1)),
    cellText(row.statement === 'IN' ? AR.statementIn : AR.statementOut),
    ...stampCells(new Date(row.at)),
    ...(carrierMode
      ? [
          row.truck === ''
            ? cellLtr(dash)
            : {
                ...cellLtr(row.truck),
                onClick: () => {
                  onTruck(row.truck);
                },
              },
        ]
      : []),
    cellLtr(row.number),
    cellText(row.driver === '' ? dash : row.driver),
    billCell(row.bill, onBill),
    cellLtr(row.seal === '' ? dash : row.seal),
    cellNumeric(row.weight, dash),
    cellText(String(row.size)),
    cellLtr(row.position === null ? dash : positionLabel(row.position)),
    cellText(row.user),
  ]);
  const footer =
    rows.length === 0
      ? null
      : [cellText(AR.totalRow), cellText(AR.movementsCount(rows.length))];
  return { head, body, footer, counted: true };
}

/**
 * كشف البوليصة: the whole group one bill of lading gathers — the standing
 * ones first with their exact slots, then the departed with their exit dates.
 * Opened with no bill typed it reads across ALL bills at once, so each row
 * then names its bill — a doorway into that bill's own sheet.
 */
function billModel(
  rows: readonly ContainerDto[],
  onBill: ((bill: string) => void) | null,
): TableModel {
  const head = [
    AR.colSeq,
    AR.colNumber,
    ...(onBill === null ? [] : [AR.colBill]),
    AR.colSize,
    AR.colSlot,
    AR.colSeal,
    AR.colEnteredAt,
    AR.colExitedAt,
    AR.colDwell,
    AR.colNotes,
  ];
  const body = rows.map((container, index) => [
    cellText(String(index + 1)),
    cellLtr(container.number),
    ...(onBill === null ? [] : [billCell(container.bill, onBill)]),
    cellText(String(container.size)),
    container.position === null
      ? cellText(dash)
      : cellLtr(positionLabel(container.position)),
    cellLtr(container.sealIn === '' ? dash : container.sealIn),
    cellLtr(dateFormat.format(new Date(container.enteredAt)), Date.parse(container.enteredAt)),
    // A container that has not left yet sorts after every departure: it will
    // leave later than any of them.
    container.exitedAt === null
      ? cellText(AR.stillStanding, Number.POSITIVE_INFINITY)
      : cellLtr(dateFormat.format(new Date(container.exitedAt)), Date.parse(container.exitedAt)),
    cellText(
      AR.daysCount(dwellDays(container.enteredAt, container.exitedAt ?? undefined)),
      dwellDays(container.enteredAt, container.exitedAt ?? undefined),
    ),
    cellWrap(container.notes === '' ? dash : container.notes),
  ]);
  const t20 = rows.filter((row) => row.size === 20).length;
  const t40 = rows.length - t20;
  const footer =
    rows.length === 0
      ? null
      : [cellText(AR.totalRow), cellText(AR.billTotals(rows.length, t20, t40))];
  return { head, body, footer, counted: true };
}

function dailyModel(rows: readonly DailyReportRow[]): TableModel {
  const head = [AR.colSeq, AR.colDay, AR.colDate, AR.colIn, AR.colOut, AR.colStanding];
  const body = rows.map((row, index) => {
    const at = new Date(`${row.date}T12:00:00+03:00`);
    return [
      cellText(String(index + 1)),
      cellText(dayFormat.format(at), at.getTime()),
      cellLtr(dateFormat.format(at), at.getTime()),
      cellText(String(row.inCount)),
      cellText(String(row.outCount)),
      cellText(String(row.standing)),
    ];
  });
  const totalIn = rows.reduce((n, r) => n + r.inCount, 0);
  const totalOut = rows.reduce((n, r) => n + r.outCount, 0);
  const footer =
    rows.length === 0
      ? null
      : [
          cellText(AR.totalRow),
          cellText(''),
          cellText(''),
          cellText(String(totalIn)),
          cellText(String(totalOut)),
          cellText(String(rows.at(-1)?.standing ?? 0)),
        ];
  return { head, body, footer, counted: true };
}

/**
 * كشف إنتاجية الآليات — سجل «تم» ناطقاً: صف لكل (آلية، منفّذ) في الفترة،
 * بعدد مهام الإدخال والتجهيز ومتوسط الزمن من إرسال الأمر حتى إنجازه.
 */
function machinesModel(rows: readonly MachineReportRow[]): TableModel {
  const head = [
    AR.colSeq,
    AR.colMachine,
    AR.colTaskDoer,
    AR.colTasksIn,
    AR.colTasksOut,
    AR.colTasksTotal,
    AR.colTaskSpeed,
  ];
  const body = rows.map((row, index) => [
    cellText(String(index + 1)),
    cellText(AR.machineName[row.machine]),
    cellText(row.doer),
    cellText(String(row.inDone)),
    cellText(String(row.outDone)),
    cellText(String(row.total)),
    cellText(row.avgMinutes === null ? '—' : AR.taskMinutes(row.avgMinutes), row.avgMinutes ?? -1),
  ]);
  const footer =
    rows.length === 0
      ? null
      : [
          cellText(AR.totalRow),
          cellText(''),
          cellText(''),
          cellText(String(rows.reduce((n, r) => n + r.inDone, 0))),
          cellText(String(rows.reduce((n, r) => n + r.outDone, 0))),
          cellText(String(rows.reduce((n, r) => n + r.total, 0))),
          cellText(''),
        ];
  return { head, body, footer, counted: true };
}

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['in', AR.reportIn],
  ['out', AR.reportOut],
  ['standing', AR.reportStanding],
  ['bill', AR.reportBill],
  ['daily', AR.reportDaily],
  ['machines', AR.reportMachines],
  ['truck', AR.reportTruck],
  ['permits', AR.reportPermits],
];

/** كشف خروج وتحميل داخلي: التصاريح الصادرة في الفترة، الأقدم أولاً. */
function permitsModel(rows: readonly PermitReportRow[], onBill: (bill: string) => void): TableModel {
  const head = [
    AR.colSeq,
    AR.permitSerial,
    AR.colDay,
    AR.colDate,
    AR.colTime,
    AR.colBill,
    AR.colPermitCount,
    AR.colUser,
  ];
  const body = rows.map((row, index) => [
    cellText(String(index + 1)),
    // Ordered by year then serial — «0002/2026» comes before «0001/2027».
    cellLtr(cardSerial(row.serial, row.serialYear) ?? dash, row.serialYear * 100_000 + row.serial),
    ...stampCells(new Date(row.at)),
    billCell(row.bill, onBill),
    cellText(String(row.containers), row.containers),
    cellText(row.user),
  ]);
  const footer =
    rows.length === 0 ? null : [cellText(AR.totalRow), cellText(AR.permitsCount(rows.length))];
  return { head, body, footer, counted: true };
}

export function ReportsScreen(props: {
  /** Land straight on one bill's sheet — the search's doorway. */
  initialBill?: string | undefined;
  /** Reprint a gate card straight from the row it is on. */
  onCard: (kind: 'in' | 'out', containerId: number) => void;
  /** The register row's pencil: the container's card opens editing at once. */
  onEdit: (containerId: number) => void;
  /** Open a permit's paper from its register row. */
  onPermit: (permitId: number) => void;
  /** Open the issue form for this bill's standing containers. */
  onCreatePermit: (bill: string, containers: readonly ContainerDto[]) => void;
  /** May this person issue a permit? It is exit paperwork — GATE_OUT. */
  canPermit: boolean;
  /**
   * May this person edit a container? The row's pencil opens the very same
   * form the container's card opens, so it answers to the very same
   * permission — «ما حدا عنده هاد الشي الا الي عنده الصلاحية».
   */
  canEdit: boolean;
  /** Voiding a numbered permit is the owner's alone. */
  isOwner: boolean;
  onBack: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(props.initialBill === undefined ? 'in' : 'bill');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(ammanToday());
  /** «عرض الكل»: the whole register regardless of the period pickers. */
  const [all, setAll] = useState(false);
  const [truck, setTruck] = useState('');
  /** The carrier whose whole fleet the truck register is showing; 0 = by plate. */
  const [carrier, setCarrier] = useState(0);
  /** «فصل بين سيارات التي اخرجت وبين التي ادخلت» — the truck sheet splits. */
  const [truckDir, setTruckDir] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [bill, setBill] = useState(props.initialBill ?? '');
  const [removingPermit, setRemovingPermit] = useState<PermitReportRow | null>(null);
  /** «تجهيز البوليصة كاملة»: the bill awaiting its machine choice, or null. */
  const [prepareBillFor, setPrepareBillFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** الطباعة الكلية للبطاقات — the owner's one-click book of the period. */
  const [cardsBusy, setCardsBusy] = useState(false);

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
    // The registry has no records before the system existed, so an early
    // fixed floor honestly reads as «كامل السجل».
    () => (all ? rangeInstants('2000-01-01', ammanToday()) : rangeInstants(from, to)),
    [all, from, to],
  );

  const valid = all || (from !== '' && to !== '' && from <= to);
  const truckReady = truck.trim() !== '';
  const billReady = bill.trim() !== '';

  /**
   * «بدي طريقة اطبع جميع بطاقات الدخول مره واحدة مهما كان عددها فقط تحت
   * صلاحية المالك»: the whole period's cards as one PDF, a page per card in
   * serial order — the register's own filter decides the period, and its
   * «عرض الكل» button makes that the entire book.
   */
  const printCardsBook = (kind: 'in' | 'out', withPhotos: boolean): void => {
    if (cardsBusy || !valid) return;
    setCardsBusy(true);
    setToast(AR.bulkCardsWorking);
    const period = all ? AR.bulkCardsAllPeriod : AR.bulkCardsPeriod(from, to);
    downloadCardsBook(kind, fromIso, toIso, withPhotos, AR.bulkCardsTitle(kind, period))
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

  // The carriers, for the truck tab's filter and for naming a typed plate's
  // own carrier in the sheet title.
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: api.fleet, enabled: tab === 'truck' });
  const carriers = fleet.data?.carriers ?? [];
  const activeCarrier = carriers.find((row) => row.id === carrier) ?? null;

  // A register left open on the office screen keeps up with the gate on its
  // own. Slower than the map — a sheet being read should not reshuffle under
  // the reader every few seconds. And a LONG register slower still: «بصير
  // تعليق ع النظام وقت اعرض كل الكشف» — rebuilding fifteen thousand cells
  // every twenty seconds is the hang he felt, so past three hundred rows
  // the refresh breathes once a minute and a half.
  const LIVE = 20_000;
  const liveFor = (count: number | undefined): number =>
    (count ?? 0) > 300 ? 90_000 : LIVE;

  const gate = useQuery({
    queryKey: ['report-gate', tab, fromIso, toIso],
    queryFn: () => api.reportGate(tab === 'in' ? 'IN' : 'OUT', fromIso, toIso),
    enabled: valid && (tab === 'in' || tab === 'out'),
    refetchInterval: (query) => liveFor(query.state.data?.rows.length),
  });
  const daily = useQuery({
    queryKey: ['report-daily', fromIso, toIso],
    queryFn: () => api.reportDaily(fromIso, toIso),
    enabled: valid && tab === 'daily',
    refetchInterval: LIVE,
  });
  const machines = useQuery({
    queryKey: ['report-machines', fromIso, toIso],
    queryFn: () => api.reportMachines(fromIso, toIso),
    enabled: valid && tab === 'machines',
    refetchInterval: LIVE,
  });
  const truckReport = useQuery({
    queryKey: [
      'report-truck',
      activeCarrier !== null ? `c${String(carrier)}` : truckReady ? truck.trim() : 'all',
      fromIso,
      toIso,
    ],
    // Opened plain, the register holds every movement of the period — «عند
    // دخول كشف السيارات يظهر جميع المعلومات» — and narrows as one types.
    queryFn: () =>
      activeCarrier !== null
        ? api.reportCarrier(activeCarrier.id, fromIso, toIso)
        : truckReady
          ? api.reportTruck(truck.trim(), fromIso, toIso)
          : api.reportTruckAll(fromIso, toIso),
    enabled: valid && tab === 'truck',
    refetchInterval: (query) => liveFor(query.state.data?.rows.length),
  });
  const standing = useQuery({
    queryKey: ['report-standing'],
    queryFn: api.reportStanding,
    enabled: tab === 'standing',
    refetchInterval: (query) => liveFor(query.state.data?.rows.length),
  });
  const billReport = useQuery({
    queryKey: ['report-bill', billReady ? bill.trim() : 'all'],
    queryFn: () => (billReady ? api.reportBill(bill.trim()) : api.reportBillAll()),
    enabled: tab === 'bill',
    refetchInterval: LIVE,
  });
  const permits = useQuery({
    queryKey: ['report-permits', fromIso, toIso],
    queryFn: () => api.reportPermits(fromIso, toIso),
    enabled: valid && tab === 'permits',
    refetchInterval: LIVE,
  });

  /** The truck rows the sheet actually shows — the actions column reads the
   * SAME array, so a row's buttons always belong to the row they sit on. */
  const truckRows = useMemo(
    () =>
      (truckReport.data?.rows ?? []).filter(
        (row) => truckDir === 'ALL' || row.statement === truckDir,
      ),
    [truckReport.data, truckDir],
  );

  const baseTitle = TABS.find(([key]) => key === tab)?.[1] ?? '';
  /** A typed plate that matches a registered truck names its carrier too. */
  const plateCarrier =
    tab === 'truck' && truckReady && fleet.data !== undefined
      ? carrierOfPlate(fleet.data.carriers, fleet.data.trucks, truck.trim())
      : null;
  const title =
    tab === 'truck' && activeCarrier !== null
      ? AR.reportCarrier(activeCarrier.name)
      : tab === 'truck' && truckReady
        ? `${baseTitle} ${ltrCode(truck.trim())}${plateCarrier === null ? '' : ` — ${AR.carrierChip(plateCarrier.name)}`}`
        : tab === 'truck'
          ? AR.truckAllTitle
          : tab === 'bill' && billReady
            ? `${baseTitle} ${ltrCode(bill.trim())}`
            : tab === 'bill'
              ? AR.billAllTitle
              : baseTitle;

  const model = useMemo<TableModel>(() => {
    const openTruck = (plate: string): void => {
      setTruck(plate);
      setTab('truck');
    };
    const openBill = (number: string): void => {
      setBill(number);
      setTab('bill');
    };
    switch (tab) {
      case 'in':
      case 'out':
        return gateModel(gate.data?.rows ?? [], tab === 'out', openTruck, openBill);
      case 'standing':
        return standingModel(standing.data?.rows ?? [], openBill);
      case 'daily':
        return dailyModel(daily.data?.rows ?? []);
      case 'machines':
        return machinesModel(machines.data?.rows ?? []);
      case 'truck':
        return truckModel(
          truckRows,
          openBill,
          // Reading many plates at once — a carrier's fleet or the whole
          // register — the plate column drills into that one truck's sheet.
          activeCarrier === null && truckReady
            ? null
            : (plate) => {
                setCarrier(0);
                setTruck(plate);
              },
        );
      case 'bill':
        return billModel(billReport.data?.rows ?? [], billReady ? null : openBill);
      case 'permits':
        return permitsModel(permits.data?.rows ?? [], openBill);
    }
  }, [tab, gate.data, standing.data, daily.data, machines.data, truckRows, billReport.data, permits.data, activeCarrier, truckReady, billReady]);

  // A register row carries its own card: no hunting the exact number down in
  // the search box to reprint the paper the driver already lost. The permits
  // register carries its paper the same way — and, for the owner, the void.
  const cardActions =
    tab === 'permits'
      ? {
          header: AR.actionColumn,
          render: (rowIndex: number): ReactNode => {
            const row = permits.data?.rows[rowIndex];
            if (row === undefined) return null;
            return (
              <span className="flex justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    props.onPermit(row.id);
                  }}
                  className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
                >
                  {AR.permitAction}
                </button>
                {props.isOwner && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setRemovingPermit(row);
                    }}
                    className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-40 dark:bg-red-950 dark:text-red-300"
                  >
                    {AR.permitDelete}
                  </button>
                )}
              </span>
            );
          },
        }
      : tab === 'in' || tab === 'out' || tab === 'standing' || tab === 'bill' || tab === 'truck'
      ? {
          header: AR.actionColumn,
          render: (rowIndex: number): ReactNode => {
            const truckRow = tab === 'truck' ? truckRows[rowIndex] : undefined;
            const containerId =
              tab === 'standing'
                ? standing.data?.rows[rowIndex]?.containerId
                : tab === 'bill'
                  ? billReport.data?.rows[rowIndex]?.id
                  : tab === 'truck'
                    ? truckRow?.containerId
                    : gate.data?.rows[rowIndex]?.containerId;
            if (containerId === undefined) return null;
            const kind =
              tab === 'out' || truckRow?.statement === 'OUT' ? ('out' as const) : ('in' as const);
            return (
              <span className="flex justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    props.onCard(kind, containerId);
                  }}
                  className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
                >
                  {AR.cardAction}
                </button>
                {/* «دون الرجوع الى مكان وجود الحاوية»: the row edits itself —
                    for whoever may edit at all. Without EDIT the pencil is
                    not drawn, exactly as it is not drawn on the card. */}
                {props.canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      props.onEdit(containerId);
                    }}
                    className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200"
                  >
                    {AR.actionEdit}
                  </button>
                )}
              </span>
            );
          },
        }
      : undefined;

  return (
    <>
    <SheetScreen
      screenTitle={AR.reports}
      sheetTitle={title}
      model={model}
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      onBack={props.onBack}
      actions={cardActions}
      rangeless={
        tab === 'standing'
          ? AR.standingNow
          : tab === 'bill'
            ? billReady
              ? AR.billNow
              : AR.billAllNow
            : undefined
      }
      allRange={{
        on: all,
        toggle: () => {
          setAll((value) => !value);
        },
      }}
      tabs={
        // One sliding row on a phone — seven tabs stacked two deep were half
        // the screen; on a desk they wrap as before.
        <div className="flex flex-nowrap gap-1 lg:flex-wrap">
          {TABS.map(([key, tabLabel]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
              }}
              className={
                'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ' +
                (tab === key
                  ? 'bg-slate-800 text-white shadow-sm dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-sunken text-muted hover:bg-line')
              }
            >
              {tabLabel}
            </button>
          ))}
        </div>
      }
      extraFilters={
        tab === 'truck' ? (
          <>
            {/* «كشف سيارات بناءً على الناقل»: pick the carrier and the sheet
                gathers every plate of his fleet, however the gate spelled it. */}
            <select
              className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
              value={carrier}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCarrier(next);
                if (next !== 0) setTruck('');
              }}
            >
              <option value={0}>{AR.carrierFilterAll}</option>
              {carriers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <input
              dir="ltr"
              placeholder={AR.colTruck}
              className="w-36 rounded-lg border border-line-strong px-2.5 py-1.5 text-start text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              value={truck}
              onChange={(event) => {
                setTruck(event.target.value);
                if (event.target.value.trim() !== '') setCarrier(0);
              }}
            />
            <div className="flex gap-1 rounded-xl border border-line bg-sunken p-1">
              {(
                [
                  ['ALL', AR.filterAll],
                  ['IN', AR.operationName['IN'] ?? 'IN'],
                  ['OUT', AR.operationName['OUT'] ?? 'OUT'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setTruckDir(value);
                  }}
                  className={
                    'rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ' +
                    (truckDir === value
                      ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                      : 'text-muted hover:bg-line')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : tab === 'bill' ? (
          <>
            <input
              dir="ltr"
              placeholder={AR.colBill}
              className="w-36 rounded-lg border border-line-strong px-2.5 py-1.5 text-start text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              value={bill}
              onChange={(event) => {
                setBill(event.target.value);
              }}
            />
            {/* The bill sheet is where the permit is born: the whole group is
                on the screen, and the paper takes the standing part of it. */}
            {billReady && props.canPermit && (
              <Button
                kind="quiet"
                disabled={(billReport.data?.rows ?? []).length === 0}
                onClick={() => {
                  props.onCreatePermit(bill.trim(), billReport.data?.rows ?? []);
                }}
              >
                {AR.permitCreate}
              </Button>
            )}
            {/* «بنخرجها دفعة وحده البوليصة كاملة»: one tap sends a تجهيز
                task per standing container — each to its own machine, or
                all to one when the desk overrides. */}
            {billReady && props.canPermit && (
              <Button
                kind="quiet"
                disabled={(billReport.data?.rows ?? []).some((row) => row.position !== null) === false}
                onClick={() => {
                  setPrepareBillFor(bill.trim());
                }}
              >
                {AR.prepareBillAction}
              </Button>
            )}
          </>
        ) : (tab === 'in' || tab === 'out') && props.isOwner ? (
          // الطباعة الكلية — the owner's alone; the server refuses everyone
          // else regardless, this is just the door being where he stands.
          <>
            {tab === 'in' && (
              <Button kind="quiet" disabled={cardsBusy || !valid} onClick={() => { printCardsBook('in', true); }}>
                {AR.bulkCardsWithPhotos}
              </Button>
            )}
            <Button kind="quiet" disabled={cardsBusy || !valid} onClick={() => { printCardsBook(tab, false); }}>
              {tab === 'in' ? AR.bulkCardsNoPhotos : AR.bulkCardsPlain}
            </Button>
          </>
        ) : undefined
      }
    />
    {removingPermit !== null && (
      <Confirm
        title={AR.confirmPermitDeleteTitle}
        body={AR.confirmPermitDeleteBody(
          cardSerial(removingPermit.serial, removingPermit.serialYear) ??
            String(removingPermit.serial),
        )}
        confirmLabel={AR.permitDelete}
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          api
            .removePermit(removingPermit.id)
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: ['report-permits'] });
              setToast(AR.permitDeleted);
              setBusy(false);
              setRemovingPermit(null);
            })
            .catch((failure: unknown) => {
              setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
              setBusy(false);
              setRemovingPermit(null);
            });
        }}
        onCancel={() => {
          setRemovingPermit(null);
        }}
      />
    )}
    {prepareBillFor !== null && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl">
          <h3 className="text-base font-extrabold text-ink">{AR.prepareBillAction}</h3>
          <p className="mt-1 text-sm text-muted">{AR.prepareMachineLabel}</p>
          <div className="mt-3 grid gap-2">
            {(
              [
                [undefined, AR.prepareByHandling],
                ...HANDLING.map((machine): [Handling | undefined, string] => [
                  machine,
                  AR.machineName[machine],
                ]),
              ] as Array<[Handling | undefined, string]>
            ).map(([machine, label]) => (
              <Button
                key={label}
                kind="quiet"
                disabled={busy}
                onClick={() => {
                  const chosen = prepareBillFor;
                  setBusy(true);
                  api
                    .prepareBill(chosen, machine)
                    .then(({ created, skipped }) => {
                      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
                      setToast(AR.prepareBillSent(created, skipped));
                    })
                    .catch((failure: unknown) => {
                      setToast(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
                    })
                    .finally(() => {
                      setBusy(false);
                      setPrepareBillFor(null);
                    });
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="mt-4">
            <Button
              kind="quiet"
              full
              onClick={() => {
                setPrepareBillFor(null);
              }}
            >
              {AR.cancel}
            </Button>
          </div>
        </div>
      </div>
    )}
    {toast !== null && <Toast message={toast} />}
    </>
  );
}
