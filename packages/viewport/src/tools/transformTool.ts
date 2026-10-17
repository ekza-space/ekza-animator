// The move (`W`) and rotate (`E`) tools (MVP-SPEC §4.11.16): an LMB press on a manipulator handle starts a drag whose
// channel edits go through `beginChannelEditGesture` (preview, overrides, auto-key on commit, exactly one history
// step; Esc cancels). A press anywhere else selects like the select tool.
import { EkzaError } from '@ekza-animator/anim-core';
import {
  beginChannelEditGesture,
  type ChannelEditGesture,
  type EditorApp,
  PANEL,
  type ToolDef,
  type ToolInstance,
  type ToolPointerEvent,
  VIEWPORT_TOOL,
} from '@ekza-animator/editor-core';
import type { DragSession } from '../manipulators/drag';
import type { ViewportToolHost } from './host';
import { SelectBehaviour } from './selectTool';

/** Creates the gesture for a drag; replaceable for extension tools, defaults to the editor-core helper. */
export type GestureFactory = (app: EditorApp, label: string) => ChannelEditGesture;

const defaultGesture: GestureFactory = (app, label) => beginChannelEditGesture(app, label, { key: 'auto' });

interface Drag {
  readonly session: DragSession;
  readonly gesture: ChannelEditGesture;
}

class TransformTool implements ToolInstance {
  private readonly select: SelectBehaviour;
  private drag: Drag | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly host: ViewportToolHost,
    private readonly label: string,
    private readonly gestureFactory: GestureFactory,
  ) {
    this.select = new SelectBehaviour(app, host);
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null) return false;
    const handle = this.host.pickManipulator(e.paneId, e.x, e.y);
    if (handle === null) return this.select.pointerDown(e);
    const session = this.host.beginManipulatorDrag(e.paneId, handle, e.x, e.y);
    if (session === null) return this.select.pointerDown(e);
    let gesture: ChannelEditGesture;
    try {
      gesture = this.gestureFactory(this.app, this.label);
    } catch (error) {
      this.app.services.notify.toast({ kind: 'error', text: gestureError(error) });
      return true;
    }
    this.drag = { session, gesture };
    this.host.setActiveHandle(handle);
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null) return this.select.pointerMove(e);
    if (!drag.gesture.active) {
      // The preview was cancelled elsewhere (Esc through edit.escape): end the drag.
      this.finish();
      return true;
    }
    drag.gesture.update(drag.session.update(e.x, e.y));
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null) return this.select.pointerUp(e);
    if (drag.gesture.active) {
      drag.gesture.update(drag.session.update(e.x, e.y));
      drag.gesture.commit();
    }
    this.finish();
    return true;
  }

  cancel(): void {
    const drag = this.drag;
    if (drag !== null && drag.gesture.active) drag.gesture.cancel();
    this.finish();
    this.select.cancel();
  }

  deactivate(): void {
    this.cancel();
  }

  cursor(): string | null {
    return this.drag === null ? null : 'grabbing';
  }

  private finish(): void {
    this.drag = null;
    this.host.setActiveHandle(null);
  }
}

function gestureError(error: unknown): string {
  if (error instanceof EkzaError && error.code === 'not-implemented') return 'Posing is not available yet.';
  if (error instanceof EkzaError && error.code === 'preview-active') return 'Another edit is in progress.';
  return error instanceof Error ? error.message : String(error);
}

export function moveToolDef(gestureFactory: GestureFactory = defaultGesture): ToolDef<ViewportToolHost> {
  return {
    id: VIEWPORT_TOOL.move,
    panel: PANEL.viewport,
    label: 'Move',
    icon: 'tool-move',
    create: (app: EditorApp, host: ViewportToolHost): ToolInstance =>
      new TransformTool(app, host, 'Move', gestureFactory),
  };
}

export function rotateToolDef(gestureFactory: GestureFactory = defaultGesture): ToolDef<ViewportToolHost> {
  return {
    id: VIEWPORT_TOOL.rotate,
    panel: PANEL.viewport,
    label: 'Rotate',
    icon: 'tool-rotate',
    create: (app: EditorApp, host: ViewportToolHost): ToolInstance =>
      new TransformTool(app, host, 'Rotate', gestureFactory),
  };
}
