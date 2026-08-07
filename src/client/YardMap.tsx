import type { ReactElement } from 'react';
import type { ContainerDto, Position, Size, Tier, YardConfig } from '../shared/types';
import { GROUND_TIER } from '../shared/types';
import { rowLabel, slotKey } from '../shared/address';
import type { SlotStack } from './mapModel';
import { AR } from './ar';

/**
 * The yard drawn to scale as SVG: two panels, one per size, cells positioned
 * with slot 1 at the right edge — the reading start in Arabic. A 40 ft cell is
 * drawn twice as wide as a 20 ft cell because the ground it covers is twice as
 * long; the shape carries the meaning, not a seventh colour.
 */

const CH = 34;
const CW20 = 60;
const CW40 = 127;
const GAP = 7;
const TITLE_H = 40;
const HEADER_H = 20;
const LABEL_GUTTER = 26;
const ZONE_PAD = 14;
const ZONE_MARGIN = 30;
const OUTER_PAD = 8;

const C = {
  panel: '#ffffff',
  panelBorder: '#e2e8f0',
  free: '#f8fafc',
  freeBorder: '#cbd5e1',
  laden: '#1d4ed8',
  ladenText: '#ffffff',
  empty: '#bfdbfe',
  emptyText: '#173a7a',
  ghost: '#e2e8f0',
  badge: '#0f172a',
  badgeText: '#ffffff',
  targetFill: '#dcfce7',
  targetBorder: '#16a34a',
  match: '#f59e0b',
  selected: '#0284c7',
  label: '#94a3b8',
  title: '#0f172a',
  subtitle: '#64748b',
} as const;

function cellWidth(zone: Size): number {
  return zone === 20 ? CW20 : CW40;
}

interface ZoneLayout {
  zone: Size;
  x: number;
  y: number;
  width: number;
  height: number;
  cellsX: number;
  cellsY: number;
  rows: number;
  cols: number;
}

export interface MapLayout {
  width: number;
  height: number;
  zones: ZoneLayout[];
}

export function computeLayout(yard: YardConfig): MapLayout {
  const zones: ZoneLayout[] = [];
  let y = OUTER_PAD;
  let maxWidth = 0;

  for (const zone of [20, 40] as const) {
    const shape = zone === 20 ? yard.twenty : yard.forty;
    const cw = cellWidth(zone);
    const contentW = shape.cols * (cw + GAP) - GAP;
    const width = ZONE_PAD * 2 + contentW + LABEL_GUTTER;
    const height = TITLE_H + HEADER_H + shape.rows * (CH + GAP) - GAP + ZONE_PAD;
    zones.push({
      zone,
      x: 0,
      y,
      width,
      height,
      cellsX: ZONE_PAD,
      cellsY: TITLE_H + HEADER_H,
      rows: shape.rows,
      cols: shape.cols,
    });
    maxWidth = Math.max(maxWidth, width);
    y += height + ZONE_MARGIN;
  }

  // Panels align to the right edge — where reading starts.
  const width = maxWidth + OUTER_PAD * 2;
  for (const zone of zones) {
    zone.x = width - OUTER_PAD - zone.width;
  }

  return { width, height: y - ZONE_MARGIN + OUTER_PAD, zones };
}

export interface MapProps {
  yard: YardConfig;
  stacks: ReadonlyMap<string, SlotStack>;
  tier: Tier;
  selectedId: number | null;
  /** Container ids matching the current search; empty set = no search. */
  matches: ReadonlySet<number>;
  searchActive: boolean;
  /** When a move or gate-in is placing: positions that may be landed on. */
  targets: ReadonlySet<string> | null;
  movingId: number | null;
  onCellClick: (position: Position, occupant: ContainerDto | null) => void;
}

function containerFill(container: ContainerDto): { fill: string; text: string } {
  return container.cargo === 'LADEN'
    ? { fill: C.laden, text: C.ladenText }
    : { fill: C.empty, text: C.emptyText };
}

function Cell(props: {
  layout: ZoneLayout;
  row: number;
  col: number;
  stack: SlotStack;
  map: MapProps;
}): ReactElement {
  const { layout, row, col, stack, map } = props;
  const cw = cellWidth(layout.zone);
  const x = layout.cellsX + (layout.cols - col) * (cw + GAP);
  const y = layout.cellsY + (row - 1) * (CH + GAP);

  const occupant = map.tier === GROUND_TIER ? stack.ground : stack.upper;
  const groundBelow = stack.ground;
  const position: Position = { zone: layout.zone, row, col, tier: map.tier };
  const key = `${slotKey(position)}|${String(map.tier)}`;

  const isTarget = map.targets !== null && map.targets.has(key);
  const isMovingSource = occupant !== undefined && occupant.id === map.movingId;
  const isSelected = occupant !== undefined && occupant.id === map.selectedId;
  const isMatch =
    occupant !== undefined ? map.matches.has(occupant.id)
    : map.tier === GROUND_TIER && stack.upper !== undefined ? map.matches.has(stack.upper.id)
    : false;

  // While searching or placing, everything irrelevant steps back. It dims,
  // it never disappears — the map must stay a picture of the whole place.
  let dimmed = false;
  if (map.searchActive) dimmed = !isMatch;
  if (map.targets !== null) dimmed = !(isTarget || isMovingSource);

  const elements: ReactElement[] = [];

  if (occupant === undefined) {
    // Empty position. On the upper tier, ground support decides how it draws:
    // landable slots look real, unsupported air is barely there.
    const unsupportedAir = map.tier > GROUND_TIER && groundBelow === undefined;
    elements.push(
      <rect
        key="frame"
        className="cell-frame"
        x={x}
        y={y}
        width={cw}
        height={CH}
        rx={5}
        fill={isTarget ? C.targetFill : C.free}
        stroke={isTarget ? C.targetBorder : unsupportedAir ? C.ghost : C.freeBorder}
        strokeWidth={isTarget ? 2 : 1.2}
        strokeDasharray={isTarget ? undefined : '4 3'}
      />,
    );
  } else {
    const palette = containerFill(occupant);
    const stroke = isSelected || isMovingSource ? C.selected : isMatch ? C.match : 'none';
    elements.push(
      <rect
        key="box"
        className="cell-frame"
        x={x}
        y={y}
        width={cw}
        height={CH}
        rx={5}
        fill={palette.fill}
        stroke={stroke}
        strokeWidth={stroke === 'none' ? 0 : 3}
      />,
      <text
        key="owner"
        x={x + cw / 2}
        y={y + 14}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill={palette.text}
        direction="ltr"
      >
        {occupant.number.slice(0, 4)}
      </text>,
      <text
        key="serial"
        x={x + cw / 2}
        y={y + 27}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={600}
        fill={palette.text}
        direction="ltr"
      >
        {occupant.number.slice(4)}
      </text>,
    );

    if (map.tier === GROUND_TIER && stack.upper !== undefined) {
      // Physical top-right corner: visible in both reading directions.
      elements.push(
        <g key="stacked">
          <circle cx={x + cw - 9} cy={y + 9} r={8} fill={C.badge} />
          <text
            x={x + cw - 9}
            y={y + 12.5}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={700}
            fill={C.badgeText}
          >
            2
          </text>
        </g>,
      );
    }
  }

  return (
    <g
      className="map-cell"
      opacity={dimmed ? 0.22 : 1}
      onClick={() => {
        map.onCellClick(position, occupant ?? null);
      }}
    >
      {elements}
    </g>
  );
}

function ZonePanel(props: { layout: ZoneLayout; map: MapProps; freeLabel: string }): ReactElement {
  const { layout, map, freeLabel } = props;
  const cw = cellWidth(layout.zone);
  const cells: ReactElement[] = [];

  for (let row = 1; row <= layout.rows; row += 1) {
    for (let col = 1; col <= layout.cols; col += 1) {
      const stack =
        map.stacks.get(`${String(layout.zone)}|${String(row)}|${String(col)}`) ?? {};
      cells.push(
        <Cell
          key={`${String(row)}-${String(col)}`}
          layout={layout}
          row={row}
          col={col}
          stack={stack}
          map={map}
        />,
      );
    }
  }

  const headers: ReactElement[] = [];
  for (let col = 1; col <= layout.cols; col += 1) {
    headers.push(
      <text
        key={`col-${String(col)}`}
        x={layout.cellsX + (layout.cols - col) * (cw + GAP) + cw / 2}
        y={layout.cellsY - 7}
        textAnchor="middle"
        fontSize={10}
        fill={C.label}
      >
        {col}
      </text>,
    );
  }
  for (let row = 1; row <= layout.rows; row += 1) {
    headers.push(
      <text
        key={`row-${String(row)}`}
        x={layout.cellsX + layout.cols * (cw + GAP) - GAP + 12}
        y={layout.cellsY + (row - 1) * (CH + GAP) + CH / 2 + 4}
        fontSize={11}
        fontWeight={600}
        fill={C.label}
      >
        {rowLabel(row)}
      </text>,
    );
  }

  return (
    <g transform={`translate(${String(layout.x)}, ${String(layout.y)})`}>
      <rect
        width={layout.width}
        height={layout.height}
        rx={12}
        fill={C.panel}
        stroke={C.panelBorder}
      />
      <text
        x={layout.width - ZONE_PAD}
        y={26}
        textAnchor="end"
        fontSize={15}
        fontWeight={700}
        fill={C.title}
      >
        {layout.zone === 20 ? AR.zone20 : AR.zone40}
      </text>
      <text x={ZONE_PAD} y={26} fontSize={11.5} fill={C.subtitle}>
        {freeLabel}
      </text>
      {headers}
      {cells}
    </g>
  );
}

export function YardMap(props: {
  map: MapProps;
  layout: MapLayout;
  freeLabels: ReadonlyMap<Size, string>;
}): ReactElement {
  const { map, layout, freeLabels } = props;
  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      style={{ display: 'block', userSelect: 'none' }}
    >
      {layout.zones.map((zone) => (
        <ZonePanel
          key={zone.zone}
          layout={zone}
          map={map}
          freeLabel={freeLabels.get(zone.zone) ?? ''}
        />
      ))}
    </svg>
  );
}
