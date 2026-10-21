// The Paint Skin Weights tool (`paintSkinWeights`, Skin mode's default tool; M6B-SPEC §5.11; C6; lazy with the skin
// runtime):
// - LMB drag paints the active influence with the session brush (Replace / Add / Scale / Smooth, value, opacity,
//   radius in CSS px converted at the hit depth, falloff, Surface or Volume reach, front faces only, the X-mirror
//   stroke): a stamp every 0.25 r of pointer travel on the mesh the stroke started on, previewed live through the
//   kernel's `beginStroke` (partial weight uploads, no document write, no recompile) and committed on release as ONE
//   `skin.weights.paint {mesh, joint, op, value, stamps, mirror, holds}` step — the same stamps, so the commit equals
//   the preview bit for bit (P-S2). `Esc` (or a lost pointer) cancels the stroke with no step.
// - Held keys (§7): `B`+drag radius, `M`+drag opacity, `N`+drag value (horizontal travel); `I`+click samples the active
//   influence's weight into Value; `Shift+I`+click makes the point's dominant joint the active influence.
// - `E` (`skin.testRotate.toggle`) shows the test-rotate ring on the active influence's joint: dragging the ring writes
//   a test pose of the joint's control (never a key, never the document; C7's test-pose gesture) while the tool stays
//   the brush; LMB elsewhere keeps painting; `E` again or `Esc` hides it.
// - `Alt+C` toggles the weight display (off ↔ greyscale) of every pane.
// Posed painting: the hit and the stamps use the CPU-skinned points of the shown pose; weights are bind-pose data.
import type { ControlId, MeshId } from '@ekza-studio/doc';
import {
  beginChannelEditGesture,
  type ChannelEditGesture,
  type EditorApp,
  heldKeysOf,
  meshKernel,
  PANEL,
  setBrush,
  setSkinTestRotate,
  skinPaintRefusal,
  skinTestRotate,
  stampArgs,
  type ToolDef,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPointerEvent,
  type WeightInputs,
  weightContext,
  weightInputsNow,
} from '@ekza-studio/editor-core';
import type { SkinWeights, StrokeSession, StrokeStamp } from '@ekza-studio/mesh-core';
import type { ViewportToolHost } from '../../host';
import { metresPerPx, nearestCorner, ROTATE_RING_PX, type SurfaceHit, stampAt } from './pick';
import type { RigSkinRuntime } from './runtime';

/** Keys the tool receives first (§5.17): the brush holds, `Esc` for the test-rotate ring, `Alt+C`. */
export const PAINT_SKIN_TOOL_KEYS = ['KeyB', 'KeyM', 'KeyN', 'KeyI', 'KeyC', 'Escape'] as const;

/** The test-rotate ring's radius (CSS px) and the press band around it. */
const ROTATE_BAND_PX = 12;

interface Stroke {
  readonly paneId: string;
  readonly mesh: MeshId;
  readonly joint: string;
  readonly inputs: WeightInputs;
  readonly session: StrokeSession;
  readonly stamps: StrokeStamp[];
  readonly holds: readonly string[];
  readonly op: 'replace' | 'add' | 'scale' | 'smooth';
  readonly value: number;
  readonly mirror: boolean;
  readonly changed: Set<number>;
  lastX: number;
  lastY: number;
  travel: number;
}

interface Adjust {
  readonly field: 'radiusPx' | 'opacity' | 'value';
  readonly startX: number;
  readonly start: number;
}

interface Rotate {
  readonly gesture: ChannelEditGesture;
  readonly control: ControlId;
  readonly channel: 'rx' | 'ry' | 'rz';
  readonly sign: number;
  readonly start: number;
  readonly centre: { readonly x: number; readonly y: number };
  readonly angle0: number;
}

const HOLD_FIELD: Readonly<Record<string, Adjust['field']>> = { KeyB: 'radiusPx', KeyM: 'opacity', KeyN: 'value' };

export class PaintSkinTool implements ToolInstance {
  private stroke: Stroke | null = null;
  private adjust: Adjust | null = null;
  private rotate: Rotate | null = null;
  private readonly held = new Set<string>();

  constructor(
    private readonly app: EditorApp,
    private readonly runtime: RigSkinRuntime,
  ) {}

  activate(): void {
    this.held.clear();
  }

  deactivate(): void {
    this.cancel();
    this.held.clear();
    this.runtime.ring.hide();
  }

  cursor(): string | null {
    return this.held.has('KeyI') ? 'copy' : 'crosshair';
  }

  phase(): 'idle' | 'dragging' {
    return this.stroke !== null || this.adjust !== null || this.rotate !== null ? 'dragging' : 'idle';
  }

  key(e: ToolKeyEvent): boolean {
    if (e.code === 'KeyC') {
      if (e.type === 'down' && e.alt && !e.mod && !e.repeat) {
        this.runtime.toggleWeights();
        return true;
      }
      return false;
    }
    if (e.code === 'Escape') {
      if (e.type === 'down' && this.stroke === null && skinTestRotate(this.app)) {
        setSkinTestRotate(this.app, false);
        this.runtime.vm.invalidate();
        return true;
      }
      return false;
    }
    // A hold the tool observes (§5.17 adapter step 2): false, so the keymap still resolves the key.
    if (e.type === 'up') this.held.delete(e.code);
    else if (!e.mod && !e.alt && !e.ctrl) this.held.add(e.code);
    return false;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null || e.alt) return false;
    const brush = this.app.session.getState().rig.paint.brush;
    const field = [...this.held].map((code) => HOLD_FIELD[code]).find((f) => f !== undefined);
    if (field !== undefined) {
      this.adjust = { field, startX: e.x, start: brush[field] };
      return true;
    }
    if (skinTestRotate(this.app) && this.beginRotate(e)) return true;
    const hit = this.runtime.hitAt(e.paneId, e.x, e.y);
    if (hit === null) return false;
    const mesh = hit.surface.mesh as MeshId;
    if (this.held.has('KeyI')) {
      const point = nearestCorner(hit, this.runtime.worldOf(hit.surface));
      void this.run(e.shift ? 'skin.influence.pickDominant' : 'skin.paint.sample', { mesh, point });
      return true;
    }
    this.beginStroke(e, hit);
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    if (this.adjust !== null) {
      const dx = e.x - this.adjust.startX;
      const { field, start } = this.adjust;
      const op = this.app.session.getState().rig.paint.brush.op;
      const next =
        field === 'radiusPx'
          ? Math.max(1, Math.round(start + dx))
          : Math.min(1, Math.max(field === 'value' && op === 'add' ? -1 : 0, start + dx / 200));
      setBrush(this.app, { [field]: next });
      return true;
    }
    if (this.rotate !== null) {
      const angle = Math.atan2(e.y - this.rotate.centre.y, e.x - this.rotate.centre.x);
      let delta = angle - this.rotate.angle0;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      this.rotate.gesture.update([
        {
          control: this.rotate.control,
          channel: this.rotate.channel,
          value: this.rotate.start + this.rotate.sign * delta,
        },
      ]);
      return true;
    }
    const stroke = this.stroke;
    if (stroke === null || e.paneId !== stroke.paneId) return false;
    stroke.travel += Math.hypot(e.x - stroke.lastX, e.y - stroke.lastY);
    stroke.lastX = e.x;
    stroke.lastY = e.y;
    const spacing = 0.25 * this.app.session.getState().rig.paint.brush.radiusPx;
    const hit = this.runtime.showRing(e.paneId, e.x, e.y, e.alt);
    if (stroke.travel >= spacing && hit !== null && hit.surface.mesh === stroke.mesh) {
      stroke.travel = 0;
      this.addStamp(stroke, hit);
    }
    return true;
  }

  pointerUp(_e: ToolPointerEvent): boolean {
    if (this.adjust !== null) {
      this.adjust = null;
      return true;
    }
    if (this.rotate !== null) {
      this.rotate.gesture.commit();
      this.rotate = null;
      return true;
    }
    const stroke = this.stroke;
    if (stroke === null) return false;
    this.stroke = null;
    this.runtime.stroking = false;
    if (stroke.stamps.length === 0 || stroke.changed.size === 0) {
      this.revert(stroke);
      return true;
    }
    void this.app
      .runUntyped(
        'skin.weights.paint',
        {
          mesh: stroke.mesh,
          joint: stroke.joint,
          op: stroke.op,
          value: stroke.value,
          stamps: stampArgs(stroke.stamps),
          mirror: stroke.mirror,
          holds: [...stroke.holds],
        },
        { panel: PANEL.viewport, paneId: stroke.paneId, source: 'tool' },
      )
      .then((result) => {
        if (result.status === 'finished') return;
        this.revert(stroke);
        this.toast(result.status === 'cancelled' ? result.reason : result.error.message);
      });
    return true;
  }

  cancel(): void {
    this.adjust = null;
    if (this.rotate !== null) {
      this.rotate.gesture.cancel();
      this.rotate = null;
    }
    const stroke = this.stroke;
    this.stroke = null;
    this.runtime.stroking = false;
    if (stroke !== null) this.revert(stroke);
  }

  // ---------- strokes ----------

  private beginStroke(e: ToolPointerEvent, hit: SurfaceHit): void {
    const state = this.app.session.getState();
    const joint = state.rig.activeInfluence?.joint ?? null;
    const character = this.runtime.character();
    if (joint === null) {
      this.toast('Pick an influence first (Paint Weights panel)');
      return;
    }
    const refusal = skinPaintRefusal(this.app, character, joint);
    if (refusal !== null) {
      this.toast(refusal);
      return;
    }
    const mesh = hit.surface.mesh as MeshId;
    const inputs = weightInputsNow(this.app, mesh);
    const kernel = meshKernel();
    if (inputs === null || kernel === null || e.paneId === null) return;
    const brush = state.rig.paint.brush;
    const holds = heldKeysOf(this.app, character);
    const session = kernel.beginStroke(inputs.skin, weightContext(inputs, holds), {
      joint,
      op: brush.op,
      value: brush.value,
      mirror: brush.mirror,
    });
    const stroke: Stroke = {
      paneId: e.paneId,
      mesh,
      joint,
      inputs,
      session,
      stamps: [],
      holds,
      op: brush.op,
      value: brush.value,
      mirror: brush.mirror,
      changed: new Set(),
      lastX: e.x,
      lastY: e.y,
      travel: 0,
    };
    this.stroke = stroke;
    this.runtime.stroking = true;
    this.addStamp(stroke, hit);
  }

  private addStamp(stroke: Stroke, hit: SurfaceHit): void {
    const rect = this.runtime.vm.paneRect(stroke.paneId);
    if (rect === null) return;
    const camera = this.runtime.vm.camera(stroke.paneId);
    const brush = this.app.session.getState().rig.paint.brush;
    const radius = brush.radiusPx * metresPerPx(camera, rect.h, hit.point);
    const stamp = stampAt(hit, radius, brush, camera, this.runtime.worldOf(hit.surface));
    if (stamp.points.length === 0) return;
    stroke.stamps.push(stamp);
    const changed = stroke.session.addStamp(stamp);
    for (const v of changed) stroke.changed.add(v);
    this.runtime.previewWeights(stroke.mesh, stroke.session.current(), changed, stroke.inputs.skin);
  }

  /** Puts the surface back to the stroke-start weights (a cancelled or refused stroke). */
  private revert(stroke: Stroke): void {
    const current: SkinWeights = stroke.session.current();
    const grown = current.palette.length !== stroke.inputs.skin.palette.length;
    this.runtime.previewWeights(
      stroke.mesh,
      stroke.inputs.skin,
      grown ? 'all' : Uint32Array.from(stroke.changed),
      current,
    );
  }

  // ---------- test rotate (§5.11) ----------

  private beginRotate(e: ToolPointerEvent): boolean {
    if (e.paneId === null) return false;
    const target = this.runtime.rotateTarget(e.paneId);
    if (target === null) return false;
    const d = Math.hypot(e.x - target.x, e.y - target.y);
    if (Math.abs(d - ROTATE_RING_PX) > ROTATE_BAND_PX) return false;
    // The channel whose axis is closest to the view direction (FK controls rest world-aligned in the T-pose).
    const camera = this.runtime.vm.camera(e.paneId);
    const f = [
      camera.target[0] - camera.position[0],
      camera.target[1] - camera.position[1],
      camera.target[2] - camera.position[2],
    ];
    const axis = [0, 1, 2].reduce((best, i) => (Math.abs(f[i] as number) > Math.abs(f[best] as number) ? i : best), 0);
    const channel = (['rx', 'ry', 'rz'] as const)[axis] as 'rx' | 'ry' | 'rz';
    // Screen y grows downwards: a counter-clockwise drag on screen is a positive rotation about the axis to the viewer.
    const sign = (f[axis] as number) > 0 ? 1 : -1;
    const start = this.app.evaluation.channelValues(target.control)[channel];
    this.rotate = {
      gesture: beginChannelEditGesture(this.app, 'Rotate', { key: 'none' }),
      control: target.control,
      channel,
      sign,
      start,
      centre: { x: target.x, y: target.y },
      angle0: Math.atan2(e.y - target.y, e.x - target.x),
    };
    return true;
  }

  private async run(id: string, args: unknown): Promise<void> {
    const result = await this.app.runUntyped(id, args, { panel: PANEL.viewport, source: 'tool' });
    if (result.status === 'cancelled') this.toast(result.reason);
    else if (result.status === 'failed') this.toast(result.error.message);
  }

  private toast(text: string): void {
    this.app.services.notify.toast({ kind: 'warning', text });
  }

  /** Test probe. */
  state(): { readonly stroking: boolean; readonly stamps: number; readonly held: readonly string[] } {
    return { stroking: this.stroke !== null, stamps: this.stroke?.stamps.length ?? 0, held: [...this.held].sort() };
  }
}

/** The tool definition (contributed by the skin runtime, so nothing of it is eager). */
export function paintSkinToolDef(runtime: RigSkinRuntime): ToolDef<ViewportToolHost> {
  return {
    id: 'paintSkinWeights',
    panel: PANEL.viewport,
    label: 'Paint Skin Weights',
    icon: 'tool-paint',
    workspaces: ['rig'],
    keys: PAINT_SKIN_TOOL_KEYS,
    create: (app: EditorApp): ToolInstance => new PaintSkinTool(app, runtime),
  };
}
