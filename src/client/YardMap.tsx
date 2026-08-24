import { memo, useState, type ReactElement } from 'react';
import type { ContainerDto, Landmark, YardLayout, Zone, ZoneDef } from '../shared/types';
import { AR } from './ar';
import { bayKey, countBay, maxStackOf, summarizeZone } from './mapModel';

/**
 * The official ASEZA yard drawn to scale as SVG: zone strips with their bays
 * exactly as the authority's plan numbers them, and the hangars, buildings,
 * tower and caravan standing where the printed map puts them, so the screen
 * reads like the paper the yard already knows.
 *
 * A map cell is one ODD bay — the ground itself. What stands in it (both
 * tiers, and any 40 reaching over from an even bay) is one tap away.
 */

const OUTER_PAD = 26;
/** The zone panel's inner metrics — must match the decoder's zone rects. */
const PAD = 14;
const TITLE_H = 44;
const CELL_H = 66;

/**
 * The drawing reads the theme's own variables, so the yard turns dark with
 * the rest of the site and prints light with the rest of the paper.
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
  landmark: 'var(--yard-landmark)',
  landmarkLine: 'var(--yard-landmark-line)',
} as const;

export interface MapLayout {
  readonly width: number;
  readonly height: number;
  readonly zones: readonly ZoneDef[];
  readonly landmarks: readonly Landmark[];
}

/** Canvas geometry: the decoded layout plus breathing room. */
export function computeLayout(layout: YardLayout): MapLayout {
  let maxX = 0;
  let maxY = 0;
  for (const rect of [...layout.zones, ...layout.landmarks]) {
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return {
    width: maxX + OUTER_PAD * 2,
    height: maxY + OUTER_PAD * 2,
    zones: layout.zones,
    landmarks: layout.landmarks,
  };
}

export interface MapProps {
  /** Who covers each odd bay, keyed by `bayKey`. */
  loads: ReadonlyMap<string, readonly ContainerDto[]>;
  selectedId: number | null;
  /** Container ids matching the current search; empty set = no search. */
  matches: ReadonlySet<number>;
  searchActive: boolean;
  /** While placing: the bays that hold at least one legal landing. */
  targets: ReadonlySet<string> | null;
  movingId: number | null;
  onBayClick: (zone: Zone, bay: number) => void;
  /**
   * «بدي اقدر احرك الزون … عن طريق السحب»: the OWNER may drag a zone he
   * defined by its title bar to park it anywhere on its yard's drawing.
   * Null for everyone else and for the official zones, which never move.
   */
  dragZones: {
    names: ReadonlySet<string>;
    onDrop: (zone: string, x: number, y: number) => void;
  } | null;
}

function BayCell(props: {
  zone: ZoneDef;
  bay: number;
  index: number;
  cellW: number;
  view: MapProps;
}): ReactElement {
  const { zone, bay, index, cellW, view } = props;
  const key = bayKey(zone.zone, bay);
  const load = view.loads.get(key);
  const count = countBay(zone, bay, load);

  const x = PAD + index * cellW;
  const y = TITLE_H;

  const isTarget = view.targets !== null && view.targets.has(key);
  const holdsMoving =
    view.movingId !== null && (load?.some((c) => c.id === view.movingId) ?? false);
  const holdsSelected =
    view.selectedId !== null && (load?.some((c) => c.id === view.selectedId) ?? false);
  const holdsMatch = load?.some((container) => view.matches.has(container.id)) ?? false;

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
  const noted = load?.some((container) => container.notes !== '') ?? false;

  return (
    <g
      className="map-cell"
      opacity={dimmed ? 0.22 : undefined}
      onClick={() => {
        view.onBayClick(zone.zone, bay);
      }}
    >
      <rect
        className="cell-frame"
        x={x + 2}
        y={y}
        width={cellW - 4}
        height={CELL_H}
        rx={5}
        fill={fill}
        stroke={stroke}
        strokeWidth={strong ? 2.5 : 1.2}
        strokeDasharray={empty && !strong ? '4 3' : undefined}
      />
      {/* The bay's own number, exactly as the plan paints it on the ground. */}
      <text
        x={x + cellW / 2}
        y={y + 25}
        textAnchor="middle"
        fontSize={15}
        fontWeight={700}
        fill={textColor}
        direction="ltr"
      >
        {String(bay).padStart(2, '0')}
      </text>
      <text
        x={x + cellW / 2}
        y={y + 50}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill={textColor}
        direction="ltr"
      >
        {`${String(count.used)} / ${String(count.total)}`}
      </text>
      {noted && <circle cx={x + cellW / 2} cy={y + CELL_H - 8} r={3.5} fill={C.match} />}
    </g>
  );
}

const ZonePanel = memo(
  function ZonePanel(props: { zone: ZoneDef; view: MapProps }): ReactElement {
    const { zone, view } = props;
    const cellW = (zone.w - PAD * 2) / zone.bays.length;
    const summary = summarizeZone(zone, view.loads);

    // Dragging: the offset rides in local state while the pointer is down,
    // and the drop hands the final parking spot up. Pointer deltas are read
    // back through the SVG's own screen matrix, so pan and zoom cannot lie
    // about how far the zone actually moved.
    const draggable = view.dragZones !== null && view.dragZones.names.has(zone.zone);
    const [drag, setDrag] = useState<{
      pointerId: number;
      startX: number;
      startY: number;
      dx: number;
      dy: number;
    } | null>(null);
    const place = (event: { clientX: number; clientY: number }, start: { startX: number; startY: number }): { dx: number; dy: number } => {
      return { dx: event.clientX - start.startX, dy: event.clientY - start.startY };
    };

    return (
      <g
        transform={`translate(${String(zone.x + (drag?.dx ?? 0))}, ${String(zone.y + (drag?.dy ?? 0))})`}
      >
        <rect width={zone.w} height={zone.h} rx={12} fill={C.panel} stroke={C.panelBorder} />
        {/* Under dir=rtl, text-anchor follows reading order: "start" pins the
            right edge of Arabic text at x, "end" pins its left edge. */}
        <text
          x={zone.w - PAD}
          y={22}
          textAnchor="start"
          fontSize={15}
          fontWeight={700}
          fill={C.text}
        >
          {AR.zoneTitle(zone.zone, zone.yard)}
        </text>
        <text x={zone.w - PAD} y={TITLE_H - 6} textAnchor="start" fontSize={10.5} fill={C.label}>
          {AR.zoneBuild(maxStackOf(zone))}
        </text>
        <text x={PAD} y={22} textAnchor="end" fontSize={11.5} fontWeight={700} fill={C.label}>
          {AR.fullAndFree(summary.usedTeu, summary.totalTeu - summary.usedTeu)}
        </text>
        {zone.bays.map((bay, index) => (
          <BayCell key={bay} zone={zone} bay={bay} index={index} cellW={cellW} view={view} />
        ))}
        {draggable && (
          <rect
            width={zone.w}
            height={TITLE_H}
            fill="transparent"
            style={{ cursor: 'move' }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                dx: 0,
                dy: 0,
              });
            }}
            onPointerMove={(event) => {
              if (drag === null || event.pointerId !== drag.pointerId) return;
              const svg = event.currentTarget.ownerSVGElement;
              const scale = svg?.getScreenCTM()?.a ?? 1;
              const raw = place(event, drag);
              setDrag({ ...drag, dx: raw.dx / scale, dy: raw.dy / scale });
            }}
            onPointerUp={(event) => {
              if (drag === null || event.pointerId !== drag.pointerId) return;
              // The server parks nothing past 5000 units; the landing is
              // clamped to the same fence so no drop can end in a refusal.
              const landedX = Math.min(5000, Math.max(0, zone.x + drag.dx));
              const landedY = Math.min(5000, Math.max(0, zone.y + drag.dy));
              setDrag(null);
              if (Math.abs(drag.dx) + Math.abs(drag.dy) > 2) {
                view.dragZones?.onDrop(zone.zone, landedX, landedY);
              }
            }}
            onPointerCancel={() => {
              setDrag(null);
            }}
          >
            <title>{AR.zoneDragHint}</title>
          </rect>
        )}
      </g>
    );
  },
  // Pan/zoom moves the transformed wrapper; the panels must repaint only when
  // the data itself changes. EVERY field of MapProps must appear here.
  (prev, next) =>
    prev.zone === next.zone &&
    prev.view.loads === next.view.loads &&
    prev.view.selectedId === next.view.selectedId &&
    prev.view.matches === next.view.matches &&
    prev.view.searchActive === next.view.searchActive &&
    prev.view.targets === next.view.targets &&
    prev.view.movingId === next.view.movingId &&
    prev.view.onBayClick === next.view.onBayClick &&
    prev.view.dragZones === next.view.dragZones,
);

function LandmarkShape(props: { landmark: Landmark }): ReactElement {
  const { landmark } = props;
  return (
    <g>
      <rect
        x={landmark.x}
        y={landmark.y}
        width={landmark.w}
        height={landmark.h}
        rx={6}
        fill="url(#landmark-hatch)"
        stroke={C.landmarkLine}
        strokeWidth={1.5}
      />
      <text
        x={landmark.x + landmark.w / 2}
        y={landmark.y + landmark.h / 2 + 4}
        textAnchor="middle"
        fontSize={12}
        fontWeight={700}
        fill={C.landmarkLine}
      >
        {landmark.label}
      </text>
    </g>
  );
}

/**
 * Memoized: panning and zooming only move the transformed wrapper, so the
 * SVG nodes must not re-render per frame. Callers keep `map` referentially
 * stable across view changes.
 */
export const YardMap = memo(function YardMap(props: {
  map: MapProps;
  layout: MapLayout;
}): ReactElement {
  const { map, layout } = props;
  return (
    <svg
      className="yard-map"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
      style={{ display: 'block', userSelect: 'none', overflow: 'visible' }}
    >
      <defs>
        {/* The hangars hatch like the printed plan, in the theme's own ink. */}
        <pattern id="landmark-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" fill={C.landmark} />
          <line x1="0" y1="0" x2="0" y2="7" stroke={C.landmarkLine} strokeWidth="1.4" opacity="0.55" />
        </pattern>
      </defs>
      <g transform={`translate(${String(OUTER_PAD)}, ${String(OUTER_PAD)})`}>
        {layout.landmarks.map((landmark, index) => (
          <LandmarkShape key={index} landmark={landmark} />
        ))}
        {layout.zones.map((zone) => (
          <ZonePanel key={zone.zone} zone={zone} view={map} />
        ))}
      </g>
    </svg>
  );
});
