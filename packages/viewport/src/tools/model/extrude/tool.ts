// The extrude manipulator tool (`VIEWPORT_TOOL.extrude`; M6A-SPEC §5.8, §5.9, §5.10; B12b). While an extrude
// session is open it draws Maya's polyExtrude manipulator on the cap: every handle drag goes through
// `app.extrude.beginAbsorb` (the drag's world-space delta becomes the extrude's `local*` args, previewed from the
// pre-op mesh and committed with one `edit.adjustLast`), `Shift` held at the start of a handle drag is smart extrude
// (a new extrude from the drag, `beginSmartExtrude`), `Shift` pressed after the drag started is the fine adjustment
// (×0.1) and `Mod` the coarse one (×10), per move (§7); the small square toggles the handles between the cap's axes
// and world axes. The reserved modal keys are the tool's during a drag (§5.10). `Esc` cancels the drag; during the first drag after `Mod+E` it also ends the session (zero-drop).
// After an Inset or Bevel (no session) it shows their value handle instead: dragging it is a virtual slider on the
// offset/fraction (the card preview, one adjust on release). A press anywhere else selects like the select tool, which
// ends the session at its start (§5.8).
import { quatFromAxisAngle, type Vec3 } from '@ekza-animator/anim-core';
import {
  type AbsorbGesture,
  beginCardPreview,
  beginSmartExtrude,
  type CardPreview,
  clampParamValue,
  type EditorApp,
  extrudeFirstDrag,
  type ExtrudeManipFrame,
  type NumericTarget,
  numericParams,
  paramSliderRate,
  RESERVED_MODAL_KEYS,
  type ToolInstance,
  type ToolKeyEvent,
  type ToolPhase,
  type ToolPointerEvent,
  VIEWPORT_TOOL,
} from '@ekza-animator/editor-core';
import { MESH_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { rayLineParameter, ringScreenTangent } from '../../../manipulators/drag';
import {
  axisOf,
  type ExtrudeHandle,
  pickExtrudeHandle,
  ringPoints,
  ROTATE,
  SCALE,
  TRANSLATE,
  worldPerPixel,
} from '../../../manipulators/extrude/geometry';
import type { PaneProjector } from '../../../picking/geometry';
import type { ViewportToolHost } from '../../host';
import { SelectBehaviour } from '../../selectTool';
import type { TopologyRuntime } from '../topology/runtime';

const DRAG_PX = 3;
/** Uniform scale per px of horizontal travel on the centre cube. */
const UNIFORM_PER_PX = 0.01;
/** Value handle pick radius (CSS px) around its diamond and along its arrow. */
const VALUE_PICK_PX = 10;

/** The extrude arg a handle edits (the capture window's active field, §5.10). */
export const HANDLE_FIELD: Readonly<Record<string, string>> = {
  tx: 'localTranslateX',
  ty: 'localTranslateY',
  tz: 'localTranslateZ',
  rx: 'localRotateX',
  ry: 'localRotateY',
  rz: 'localRotateZ',
  sx: 'localScaleX',
  sy: 'localScaleY',
  sz: 'localScaleZ',
  suniform: 'localScaleX',
};

interface ManipDrag {
  readonly kind: 'manip';
  readonly handle: ExtrudeHandle;
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly frame: ExtrudeManipFrame;
  readonly smart: boolean;
  readonly firstDrag: boolean;
  readonly axis: Vec3;
  /** Translate/scale: the axis parameter of the press; rotate: the ring's screen tangent at the press. */
  readonly startParam: number | null;
  readonly tangent: readonly [number, number];
  gesture: AbsorbGesture | null;
  moved: boolean;
  typed: { readonly field: string; readonly value: number } | null;
  /**
   * The drag-speed rule (§5.8, §7: `Shift` ×0.1, `Mod` ×10 during the drag), applied per move so a modifier change
   * mid-drag never jumps: `raw` is the unmodified drag value of the last move (translate/scale: the axis parameter;
   * rotate: the angle; uniform: the factor's offset from 1), `value` the sum of each move's step at its speed.
   */
  raw: number;
  value: number;
  /** `Shift` held since the press (smart extrude): it is the fine adjustment only once released and pressed again. */
  shiftFromStart: boolean;
}

/** The speed of a manipulator drag's move (§7, the shipped virtual-slider rule): `Shift` ×0.1, else `Mod` ×10. */
export function dragSpeed(e: { readonly shift: boolean; readonly mod: boolean }, shiftFromStart = false): number {
  return e.shift && !shiftFromStart ? 0.1 : e.mod ? 10 : 1;
}

interface ValueDrag {
  readonly kind: 'value';
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly param: string;
  readonly start: number;
  preview: CardPreview | null;
  value: number;
  moved: boolean;
  /** The pointer x of the last move and the unclamped value (per-move speed, as on the manipulator). */
  lastX: number;
  raw: number;
}

type Drag = ManipDrag | ValueDrag;

export class ExtrudeTool implements ToolInstance {
  private drag: Drag | null = null;
  private readonly select: SelectBehaviour;

  constructor(
    private readonly app: EditorApp,
    private readonly rt: TopologyRuntime,
    host: ViewportToolHost,
  ) {
    this.select = new SelectBehaviour(app, host);
  }

  activate(): void {
    this.rt.onHover((at) => {
      if (this.drag !== null) return;
      const handle = at === null ? null : this.handleAt(at.paneId, at.x, at.y);
      const value = at !== null && handle === null && this.onValueHandle(at.paneId, at.x, at.y);
      const changed = this.rt.manipulator.setHover(handle);
      if (changed || this.rt.valueHandle.setHot(value)) this.rt.invalidate();
    });
    this.rt.refreshHandles();
    // The manipulator tool never lingers with nothing to show (a workspace's remembered tool, a session that ended
    // while another tool was active): the select tool takes over.
    if (!this.rt.manipulator.visible && !this.rt.valueHandle.visible) {
      const tools = this.app.session.getState().tools;
      if (tools.viewport === VIEWPORT_TOOL.extrude) {
        this.app.session.setState({ tools: { ...tools, viewport: VIEWPORT_TOOL.select } });
      }
    }
  }

  deactivate(): void {
    this.cancel();
    this.rt.onHover(null);
    this.rt.refreshHandles();
  }

  phase(): ToolPhase {
    if (this.drag === null) return 'idle';
    return this.drag.moved ? 'dragging' : 'placing';
  }

  cursor(): string | null {
    return this.drag === null ? null : 'grabbing';
  }

  // ---------- picking ----------

  private paneScale(paneId: string, frame: ExtrudeManipFrame): { projector: PaneProjector; s: number } | null {
    const q = this.rt.query(paneId);
    if (q === null) return null;
    const s = worldPerPixel(q.camera, q.height, q.projector, frame.pivot) * this.rt.manipulator.size;
    return { projector: q.projector, s };
  }

  private handleAt(paneId: string, x: number, y: number): ExtrudeHandle | null {
    const frame = this.rt.manipulator.current;
    if (frame === null) return null;
    const scale = this.paneScale(paneId, frame);
    return scale === null ? null : pickExtrudeHandle(frame, scale.s, scale.projector, x, y);
  }

  private onValueHandle(paneId: string, x: number, y: number): boolean {
    const at = this.rt.valueHandle.at;
    if (at === null) return false;
    const p = this.rt.project(paneId, at);
    if (p === null) return false;
    // The diamond and the arrow to its right (pane right, ≈ 0.63 manipulator units long).
    const length = 0.63 * this.rt.valueHandle.size;
    const dx = x - p.x;
    return Math.abs(y - p.y) <= VALUE_PICK_PX && dx >= -VALUE_PICK_PX && dx <= length + VALUE_PICK_PX;
  }

  // ---------- pointer ----------

  pointerDown(e: ToolPointerEvent): boolean {
    if (this.drag !== null) return true; // RMB and other buttons are ignored during a drag
    if (e.button !== 0 || e.paneId === null) return this.select.pointerDown(e);
    const handle = this.handleAt(e.paneId, e.x, e.y);
    if (handle === 'space') {
      const state = this.app.extrude.state;
      if (state !== null) this.app.extrude.setManipSpace(state.manipSpace === 'local' ? 'world' : 'local');
      this.rt.refreshHandles();
      return true;
    }
    if (handle !== null) return this.startManip(e, handle);
    if (this.onValueHandle(e.paneId, e.x, e.y)) return this.startValue(e);
    return this.select.pointerDown(e);
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null) return this.select.pointerMove(e);
    if (!drag.moved && Math.hypot(e.x - drag.x, e.y - drag.y) < DRAG_PX) return true;
    drag.moved = true;
    if (drag.kind === 'value') this.moveValue(drag, e);
    else this.moveManip(drag, e);
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const drag = this.drag;
    if (drag === null) return this.select.pointerUp(e);
    if (e.button !== 0) return true;
    this.drag = null;
    if (this.app.capture.state.armed === 'drag') this.app.capture.disarm();
    this.rt.manipulator.setActive(null);
    if (drag.kind === 'value') this.commitValue(drag);
    else this.commitManip(drag);
    this.rt.refreshHandles();
    return true;
  }

  key(e: ToolKeyEvent): boolean {
    if (this.drag === null) return false;
    if (e.type === 'down' && e.code === 'Escape') {
      this.cancel();
      return true;
    }
    // §5.10: the other reserved modal keys are swallowed during a drag (never the keymap's `mesh.delete`).
    return RESERVED_MODAL_KEYS.has(e.code);
  }

  cancel(): void {
    const drag = this.drag;
    this.select.cancel();
    if (drag === null) return;
    this.drag = null;
    if (this.app.capture.state.armed === 'drag') this.app.capture.disarm();
    this.rt.manipulator.setActive(null);
    if (drag.kind === 'value') drag.preview?.cancel();
    else {
      drag.gesture?.cancel();
      // §5.8: Esc during the first drag after Mod+E cancels that drag, then ends the session (zero-drop).
      if (drag.firstDrag && !drag.smart) this.app.extrude.end('escape', { drop: true });
    }
    this.rt.refreshHandles();
  }

  numeric(): NumericTarget | null {
    const drag = this.drag;
    if (drag === null || drag.kind !== 'manip' || drag.smart) return null;
    return this.numericTarget(drag);
  }

  // ---------- manipulator drags ----------

  private startManip(e: ToolPointerEvent, handle: ExtrudeHandle): boolean {
    const frame = this.rt.manipulator.current;
    const paneId = e.paneId;
    if (frame === null || paneId === null) return false;
    const scale = this.paneScale(paneId, frame);
    if (scale === null) return false;
    const i = axisOf(handle);
    const axes = SCALE.includes(handle) || handle === 'suniform' ? frame.scaleAxes : frame.axes;
    const axis: Vec3 = i === null ? [0, 0, 1] : ([...axes[i]] as Vec3);
    let startParam: number | null = null;
    let tangent: readonly [number, number] = [0, 0];
    const q = this.rt.query(paneId);
    if (q === null) return false;
    if (TRANSLATE.includes(handle) || SCALE.includes(handle)) {
      const origin = [0, 0, 0];
      const dir = [0, 0, 0];
      q.projector.ray(q.camera, e.x, e.y, origin, dir);
      startParam = rayLineParameter(origin, dir, frame.pivot, axis);
    } else if (ROTATE.includes(handle) && i !== null) {
      const points = ringPoints(frame, i, scale.s);
      const out = [0, 0, 0];
      let grab = points[0] as Vec3;
      let best = Number.POSITIVE_INFINITY;
      for (const p of points) {
        if (!q.projector.project(p[0], p[1], p[2], out)) continue;
        const d = Math.hypot((out[0] as number) - e.x, (out[1] as number) - e.y);
        if (d < best) {
          best = d;
          grab = p;
        }
      }
      tangent = ringScreenTangent(q.projector, frame.pivot, axis, grab);
    }
    this.drag = {
      kind: 'manip',
      handle,
      paneId,
      x: e.x,
      y: e.y,
      frame,
      smart: e.shift,
      firstDrag: extrudeFirstDrag(this.app),
      axis,
      startParam,
      tangent,
      gesture: null,
      moved: false,
      typed: null,
      raw: startParam ?? 0,
      value: startParam ?? 0,
      shiftFromStart: e.shift,
    };
    this.rt.manipulator.setActive(handle);
    return true;
  }

  /** The gesture of a drag, opened on its first real movement (a click edits nothing). */
  private gestureOf(drag: ManipDrag): AbsorbGesture | null {
    if (drag.gesture !== null) return drag.gesture;
    const tool = TRANSLATE.includes(drag.handle) ? 'move' : ROTATE.includes(drag.handle) ? 'rotate' : 'scale';
    drag.gesture = drag.smart
      ? beginSmartExtrude(this.app, { paneId: drag.paneId })
      : this.app.extrude.beginAbsorb(tool, 'component');
    if (drag.gesture !== null && !drag.smart) this.app.capture.arm('drag', this.numericTarget(drag));
    return drag.gesture;
  }

  private moveManip(drag: ManipDrag, e: ToolPointerEvent): void {
    if (drag.typed !== null) return;
    const gesture = this.gestureOf(drag);
    if (gesture === null) return;
    const q = this.rt.query(drag.paneId);
    if (q === null) return;
    if (drag.shiftFromStart && !e.shift) drag.shiftFromStart = false;
    const speed = dragSpeed(e, drag.shiftFromStart);
    /** This move's step at its speed, added to the drag's value. */
    const advance = (raw: number): number => {
      drag.value += (raw - drag.raw) * speed;
      drag.raw = raw;
      return drag.value;
    };
    const handle = drag.handle;
    if (TRANSLATE.includes(handle) || SCALE.includes(handle)) {
      const origin = [0, 0, 0];
      const dir = [0, 0, 0];
      q.projector.ray(q.camera, e.x, e.y, origin, dir);
      const now = rayLineParameter(origin, dir, drag.frame.pivot, drag.axis);
      if (now === null || drag.startParam === null) return;
      const at = advance(now);
      if (TRANSLATE.includes(handle)) {
        const d = at - drag.startParam;
        gesture.update({ translate: [drag.axis[0] * d, drag.axis[1] * d, drag.axis[2] * d] });
      } else if (Math.abs(drag.startParam) > 1e-9) {
        const factor = Math.max(0, at / drag.startParam);
        const i = axisOf(handle) ?? 0;
        const scale: Vec3 = [1, 1, 1];
        scale[i] = factor;
        gesture.update({ scale });
      }
    } else if (ROTATE.includes(handle)) {
      const [tx, ty] = drag.tangent;
      const speed2 = tx * tx + ty * ty;
      if (speed2 < 1e-9) return;
      const angle = advance(((e.x - drag.x) * tx + (e.y - drag.y) * ty) / speed2);
      gesture.update({ rotate: quatFromAxisAngle(drag.axis, angle) });
    } else if (handle === 'suniform') {
      const f = Math.max(0, 1 + advance((e.x - drag.x) * UNIFORM_PER_PX));
      gesture.update({ scale: [f, f, f] });
    }
    this.rt.invalidate();
  }

  private commitManip(drag: ManipDrag): void {
    const typed = drag.typed;
    if (typed !== null) {
      drag.gesture?.cancel();
      void this.app.runUntyped('edit.adjustLast', { args: { [typed.field]: typed.value } });
      return;
    }
    if (!drag.moved) return;
    drag.gesture?.commit();
  }

  private numericTarget(drag: ManipDrag): NumericTarget {
    const params = numericParams(MESH_OP_DESCRIPTORS['mesh.extrude']?.params ?? []);
    const active = HANDLE_FIELD[drag.handle] ?? 'localTranslateZ';
    return {
      fields: [...params].sort((a, b) => (a.name === active ? -1 : b.name === active ? 1 : 0)),
      active,
      value: (field) => {
        const args = this.app.session.getState().lastRun?.args ?? {};
        const value = args[field];
        return typeof value === 'number' ? value : 0;
      },
      set: (field, value) => {
        drag.typed = { field, value };
      },
      confirm: () => {
        if (this.drag !== drag) return;
        this.drag = null;
        this.rt.manipulator.setActive(null);
        this.commitManip(drag);
        this.rt.refreshHandles();
      },
      cancel: () => {
        if (this.drag === drag) this.cancel();
      },
    };
  }

  // ---------- the Inset/Bevel value handle ----------

  private startValue(e: ToolPointerEvent): boolean {
    const run = this.rt.valueRun();
    const last = this.app.session.getState().lastRun;
    if (run === null || last === null || e.paneId === null) return this.select.pointerDown(e);
    const value = last.args[run.param];
    const start = typeof value === 'number' ? value : 0;
    let preview: CardPreview | null = null;
    try {
      preview = beginCardPreview(this.app);
    } catch {
      preview = null;
    }
    this.drag = {
      kind: 'value',
      paneId: e.paneId,
      x: e.x,
      y: e.y,
      param: run.param,
      start,
      preview,
      value: start,
      moved: false,
      lastX: e.x,
      raw: start,
    };
    this.rt.valueHandle.setHot(true);
    return true;
  }

  private moveValue(drag: ValueDrag, e: ToolPointerEvent): void {
    const last = this.app.session.getState().lastRun;
    const def = last?.params.find((p) => p.name === drag.param);
    if (def === undefined) return;
    const rates = this.app.prefs.getState().virtualSlider;
    drag.raw += (e.x - drag.lastX) * paramSliderRate(def, rates) * dragSpeed(e);
    drag.lastX = e.x;
    drag.value = clampParamValue(def, drag.raw).value;
    if (drag.preview !== null && !drag.preview.slow) drag.preview.update({ [drag.param]: drag.value });
    this.rt.invalidate();
  }

  private commitValue(drag: ValueDrag): void {
    this.rt.valueHandle.setHot(false);
    if (!drag.moved || drag.value === drag.start) {
      drag.preview?.cancel();
      return;
    }
    void this.app.runUntyped('edit.adjustLast', { args: { [drag.param]: drag.value } });
  }
}
