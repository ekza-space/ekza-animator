// Graph Editor parts of the e2e test API (MVP-SPEC §4.8 `graph`, `screenOfKey`, `screenOfHandle`, `screenOfCurve`),
// in page CSS px, for the focused Graph Editor. The shell's test API (WP-8) delegates to these.
import type { RegionHandle } from '@ekza-studio/curve-editor';
import type { CurveId, KeyId } from '@ekza-studio/doc';
import type { EditorApp, GraphViewMode } from '@ekza-studio/editor-core';
import { focusedGraphEditor, type GraphEditorHandle } from './focus';

export interface GraphTestHooks {
  graph(): {
    visibleCurves: string[];
    view: { f0: number; v0: number; sx: number; sy: number };
    canvasRect: { x: number; y: number; w: number; h: number };
    /** M2a §5.15.2 (A4). */
    viewMode: GraphViewMode;
  } | null;
  screenOfKey(key: string): { x: number; y: number } | null;
  /** M2a §5.15.3 (A4): a grab point of the Scale tool's region box. */
  screenOfRegionHandle(handle: string): { x: number; y: number } | null;
  screenOfHandle(key: string, side: 'in' | 'out'): { x: number; y: number } | null;
  screenOfCurve(curve: string, frame: number): { x: number; y: number } | null;
}

const REGION_HANDLES: ReadonlySet<string> = new Set([
  'left',
  'right',
  'top',
  'bottom',
  'tl',
  'tr',
  'bl',
  'br',
  'inside',
]);

function toPage(
  handle: GraphEditorHandle,
  point: { readonly x: number; readonly y: number } | null,
): { x: number; y: number } | null {
  if (point === null) return null;
  const rect = handle.surface.getBoundingClientRect();
  return { x: rect.left + point.x, y: rect.top + point.y };
}

export function graphTestHooks(app: EditorApp): GraphTestHooks {
  const withEditor = <T>(fn: (handle: GraphEditorHandle) => T): T | null => {
    const handle = focusedGraphEditor(app);
    if (handle === null) return null;
    // Draw pending changes first, so what a test clicks is what is on screen.
    handle.controller.redraw();
    return fn(handle);
  };
  return {
    graph: () =>
      withEditor((handle) => {
        const rect = handle.surface.getBoundingClientRect();
        const { f0, v0, sx, sy } = handle.controller.view;
        return {
          visibleCurves: [...handle.controller.curves],
          view: { f0, v0, sx, sy },
          canvasRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
          viewMode: handle.controller.viewMode,
        };
      }),
    screenOfKey: (key) => withEditor((handle) => toPage(handle, handle.controller.keyPoint(key as KeyId))),
    screenOfHandle: (key, side) =>
      withEditor((handle) => toPage(handle, handle.controller.handlePoint(key as KeyId, side))),
    screenOfCurve: (curve, frame) =>
      withEditor((handle) => toPage(handle, handle.controller.curvePoint(curve as CurveId, frame))),
    screenOfRegionHandle: (region) =>
      withEditor((handle) =>
        REGION_HANDLES.has(region) ? toPage(handle, handle.controller.regionHandlePoint(region as RegionHandle)) : null,
      ),
  };
}
