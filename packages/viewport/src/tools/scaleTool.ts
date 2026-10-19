// The viewport Scale tool (`R`; M6A-SPEC §3 rule 10, §4.7; B9): the eager definition. Its behaviour (scale handles on
// controls in Animate, on scene objects in Model's object mode; one history step "Scale") lives in the lazy scale
// chunk (`manipulators/scale/tool.ts`), loaded when the tool is first created; until then a press does nothing. A
// failed load says so (a toast) and is tried again on the next activation or press.
import type { ChannelEditGesture, EditorApp, ToolDef, ToolInstance } from '@ekza-animator/editor-core';
import { PANEL, VIEWPORT_TOOL } from '@ekza-animator/editor-core';
import { requestScaleKit, scaleKit } from '../manipulators/scale/load';
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
      let pending = false;
      // The behaviour once the chunk is there (built on first need, activated when asked), else null while the chunk
      // loads. A failed load is toasted once and tried again only on the user's next Scale action (activating the
      // tool, a press with it), never per frame.
      const ensure = (activateNew: boolean): ToolInstance | null => {
        if (impl !== null) return impl;
        const kit = scaleKit();
        if (kit !== null) {
          const built = kit.createScaleTool(app, host, gestureFactory);
          impl = built;
          if (activateNew) built.activate?.();
          return built;
        }
        if (!pending) {
          pending = true;
          void requestScaleKit(app.services.notify).then((loaded) => {
            pending = false;
            if (loaded !== null && impl === null) ensure(active);
          });
        }
        return null;
      };
      ensure(false); // the host activates a new instance next
      return {
        activate: () => {
          active = true;
          if (impl === null) ensure(true);
          else impl.activate?.();
        },
        deactivate: () => {
          active = false;
          impl?.deactivate?.();
        },
        pointerDown: (e) => (impl ?? ensure(active))?.pointerDown?.(e) ?? false,
        pointerMove: (e) => impl?.pointerMove?.(e) ?? false,
        pointerUp: (e) => impl?.pointerUp?.(e) ?? false,
        cancel: () => impl?.cancel?.(),
        cursor: () => impl?.cursor?.() ?? null,
      };
    },
  };
}
