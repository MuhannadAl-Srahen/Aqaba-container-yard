import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DailyReportRow, GateReportRow, Position } from '../shared/types';
import { AR } from './ar';
import { api } from './api';
import {
  SheetScreen,
  ammanToday,
  cellLtr,
  cellText,
  cellWrap,
  dash,
  dayFormat,
  dateFormat,
  monthStart,
  rangeInstants,
  stampCells,
  type TableModel,
} from './sheetKit';

/**
 * The office's registers: entry and exit movements, the daily summary, and
 * the per-truck sheet. The operations log lives on its own screen.
 */

type Tab = 'in' | 'out' | 'daily' | 'truck';

function gateModel(
  rows: readonly GateReportRow[],
  out: boolean,
  label: (position: Position) => string,
  onTruck: (truck: string) => void,
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
    AR.colWeight,
    AR.colSize,
    AR.colSlot,
    AR.colCompany,
    ...(out ? [AR.colDwell] : []),
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
    cellLtr(row.card === null ? dash : String(row.card)),
    cellLtr(row.number),
    cellLtr(row.weight === '' ? dash : row.weight),
    cellText(String(row.size)),
    cellLtr(row.position === null ? dash : label(row.position)),
    cellWrap(row.customer),
    ...(out ? [cellText(row.dwellDays === null ? dash : String(row.dwellDays))] : []),
  ]);
  const footer =
    rows.length === 0
      ? null
      : [cellText(AR.totalRow), cellText(AR.movementsCount(rows.length))];
  return { head, body, footer };
}

function truckModel(
  rows: ReadonlyArray<GateReportRow & { statement: 'IN' | 'OUT' }>,
  label: (position: Position) => string,
): TableModel {
  const head = [
    AR.colSeq,
    AR.colStatement,
    AR.colDay,
    AR.colDate,
    AR.colTime,
    AR.colNumber,
    AR.colWeight,
    AR.colSize,
    AR.colSlot,
    AR.colCompany,
  ];
  const body = rows.map((row, index) => [
    cellText(String(index + 1)),
    cellText(row.statement === 'IN' ? AR.statementIn : AR.statementOut),
    ...stampCells(new Date(row.at)),
    cellLtr(row.number),
    cellLtr(row.weight === '' ? dash : row.weight),
    cellText(String(row.size)),
    cellLtr(row.position === null ? dash : label(row.position)),
    cellWrap(row.customer),
  ]);
  const footer =
    rows.length === 0
      ? null
      : [cellText(AR.totalRow), cellText(AR.movementsCount(rows.length))];
  return { head, body, footer };
}

function dailyModel(rows: readonly DailyReportRow[]): TableModel {
  const head = [AR.colSeq, AR.colDay, AR.colDate, AR.colIn, AR.colOut, AR.colStanding];
  const body = rows.map((row, index) => {
    const at = new Date(`${row.date}T12:00:00+03:00`);
    return [
      cellText(String(index + 1)),
      cellText(dayFormat.format(at)),
      cellLtr(dateFormat.format(at)),
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
  return { head, body, footer };
}

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['in', AR.reportIn],
  ['out', AR.reportOut],
  ['daily', AR.reportDaily],
  ['truck', AR.reportTruck],
];

export function ReportsScreen(props: {
  label: (position: Position) => string;
  onBack: () => void;
}): ReactElement {
  const [tab, setTab] = useState<Tab>('in');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(ammanToday());
  const [truck, setTruck] = useState('');

  const { fromIso, toIso } = useMemo(() => rangeInstants(from, to), [from, to]);
  const valid = from !== '' && to !== '' && from <= to;
  const truckReady = truck.trim() !== '';

  const gate = useQuery({
    queryKey: ['report-gate', tab, fromIso, toIso],
    queryFn: () => api.reportGate(tab === 'in' ? 'IN' : 'OUT', fromIso, toIso),
    enabled: valid && (tab === 'in' || tab === 'out'),
  });
  const daily = useQuery({
    queryKey: ['report-daily', fromIso, toIso],
    queryFn: () => api.reportDaily(fromIso, toIso),
    enabled: valid && tab === 'daily',
  });
  const truckReport = useQuery({
    queryKey: ['report-truck', truck.trim(), fromIso, toIso],
    queryFn: () => api.reportTruck(truck.trim(), fromIso, toIso),
    enabled: valid && tab === 'truck' && truckReady,
  });

  const baseTitle = TABS.find(([key]) => key === tab)?.[1] ?? '';
  const title = tab === 'truck' && truckReady ? `${baseTitle} ${truck.trim()}` : baseTitle;

  const model = useMemo<TableModel>(() => {
    const openTruck = (plate: string): void => {
      setTruck(plate);
      setTab('truck');
    };
    switch (tab) {
      case 'in':
      case 'out':
        return gateModel(gate.data?.rows ?? [], tab === 'out', props.label, openTruck);
      case 'daily':
        return dailyModel(daily.data?.rows ?? []);
      case 'truck':
        return truckModel(truckReport.data?.rows ?? [], props.label);
    }
  }, [tab, gate.data, daily.data, truckReport.data, props.label]);

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
      emptyText={tab === 'truck' && !truckReady ? AR.truckPrompt : undefined}
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
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
              }
            >
              {tabLabel}
            </button>
          ))}
        </div>
      }
      extraFilters={
        tab === 'truck' ? (
          <input
            dir="ltr"
            placeholder={AR.colTruck}
            className="w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-start text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            value={truck}
            onChange={(event) => {
              setTruck(event.target.value);
            }}
          />
        ) : undefined
      }
    />
  );
}
