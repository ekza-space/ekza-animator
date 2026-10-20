// The Paint Colour tool (`view.tool {tool: 'paint'}`, Mesh Tools › Paint Colour; M6A-SPEC §5.19, §4.7; B13): the eager
// definition. It declares `KeyI` (eyedropper, held) and `Enter` (apply the active swatch to the selected faces) in
// `ToolDef.keys` (§5.17), so it receives them first while active. The behaviour and the face picking live in a lazy
// chunk (`./tool`, `./pick`) loaded when the tool is first created; until it arrives a press does nothing. A failed
// load is toasted once and tried again on the next activation or press.
import type { EditorApp, ToolDef, ToolInstance } from '@ekza-animator/editor-core';
import { PANEL, VIEWPORT_TOOL } from '@ekza-animator/editor-core';
import type { ViewportToolHost } from '../../host';
import type { PaintView } from './pick';
import type * as PaintChunk from './tool';
import type { PaintTool } from './tool';

export type { PaintView } from './pick';

/** `KeyboardEvent.code`s the tool always receives first (§5.17). */
export const PAINT_TOOL_KEYS = ['KeyI', 'Enter', 'NumpadEnter'] as const;

export function paintToolDef(
  view: PaintView,
  opts?: { readonly importChunk?: () => Promise<typeof PaintChunk> },
): ToolDef<ViewportToolHost> {
  const importChunk = opts?.importChunk ?? (() => import('./tool'));
  return {
    id: VIEWPORT_TOOL.paint,
    panel: PANEL.viewport,
    label: 'Paint Colour',
    icon: 'tool-paint',
    workspaces: ['model'],
    keys: PAINT_TOOL_KEYS,
    create: (app: EditorApp): ToolInstance => {
      let impl: PaintTool | null = null;
      let active = true;
      let pending = false;
      let reported = false;
      const ensure = (): PaintTool | null => {
        if (impl !== null || pending) return impl;
        pending = true;
        importChunk().then(
          (chunk) => {
            pending = false;
            impl = chunk.createPaintTool(app, view);
            if (active) impl.activate();
          },
          (error: unknown) => {
            pending = false;
            if (reported) return;
            reported = true;
            app.services.notify.toast({
              kind: 'error',
              text: `The Paint Colour tool could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
            });
          },
        );
        return null;
      };
      ensure();
      return {
        activate: () => {
          active = true;
          reported = false;
          (impl ?? ensure())?.activate();
        },
        deactivate: () => {
          active = false;
          impl?.deactivate();
        },
        pointerDown: (e) => (impl ?? ensure())?.pointerDown(e) ?? false,
        pointerMove: (e) => impl?.pointerMove(e) ?? false,
        pointerUp: (e) => impl?.pointerUp(e) ?? false,
        key: (e) => impl?.key(e) ?? false,
        cancel: () => impl?.cancel(),
        cursor: () => impl?.cursor() ?? 'crosshair',
        phase: () => impl?.phase() ?? 'idle',
      };
    },
  };
}
