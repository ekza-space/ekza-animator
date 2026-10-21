// The Scale tool's behaviour (`R`; M6A-SPEC §3 rule 10, §4.7; B9), in the lazy scale chunk. In Animate (and wherever
// controls are selected) an LMB drag on a scale handle edits the selected controls' `sx/sy/sz` channels through
// `beginChannelEditGesture` (preview, auto-key on commit, one history step "Scale", Esc cancels), like the move and
// rotate tools. In Model's object mode it scales the selected meshes and groups about their pivots in one document
// gesture (one step "Scale"). A press that misses the manipulator selects like the select tool. Component scaling is
// B12a's (the same tool id branches on the component mode, §4.6).
import { EkzaError } from '@ekza-studio/anim-core';
import type { ReadonlyXf } from '@ekza-studio/anim-core';
import {
  beginChannelEditGesture,
  beginKeyEditGesture,
  type ChannelEditGesture,
  type EditorApp,
  type KeyEditGesture,
  type ToolInstance,
  type ToolPointerEvent,
} from '@ekza-studio/editor-core';
import { objectTable, sceneObject } from '../../manager/objects';
import type { ViewportToolHost } from '../../tools/host';
import { SCALE_LABEL, type ScaleGestureFactory } from '../../tools/scaleTool';
import { SelectBehaviour } from '../../tools/selectTool';
import type { DragSession } from '../drag';
import type { ObjectScaleSession } from './math';

const defaultGesture: ScaleGestureFactory = (app, label) => beginChannelEditGesture(app, label, { key: 'auto' });

/** Pointer travel (CSS px) before a press on a handle becomes a drag; a shorter press is a click and edits nothing. */
const DRAG_THRESHOLD_PX = 2;

interface Drag {
  readonly startX: number;
  readonly startY: number;
  moved: boolean;
  failed: boolean;
  readonly controls: DragSession | null;
  readonly objects: ObjectScaleSession | null;
  /** Opened lazily on the first real movement, so a click on a handle leaves no preview and no history step. */
  channel: ChannelEditGesture | null;
  document: KeyEditGesture | null;
  /** The last placements of an object drag (committed on release). */
  placements: readonly ReadonlyXf[] | null;
}

class ScaleTool implements ToolInstance {
  private readonly select: SelectBehaviour;
  private drag: Drag | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly host: ViewportToolHost,
    private readonly gestureFactory: ScaleGestureFactory,
  ) {
    this.select = new SelectBehaviour(app, host);
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null) return false;
    const handle = this.host.pickManipulator(e.paneId, e.x, e.y);
    if (handle === null) return this.select.pointerDown(e);
    const controls = this.host.beginManipulatorDrag(e.paneId, handle, e.x, e.y);
    const objects = controls === null ? (this.host.beginObjectDrag?.(e.paneId, handle, e.x, e.y) ?? null) : null;
    if (controls === null && objects === null) return this.select.pointerDown(e);
    this.drag = {
      startX: e.x,
      startY: e.y,
      moved: false,
      failed: false,
      controls,
      objects,
      channel: null,
      document: null,
      placements: null,
    };
    this.host.setActiveHandle(handle);
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null) return this.select.pointerMove(e);
    if (!drag.moved && Math.hypot(e.x - drag.startX, e.y - drag.startY) < DRAG_THRESHOLD_PX) return true;
    drag.moved = true;
    this.apply(drag, e.x, e.y);
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null) return this.select.pointerUp(e);
    if (drag.moved) this.apply(drag, e.x, e.y);
    if (drag.channel?.active === true) drag.channel.commit();
    const placements = drag.placements;
    if (drag.document?.active === true && drag.objects !== null && placements !== null) {
      const ids = drag.objects.ids;
      drag.document.commit((tx) => this.writePlacements(tx, ids, placements), { label: SCALE_LABEL });
    }
    this.finish();
    return true;
  }

  cancel(): void {
    const drag = this.drag;
    if (drag?.channel?.active === true) drag.channel.cancel();
    if (drag?.document?.active === true) drag.document.cancel();
    this.finish();
    this.select.cancel();
  }

  deactivate(): void {
    this.cancel();
  }

  cursor(): string | null {
    return this.drag === null ? null : 'grabbing';
  }

  private apply(drag: Drag, x: number, y: number): void {
    if (drag.controls !== null) {
      const gesture = this.channelGesture(drag);
      if (gesture === null) return;
      if (!gesture.active) {
        this.finish(); // cancelled elsewhere (Esc through edit.escape)
        return;
      }
      gesture.update(drag.controls.update(x, y));
      return;
    }
    const objects = drag.objects;
    if (objects === null) return;
    const placements = objects.update(x, y);
    if (placements === null) return;
    const gesture = this.documentGesture(drag);
    if (gesture === null) return;
    if (!gesture.active) {
      this.finish();
      return;
    }
    drag.placements = placements;
    gesture.update((tx) => this.writePlacements(tx, objects.ids, placements));
  }

  private writePlacements(
    tx: Parameters<Parameters<KeyEditGesture['update']>[0]>[0],
    ids: readonly string[],
    placements: readonly ReadonlyXf[],
  ): void {
    ids.forEach((id, i) => {
      const placement = placements[i];
      const record = sceneObject(this.app, id);
      if (placement === undefined || record === null) return;
      tx.patch(objectTable(record), record.id, { placement });
    });
  }

  private channelGesture(drag: Drag): ChannelEditGesture | null {
    if (drag.channel !== null || drag.failed) return drag.channel;
    try {
      drag.channel = this.gestureFactory(this.app, SCALE_LABEL);
    } catch (error) {
      drag.failed = true;
      this.app.services.notify.toast({ kind: 'error', text: gestureError(error) });
    }
    return drag.channel;
  }

  private documentGesture(drag: Drag): KeyEditGesture | null {
    if (drag.document !== null || drag.failed) return drag.document;
    try {
      drag.document = beginKeyEditGesture(this.app, SCALE_LABEL);
    } catch (error) {
      drag.failed = true;
      this.app.services.notify.toast({ kind: 'error', text: gestureError(error) });
    }
    return drag.document;
  }

  private finish(): void {
    this.drag = null;
    this.host.setActiveHandle(null);
  }
}

function gestureError(error: unknown): string {
  if (error instanceof EkzaError && error.code === 'not-implemented') return 'Scaling is not available yet.';
  if (error instanceof EkzaError && error.code === 'preview-active') return 'Another edit is in progress.';
  if (error instanceof EkzaError && error.code === 'read-only') return 'This project is read-only.';
  return error instanceof Error ? error.message : String(error);
}

/** The Scale tool's instance (the eager `scaleToolDef` forwards to it once this chunk has loaded). */
export function createScaleTool(
  app: EditorApp,
  host: ViewportToolHost,
  gestureFactory: ScaleGestureFactory = defaultGesture,
): ToolInstance {
  return new ScaleTool(app, host, gestureFactory);
}
