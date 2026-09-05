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

  const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  /** Fit the whole yard in the container, centered — the home view. */
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (el === null || contentWidth === 0 || contentHeight === 0) return;
    const pad = 24;
    const scale = clampScale(
      Math.min(
        (el.clientWidth - pad) / contentWidth,
        (el.clientHeight - pad) / contentHeight,
      ),
    );
    setView({
      x: (el.clientWidth - contentWidth * scale) / 2,
      y: (el.clientHeight - contentHeight * scale) / 2,
      scale,
    });
  }, [contentWidth, contentHeight]);

  // First layout and any yard reshape both deserve a fresh fit.
  useEffect(() => {
    fit();
  }, [fit]);

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
