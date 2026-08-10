import { memo, type ReactElement } from 'react';
import type { BlockConfig, ContainerDto, Position, YardConfig } from '../shared/types';
import { positionKey, rowNumber } from '../shared/address';
import { BLOCK_PAD, CELL_GAP, CELL_H, CELL_W, HEADER_H, TITLE_H, blockFrame, yardBounds } from '../shared/geometry';
import { AR } from './ar';
import { countLocation } from './mapModel';

/**
 * The yard drawn to scale as SVG: one panel per column, translated and
 * rotated to where the owner put it, its locations running down it from 01.
 * A cell says the two things the yard asks of it — which location this is,
 * and how much of it is taken. What stands inside is one tap away.
 */

const OUTER_PAD = 24;

/**
 * The drawing reads the theme's own variables, so the yard turns dark with
 * the rest of the site and prints light with the rest of the paper — no
 * second palette, no re-render.
 */
const C = {
  panel: 'var(--yard-panel)',
  panelBorder: 'var(--yard-panel-border)',
  free: 'var(--yard-free)',
  freeBorder: 'var(--yard-free-border)',
  partial: 'var(--yard-partial)',
  partialBorder: 'var(--yard-partial-border)',
  full: 'var(--yard-full)',
  fullText: 'var(--yard-full-text)',
  targetFill: 'var(--yard-target)',
  targetBorder: 'var(--yard-target-border)',
  match: 'var(--yard-match)',
  selected: 'var(--yard-selected)',
  label: 'var(--yard-muted)',
  text: 'var(--yard-text)',
  title: 'var(--yard-text)',
  subtitle: 'var(--yard-muted)',
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

export interface MapProps {
  yard: YardConfig;
  /** What stands in each location, keyed by positionKey. */
  loads: ReadonlyMap<string, readonly ContainerDto[]>;
  selectedId: number | null;
  /** Container ids matching the current search; empty set = no search. */
  matches: ReadonlySet<number>;
  searchActive: boolean;
  /** When a move or gate-in is placing: locations that may be landed on. */
  targets: ReadonlySet<string> | null;
  movingId: number | null;
  onCellClick: (position: Position, load: readonly ContainerDto[]) => void;
}

/** The per-panel slice of MapProps — everything except the yard itself. */
type PanelView = Omit<MapProps, 'yard'>;

const EMPTY_LOAD: readonly ContainerDto[] = [];

function Cell(props: { layout: BlockLayout; row: number; view: PanelView }): ReactElement {
  const { layout, row, view } = props;
  const { block } = layout;
  const position: Position = { block: block.id, row };
  const load = view.loads.get(positionKey(position)) ?? EMPTY_LOAD;
  const count = countLocation(block, load);

  const x = BLOCK_PAD;
  const y = TITLE_H + HEADER_H + (row - 1) * (CELL_H + CELL_GAP);

  const isTarget = view.targets !== null && view.targets.has(positionKey(position));
  const holdsMoving = view.movingId !== null && load.some((c) => c.id === view.movingId);
  const holdsSelected = view.selectedId !== null && load.some((c) => c.id === view.selectedId);
  const holdsMatch = load.some((container) => view.matches.has(container.id));

  // While searching or placing, everything irrelevant steps back. It dims,
  // it never disappears — the map must stay a picture of the whole place.
  let dimmed = false;
  if (view.searchActive) dimmed = !holdsMatch;
  if (view.targets !== null) dimmed = !(isTarget || holdsMoving);

  const empty = count.used === 0;
  const fill = isTarget ? C.targetFill : empty ? C.free : count.full ? C.full : C.partial;
  const textColor = count.full && !isTarget ? C.fullText : empty ? C.label : C.text;
  const stroke =
    holdsSelected || holdsMoving
      ? C.selected
      : holdsMatch
        ? C.match
        : isTarget
          ? C.targetBorder
          : count.full
            ? C.full
            : empty
              ? C.freeBorder
              : C.partialBorder;
  const strong = holdsSelected || holdsMoving || holdsMatch || isTarget;
  // A note on any container here earns a dot: the crew writes the dents, the
  // opened locks and the customs holds there, and the map must not hide it.
  const noted = load.some((container) => container.notes !== '');

  return (
    <g
      className="map-cell"
      opacity={dimmed ? 0.22 : undefined}
      onClick={() => {
        view.onCellClick(position, load);
      }}
    >
      <rect
        className="cell-frame"
        x={x}
        y={y}
        width={CELL_W}
        height={CELL_H}
        rx={5}
        fill={fill}
        stroke={stroke}
        strokeWidth={strong ? 2.5 : 1.2}
        strokeDasharray={empty && !strong ? '4 3' : undefined}
      />
      {/* The location's own name, always written left to right. */}
      <text
        x={x + CELL_W - 9}
        y={y + CELL_H / 2 + 5}
        textAnchor="end"
        fontSize={14}
        fontWeight={700}
        fill={textColor}
        direction="ltr"
      >
        {`${block.name}-${rowNumber(row)}`}
      </text>
      <text
        x={x + 9}
        y={y + CELL_H / 2 + 5}
        textAnchor="start"
        fontSize={13}
        fontWeight={600}
        fill={textColor}
        direction="ltr"
      >
        {`${String(count.used)} / ${String(count.total)}`}
      </text>
      {noted && <circle cx={x + CELL_W / 2} cy={y + 9} r={3.5} fill={C.match} />}
    </g>
  );
}

const BlockPanel = memo(
  function BlockPanel(props: {
    layout: BlockLayout;
    view: PanelView;
    freeLabel: string;
    sizeLabel: string;
    buildLabel: string;
  }): ReactElement {
    const { layout, view, freeLabel, sizeLabel, buildLabel } = props;
    const { block } = layout;
    const cells: ReactElement[] = [];
    for (let row = 1; row <= block.rows; row += 1) {
      cells.push(<Cell key={row} layout={layout} row={row} view={view} />);
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
        {/* Everything the owner asked to see beside the letter, on three
            lines so it all stays inside the panel: the size this column
            takes, how it is built, and the split of full against free. */}
        <text
          x={layout.width - BLOCK_PAD}
          y={23}
          textAnchor="start"
          fontSize={18}
          fontWeight={700}
          fill={C.title}
        >
          {block.name}
        </text>
        <text x={BLOCK_PAD} y={22} textAnchor="end" fontSize={11.5} fontWeight={600} fill={C.subtitle}>
          {sizeLabel}
        </text>
        <text
          x={layout.width - BLOCK_PAD}
          y={TITLE_H - 8}
          textAnchor="start"
          fontSize={10.5}
          fill={C.subtitle}
        >
          {buildLabel}
        </text>
        <text
          x={layout.width - BLOCK_PAD}
          y={TITLE_H + HEADER_H - 9}
          textAnchor="start"
          fontSize={11}
          fontWeight={700}
          fill={C.subtitle}
        >
          {freeLabel}
        </text>
        {cells}
      </g>
    );
  },
  // Editor drags patch one block per frame; every other panel must skip.
  // EVERY field of PanelView must appear here — a forgotten one means panels
  // silently stop repainting when that field changes.
  (prev, next) =>
    prev.layout.block === next.layout.block &&
    prev.layout.x === next.layout.x &&
    prev.layout.y === next.layout.y &&
    prev.freeLabel === next.freeLabel &&
    prev.sizeLabel === next.sizeLabel &&
    prev.buildLabel === next.buildLabel &&
    prev.view.loads === next.view.loads &&
    prev.view.selectedId === next.view.selectedId &&
    prev.view.matches === next.view.matches &&
    prev.view.searchActive === next.view.searchActive &&
    prev.view.targets === next.view.targets &&
    prev.view.movingId === next.view.movingId &&
    prev.view.onCellClick === next.view.onCellClick,
);

/** `40 قدم` — which size this column takes, in its own language. */
export function sizeLabelOf(block: BlockConfig): string {
  return AR.blockSizeName(block.size);
}

/** `2 طابق × 4 حاوية` — how one location in this column is built. */
export function buildLabelOf(block: BlockConfig): string {
  const per = countLocation(block, undefined);
  return AR.blockBuild(
    block.placesPerTier / (block.size === 40 ? 2 : 1),
    block.tiers,
    per.inPlaces,
  );
}

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
    loads: map.loads,
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
          sizeLabel={sizeLabelOf(blockLayout.block)}
          buildLabel={buildLabelOf(blockLayout.block)}
        />
      ))}
    </svg>
  );
});
