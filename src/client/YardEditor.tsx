import { useMemo, useRef, useState, type ReactElement } from 'react';
import type { BlockConfig, BlockSize, ContainerDto, YardConfig } from '../shared/types';
import { ANGLE_STEP, MAX_BLOCKS, MAX_ZONE_COLS, MAX_ZONE_ROWS, MIXED_SIZE } from '../shared/types';
import { blockFrame, overlappingPairs, yardBounds } from '../shared/geometry';
import { AR } from './ar';
import { ApiFailure, api, type BlockDraft } from './api';
import { Button, inputClass } from './ui';
import { YardMap, blockTransform, type MapLayout } from './YardMap';
import { buildStacks, summarizeBlock } from './mapModel';
import { usePanZoom } from './usePanZoom';

/**
 * The yard arranged on the yard itself: drag a block to move it, select it to
 * rename, resize, or turn it in ANGLE_STEP notches. Nothing reaches the
 * server until one atomic save — cancel and the yard never knew.
 */

const CANVAS_PAD = 60;
const MOVE_SNAP = 5;

// Stable references so the memoized panels skip re-rendering during drags.
const NO_MATCHES: ReadonlySet<number> = new Set<number>();
const noopCellClick = (): undefined => undefined;

/** The next unused register letter: A..Z then AA, AB… */
function nextLetterName(taken: ReadonlySet<string>): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const first of ['', ...letters]) {
    for (const second of letters) {
      const name = `${first}${second}`;
      if (!taken.has(name)) return name;
    }
  }
  return `Z${String(taken.size)}`;
}

interface DragState {
  blockId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface RotateState {
  blockId: number;
  /** Block centre, in canvas coordinates. */
  centerX: number;
  centerY: number;
}

export function YardEditor(props: {
  yard: YardConfig;
  containers: readonly ContainerDto[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState<readonly BlockConfig[]>(props.yard.blocks);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextTempId = useRef(-1);
  const drag = useRef<DragState | null>(null);
  const rotating = useRef<RotateState | null>(null);

  const stacks = useMemo(() => buildStacks(props.containers), [props.containers]);

  /** Blocks that still hold containers cannot shrink below them or be deleted. */
  const occupancy = useMemo(() => {
    const byBlock = new Map<
      number,
      { maxRow: number; maxCol: number; count: number; has20: boolean; has40: boolean }
    >();
    for (const container of props.containers) {
      if (container.position === null) continue;
      const entry = byBlock.get(container.position.block) ?? {
        maxRow: 0,
        maxCol: 0,
        count: 0,
        has20: false,
        has40: false,
      };
      entry.maxRow = Math.max(entry.maxRow, container.position.row);
      entry.maxCol = Math.max(entry.maxCol, container.position.col);
      entry.count += 1;
      if (container.size === 20) entry.has20 = true;
      else entry.has40 = true;
      byBlock.set(container.position.block, entry);
    }
    return byBlock;
  }, [props.containers]);

  // The canvas frame is frozen at entry so dragging one block never shifts
  // the others on screen; blocks pushed past it still render (overflow) and
  // the server renormalises on the next load.
  const base = useMemo(() => yardBounds(props.yard.blocks), [props.yard.blocks]);
  const canvasWidth = base.maxX - base.minX + CANVAS_PAD * 2;
  const canvasHeight = base.maxY - base.minY + CANVAS_PAD * 2;

  const layout: MapLayout = useMemo(
    () => ({
      width: canvasWidth,
      height: canvasHeight,
      blocks: draft.map((block) => {
        const frame = blockFrame(block);
        return {
          block,
          x: block.x - base.minX + CANVAS_PAD,
          y: block.y - base.minY + CANVAS_PAD,
          width: frame.width,
          height: frame.height,
        };
      }),
    }),
    [draft, base, canvasWidth, canvasHeight],
  );

  const overlapping = useMemo(() => {
    const ids = new Set<number>();
    for (const [a, b] of overlappingPairs(draft)) {
      ids.add(a.id);
      ids.add(b.id);
    }
    return ids;
  }, [draft]);

  const freeLabels = useMemo(() => {
    const labels = new Map<number, string>();
    for (const block of draft) {
      const summary = summarizeBlock(block, stacks);
      labels.set(block.id, AR.freeOf(summary.freeGround, summary.totalGround));
    }
    return labels;
  }, [draft, stacks]);

  const pz = usePanZoom(canvasWidth, canvasHeight);

  // The map is memoized against pan/zoom frames AND per-panel against block
  // drags; every reference here must hold still.
  const editorMapProps = useMemo(
    () => ({
      yard: { blocks: draft },
      stacks,
      tier: 1 as const,
      selectedId: null,
      matches: NO_MATCHES,
      searchActive: false,
      targets: null,
      movingId: null,
      onCellClick: noopCellClick,
    }),
    [draft, stacks],
  );

  const selected = draft.find((block) => block.id === selectedId) ?? null;
  const selectedOccupancy = selected === null ? undefined : occupancy.get(selected.id);

  const patchBlock = (id: number, patch: Partial<BlockConfig>): void => {
    setDraft((blocks) => blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const addBlock = (size: BlockSize): void => {
    if (draft.length >= MAX_BLOCKS) return;
    const bounds = yardBounds(draft);
    const id = nextTempId.current;
    nextTempId.current -= 1;
    const shape = { size, rows: size === 40 ? 15 : 30, cols: 2 };
    const frame = blockFrame(shape);
    const block: BlockConfig = {
      id,
      // The next register letter, like the areas the owner already names.
      name: nextLetterName(new Set(draft.map((b) => b.name))),
      ...shape,
      // Below everything, hugging the RIGHT edge — where reading starts, and
      // away from the toolbar that floats at the start side.
      x: bounds.maxX - frame.width,
      y: bounds.maxY + 30,
      angle: 0,
    };
    setDraft((blocks) => [...blocks, block]);
    setSelectedId(id);
  };

  const save = (): void => {
    if (busy || overlapping.size > 0) return;
    setBusy(true);
    setError(null);
    const payload: BlockDraft[] = draft.map((block) =>
      block.id > 0
        ? block
        : {
            name: block.name,
            size: block.size,
            rows: block.rows,
            cols: block.cols,
            x: block.x,
            y: block.y,
            angle: block.angle,
          },
    );
    api
      .saveYard(payload)
      .then(() => {
        props.onSaved(AR.editorSaved);
      })
      .catch((failure: unknown) => {
        setError(failure instanceof ApiFailure ? failure.arabic : AR.networkError);
        setBusy(false);
      });
  };

  const onBlockPointerDown = (
    event: React.PointerEvent<SVGRectElement>,
    block: BlockConfig,
  ): void => {
    // The canvas pan must not also grab this gesture.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      blockId: block.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: block.x,
      originY: block.y,
      moved: false,
    };
  };

  const onBlockPointerMove = (event: React.PointerEvent<SVGRectElement>): void => {
    const state = drag.current;
    if (state === null) return;
    const dx = (event.clientX - state.startClientX) / pz.view.scale;
    const dy = (event.clientY - state.startClientY) / pz.view.scale;
    if (Math.hypot(dx, dy) > 3) state.moved = true;
    if (!state.moved) return;
    let x = Math.round((state.originX + dx) / MOVE_SNAP) * MOVE_SNAP;
    let y = Math.round((state.originY + dy) / MOVE_SNAP) * MOVE_SNAP;
    // Edges glue to the neighbours' edges so rows of areas line up straight.
    for (const other of draft) {
      if (other.id === state.blockId) continue;
      if (Math.abs(x - other.x) <= 8) x = other.x;
      if (Math.abs(y - other.y) <= 8) y = other.y;
    }
    patchBlock(state.blockId, { x, y });
  };

  const onBlockPointerUp = (): void => {
    const state = drag.current;
    drag.current = null;
    if (state !== null && !state.moved) {
      setSelectedId((current) => (current === state.blockId ? null : state.blockId));
    }
  };

  /** The wheel above the block: grab it and the area follows the hand. */
  const onRotateHandleDown = (
    event: React.PointerEvent<SVGCircleElement>,
    blockId: number,
    centerX: number,
    centerY: number,
  ): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    rotating.current = { blockId, centerX, centerY };
  };

  const onRotateHandleMove = (event: React.PointerEvent<SVGCircleElement>): void => {
    const state = rotating.current;
    if (state === null) return;
    const container = pz.containerRef.current;
    if (container === null) return;
    const rect = container.getBoundingClientRect();
    const px = (event.clientX - rect.left - pz.view.x) / pz.view.scale;
    const py = (event.clientY - rect.top - pz.view.y) / pz.view.scale;
    const dx = px - state.centerX;
    const dy = py - state.centerY;
    // The handle sits straight up at 0°; clockwise from there, whole degrees.
    const degrees = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    patchBlock(state.blockId, { angle: degrees });
  };

  const onRotateHandleUp = (): void => {
    rotating.current = null;
  };

  // Typed straight in or nudged with the buttons — no click marathons.
  const stepper = (
    label: string,
    value: number,
    min: number,
    max: number,
    apply: (next: number) => void,
  ): ReactElement => (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <button
        type="button"
        className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 disabled:opacity-30"
        disabled={value <= min}
        onClick={() => {
          apply(value - 1);
        }}
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isInteger(parsed)) apply(Math.max(min, Math.min(max, parsed)));
        }}
        className="w-14 rounded-lg border border-slate-300 px-1.5 py-1 text-center text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
      />
      <button
        type="button"
        className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 disabled:opacity-30"
        disabled={value >= max}
        onClick={() => {
          apply(value + 1);
        }}
      >
        +
      </button>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <header className="z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm lg:px-5">
        <h1 className="text-base font-extrabold text-slate-900">{AR.editYard}</h1>
        <span className="hidden text-xs text-slate-400 lg:block">{AR.editorHint}</span>
        <div className="ms-auto flex items-center gap-1.5">
          <Button kind="quiet" disabled={busy || draft.length >= MAX_BLOCKS} onClick={() => { addBlock(20); }}>
            {AR.editorAdd20}
          </Button>
          <Button kind="quiet" disabled={busy || draft.length >= MAX_BLOCKS} onClick={() => { addBlock(40); }}>
            {AR.editorAdd40}
          </Button>
          <Button
            kind="quiet"
            disabled={busy || draft.length >= MAX_BLOCKS}
            onClick={() => {
              addBlock(MIXED_SIZE);
            }}
          >
            {AR.editorAddMixed}
          </Button>
          <Button kind="quiet" disabled={busy} onClick={props.onCancel}>
            {AR.editorCancel}
          </Button>
          <Button disabled={busy || overlapping.size > 0} onClick={save}>
            {AR.editorSave}
          </Button>
        </div>
        {(overlapping.size > 0 || error !== null) && (
          <p className="w-full text-xs font-semibold text-red-600">
            {error ?? AR.editorOverlap}
          </p>
        )}
      </header>

      <main className="relative flex-1 overflow-hidden">
        <div
          ref={pz.attachContainer}
          {...pz.handlers}
          className="absolute inset-0 touch-none overflow-hidden"
          style={{ contain: 'layout paint' }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${String(pz.view.x)}px, ${String(pz.view.y)}px) scale(${String(pz.view.scale)})`,
              transformOrigin: '0 0',
              // Its own compositor layer: block drags repaint one panel, and
              // panning repaints nothing.
              willChange: 'transform',
              width: canvasWidth,
              height: canvasHeight,
            }}
          >
            <YardMap layout={layout} freeLabels={freeLabels} map={editorMapProps} />
            {/* The editing chrome: one grab-surface per block over the map. */}
            <svg
              width={canvasWidth}
              height={canvasHeight}
              viewBox={`0 0 ${String(canvasWidth)} ${String(canvasHeight)}`}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                overflow: 'visible',
                userSelect: 'none',
              }}
            >
              {layout.blocks.map((blockLayout) => {
                const { block } = blockLayout;
                const isSelected = block.id === selectedId;
                const invalid = overlapping.has(block.id);
                const centerX = blockLayout.x + blockLayout.width / 2;
                const centerY = blockLayout.y + blockLayout.height / 2;
                return (
                  <g key={block.id} transform={blockTransform(blockLayout)}>
                    <rect
                      width={blockLayout.width}
                      height={blockLayout.height}
                      rx={12}
                      fill="transparent"
                      stroke={invalid ? '#dc2626' : isSelected ? '#2563eb' : '#94a3b8'}
                      strokeWidth={invalid || isSelected ? 3 : 1.5}
                      strokeDasharray={isSelected || invalid ? undefined : '6 5'}
                      style={{ cursor: 'move', touchAction: 'none' }}
                      onPointerDown={(event) => {
                        onBlockPointerDown(event, block);
                      }}
                      onPointerMove={onBlockPointerMove}
                      onPointerUp={onBlockPointerUp}
                      onPointerCancel={onBlockPointerUp}
                    />
                    {isSelected && (
                      <>
                        <line
                          x1={blockLayout.width / 2}
                          y1={0}
                          x2={blockLayout.width / 2}
                          y2={-24}
                          stroke="#2563eb"
                          strokeWidth={2}
                        />
                        <circle
                          cx={blockLayout.width / 2}
                          cy={-32}
                          r={11}
                          fill="#2563eb"
                          stroke="#ffffff"
                          strokeWidth={2.5}
                          style={{ cursor: 'grab', touchAction: 'none' }}
                          onPointerDown={(event) => {
                            onRotateHandleDown(event, block.id, centerX, centerY);
                          }}
                          onPointerMove={onRotateHandleMove}
                          onPointerUp={onRotateHandleUp}
                          onPointerCancel={onRotateHandleUp}
                        />
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {selected !== null && (
          <div className="absolute inset-x-2 bottom-2 z-10 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl lg:inset-x-auto lg:end-4 lg:w-[440px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex min-w-40 flex-1 items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">{AR.editorName}</span>
                <input
                  className={inputClass}
                  value={selected.name}
                  maxLength={40}
                  onChange={(event) => {
                    patchBlock(selected.id, { name: event.target.value });
                  }}
                />
              </label>
              <div className="flex overflow-hidden rounded-lg border border-slate-300">
                {([20, 40, MIXED_SIZE] as const).map((size) => {
                  // A block may always turn mixed; turning single-size needs
                  // every standing container to fit the new policy.
                  const allowed =
                    size === MIXED_SIZE ||
                    ((size === 20 ? selectedOccupancy?.has40 : selectedOccupancy?.has20) ?? false) ===
                      false;
                  return (
                    <button
                      key={size}
                      type="button"
                      disabled={!allowed}
                      title={allowed ? undefined : AR.sizeMixedBlocked}
                      onClick={() => {
                        patchBlock(selected.id, { size });
                      }}
                      className={
                        'px-2.5 py-1 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
                        (selected.size === size
                          ? 'bg-slate-800 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-100')
                      }
                    >
                      {size === MIXED_SIZE ? AR.sizeMixed : `${size} قدم`}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              {stepper(AR.editorRows, selected.rows, Math.max(1, selectedOccupancy?.maxRow ?? 1), MAX_ZONE_ROWS, (rows) => {
                patchBlock(selected.id, { rows });
              })}
              {stepper(AR.editorCols, selected.cols, Math.max(1, selectedOccupancy?.maxCol ?? 1), MAX_ZONE_COLS, (cols) => {
                patchBlock(selected.id, { cols });
              })}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500">{AR.editorAngle}</span>
                <button
                  type="button"
                  aria-label="↺"
                  className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base text-slate-700"
                  onClick={() => {
                    patchBlock(selected.id, { angle: (selected.angle + 360 - ANGLE_STEP) % 360 });
                  }}
                >
                  ↺
                </button>
                <span className="w-9 text-center text-sm font-bold text-slate-900" dir="ltr">
                  {selected.angle}°
                </span>
                <button
                  type="button"
                  aria-label="↻"
                  className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-base text-slate-700"
                  onClick={() => {
                    patchBlock(selected.id, { angle: (selected.angle + ANGLE_STEP) % 360 });
                  }}
                >
                  ↻
                </button>
              </div>
              <div className="ms-auto">
                {(selectedOccupancy?.count ?? 0) > 0 ? (
                  <span className="text-xs text-slate-400">{AR.editorDeleteBlocked}</span>
                ) : (
                  <Button
                    kind="danger"
                    disabled={busy || draft.length <= 1}
                    onClick={() => {
                      setDraft((blocks) => blocks.filter((b) => b.id !== selected.id));
                      setSelectedId(null);
                    }}
                  >
                    {AR.editorDelete}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
