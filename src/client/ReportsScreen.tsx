import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ContainerDto,
  DailyReportRow,
  GateReportRow,
  StandingReportRow,
} from '../shared/types';
import { cardSerial } from '../shared/types';
import { carrierOfPlate } from '../shared/fleet';
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

type Tab = 'in' | 'out' | 'standing' | 'daily' | 'truck' | 'bill';

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
 */
function billModel(rows: readonly ContainerDto[]): TableModel {
  const head = [
    AR.colSeq,
    AR.colNumber,
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

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['in', AR.reportIn],
  ['out', AR.reportOut],
  ['standing', AR.reportStanding],
  ['bill', AR.reportBill],
  ['daily', AR.reportDaily],
  ['truck', AR.reportTruck],
];

export function ReportsScreen(props: {
  /** Land straight on one bill's sheet — the search's doorway. */
  initialBill?: string | undefined;
  /** Reprint a gate card straight from the row it is on. */
  onCard: (kind: 'in' | 'out', containerId: number) => void;
  onBack: () => void;
}): ReactElement {
  const [tab, setTab] = useState<Tab>(props.initialBill === undefined ? 'in' : 'bill');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(ammanToday());
  /** «عرض الكل»: the whole register regardless of the period pickers. */
  const [all, setAll] = useState(false);
  const [truck, setTruck] = useState('');
  /** The carrier whose whole fleet the truck register is showing; 0 = by plate. */
  const [carrier, setCarrier] = useState(0);
  const [bill, setBill] = useState(props.initialBill ?? '');

  const { fromIso, toIso } = useMemo(
    // The registry has no records before the system existed, so an early
    // fixed floor honestly reads as «كامل السجل».
    () => (all ? rangeInstants('2000-01-01', ammanToday()) : rangeInstants(from, to)),
    [all, from, to],
  );
  const valid = all || (from !== '' && to !== '' && from <= to);
  const truckReady = truck.trim() !== '';
  const billReady = bill.trim() !== '';

  // The carriers, for the truck tab's filter and for naming a typed plate's
  // own carrier in the sheet title.
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: api.fleet, enabled: tab === 'truck' });
  const carriers = fleet.data?.carriers ?? [];
  const activeCarrier = carriers.find((row) => row.id === carrier) ?? null;

  // A register left open on the office screen keeps up with the gate on its
  // own. Slower than the map — a sheet being read should not reshuffle under
  // the reader every few seconds.
  const LIVE = 20_000;

  const gate = useQuery({
    queryKey: ['report-gate', tab, fromIso, toIso],
    queryFn: () => api.reportGate(tab === 'in' ? 'IN' : 'OUT', fromIso, toIso),
    enabled: valid && (tab === 'in' || tab === 'out'),
    refetchInterval: LIVE,
  });
  const daily = useQuery({
    queryKey: ['report-daily', fromIso, toIso],
    queryFn: () => api.reportDaily(fromIso, toIso),
    enabled: valid && tab === 'daily',
    refetchInterval: LIVE,
  });
  const truckReport = useQuery({
    queryKey: ['report-truck', activeCarrier === null ? truck.trim() : `c${String(carrier)}`, fromIso, toIso],
    queryFn: () =>
      activeCarrier === null
        ? api.reportTruck(truck.trim(), fromIso, toIso)
        : api.reportCarrier(activeCarrier.id, fromIso, toIso),
    enabled: valid && tab === 'truck' && (truckReady || activeCarrier !== null),
    refetchInterval: LIVE,
  });
  const standing = useQuery({
    queryKey: ['report-standing'],
    queryFn: api.reportStanding,
    enabled: tab === 'standing',
    refetchInterval: LIVE,
  });
  const billReport = useQuery({
    queryKey: ['report-bill', bill.trim()],
    queryFn: () => api.reportBill(bill.trim()),
    enabled: tab === 'bill' && billReady,
    refetchInterval: LIVE,
  });

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
        ? `${baseTitle} ${truck.trim()}${plateCarrier === null ? '' : ` — ${AR.carrierChip(plateCarrier.name)}`}`
        : tab === 'bill' && billReady
          ? `${baseTitle} ${bill.trim()}`
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
      case 'truck':
        return truckModel(
          truckReport.data?.rows ?? [],
          openBill,
          // Carrier mode: the plate column drills into that one truck.
          activeCarrier === null
            ? null
            : (plate) => {
                setCarrier(0);
                setTruck(plate);
              },
        );
      case 'bill':
        return billModel(billReport.data?.rows ?? []);
    }
  }, [tab, gate.data, standing.data, daily.data, truckReport.data, billReport.data, activeCarrier]);

  // A register row carries its own card: no hunting the exact number down in
  // the search box to reprint the paper the driver already lost.
  const cardActions =
    tab === 'in' || tab === 'out' || tab === 'standing' || tab === 'bill'
      ? {
          header: AR.actionColumn,
          render: (rowIndex: number): ReactNode => {
            const containerId =
              tab === 'standing'
                ? standing.data?.rows[rowIndex]?.containerId
                : tab === 'bill'
                  ? billReport.data?.rows[rowIndex]?.id
                  : gate.data?.rows[rowIndex]?.containerId;
            if (containerId === undefined) return null;
            return (
              <button
                type="button"
                onClick={() => {
                  props.onCard(tab === 'out' ? 'out' : 'in', containerId);
                }}
                className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-200"
              >
                {AR.cardAction}
              </button>
            );
          },
        }
      : undefined;

  return (
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
        tab === 'standing' ? AR.standingNow : tab === 'bill' ? AR.billNow : undefined
      }
      emptyText={
        tab === 'truck' && !truckReady && activeCarrier === null
          ? AR.truckPrompt
          : tab === 'bill' && !billReady
            ? AR.billPrompt
            : undefined
      }
      allRange={{
        on: all,
        toggle: () => {
          setAll((value) => !value);
        },
      }}
      tabs={
        <div className="flex flex-wrap gap-1">
          {TABS.map(([key, tabLabel]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
              }}
              className={
                'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ' +
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
          </>
        ) : tab === 'bill' ? (
          <input
            dir="ltr"
            placeholder={AR.colBill}
            className="w-36 rounded-lg border border-line-strong px-2.5 py-1.5 text-start text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            value={bill}
            onChange={(event) => {
              setBill(event.target.value);
            }}
          />
        ) : undefined
      }
    />
  );
}
