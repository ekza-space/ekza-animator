// The curve view of the Graph Editor panel: two stacked canvases (ADR 0007 §2) driven by a GraphEditorController.
// DOM pointer, wheel and key events become editor-core tool events here; hi-DPI backing stores follow a
// ResizeObserver (devicePixelContentBoxSize, with contentRect × devicePixelRatio as the fallback).
import { GraphEditorController } from '@ekza-animator/curve-editor';
import type { CurveId } from '@ekza-animator/doc';
import { type EditorApp, PANEL, type ToolPointerEvent } from '@ekza-animator/editor-core';
import { type JSX, memo, useEffect, useRef, useState } from 'react';
import { attachGraphEditor, focusGraphEditor, type GraphEditorHandle } from './focus';

/** Two presses within this time and distance count as a double-click (ToolPointerEvent.detail). */
const MULTI_CLICK_MS = 400;
const MULTI_CLICK_PX = 4;
const LINE_HEIGHT_PX = 16;

interface ClickTracker {
  time: number;
  x: number;
  y: number;
  button: number;
  count: number;
}

export interface GraphCanvasProps {
  readonly app: EditorApp;
  readonly curves: readonly CurveId[];
  readonly onController?: (controller: GraphEditorController | null) => void;
}

export const GraphCanvas = memo(function GraphCanvas({ app, curves, onController }: GraphCanvasProps): JSX.Element {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<GraphEditorController | null>(null);

  useEffect(() => {
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (base === null || overlay === null) return undefined;
    const editor = new GraphEditorController({ app, base, overlay });
    const handle: GraphEditorHandle = { controller: editor, surface: overlay };
    const detach = attachGraphEditor(app, handle);
    const cleanup = bindInput(app, editor, handle, overlay);
    setController(editor);
    return () => {
      cleanup();
      detach();
      editor.dispose();
      setController(null);
    };
  }, [app]);

  useEffect(() => {
    onController?.(controller);
  }, [controller, onController]);

  useEffect(() => {
    controller?.setCurves(curves);
  }, [controller, curves]);

  return (
    <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden" data-testid="ge-view">
      <canvas ref={baseRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />
      <canvas
        ref={overlayRef}
        className="absolute inset-0 block h-full w-full touch-none select-none"
        data-testid="ge-canvas"
        aria-label="Graph Editor curves"
      />
    </div>
  );
});

/** Wires DOM input on `surface` to the controller; returns the cleanup. */
function bindInput(
  app: EditorApp,
  editor: GraphEditorController,
  handle: GraphEditorHandle,
  surface: HTMLCanvasElement,
): () => void {
  const clicks: ClickTracker = { time: Number.NEGATIVE_INFINITY, x: 0, y: 0, button: -1, count: 0 };
  let hovered = false;
  const mac = app.keymap.platform === 'mac';

  const toTool = (e: PointerEvent, detail: number): ToolPointerEvent => {
    const rect = surface.getBoundingClientRect();
    return {
      panel: PANEL.graph,
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
      detail,
    };
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 1 || e.button === 2) e.preventDefault(); // no autoscroll / paste / context menu
    const near = Math.hypot(e.clientX - clicks.x, e.clientY - clicks.y) <= MULTI_CLICK_PX;
    const count =
      e.button === clicks.button && near && e.timeStamp - clicks.time <= MULTI_CLICK_MS ? clicks.count + 1 : 1;
    Object.assign(clicks, { time: e.timeStamp, x: e.clientX, y: e.clientY, button: e.button, count });
    focusGraphEditor(app, handle);
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already released pointer cannot be captured; the drag still works inside the canvas.
    }
    editor.pointerDown(toTool(e, count));
    surface.style.cursor = editor.cursor();
  };
  const onPointerMove = (e: PointerEvent): void => {
    editor.pointerMove(toTool(e, 0));
    surface.style.cursor = editor.cursor();
  };
  const onPointerUp = (e: PointerEvent): void => {
    editor.pointerUp(toTool(e, clicks.count));
    if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
    surface.style.cursor = editor.cursor();
  };
  const onPointerCancel = (): void => editor.cancel();
  const onPointerEnter = (): void => {
    hovered = true;
    focusGraphEditor(app, handle);
  };
  const onPointerLeave = (): void => {
    hovered = false;
    editor.pointerLeave();
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // page zoom on pinch, page scroll on wheel
    const rect = surface.getBoundingClientRect();
    const scale = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? rect.height : 1;
    editor.wheel({
      panel: PANEL.graph,
      paneId: null,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      deltaX: e.deltaX * scale,
      deltaY: e.deltaY * scale,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: mac ? e.metaKey : e.ctrlKey,
      ctrl: e.ctrlKey,
    });
  };
  const suppress = (e: Event): void => e.preventDefault();
  // Esc and modifier changes reach a drag before the shell's keymap does (capture on window).
  const onKey = (e: KeyboardEvent): void => {
    if (!hovered && !editor.busy) return;
    const consumed = editor.key({
      type: e.type === 'keyup' ? 'up' : 'down',
      code: e.code,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: mac ? e.metaKey : e.ctrlKey,
      ctrl: e.ctrlKey,
      repeat: e.repeat,
    });
    if (consumed) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onBlur = (): void => editor.cancel();

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry === undefined) return;
    const width = entry.contentRect.width;
    const height = entry.contentRect.height;
    const device = entry.devicePixelContentBoxSize?.[0];
    const dpr = device !== undefined && width > 0 ? device.inlineSize / width : window.devicePixelRatio || 1;
    editor.resize(width, height, dpr);
    editor.redraw();
  });
  try {
    observer.observe(surface, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(surface); // Safari: no device-pixel-content-box
  }

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  surface.addEventListener('pointerenter', onPointerEnter);
  surface.addEventListener('pointerleave', onPointerLeave);
  surface.addEventListener('wheel', onWheel, { passive: false });
  surface.addEventListener('contextmenu', suppress);
  surface.addEventListener('auxclick', suppress);
  window.addEventListener('keydown', onKey, { capture: true });
  window.addEventListener('keyup', onKey, { capture: true });
  window.addEventListener('blur', onBlur);
  return () => {
    observer.disconnect();
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', onPointerUp);
    surface.removeEventListener('pointercancel', onPointerCancel);
    surface.removeEventListener('pointerenter', onPointerEnter);
    surface.removeEventListener('pointerleave', onPointerLeave);
    surface.removeEventListener('wheel', onWheel);
    surface.removeEventListener('contextmenu', suppress);
    surface.removeEventListener('auxclick', suppress);
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('keyup', onKey, { capture: true });
    window.removeEventListener('blur', onBlur);
  };
}
