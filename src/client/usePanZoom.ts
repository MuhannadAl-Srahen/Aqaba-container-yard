import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hand-rolled pan/zoom for the map: drag to pan, wheel to zoom at the cursor,
 * pinch to zoom on touch. No library — the whole behaviour is ~150 lines and
 * every quirk (tap-vs-drag, RTL, pinch midpoint) is visible here.
 */

export interface PanZoom {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
/**
 * Below this the bay numbers are grey mush — measured on the drawing itself,
 * where a bay band is 58 yard units and needs about 25 screen pixels to read.
 */
const LEGIBLE_SCALE = 0.45;
/** Finger movement below this is a tap, not a drag. */
const TAP_SLOP_PX = 8;

interface PointerState {
  x: number;
  y: number;
}

export function usePanZoom(contentWidth: number, contentHeight: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The node also lives in state so effects re-bind when the container
  // REMOUNTS (leaving for the editor/reports and back) — a plain ref kept
  // the old wheel listener glued to a dead element.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setContainerEl(el);
  }, []);
  const [view, setView] = useState<PanZoom>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, PointerState>());
  const pinchDistance = useRef<number | null>(null);
  const dragged = useRef(false);
  /** Where the gesture started, for the tap-vs-drag distance. */
  const downAt = useRef<PointerState | null>(null);

  /**
   * The floor a gesture may not go below — and it is NOT a constant.
   *
   * The yard is some 4420 units wide since the authority's newer plan (it was
   * 2860 when this was measured). A desk screen fitted that at about 0.48,
   * so the 0.2 floor never showed; a phone needed 0.13, so the floor held the
   * drawing at 0.2 and the yard was rendered 572 pixels wide inside a
   * 393-pixel screen — cut off at both edges, on the one screen he uses most
   * while walking the ground. The floor is now the FIT itself whenever the
   * fit is smaller: the whole yard is always reachable, and no gesture can
   * shrink it past the point where it all shows.
   */
  const floorRef = useRef(MIN_SCALE);

  const clampScale = (scale: number): number =>
    Math.min(MAX_SCALE, Math.max(floorRef.current, scale));

  /** Fit the whole yard in the container, centered — the home view. */
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (el === null || contentWidth === 0 || contentHeight === 0) return;
    const pad = 24;
    const raw = Math.min(
      (el.clientWidth - pad) / contentWidth,
      (el.clientHeight - pad) / contentHeight,
    );
    floorRef.current = Math.min(MIN_SCALE, raw);
    const scale = Math.min(MAX_SCALE, Math.max(floorRef.current, raw));
    console.log('[pz] FIT raw=' + String(raw) + ' stack=' + String(new Error('t').stack).slice(0, 300));
    setView({
      x: (el.clientWidth - contentWidth * scale) / 2,
      y: (el.clientHeight - contentHeight * scale) / 2,
      scale,
    });
  }, [contentWidth, contentHeight]);

  /**
   * The view the app OPENS on. The yard is three times wider than it is deep,
   * and a phone is twice as deep as it is wide, so fitting the whole drawing
   * on one leaves a thread of a yard adrift in an empty screen — everything
   * visible and nothing readable. The opening view keeps the bay numbers
   * legible instead and starts at the top of the drawing; «⊡» still pulls
   * back to the whole yard whenever he wants it, and the floor above lets it.
   */
  const open = useCallback(() => {
    const el = containerRef.current;
    if (el === null || contentWidth === 0 || contentHeight === 0) return;
    const pad = 24;
    const raw = Math.min(
      (el.clientWidth - pad) / contentWidth,
      (el.clientHeight - pad) / contentHeight,
    );
    floorRef.current = Math.min(MIN_SCALE, raw);
    console.log('[pz] open raw=' + String(raw) + ' cw=' + String(el.clientWidth));
    if (raw >= LEGIBLE_SCALE) {
      fit();
      return;
    }
    const scale = Math.min(MAX_SCALE, LEGIBLE_SCALE);
    const wide = contentWidth * scale > el.clientWidth;
    setView({
      // Anchored at the drawing's own beginning — zone A, bay 01 — rather
      // than its middle: the yard is read from its first bay, and landing
      // in the middle of zone A means nothing to anyone.
      x: wide ? pad / 2 : (el.clientWidth - contentWidth * scale) / 2,
      y: pad / 2,
      scale,
    });
  }, [contentWidth, contentHeight, fit]);

  // First real layout OPENS; a genuine reshape after that re-fits.
  const opened = useRef(false);
  const shapeRef = useRef(0);
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || el.clientWidth === 0) return;
    if (!opened.current) {
      opened.current = true;
      shapeRef.current = contentWidth * contentHeight;
      open();
      return;
    }
    // Only a real reshape of the YARD — a zone added, the contents paint
    // scaling the drawing — takes the camera home again.
    const shape = contentWidth * contentHeight;
    if (shape === shapeRef.current) return;
    shapeRef.current = shape;
    fit();
  }, [fit, open, contentWidth, contentHeight]);

  /**
   * The box is often zero-sized when the effects first run, and the opening
   * view needs one real measurement. This waits for it — and does nothing
   * afterwards. Re-fitting on later resizes was tried and reverted: the map
   * loses a few pixels of height whenever the header gains a line as the
   * data lands, which is not a resize the user made, and treating it as one
   * threw away both the opening view and whatever he had zoomed to. «⊡»
   * takes the whole yard back in one tap, and now reaches it at any size.
   */
  useEffect(() => {
    const el = containerEl;
    if (el === null || opened.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (opened.current || el.clientWidth === 0 || el.clientHeight === 0) return;
      opened.current = true;
      open();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [containerEl, open]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = containerRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      const ratio = scale / v.scale;
      // Keep the point under the cursor stationary while the scale changes.
      return { scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
    });
  }, []);

  // Wheel is attached natively with passive:false — React root listeners are
  // passive, so preventDefault there cannot stop ctrl+wheel zooming the whole
  // page along with the map.
  useEffect(() => {
    if (containerEl === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    containerEl.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      containerEl.removeEventListener('wheel', onWheel);
    };
  }, [containerEl, zoomAt]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    // No capture here: capturing at pointerdown retargets the coming click
    // to this container, so a tapped cell would never hear it. Capture waits
    // until the movement says "drag" (below).
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) dragged.current = false;
    pinchDistance.current = null;
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (previous === undefined) return;

    // A tracked non-touch pointer moving with no button held means its
    // pointerup happened somewhere we never heard it (released outside,
    // uncaptured). Forget it, or plain hovering would pan the map.
    if (event.pointerType !== 'touch' && event.buttons === 0) {
      pointers.current.delete(event.pointerId);
      if (pointers.current.size < 2) pinchDistance.current = null;
      return;
    }

    const current = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, current);

    // Once the gesture is a real drag or pinch, capture the pointer so the
    // pan survives leaving the container. A tap (within the slop) never
    // captures, keeping its click intact for the cell underneath.
    const start = downAt.current;
    const isDrag =
      pointers.current.size === 2 ||
      (start !== null && Math.hypot(current.x - start.x, current.y - start.y) > TAP_SLOP_PX);
    const target = event.currentTarget as HTMLElement;
    if (isDrag && !target.hasPointerCapture(event.pointerId)) {
      target.setPointerCapture(event.pointerId);
    }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance.current !== null && pinchDistance.current > 0) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        zoomAt(midX, midY, distance / pinchDistance.current);
      }
      pinchDistance.current = distance;
      dragged.current = true;
      return;
    }

    // Pan only once the slop says drag: a shaky tap must stay a tap, and
    // it must not nudge the view either. The dropped ≤8px is imperceptible
    // at the start of a real drag.
    if (!isDrag) return;
    dragged.current = true;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  }, [zoomAt]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = null;
  }, []);

  // An uncaptured pointer that leaves will deliver its pointerup elsewhere —
  // forget it now, or its ghost would pan under the next hover and swallow
  // the next tap. A captured pointer (a real drag) is cleaned by pointerup.
  const onPointerLeave = useCallback((event: React.PointerEvent) => {
    const target = event.currentTarget as HTMLElement;
    if (!target.hasPointerCapture(event.pointerId)) {
      pointers.current.delete(event.pointerId);
      if (pointers.current.size < 2) pinchDistance.current = null;
    }
  }, []);

  /**
   * Cells call this before acting on a click: if the pointer travelled, the
   * gesture was a pan and the click that follows it must be ignored.
   */
  const wasDrag = useCallback((): boolean => dragged.current, []);

  // Track total movement from pointerdown so wasDrag is meaningful.
  const onPointerDownCapture = useCallback((event: React.PointerEvent) => {
    if (pointers.current.size === 0) {
      downAt.current = { x: event.clientX, y: event.clientY };
      dragged.current = false;
    }
  }, []);
  const onPointerUpCapture = useCallback((event: React.PointerEvent) => {
    const start = downAt.current;
    if (start !== null) {
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved > TAP_SLOP_PX) dragged.current = true;
    }
  }, []);

  /** Zoom about the container's centre — the buttons' move, callable too. */
  const zoomCenter = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt],
  );

  const zoomButtons = {
    zoomIn: () => {
      zoomCenter(1.3);
    },
    zoomOut: () => {
      zoomCenter(1 / 1.3);
    },
    fit,
  };

  return {
    containerRef,
    attachContainer,
    view,
    wasDrag,
    zoomCenter,
    zoomButtons,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerLeave,
      onPointerDownCapture,
      onPointerUpCapture,
    },
  };
}
