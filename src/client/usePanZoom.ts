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
  const [view, setView] = useState<PanZoom>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, PointerState>());
  const pinchDistance = useRef<number | null>(null);
  const dragged = useRef(false);

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

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    },
    [zoomAt],
  );

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) dragged.current = false;
    pinchDistance.current = null;
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (previous === undefined) return;

    const current = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, current);

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

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (Math.abs(dx) + Math.abs(dy) > 0) {
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    if (Math.hypot(dx, dy) > 1) {
      // Accumulate: a slow careful drag is still a drag.
      dragged.current = dragged.current || Math.hypot(dx, dy) > 0;
    }
  }, [zoomAt]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchDistance.current = null;
  }, []);

  /**
   * Cells call this before acting on a click: if the pointer travelled, the
   * gesture was a pan and the click that follows it must be ignored.
   */
  const wasDrag = useCallback((): boolean => dragged.current, []);

  // Track total movement from pointerdown so wasDrag is meaningful.
  const downAt = useRef<PointerState | null>(null);
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

  const zoomButtons = {
    zoomIn: () => {
      const el = containerRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.3);
    },
    zoomOut: () => {
      const el = containerRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.3);
    },
    fit,
  };

  return {
    containerRef,
    view,
    wasDrag,
    zoomButtons,
    handlers: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerDownCapture,
      onPointerUpCapture,
    },
  };
}
