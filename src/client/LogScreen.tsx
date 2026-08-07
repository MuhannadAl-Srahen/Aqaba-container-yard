import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LogReportRow, Position } from '../shared/types';
import { AR } from './ar';
import { api } from './api';
import {
  SheetScreen,
  ammanToday,
  cellLtr,
  cellText,
  dash,
  monthStart,
  rangeInstants,
  stampCells,
  type TableModel,
} from './sheetKit';

/**
 * سجل العمليات — its own place, not a report tab: the complete audit of
 * everything that ever happened, deletions and deleted records included.
 */

function logModel(rows: readonly LogReportRow[], label: (position: Position) => string): TableModel {
  const head = [
    AR.colSeq,
    AR.colOperation,
    AR.colDay,
    AR.colDate,
    AR.colTime,
    AR.colNumber,
    AR.colCompany,
    AR.colFrom,
    AR.colTo,
    AR.colNote,
  ];
  const body = rows.map((row, index) => {
    const noteParts: string[] = [];
    if (row.type === 'EDIT' && row.note !== '') noteParts.push(AR.editedFields(row.note));
    else if (row.note !== '') noteParts.push(row.note);
    if (row.deleted) noteParts.push(AR.deletedRecord);
    return [
      cellText(String(index + 1)),
      cellText(AR.operationName[row.type] ?? row.type),
      ...stampCells(new Date(row.at)),
      cellLtr(row.number),
      cellText(row.customer),
      cellLtr(row.from === null ? dash : label(row.from)),
      cellLtr(row.to === null ? dash : label(row.to)),
      cellText(noteParts.length === 0 ? dash : noteParts.join(' — ')),
    ];
  });
  const footer =
    rows.length === 0
      ? null
      : [cellText(AR.totalRow), cellText(AR.movementsCount(rows.length))];
  return { head, body, footer };
}

export function LogScreen(props: {
  label: (position: Position) => string;
  onBack: () => void;
}): ReactElement {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(ammanToday());

  const { fromIso, toIso } = useMemo(() => rangeInstants(from, to), [from, to]);
  const valid = from !== '' && to !== '' && from <= to;

  const log = useQuery({
    queryKey: ['report-log', fromIso, toIso],
    queryFn: () => api.reportLog(fromIso, toIso),
    enabled: valid,
  });

  const model = useMemo<TableModel>(
    () => logModel(log.data?.rows ?? [], props.label),
    [log.data, props.label],
  );

  return (
    <SheetScreen
      screenTitle={AR.reportLog}
      sheetTitle={AR.reportLog}
      model={model}
      from={from}
      to={to}
      onFrom={setFrom}
      onTo={setTo}
      onBack={props.onBack}
    />
  );
}
