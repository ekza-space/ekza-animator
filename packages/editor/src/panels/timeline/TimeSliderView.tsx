// The time-slider canvas: owns a TimeSliderController, feeds it size and pointer input, redraws it after every R3F
// frame (same frame as the viewport during playback) and opens the RMB menu. No React state changes per frame:
// the ARIA value and the cursor are written to the DOM directly.
import { TimeSliderController } from '@ekza-animator/curve-editor';
import { type EditorApp, PANEL, type ToolPointerEvent } from '@ekza-animator/editor-core';
import { addAfterEffect } from '@react-three/fiber';
import { type JSX, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { attachTimeSlider, focusTimeSlider } from './host';
import { formatFrameValue } from './input';
import { activeClipRange, currentFrameOf, subscribeToFrame } from './state';
import { type MenuEntry, TimelineMenu } from './TimelineMenu';

interface OpenMenu {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuEntry[];
}

const CURSORS: Readonly<Record<string, string>> = {
  'band-start': 'ew-resize',
  'band-end': 'ew-resize',
  'band-middle': 'grab',
};

function toolEvent(app: EditorApp, e: ReactPointerEvent<HTMLCanvasElement>): ToolPointerEvent {
  const rect = e.currentTarget.getBoundingClientRect();
  const mac = app.keymap.platform === 'mac';
  return {
    panel: PANEL.timeline,
    paneId: null,
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    button: e.button,
    buttons: e.buttons,
    shift: e.shiftKey,
    alt: e.altKey,
    mod: mac ? e.metaKey : e.ctrlKey,
    ctrl: e.ctrlKey,
    pointerType: e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse',
    timeStamp: e.timeStamp,
    detail: e.detail,
  };
}

/** CSS size and device-pixel ratio of a canvas from a ResizeObserver entry (exact device pixels when reported). */
function measure(entry: ResizeObserverEntry): {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
} {
  const box = entry.contentBoxSize[0];
  const width = box?.inlineSize ?? entry.contentRect.width;
  const height = box?.blockSize ?? entry.contentRect.height;
  const device = entry.devicePixelContentBoxSize?.[0];
  const fallback = entry.target.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  const dpr = device !== undefined && width > 0 ? device.inlineSize / width : fallback;
  return { width, height, dpr };
}

export function TimeSliderView(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<TimeSliderController | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const slider = new TimeSliderController({ app, canvas });
    sliderRef.current = slider;
    const detach = attachTimeSlider(app, slider, canvas);

    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const { width, height, dpr } = measure(entry);
      slider.resize(width, height, dpr);
    });
    try {
      observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      observer.observe(canvas);
    }
    const removeAfterEffect = addAfterEffect(() => slider.redraw());

    const showValue = (): void => {
      const { frame } = currentFrameOf(app);
      const range = activeClipRange(app);
      canvas.setAttribute('aria-valuenow', String(frame));
      canvas.setAttribute('aria-valuetext', `Frame ${formatFrameValue(frame)}`);
      if (range !== null) {
        canvas.setAttribute('aria-valuemin', String(range.start));
        canvas.setAttribute('aria-valuemax', String(range.end));
      }
    };
    showValue();
    const unsubscribe = subscribeToFrame(app, showValue);

    return () => {
      unsubscribe();
      removeAfterEffect();
      observer.disconnect();
      detach();
      slider.dispose();
      sliderRef.current = null;
    };
  }, [app]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const slider = sliderRef.current;
    if (slider === null || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; the gesture still works inside the canvas.
    }
    focusTimeSlider(app, slider);
    const event = toolEvent(app, e);
    const hit = event.shift ? 'ruler' : slider.hitTest(event.x, event.y).kind;
    slider.pointerDown(event);
    e.currentTarget.style.cursor = hit === 'band-middle' ? 'grabbing' : (CURSORS[hit] ?? '');
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const slider = sliderRef.current;
    if (slider === null) return;
    const event = toolEvent(app, e);
    if (slider.dragging) {
      slider.pointerMove(event);
      return;
    }
    e.currentTarget.style.cursor = CURSORS[slider.hitTest(event.x, event.y).kind] ?? '';
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const slider = sliderRef.current;
    if (slider === null || !slider.dragging) return;
    slider.pointerUp(toolEvent(app, e));
    e.currentTarget.style.cursor = '';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onCancel = (): void => {
    sliderRef.current?.cancel();
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none outline-none focus-visible:ring-1 focus-visible:ring-accent"
        data-testid="timeline-canvas"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a range input cannot draw ticks, bands and playhead
        role="slider"
        tabIndex={0}
        aria-label="Time slider"
        aria-orientation="horizontal"
        aria-valuenow={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
        onContextMenu={(e) => {
          e.preventDefault();
          const slider = sliderRef.current;
          if (slider === null) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({
            x: e.clientX,
            y: e.clientY,
            items: slider.contextMenu(e.clientX - rect.left, e.clientY - rect.top),
          });
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          void app.run('time.step', { delta: e.key === 'ArrowLeft' ? -1 : 1 }, { panel: PANEL.timeline });
        }}
      />
      {menu === null ? null : <TimelineMenu app={app} x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  );
}
