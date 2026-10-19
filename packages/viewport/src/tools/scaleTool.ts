// The viewport Scale tool (`R`; M6A-SPEC §3 rule 10, §4.7; B9): the eager definition. Its behaviour (scale handles on
// controls in Animate, on scene objects in Model's object mode; one history step "Scale") lives in the lazy scale
// chunk (`manipulators/scale/tool.ts`), loaded when the tool is first created; until then a press does nothing.
import type { ChannelEditGesture, EditorApp, ToolDef, ToolInstance } from '@ekza-animator/editor-core';
import { PANEL, VIEWPORT_TOOL } from '@ekza-animator/editor-core';
import { loadScaleKit } from '../manipulators/scale/load';
import type { ViewportToolHost } from './host';

/** Creates the channel gesture for a control drag; replaceable for tests, defaults to the editor-core helper. */
export type ScaleGestureFactory = (app: EditorApp, label: string) => ChannelEditGesture;

/** The history label of a scale drag. */
export const SCALE_LABEL = 'Scale';

export function scaleToolDef(gestureFactory?: ScaleGestureFactory): ToolDef<ViewportToolHost> {
  return {
    id: VIEWPORT_TOOL.scale,
    panel: PANEL.viewport,
    label: 'Scale',
    icon: 'tool-scale',
    create: (app: EditorApp, host: ViewportToolHost): ToolInstance => {
      let impl: ToolInstance | null = null;
      let active = true;
      void loadScaleKit().then((kit) => {
        impl = kit.createScaleTool(app, host, gestureFactory);
        if (active) impl.activate?.();
      });
      return {
        activate: () => {
          active = true;
          impl?.activate?.();
        },
        deactivate: () => {
          active = false;
          impl?.deactivate?.();
        },
        pointerDown: (e) => impl?.pointerDown?.(e) ?? false,
        pointerMove: (e) => impl?.pointerMove?.(e) ?? false,
        pointerUp: (e) => impl?.pointerUp?.(e) ?? false,
        cancel: () => impl?.cancel?.(),
        cursor: () => impl?.cursor?.() ?? null,
      };
    },
  };
}
