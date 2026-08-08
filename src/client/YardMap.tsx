import { memo, type ReactElement } from 'react';
import type { BlockConfig, ContainerDto, Position, Tier, YardConfig } from '../shared/types';
import { GROUND_TIER, MIXED_SIZE } from '../shared/types';
import { positionKey } from '../shared/address';
import {
  BLOCK_PAD,
  CELL_GAP,
  HEADER_H,
  TITLE_H,
  blockFrame,
  cellSize,
  yardBounds,
} from '../shared/geometry';
import type { SlotStack } from './mapModel';

/**
 * The yard drawn to scale as SVG: one panel per block, each translated and
 * rotated to where the owner put it, cells positioned with slot 1 at the
 * right edge — the reading start in Arabic. A 40 ft slot is twice as TALL as
 * a 20's because the box lies along the line; a mixed block's slots are
 * 20-shaped and the container itself carries its size.
 */

const OUTER_PAD = 24;

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
  under: '#475569',
  targetFill: '#dcfce7',
  targetBorder: '#16a34a',
  match: '#f59e0b',
  selected: '#0284c7',
  label: '#94a3b8',
  title: '#0f172a',
  subtitle: '#64748b',
} as const;

export interface BlockLayout {
  readonly block: BlockConfig;
  /** Canvas position of the unrotated frame's top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MapLayout {
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly BlockLayout[];
}

/** Canvas geometry: every rotated panel boxed, padded, in one coordinate space. */
export function computeLayout(yard: YardConfig): MapLayout {
  const bounds = yardBounds(yard.blocks);
  const blocks = yard.blocks.map((block) => {
    const frame = blockFrame(block);
    return {
      block,
      x: block.x - bounds.minX + OUTER_PAD,
      y: block.y - bounds.minY + OUTER_PAD,
      width: frame.width,
      height: frame.height,
    };
  });
  return {
    width: bounds.maxX - bounds.minX + OUTER_PAD * 2,
    height: bounds.maxY - bounds.minY + OUTER_PAD * 2,
    blocks,
  };
}

/** The SVG transform that places a block's local frame onto the canvas. */
export function blockTransform(layout: BlockLayout): string {
  const { x, y, width, height, block } = layout;
  return `translate(${String(x)}, ${String(y)}) rotate(${String(block.angle)}, ${String(width / 2)}, ${String(height / 2)})`;
}

/** What the map shows: one tier, or both side by side (L|H) like the register. */
export type ViewTier = Tier | 'ALL';

export interface MapProps {
  yard: YardConfig;
  stacks: ReadonlyMap<string, SlotStack>;
  tier: ViewTier;
  selectedId: number | null;
  /** Container ids matching the current search; empty set = no search. */
  matches: ReadonlySet<number>;
  searchActive: boolean;
  /** When a move or gate-in is placing: positions that may be landed on. */
  targets: ReadonlySet<string> | null;
  movingId: number | null;
  onCellClick: (position: Position, stack: SlotStack) => void;
}

/** The per-panel slice of MapProps — everything except the yard itself. */
type PanelView = Omit<MapProps, 'yard'>;

function containerFill(container: ContainerDto): { fill: string; text: string } {
  return container.cargo === 'LADEN'
    ? { fill: C.laden, text: C.ladenText }
    : { fill: C.empty, text: C.emptyText };
}

function numberLines(
  container: ContainerDto,
  x: number,
  width: number,
  y: number,
  height: number,
  text: string,
  compact: boolean,
): ReactElement[] {
  const mid = y + height / 2;
  return [
    <text
      key="owner"
      x={x + width / 2}
      y={mid - (compact ? 4 : 3)}
      textAnchor="middle"
      fontSize={compact ? 9 : 10}
      fontWeight={700}
      fill={text}
      direction="ltr"
    >
      {container.number.slice(0, 4)}
    </text>,
    <text
      key="serial"
      x={x + width / 2}
      y={mid + (compact ? 7 : 10)}
      textAnchor="middle"
      fontSize={compact ? 9.5 : 10.5}
      fontWeight={600}
      fill={text}
      direction="ltr"
    >
      {container.number.slice(4)}
    </text>,
  ];
}

/** One half of a split cell in the الكل view: L on the left, H on the right. */
function HalfCell(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  tier: Tier;
  position: Position;
  occupant: ContainerDto | undefined;
  supported: boolean;
  view: PanelView;
  stack: SlotStack;
}): ReactElement {
  const { x, y, width, height, position, occupant, supported, view } = props;
  const isTarget = view.targets !== null && view.targets.has(positionKey(position));
  const isMovingSource = occupant !== undefined && occupant.id === view.movingId;
  const isSelected = occupant !== undefined && occupant.id === view.selectedId;
  const isMatch = occupant !== undefined && view.matches.has(occupant.id);

  let dimmed = false;
  if (view.searchActive) dimmed = !isMatch;
  if (view.targets !== null) dimmed = !(isTarget || isMovingSource);

  const palette = occupant === undefined ? null : containerFill(occupant);
  const stroke =
    isSelected || isMovingSource ? C.selected : isMatch ? C.match : isTarget ? C.targetBorder : null;

  return (
    <g
      className="map-cell"
      opacity={dimmed ? 0.22 : undefined}
      onClick={() => {
        view.onCellClick(position, props.stack);
      }}
    >
      <rect
        className="cell-frame"
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={palette?.fill ?? (isTarget ? C.targetFill : C.free)}
        stroke={stroke ?? (occupant !== undefined ? 'none' : supported ? C.freeBorder : C.ghost)}
        strokeWidth={stroke !== null ? 2 : 1}
        strokeDasharray={occupant === undefined && stroke === null ? '3 2' : undefined}
      />
      {/* The tier letter only where a container carries it: an empty half's
          label was ~2px at fit zoom and cost the الكل view ~1800 text nodes.
          L is always the first half, so empty slots stay unambiguous. */}
      {occupant !== undefined && (
        <text
          x={x + width / 2}
          y={y + 13}
          textAnchor="middle"
          fontSize={8}
          fontWeight={700}
          fill={palette?.text ?? C.label}
          direction="ltr"
        >
          {props.tier === GROUND_TIER ? 'L' : 'H'}
        </text>
      )}
      {occupant !== undefined && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 8}
          textAnchor="middle"
          fontSize={8.5}
          fontWeight={600}
          fill={palette?.text ?? C.label}
          direction="ltr"
        >
          {occupant.number.slice(-4)}
        </text>
      )}
    </g>
  );
}

function Cell(props: {
  layout: BlockLayout;
  row: number;
  col: number;
  stack: SlotStack;
  view: PanelView;
}): ReactElement {
  const { layout, row, col, stack, view } = props;
  const { block } = layout;
  const cell = cellSize(block.size);
  const x = BLOCK_PAD + (block.cols - col) * (cell.w + CELL_GAP);
  const y = TITLE_H + HEADER_H + (row - 1) * (cell.h + CELL_GAP);

  // The register view: both tiers of the slot side by side, L then H,
  // exactly like the paper's paired columns.
  if (view.tier === 'ALL') {
    const half = (cell.w - 3) / 2;
    return (
      <g>
        <HalfCell
          x={x}
          y={y}
          width={half}
          height={cell.h}
          tier={GROUND_TIER}
          position={{ block: block.id, row, col, tier: GROUND_TIER }}
          occupant={stack.ground}
          supported
          view={view}
          stack={stack}
        />
        <HalfCell
          x={x + half + 3}
          y={y}
          width={half}
          height={cell.h}
          tier={2}
          position={{ block: block.id, row, col, tier: 2 }}
          occupant={stack.upper}
          supported={stack.ground !== undefined}
          view={view}
          stack={stack}
        />
      </g>
    );
  }

  const tier: Tier = view.tier;
  const occupant = tier === GROUND_TIER ? stack.ground : stack.upper;
  const groundBelow = stack.ground;
  const position: Position = { block: block.id, row, col, tier };

  const isTarget = view.targets !== null && view.targets.has(positionKey(position));
  const isMovingSource = occupant !== undefined && occupant.id === view.movingId;
  const isSelected =
    (occupant !== undefined && occupant.id === view.selectedId) ||
    (tier === GROUND_TIER && stack.upper !== undefined && stack.upper.id === view.selectedId);
  const isMatch =
    occupant !== undefined
      ? view.matches.has(occupant.id) ||
        (tier === GROUND_TIER && stack.upper !== undefined && view.matches.has(stack.upper.id))
      : false;

  // While searching or placing, everything irrelevant steps back. It dims,
  // it never disappears — the map must stay a picture of the whole place.
  let dimmed = false;
  if (view.searchActive) dimmed = !isMatch;
  if (view.targets !== null) dimmed = !(isTarget || isMovingSource);

  const elements: ReactElement[] = [];

  if (occupant === undefined) {
    // Empty position. On the upper tier, ground support decides how it draws:
    // landable slots look real, unsupported air is barely there.
    const unsupportedAir = tier > GROUND_TIER && groundBelow === undefined;
    elements.push(
      <rect
        key="frame"
        className="cell-frame"
        x={x}
        y={y}
        width={cell.w}
        height={cell.h}
        rx={5}
        fill={isTarget ? C.targetFill : C.free}
        stroke={isTarget ? C.targetBorder : unsupportedAir ? C.ghost : C.freeBorder}
        strokeWidth={isTarget ? 2 : 1.2}
        strokeDasharray={isTarget ? undefined : '4 3'}
      />,
    );
  } else if (tier === GROUND_TIER && stack.upper !== undefined) {
    // A stacked slot in the GROUND view shows the GROUND container in front —
    // this floor's own picture — while the one standing on it peeks from
    // behind the top corner, so the stack still reads at a glance.
    const peek = 7;
    const upper = stack.upper;
    const groundPalette = containerFill(occupant);
    const upperPalette = containerFill(upper);
    const stroke = isSelected || isMovingSource ? C.selected : isMatch ? C.match : C.under;
    elements.push(
      <rect
        key="upper-card"
        x={x + peek}
        y={y}
        width={cell.w - peek}
        height={cell.h - peek}
        rx={5}
        fill={upperPalette.fill}
        stroke={C.under}
        strokeWidth={1}
      />,
      <rect
        key="ground-card"
        className="cell-frame"
        x={x}
        y={y + peek}
        width={cell.w - peek}
        height={cell.h - peek}
        rx={5}
        fill={groundPalette.fill}
        stroke={stroke}
        strokeWidth={stroke === C.under ? 1.2 : 3}
      />,
      ...numberLines(occupant, x, cell.w - peek, y + peek, cell.h - peek, groundPalette.text, true),
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
        width={cell.w}
        height={cell.h}
        rx={5}
        fill={palette.fill}
        stroke={stroke}
        strokeWidth={stroke === 'none' ? 0 : 3}
      />,
      ...numberLines(occupant, x, cell.w, y, cell.h, palette.text, false),
    );
  }

  // In a mixed block the slot does not say the size — the container must.
  const sizeTagFor =
    block.size === MIXED_SIZE && occupant !== undefined ? occupant : undefined;
  if (sizeTagFor !== undefined) {
    elements.push(
      <g key="size-tag">
        <rect x={x + 2} y={y + 2} width={16} height={11} rx={3} fill="#0f172a" />
        <text
          x={x + 10}
          y={y + 10.5}
          textAnchor="middle"
          fontSize={7.5}
          fontWeight={700}
          fill="#ffffff"
          direction="ltr"
        >
          {sizeTagFor.size}
        </text>
      </g>,
    );
  }

  return (
    <g
      className="map-cell"
      opacity={dimmed ? 0.22 : undefined}
      onClick={() => {
        view.onCellClick(position, stack);
      }}
    >
      {elements}
    </g>
  );
}

const BlockPanel = memo(
  function BlockPanel(props: {
    layout: BlockLayout;
    view: PanelView;
    freeLabel: string;
  }): ReactElement {
    const { layout, view, freeLabel } = props;
    const { block } = layout;
    const cell = cellSize(block.size);
    const cells: ReactElement[] = [];

    for (let row = 1; row <= block.rows; row += 1) {
      for (let col = 1; col <= block.cols; col += 1) {
        const stack =
          view.stacks.get(`${String(block.id)}|${String(row)}|${String(col)}`) ?? {};
        cells.push(
          <Cell
            key={`${String(row)}-${String(col)}`}
            layout={layout}
            row={row}
            col={col}
            stack={stack}
            view={view}
          />,
        );
      }
    }

    const headers: ReactElement[] = [];
    // A short name fuses into the register's line label (A1, A2…); a long one
    // would not fit over a cell, so the plain line number stands in.
    const lineLabel = (col: number): string =>
      block.name.length <= 3 ? `${block.name}${String(col)}` : String(col);
    for (let col = 1; col <= block.cols; col += 1) {
      headers.push(
        <text
          key={`col-${String(col)}`}
          x={BLOCK_PAD + (block.cols - col) * (cell.w + CELL_GAP) + cell.w / 2}
          y={TITLE_H + HEADER_H - 7}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          fill={C.label}
          direction="ltr"
        >
          {lineLabel(col)}
        </text>,
      );
    }
    for (let row = 1; row <= block.rows; row += 1) {
      headers.push(
        <text
          key={`row-${String(row)}`}
          x={BLOCK_PAD + block.cols * (cell.w + CELL_GAP) - CELL_GAP + 12}
          y={TITLE_H + HEADER_H + (row - 1) * (cell.h + CELL_GAP) + cell.h / 2 + 4}
          textAnchor="end"
          fontSize={11}
          fontWeight={600}
          fill={C.label}
        >
          {row}
        </text>,
      );
    }

    return (
      <g transform={blockTransform(layout)}>
        <rect
          width={layout.width}
          height={layout.height}
          rx={12}
          fill={C.panel}
          stroke={C.panelBorder}
        />
        {/* Under dir=rtl, text-anchor follows reading order: "start" pins the
            right edge of Arabic text at x, "end" pins its left edge. */}
        <text
          x={layout.width - BLOCK_PAD}
          y={26}
          textAnchor="start"
          fontSize={15}
          fontWeight={700}
          fill={C.title}
        >
          {block.name}
        </text>
        <text x={BLOCK_PAD} y={26} textAnchor="end" fontSize={11.5} fill={C.subtitle}>
          {freeLabel}
        </text>
        {headers}
        {cells}
      </g>
    );
  },
  // Editor drags patch one block per frame; every other panel must skip.
  (prev, next) =>
    prev.layout.block === next.layout.block &&
    prev.layout.x === next.layout.x &&
    prev.layout.y === next.layout.y &&
    prev.freeLabel === next.freeLabel &&
    prev.view.stacks === next.view.stacks &&
    prev.view.tier === next.view.tier &&
    prev.view.selectedId === next.view.selectedId &&
    prev.view.matches === next.view.matches &&
    prev.view.searchActive === next.view.searchActive &&
    prev.view.targets === next.view.targets &&
    prev.view.movingId === next.view.movingId &&
    prev.view.onCellClick === next.view.onCellClick,
);

/**
 * Memoized: panning and zooming only move the transformed wrapper, so the
 * thousands of SVG nodes of a big yard must not re-render per frame. Callers
 * keep `map` referentially stable across view changes.
 */
export const YardMap = memo(function YardMap(props: {
  map: MapProps;
  layout: MapLayout;
  freeLabels: ReadonlyMap<number, string>;
}): ReactElement {
  const { map, layout, freeLabels } = props;
  const view: PanelView = {
    stacks: map.stacks,
    tier: map.tier,
    selectedId: map.selectedId,
    matches: map.matches,
    searchActive: map.searchActive,
    targets: map.targets,
    movingId: map.movingId,
    onCellClick: map.onCellClick,
  };
  return (
    <svg
      className="yard-map"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      style={{ display: 'block', userSelect: 'none', overflow: 'visible' }}
    >
      {layout.blocks.map((blockLayout) => (
        <BlockPanel
          key={blockLayout.block.id}
          layout={blockLayout}
          view={view}
          freeLabel={freeLabels.get(blockLayout.block.id) ?? ''}
        />
      ))}
    </svg>
  );
});