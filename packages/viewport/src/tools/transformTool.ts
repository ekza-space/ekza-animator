// The move (`W`) and rotate (`E`) tools (MVP-SPEC §4.11.16): an LMB press on a manipulator handle starts a drag whose
// channel edits go through `beginChannelEditGesture` (preview, overrides, auto-key on commit, exactly one history
// step; Esc cancels). A drag on a handle whose channel is locked edits nothing and says so. A press anywhere
// else selects like the select tool.
//
// M6a (B12a, M6A-SPEC §5.15): one ToolDef per id branches on the workspace and the component mode inside. In Model the
// presses go to the transform runtime first (`./model/transform`: component and object transforms, Tweak, snapping,
// pivots, the soft-select radius), then select. The MMB rule works in both workspaces: with no Channel Box channel
// selected (the viewport starts that virtual slider itself) an MMB drag transforms the selection along the
// last-picked handle (`session.model.tweakHandle`, set by a LMB press on a handle, cleared on a tool switch), else in
// the view plane / about the view axis / uniformly — in Animate on the selected controls through the same channel-edit
// gesture. The tools take `X`, `V`, `J`, `D` and `B` first (`ToolDef.keys`; snapping, pivot editing, soft radius).
import { EkzaError } from '@ekza-studio/anim-core';
import {
  beginChannelEditGesture,
  type ChannelEditGesture,
  type EditorApp,
  type NumericTarget,
  PANEL,
  setTweakHandle,
  type ToolDef,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPhase,
  type ToolPointerEvent,
  VIEWPORT_TOOL,
} from '@ekza-studio/editor-core';
import type { DragSession } from '../manipulators/drag';
import type { AxisHandle, ManipMode } from '../manipulators/ManipulatorKit';
import type { ManipHandle } from '../types';
import type { ViewportToolHost } from './host';
import {
  type ModelTransformBehaviour,
  type ModelTransformRuntime,
  modelTransformOf,
  TRANSFORM_TOOL_KEYS,
  type TransformToolId,
} from './model/transform';
import { SelectBehaviour } from './selectTool';

/** Creates the gesture for a drag; replaceable for extension tools, defaults to the editor-core helper. */
export type GestureFactory = (app: EditorApp, label: string) => ChannelEditGesture;

const defaultGesture: GestureFactory = (app, label) => beginChannelEditGesture(app, label, { key: 'auto' });

/** Pointer travel (CSS px) before a press on a handle becomes a drag; a shorter press is a click and edits nothing. */
const DRAG_THRESHOLD_PX = 2;
/** The select runtime's double-click distance (`DOUBLE_CLICK_PX`, in the lazy Model chunk). */
const DOUBLE_CLICK_PX = 4;

/** Channel names for the locked-handle hint (the Channel Box labels). */
const CHANNEL_LABEL: Readonly<Record<AxisHandle, string>> = {
  tx: 'Translate X',
  ty: 'Translate Y',
  tz: 'Translate Z',
  rx: 'Rotate X',
  ry: 'Rotate Y',
  rz: 'Rotate Z',
};

/** The handles of each tool's manipulator (the MMB rule follows the last-picked one only within its tool). */
const TOOL_HANDLES: Readonly<Record<TransformToolId, readonly ManipHandle[]>> = {
  move: ['tx', 'ty', 'tz', 'txy', 'tyz', 'txz', 'tview'],
  rotate: ['rx', 'ry', 'rz', 'rview'],
  scale: ['sx', 'sy', 'sz', 'suniform'],
};
const MMB_DEFAULT: Readonly<Record<TransformToolId, ManipHandle>> = {
  move: 'tview',
  rotate: 'rview',
  scale: 'suniform',
};

/** The component modes the transform tools work in (§4.6 `ToolDef.modes`, metadata). */
const TRANSFORM_MODES = ['object', 'vertex', 'edge', 'face'] as const;

/** The handle an MMB drag of a tool follows (§5.15): the last-picked one of the tool, else its default. */
export function mmbHandleFor(tool: TransformToolId, last: ManipHandle | null): ManipHandle {
  return last !== null && TOOL_HANDLES[tool].includes(last) ? last : MMB_DEFAULT[tool];
}

/** The hint shown when a drag starts on a handle whose channel is locked. */
function lockedHandleHint(channel: AxisHandle): string {
  return `${CHANNEL_LABEL[channel]} is locked. Unlock it in the Channel Box to drag this handle.`;
}

/** A press on a locked axis handle: swallowed until release; the hint shows once the pointer really moves. */
interface LockedPress {
  readonly channel: AxisHandle;
  readonly startX: number;
  readonly startY: number;
  hinted: boolean;
}

interface Drag {
  readonly session: DragSession;
  readonly startX: number;
  readonly startY: number;
  /** Opened lazily on the first real movement, so a click on a handle leaves no preview and no history step. */
  gesture: ChannelEditGesture | null;
  moved: boolean;
  failed: boolean;
}

/**
 * The second press of a component double-click that lands on the manipulator the first click put there (§5.6 loop
 * table; double-click loop selection with Move/Rotate/Scale active). The press goes to the manipulator as usual;
 * released without moving it is given to selection instead (the loop), so a quick click-then-drag of a handle still
 * drags (acceptance fix round 1).
 */
class DoubleClickPress {
  private down: ToolPointerEvent | null = null;

  constructor(private readonly select: SelectBehaviour) {}

  begin(e: ToolPointerEvent): void {
    this.down = this.select.completesDouble(e) ? e : null;
  }

  move(e: ToolPointerEvent): void {
    const down = this.down;
    if (down !== null && Math.hypot(e.x - down.x, e.y - down.y) > DOUBLE_CLICK_PX) this.down = null;
  }

  /** On release: true when selection took the press (`cancelOwner` dropped the manipulator's press first). */
  end(e: ToolPointerEvent, cancelOwner: () => void): boolean {
    const down = this.down;
    this.down = null;
    if (down === null) return false;
    cancelOwner();
    this.select.pointerDown(down);
    this.select.pointerUp(e);
    return true;
  }

  reset(): void {
    this.down = null;
  }
}

/** Model's behaviour for a tool, rebuilt when the runtime changes. */
class ModelLink {
  private cached: { readonly runtime: ModelTransformRuntime; readonly behaviour: ModelTransformBehaviour } | null =
    null;

  constructor(
    private readonly app: EditorApp,
    private readonly host: ViewportToolHost,
    private readonly tool: TransformToolId,
    private readonly select: SelectBehaviour,
  ) {}

  /** The behaviour while the Model workspace is active and the runtime has loaded, else null. */
  get(): ModelTransformBehaviour | null {
    if (this.app.session.getState().workspace !== 'model') return null;
    const runtime = modelTransformOf(this.app);
    if (runtime === null) return null;
    if (this.cached?.runtime !== runtime) {
      this.cached = { runtime, behaviour: runtime.behaviour(this.tool, this.host, this.select) };
    }
    return this.cached.behaviour;
  }
}

/** The shipped control drags (LMB on a handle) and the MMB rule on controls (Animate). */
class ControlDrags {
  private drag: Drag | null = null;
  private locked: LockedPress | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly host: ViewportToolHost,
    private readonly label: string,
    private readonly gestureFactory: GestureFactory,
  ) {}

  get active(): boolean {
    return this.drag !== null || this.locked !== null;
  }

  /** A LMB press on a handle: a locked handle says why it never moves, otherwise a drag starts. */
  pressHandle(e: ToolPointerEvent, handle: ManipHandle): boolean {
    if (e.paneId === null) return false;
    const channel = this.host.lockedChannel(handle);
    if (channel !== null) {
      // The press stays the manipulator's (it neither selects nor starts a marquee) but opens no gesture: nothing
      // changes and no history step is recorded.
      this.locked = { channel, startX: e.x, startY: e.y, hinted: false };
      return true;
    }
    return this.start(e, handle);
  }

  /** Starts a drag on `handle` (a LMB handle press or the MMB rule's handle); false when nothing can be dragged. */
  start(e: ToolPointerEvent, handle: ManipHandle): boolean {
    if (e.paneId === null) return false;
    const session = this.host.beginManipulatorDrag(e.paneId, handle, e.x, e.y);
    if (session === null) return false;
    this.drag = { session, startX: e.x, startY: e.y, gesture: null, moved: false, failed: false };
    this.host.setActiveHandle(handle);
    return true;
  }

  move(e: ToolPointerEvent): void {
    const locked = this.locked;
    if (locked !== null) {
      if (!locked.hinted && Math.hypot(e.x - locked.startX, e.y - locked.startY) >= DRAG_THRESHOLD_PX) {
        locked.hinted = true;
        this.app.services.notify.toast({ kind: 'warning', text: lockedHandleHint(locked.channel) });
      }
      return;
    }
    const drag = this.drag;
    if (drag === null) return;
    if (!drag.moved && Math.hypot(e.x - drag.startX, e.y - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const gesture = this.gestureOf(drag);
    if (gesture === null) return;
    if (!gesture.active) {
      // The preview was cancelled elsewhere (Esc through edit.escape): end the drag.
      this.finish();
      return;
    }
    gesture.update(drag.session.update(e.x, e.y));
  }

  up(e: ToolPointerEvent): void {
    if (this.locked !== null) {
      this.locked = null;
      return;
    }
    const drag = this.drag;
    if (drag === null) return;
    const gesture = drag.gesture;
    if (gesture?.active === true) {
      gesture.update(drag.session.update(e.x, e.y));
      gesture.commit();
    }
    this.finish();
  }

  cancel(): void {
    this.locked = null;
    const gesture = this.drag?.gesture ?? null;
    if (gesture?.active === true) gesture.cancel();
    this.finish();
  }

  get dragging(): boolean {
    return this.drag?.moved === true;
  }

  private gestureOf(drag: Drag): ChannelEditGesture | null {
    if (drag.gesture !== null || drag.failed) return drag.gesture;
    try {
      drag.gesture = this.gestureFactory(this.app, this.label);
    } catch (error) {
      drag.failed = true;
      this.app.services.notify.toast({ kind: 'error', text: gestureError(error) });
    }
    return drag.gesture;
  }

  private finish(): void {
    this.drag = null;
    this.host.setActiveHandle(null);
  }
}

class TransformTool implements ToolInstance {
  private readonly select: SelectBehaviour;
  private readonly model: ModelLink;
  private readonly controls: ControlDrags;
  /** Who owns the current press: the Model runtime, the control drags or the select behaviour. */
  private owner: 'model' | 'controls' | 'select' | null = null;
  private readonly double: DoubleClickPress;

  constructor(
    private readonly app: EditorApp,
    private readonly host: ViewportToolHost,
    private readonly tool: TransformToolId,
    label: string,
    gestureFactory: GestureFactory,
  ) {
    this.select = new SelectBehaviour(app, host);
    this.double = new DoubleClickPress(this.select);
    this.model = new ModelLink(app, host, tool, this.select);
    this.controls = new ControlDrags(app, host, label, gestureFactory);
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.paneId === null) return false;
    this.double.begin(e);
    if (this.model.get()?.pointerDown(e) === true) {
      this.owner = 'model';
      return true;
    }
    if (e.button === 1) {
      // The MMB rule on controls (Animate; Model only where a pane draws them, M6A-B9-21).
      const handle = mmbHandleFor(this.tool, this.app.session.getState().model.tweakHandle);
      if (!this.controls.start(e, handle)) return false;
      this.owner = 'controls';
      return true;
    }
    if (e.button !== 0) return false;
    const handle = this.host.pickManipulator(e.paneId, e.x, e.y);
    if (handle !== null && this.controls.pressHandle(e, handle)) {
      setTweakHandle(this.app, handle);
      this.owner = 'controls';
      return true;
    }
    const selected = this.select.pointerDown(e);
    if (selected) this.owner = 'select';
    return selected;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    this.double.move(e);
    if (this.owner === 'model') return this.model.get()?.pointerMove(e) ?? true;
    if (this.owner === 'controls') {
      this.controls.move(e);
      return true;
    }
    return this.select.pointerMove(e);
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const owner = this.owner;
    this.owner = null;
    if (owner === 'model' || owner === 'controls') {
      const cancelOwner = (): void => {
        if (owner === 'model') this.model.get()?.cancel();
        else this.controls.cancel();
      };
      if (this.double.end(e, cancelOwner)) return true;
    }
    this.double.reset();
    if (owner === 'model') return this.model.get()?.pointerUp(e) ?? true;
    if (owner === 'controls') {
      this.controls.up(e);
      return true;
    }
    return this.select.pointerUp(e);
  }

  cancel(): void {
    this.double.reset();
    this.owner = null;
    this.model.get()?.cancel();
    this.controls.cancel();
    this.select.cancel();
  }

  activate(): void {
    // A tool switch forgets the last-picked handle (§5.15).
    setTweakHandle(this.app, null);
  }

  deactivate(): void {
    this.cancel();
  }

  key(e: ToolKeyEvent): boolean {
    return this.model.get()?.key(e) ?? false;
  }

  phase(): ToolPhase {
    const model = this.model.get()?.phase() ?? 'idle';
    if (model !== 'idle') return model;
    return this.controls.dragging ? 'dragging' : 'idle';
  }

  numeric(): NumericTarget | null {
    return this.model.get()?.numeric() ?? null;
  }

  cursor(): string | null {
    return this.controls.active || this.model.get()?.phase() === 'dragging' ? 'grabbing' : null;
  }
}

/**
 * Wraps another tool instance of a transform tool id (the Scale tool's, B9) so Model's transform runtime and the MMB
 * rule on controls get its presses first; everything else reaches `inner`.
 */
export function withModelTransform(
  app: EditorApp,
  host: ViewportToolHost,
  tool: TransformToolId,
  inner: ToolInstance,
  gestureFactory: GestureFactory = defaultGesture,
): ToolInstance {
  const select = new SelectBehaviour(app, host);
  const model = new ModelLink(app, host, tool, select);
  const controls = new ControlDrags(
    app,
    host,
    tool === 'scale' ? 'Scale' : tool === 'rotate' ? 'Rotate' : 'Move',
    gestureFactory,
  );
  let owner: 'model' | 'controls' | 'inner' | null = null;
  const double = new DoubleClickPress(select);
  return {
    activate: () => {
      setTweakHandle(app, null);
      inner.activate?.();
    },
    deactivate: () => {
      model.get()?.cancel();
      controls.cancel();
      owner = null;
      inner.deactivate?.();
    },
    pointerDown: (e) => {
      double.begin(e);
      if (model.get()?.pointerDown(e) === true) {
        owner = 'model';
        return true;
      }
      if (e.button === 1) {
        if (!controls.start(e, mmbHandleFor(tool, app.session.getState().model.tweakHandle))) return false;
        owner = 'controls';
        return true;
      }
      if (e.button === 0 && e.paneId !== null) {
        const handle = host.pickManipulator(e.paneId, e.x, e.y);
        if (handle !== null) setTweakHandle(app, handle);
      }
      const handled = inner.pointerDown?.(e) ?? false;
      if (handled) owner = 'inner';
      return handled;
    },
    pointerMove: (e) => {
      double.move(e);
      if (owner === 'model') return model.get()?.pointerMove(e) ?? true;
      if (owner === 'controls') {
        controls.move(e);
        return true;
      }
      return inner.pointerMove?.(e) ?? false;
    },
    pointerUp: (e) => {
      const was = owner;
      owner = null;
      if (was === 'model' || was === 'controls') {
        const cancelOwner = (): void => {
          if (was === 'model') model.get()?.cancel();
          else controls.cancel();
        };
        if (double.end(e, cancelOwner)) return true;
      }
      double.reset();
      if (was === 'model') return model.get()?.pointerUp(e) ?? true;
      if (was === 'controls') {
        controls.up(e);
        return true;
      }
      return inner.pointerUp?.(e) ?? false;
    },
    cancel: () => {
      owner = null;
      double.reset();
      model.get()?.cancel();
      controls.cancel();
      select.cancel();
      inner.cancel?.();
    },
    key: (e) => model.get()?.key(e) ?? inner.key?.(e) ?? false,
    phase: () => {
      const phase = model.get()?.phase() ?? 'idle';
      if (phase !== 'idle') return phase;
      return controls.dragging ? 'dragging' : (inner.phase?.() ?? 'idle');
    },
    numeric: () => model.get()?.numeric() ?? inner.numeric?.() ?? null,
    cursor: () => (controls.active || model.get()?.phase() === 'dragging' ? 'grabbing' : (inner.cursor?.() ?? null)),
  };
}

function gestureError(error: unknown): string {
  if (error instanceof EkzaError && error.code === 'not-implemented') return 'Posing is not available yet.';
  if (error instanceof EkzaError && error.code === 'preview-active') return 'Another edit is in progress.';
  return error instanceof Error ? error.message : String(error);
}

function transformToolDef(
  tool: 'move' | 'rotate',
  label: string,
  icon: string,
  gestureFactory: GestureFactory,
): ToolDef<ViewportToolHost> {
  return {
    id: tool === 'move' ? VIEWPORT_TOOL.move : VIEWPORT_TOOL.rotate,
    panel: PANEL.viewport,
    label,
    icon,
    modes: TRANSFORM_MODES,
    keys: TRANSFORM_TOOL_KEYS,
    create: (app: EditorApp, host: ViewportToolHost): ToolInstance =>
      new TransformTool(app, host, tool, label, gestureFactory),
  };
}

export function moveToolDef(gestureFactory: GestureFactory = defaultGesture): ToolDef<ViewportToolHost> {
  return transformToolDef('move', 'Move', 'tool-move', gestureFactory);
}

export function rotateToolDef(gestureFactory: GestureFactory = defaultGesture): ToolDef<ViewportToolHost> {
  return transformToolDef('rotate', 'Rotate', 'tool-rotate', gestureFactory);
}

/** The manipulator mode of a transform tool. */
export function manipModeOf(tool: TransformToolId): ManipMode {
  return tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : 'scale';
}
