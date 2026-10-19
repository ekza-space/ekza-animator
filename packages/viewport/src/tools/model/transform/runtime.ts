// Model's transform runtime (M6A-SPEC §5.15, §5.10, §5.14; B12a), a lazy chunk loaded on the first Model entry:
//
// - places the manipulator in Model (`ModelManipulator`): on the component selection of the hilited meshes (pivot =
//   the world bounding-box centre of the picked vertices or the pinned `componentPivot`; World / Object / Component
//   orientation), on the topmost selected objects for Move and Rotate in object mode, and on the pivot while it is
//   edited (`D` held, `Insert`/`Home`: dashed, translate handles);
// - drags for the move, rotate and scale tools: components preview through a `MeshOpSession` of
//   `mesh.transformComponents` and commit one step ("Move", "Rotate", "Scale") with `source: 'tool'`; objects preview
//   through a document gesture and commit `scene.object.transform`; the pivot commits `mesh.pivot.set` (objects) or
//   pins `componentPivot` (components); an open extrude session absorbs W/E/R and MMB drags on its cap first
//   (`app.extrude.beginAbsorb`, B12b);
// - the MMB rule (an INPUTS field selected → its virtual slider; else the selection moves along the last-picked
//   handle, or in the view plane / about the view axis / uniformly), Tweak (a LMB drag that starts on an unselected
//   component selects it and moves it in the view plane, one step), snapping (`X` grid, `V` vertex, `J` increments,
//   held or sticky), the soft-select radius (`B`+LMB relative, `B`+MMB from zero) and the soft-weight overlay;
// - the numeric capture window during drags (the tool's `NumericTarget`) and the modal readout's state.
import {
  type Disposer,
  type Mat4,
  mat4Compose,
  mat4Decompose,
  mat4Invert,
  mat4Multiply,
  type ParamDef,
  type ParamValue,
  type ParamValues,
  type Quat,
  quatFromAxisAngle,
  quatInvert,
  quatRotateVec3,
  quatToEuler,
  type ReadonlyVec3,
  type ReadonlyXf,
  type Vec3,
  type Xf,
} from '@ekza-animator/anim-core';
import type { CharacterId, MeshId } from '@ekza-animator/doc';
import {
  type AbsorbGesture,
  beginCardPreview,
  beginKeyEditGesture,
  type CardPreview,
  clampParamValue,
  componentInternals,
  type EditorApp,
  type KeyEditGesture,
  liveLastRun,
  loadMeshKernel,
  meshKernel,
  type NumericTarget,
  PANEL,
  paramSliderRate,
  selectedInputsField,
  setTweakHandle,
  softWeightsOf,
  type ToolKeyEvent,
  type ToolPhase,
  type ToolPointerEvent,
  type TransformSpace,
  transformSpace,
  virtualSliderFactor,
} from '@ekza-animator/editor-core';
import type { ComponentKind } from '@ekza-animator/mesh-core';
import { MESH_OP_DESCRIPTORS, PRIMITIVE_PARAMS } from '@ekza-animator/mesh-core/descriptors';
import type { ViewportManager } from '../../../manager/ViewportManager';
import { objectWorld, pivotWorld, type SceneObjectRecord, topmostSelectedObjects } from '../../../manager/objects';
import type { ManipMode, ManipTarget } from '../../../manipulators/ManipulatorKit';
import type { ManipHandle } from '../../../types';
import type { ViewportToolHost } from '../../host';
import { modelSelectOf, subscribeModelSelect } from '../select';
import { componentFrame, componentPicks, type MeshPicks, picksCentre, quatOfAxes, rotationOf } from './frame';
import { type DragFrame, handleMode, isIdentityMotion, type Motion, mmbHandle, motionAt } from './motion';
import { setTransformReadout, transformReadout } from './readout';
import { deltaTowards, nearestVertex, type SnapCandidate, snapIncrement, snapTranslation } from './snap';
import type { ModelManipulator, ModelManipulatorRequest, ModelManipulatorTarget } from './types';

export type TransformToolId = 'move' | 'rotate' | 'scale';

/** Pointer travel (CSS px) before a press becomes a drag (§5.10). */
export const DRAG_START_PX = 3;
/** `B`+LMB: the radius doubles per this many CSS px to the right (halves to the left). */
const RADIUS_DOUBLING_PX = 100;
const MIN_RADIUS = 0.001;

const MODE_OF_TOOL: Readonly<Record<TransformToolId, ManipMode>> = {
  move: 'translate',
  rotate: 'rotate',
  scale: 'scale',
};
const IDENTITY_Q: Quat = [0, 0, 0, 1];

/** The `mesh.transformComponents` fields of each motion kind (the capture window's Tab order). */
const FIELDS: Readonly<Record<Motion['kind'], readonly [string, string, string]>> = {
  translate: ['translateX', 'translateY', 'translateZ'],
  rotate: ['rotateX', 'rotateY', 'rotateZ'],
  scale: ['scaleX', 'scaleY', 'scaleZ'],
};

/** The tool behaviour the move, rotate and scale tools delegate to in Model. */
export interface ModelTransformBehaviour {
  /** True when the runtime owns the press (a handle, Tweak, MMB, `B`); false: the tool selects. */
  pointerDown(e: ToolPointerEvent): boolean;
  pointerMove(e: ToolPointerEvent): boolean;
  pointerUp(e: ToolPointerEvent): boolean;
  cancel(): void;
  key(e: ToolKeyEvent): boolean;
  phase(): ToolPhase;
  numeric(): NumericTarget | null;
}

/** The select tool behaviour a press falls back to (Tweak clicks become plain clicks). */
export interface SelectFallback {
  pointerDown(e: ToolPointerEvent): boolean;
  pointerUp(e: ToolPointerEvent): boolean;
}

export async function createModelTransformRuntime(app: EditorApp, vm: ViewportManager): Promise<ModelTransformRuntime> {
  await loadMeshKernel();
  return new ModelTransformRuntime(app, vm);
}

// ---------------------------------------------------------------------------------------------------------------
// small maths

function quatOfAxesTuple(axes: readonly [ReadonlyVec3, ReadonlyVec3, ReadonlyVec3]): Quat {
  return quatOfAxes([...axes[0]] as Vec3, [...axes[1]] as Vec3, [...axes[2]] as Vec3);
}

function sameQuat(a: Quat, b: Quat, eps = 1e-9): boolean {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return Math.abs(1 - d) < eps;
}

function translationMatrix(t: ReadonlyVec3): Mat4 {
  return mat4Compose({ t: [t[0], t[1], t[2]], q: [0, 0, 0, 1], s: [1, 1, 1] });
}

/** The world matrix of a motion about a pivot (translation; rotation about an axis; scale along the frame axes). */
function motionMatrix(motion: Motion, pivot: ReadonlyVec3, frame: Quat): Mat4 {
  if (motion.kind === 'translate') return translationMatrix(motion.delta);
  const there = translationMatrix(pivot);
  const back = translationMatrix([-pivot[0], -pivot[1], -pivot[2]]);
  let linear: Mat4;
  if (motion.kind === 'rotate') {
    linear = mat4Compose({ t: [0, 0, 0], q: quatFromAxisAngle(motion.axis, motion.angle), s: [1, 1, 1] });
  } else {
    const a = mat4Compose({ t: [0, 0, 0], q: frame, s: [1, 1, 1] });
    const s = mat4Compose({ t: [0, 0, 0], q: [0, 0, 0, 1], s: motion.factors });
    linear = mat4Multiply(mat4Multiply(a, s), mat4Compose({ t: [0, 0, 0], q: quatInvert(frame), s: [1, 1, 1] }));
  }
  return mat4Multiply(there, mat4Multiply(linear, back));
}

function applyPoint(m: Mat4, p: ReadonlyVec3): Vec3 {
  return [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number),
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number),
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number),
  ];
}

/** `mesh.transformComponents` value args of a motion expressed in the frame `frame` (world rotation). */
export function componentArgs(motion: Motion, frame: Quat): Record<string, number> {
  const args: Record<string, number> = {
    translateX: 0,
    translateY: 0,
    translateZ: 0,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
  const inverse = quatInvert(frame);
  if (motion.kind === 'translate') {
    const t = quatRotateVec3(inverse, motion.delta);
    args['translateX'] = t[0];
    args['translateY'] = t[1];
    args['translateZ'] = t[2];
  } else if (motion.kind === 'rotate') {
    const a = quatRotateVec3(inverse, motion.axis);
    const k = [0, 1, 2].find((i) => Math.abs(Math.abs(a[i] as number) - 1) < 1e-9);
    if (k !== undefined) {
      args[FIELDS.rotate[k] as string] = Math.sign(a[k] as number) * motion.angle;
    } else {
      const e = quatToEuler(quatFromAxisAngle(a, motion.angle), 'xyz');
      args['rotateX'] = e[0];
      args['rotateY'] = e[1];
      args['rotateZ'] = e[2];
    }
  } else {
    args['scaleX'] = motion.factors[0];
    args['scaleY'] = motion.factors[1];
    args['scaleZ'] = motion.factors[2];
  }
  return args;
}

/** The field a handle drags first (the capture window's active field). */
function activeField(handle: ManipHandle, kind: Motion['kind']): string {
  const fields = FIELDS[kind];
  const axis: Partial<Record<ManipHandle, number>> = {
    tx: 0,
    ty: 1,
    tz: 2,
    rx: 0,
    ry: 1,
    rz: 2,
    sx: 0,
    sy: 1,
    sz: 2,
    tyz: 1,
    txz: 0,
    txy: 0,
  };
  return fields[axis[handle] ?? (kind === 'rotate' ? 2 : 0)] as string;
}

function formatField(field: string, value: number): string {
  if (field.startsWith('translate')) return `${value.toFixed(3)} m`;
  if (field.startsWith('rotate')) return `${((value * 180) / Math.PI).toFixed(1)}°`;
  return `×${value.toFixed(3)}`;
}

function fieldLabel(field: string): string {
  const def = MESH_OP_DESCRIPTORS['mesh.transformComponents']?.params.find((p) => p.name === field);
  return def?.label ?? field;
}

function fieldDefs(kind: Motion['kind']): readonly ParamDef[] {
  const params = MESH_OP_DESCRIPTORS['mesh.transformComponents']?.params ?? [];
  return FIELDS[kind].map((name) => params.find((p) => p.name === name)).filter((p): p is ParamDef => p !== undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// drags

interface Press {
  readonly kind: 'handle' | 'mmb' | 'tweak' | 'radius' | 'inputs';
  readonly tool: TransformToolId;
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly handle: ManipHandle | null;
  readonly event: ToolPointerEvent;
  /** Tweak: the component under the press. */
  readonly pick: { readonly mesh: MeshId; readonly kind: ComponentKind; readonly index: number } | null;
}

/** A running drag of any kind. */
interface Drag {
  readonly paneId: string;
  update(e: ToolPointerEvent): void;
  finish(commit: boolean): void;
  readonly target: NumericTarget | null;
}

interface MotionDragBase {
  /** The pane of the latest pointer event. */
  paneId: string;
  readonly handle: ManipHandle;
  readonly drag: DragFrame;
  readonly motionKind: Motion['kind'];
  readonly at: (x: number, y: number) => Motion | null;
  /** Values typed in the capture window win over the pointer for their field (§5.10). */
  readonly typed: Map<string, number>;
  /** The frame the readout and the typed fields read (the manipulator's axes). */
  readonly frame: Quat;
  motion: Motion | null;
}

/** The selection's frame for components (cached per selection, mesh revision and placement). */
interface ComponentFrameCache {
  readonly key: string;
  readonly picks: readonly MeshPicks[];
  readonly centre: Vec3 | null;
  readonly frame: Quat;
}

// ---------------------------------------------------------------------------------------------------------------

export class ModelTransformRuntime implements ModelManipulator {
  private readonly disposers: Disposer[] = [];
  /** Snapping and pivot holds (`X`, `V`, `J`, `D`) and `B`. */
  readonly held = { grid: false, vertex: false, increment: false, pivot: false, soft: false };
  private press: Press | null = null;
  private drag: Drag | null = null;
  /** The manipulator follows a drag (translation of the pivot). */
  private livePivot: Vec3 | null = null;
  private frameCache: ComponentFrameCache | null = null;
  private characterWorld: (character: CharacterId) => Mat4 | null = () => null;
  private softPushed = new Set<MeshId>();
  private softQueued = false;
  private selectionSignature = '';
  private radiusDragged = false;
  private hover: { paneId: string; x: number; y: number } | null = null;
  private disposed = false;

  constructor(
    readonly app: EditorApp,
    readonly vm: ViewportManager,
  ) {
    this.selectionSignature = this.signature();
    this.disposers.push(
      app.components.subscribe(() => {
        this.frameCache = null;
        this.onSelectionChanged();
        this.vm.refreshManipulatorSoon();
        this.scheduleSoft();
      }),
      app.meshes.subscribe((_id, e) => {
        if (e.type === 'changed' && e.preview) return;
        this.frameCache = null;
        this.vm.refreshManipulatorSoon();
        this.scheduleSoft();
      }),
      app.session.subscribe((state, previous) => {
        const model = state.model;
        const before = previous.model;
        if (
          model.componentMode !== before.componentMode ||
          model.hilite !== before.hilite ||
          model.symmetry !== before.symmetry ||
          state.workspace !== previous.workspace
        ) {
          this.frameCache = null;
          this.scheduleSoft();
        }
        if (model.softSelect !== before.softSelect) this.scheduleSoft();
        if (
          model.pivotEdit !== before.pivotEdit ||
          model.componentPivot !== before.componentPivot ||
          model.componentMode !== before.componentMode ||
          model.hilite !== before.hilite
        ) {
          this.vm.refreshManipulatorSoon();
        }
        // The last-picked handle belongs to the tool that picked it (§5.15: cleared on a tool switch).
        if (state.tools.viewport !== previous.tools.viewport && model.tweakHandle !== null) setTweakHandle(app, null);
        if (state.workspace !== 'model') this.releaseHolds();
      }),
      app.store.subscribe((batch) => {
        if (batch.changes.some((change) => change.table === 'meshes' || change.table === 'groups')) {
          this.frameCache = null;
        }
      }),
      subscribeModelSelect(app, () => this.scheduleSoft()),
      () => this.pushSoft(true),
    );
    if (typeof window !== 'undefined') {
      const move = (e: PointerEvent): void => this.trackPointer(e);
      window.addEventListener('pointermove', move, { capture: true, passive: true });
      this.disposers.push(() => window.removeEventListener('pointermove', move, { capture: true }));
    }
    vm.setModelManipulator(this);
    this.disposers.push(() => vm.setModelManipulator(null));
    this.scheduleSoft();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.drag?.finish(false);
    this.drag = null;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    setTransformReadout(this.app, null);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the manipulator (ModelManipulator)

  private pivotEditing(): boolean {
    return this.app.session.getState().model.pivotEdit || this.held.pivot;
  }

  private toolOf(mode: ManipMode): TransformToolId {
    return mode === 'translate' ? 'move' : mode === 'rotate' ? 'rotate' : 'scale';
  }

  /** The component frame of the current selection (cached). */
  componentSelection(kind: ComponentKind): ComponentFrameCache {
    const state = this.app.session.getState();
    const parts: string[] = [String(this.app.components.version), kind, state.model.hilite.join(',')];
    for (const mesh of state.model.hilite) {
      const runtime = this.app.meshes.get(mesh);
      parts.push(`${runtime?.ref?.manifest ?? ''}:${runtime?.state ?? ''}`);
    }
    const key = parts.join('|');
    if (this.frameCache?.key === key) return this.frameCache;
    const picks = componentPicks(this.app, kind);
    const cache = { key, picks, centre: picksCentre(picks), frame: componentFrame(picks, kind) };
    this.frameCache = cache;
    return cache;
  }

  /** The manipulator rotation of a tool's orientation for the component selection. */
  private componentOrientation(tool: TransformToolId, sel: ComponentFrameCache): Quat {
    const space = transformSpace(this.app, tool);
    if (space === 'world') return IDENTITY_Q;
    if (space === 'component') return sel.frame;
    const lead = sel.picks.at(-1);
    return lead === undefined ? IDENTITY_Q : rotationOf(lead.world);
  }

  target(request: ModelManipulatorRequest): ModelManipulatorTarget | null {
    this.characterWorld = request.characterWorld;
    const state = this.app.session.getState();
    if (state.workspace !== 'model') return null;
    const tool = this.toolOf(request.mode);
    const editing = this.pivotEditing();
    const mode: ManipMode = editing ? 'translate' : request.mode;
    const kind = state.model.componentMode;
    if (kind !== 'object') {
      const sel = this.componentSelection(kind);
      const pivot = this.livePivot ?? state.model.componentPivot ?? sel.centre;
      if (pivot === null || sel.picks.length === 0) return null;
      const q = editing ? IDENTITY_Q : this.componentOrientation(tool, sel);
      return { target: manipTarget(pivot, q), mode, dashed: editing };
    }
    if (request.mode === 'scale' && !editing) return null; // B9's object scale target
    const lead = topmostSelectedObjects(this.app).at(-1);
    if (lead === undefined) return null;
    const world = objectWorld(this.app, lead, this.characterWorld);
    const pivot = this.livePivot ?? pivotWorld(world, lead.pivot);
    const q = editing || transformSpace(this.app, tool) === 'world' ? IDENTITY_Q : rotationOf(world);
    return { target: manipTarget(pivot, q), mode, dashed: editing };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the tools' behaviour

  behaviour(tool: TransformToolId, host: ViewportToolHost, select: SelectFallback): ModelTransformBehaviour {
    return {
      pointerDown: (e) => this.pointerDown(tool, host, e),
      pointerMove: (e) => this.pointerMove(e),
      pointerUp: (e) => this.pointerUp(e, select),
      cancel: () => this.cancel(),
      key: (e) => this.key(e),
      phase: () => (this.drag !== null ? 'dragging' : 'idle'),
      numeric: () => this.drag?.target ?? null,
    };
  }

  private pointerDown(tool: TransformToolId, host: ViewportToolHost, e: ToolPointerEvent): boolean {
    const state = this.app.session.getState();
    if (state.workspace !== 'model' || e.paneId === null || this.drag !== null) return false;
    const base = { tool, paneId: e.paneId, x: e.x, y: e.y, button: e.button, event: e, handle: null, pick: null };
    const component = state.model.componentMode !== 'object';
    // `B`+LMB scales the radius, `B`+MMB sets it from zero (§5.15).
    if (this.held.soft && component && (e.button === 0 || e.button === 1)) {
      this.press = { ...base, kind: 'radius' };
      return true;
    }
    if (e.button === 1) {
      if (selectedInputsField(this.app) !== null) {
        this.press = { ...base, kind: 'inputs' };
        return true;
      }
      const at = this.vm.manipulatorFrame(e.paneId)?.pivot ?? null;
      if (at === null) return false;
      const mode = this.pivotEditing() ? 'translate' : MODE_OF_TOOL[tool];
      this.press = { ...base, kind: 'mmb', handle: mmbHandle(mode, state.model.tweakHandle) };
      return true;
    }
    if (e.button !== 0) return false;
    const handle = host.pickManipulator(e.paneId, e.x, e.y);
    if (handle !== null) {
      setTweakHandle(this.app, handle);
      // Object scaling with the Scale tool's handles stays B9's (each object in its own axes, one "Scale" step).
      if (tool === 'scale' && !component && !this.pivotEditing()) return false;
      this.press = { ...base, kind: 'handle', handle };
      return true;
    }
    // Tweak (§5.15): with the Move tool, a drag that starts on a component moves it in the view plane.
    if (tool === 'move' && component && state.model.selectionStyle === 'tweak' && !this.pivotEditing()) {
      const kind = state.model.componentMode;
      const hit = modelSelectOf(this.app)?.pickComponent(e.paneId, e.x, e.y, kind) ?? null;
      if (hit !== null) {
        this.press = { ...base, kind: 'tweak', pick: { mesh: hit.mesh, kind, index: hit.index } };
        return true;
      }
    }
    return false;
  }

  private pointerMove(e: ToolPointerEvent): boolean {
    this.hover = e.paneId === null ? this.hover : { paneId: e.paneId, x: e.x, y: e.y };
    const drag = this.drag;
    if (drag !== null) {
      drag.update(e);
      return true;
    }
    const press = this.press;
    if (press === null) return false;
    if (Math.hypot(e.x - press.x, e.y - press.y) < DRAG_START_PX) return true;
    this.press = null;
    this.drag = this.begin(press);
    this.drag?.update(e);
    return true;
  }

  private pointerUp(e: ToolPointerEvent, select: SelectFallback): boolean {
    const drag = this.drag;
    if (drag !== null) {
      drag.update(e);
      this.drag = null;
      drag.finish(true);
      return true;
    }
    const press = this.press;
    if (press === null) return false;
    this.press = null;
    // A Tweak press without a drag is a plain click (it selects); a click on a handle only picked it.
    if (press.kind === 'tweak') {
      select.pointerDown(press.event);
      select.pointerUp(e);
    }
    return true;
  }

  private cancel(): void {
    this.press = null;
    const drag = this.drag;
    this.drag = null;
    drag?.finish(false);
  }

  /** Esc, a window blur or the workspace leaving Model: forget held keys. */
  private releaseHolds(): void {
    const pivot = this.held.pivot;
    this.held.grid = false;
    this.held.vertex = false;
    this.held.increment = false;
    this.held.pivot = false;
    this.held.soft = false;
    this.updateRing();
    if (pivot) this.vm.refreshManipulatorSoon();
  }

  private key(e: ToolKeyEvent): boolean {
    if (this.app.session.getState().workspace !== 'model') return false;
    const modified = e.shift || e.alt || e.mod || e.ctrl;
    const down = e.type === 'down';
    const hold = (name: 'grid' | 'vertex' | 'increment' | 'pivot'): boolean => {
      if (down && modified && !this.held[name]) return false;
      const was = this.held[name];
      this.held[name] = down;
      if (name === 'pivot' && was !== down) this.vm.refreshManipulatorSoon();
      // A snap key pressed or released during a drag applies at once (Maya).
      if (this.drag !== null && this.lastEvent !== null && was !== down) this.drag.update(this.lastEvent);
      return down || was;
    };
    switch (e.code) {
      case 'KeyX':
        return hold('grid');
      case 'KeyV':
        return hold('vertex');
      case 'KeyJ':
        return hold('increment');
      case 'KeyD':
        return hold('pivot');
      case 'KeyB': {
        // Observed, never consumed on the way down: the keymap's tap toggles soft select (§7); a `B`+drag makes the
        // release no tap (the adapter's pointer activity, and true here).
        if (down) {
          if (modified) return false;
          if (!this.held.soft) this.radiusDragged = false;
          this.held.soft = true;
          this.updateRing();
          return false;
        }
        const dragged = this.radiusDragged;
        this.held.soft = false;
        this.radiusDragged = false;
        this.updateRing();
        return dragged;
      }
      default:
        return false;
    }
  }

  private lastEvent: ToolPointerEvent | null = null;

  // ---------------------------------------------------------------------------------------------------------------
  // starting drags

  private begin(press: Press): Drag | null {
    try {
      if (press.kind === 'radius') return this.beginRadius(press);
      if (press.kind === 'inputs') return this.beginInputs(press);
      if (press.kind === 'tweak') return this.beginTweak(press);
      const handle = press.handle;
      if (handle === null) return null;
      const frame = this.vm.manipulatorFrame(press.paneId);
      if (frame === null || frame.pivot === null) return null;
      const drag: DragFrame = {
        frame,
        pivot: [...frame.pivot] as Vec3,
        axes: frame.axes,
        start: { x: press.x, y: press.y },
      };
      if (this.pivotEditing()) return this.beginPivot(press, handle, drag);
      if (this.app.session.getState().model.componentMode !== 'object') {
        return this.beginComponents(press.tool, press.button === 1 ? 'mmb' : press.tool, handle, drag);
      }
      return this.beginObjects(handle, drag);
    } catch (error) {
      this.app.services.notify.toast({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /** The motion of a drag with snapping and typed values applied; updates the readout. */
  private motionOf(
    base: MotionDragBase,
    e: ToolPointerEvent,
    exclude: (mesh: MeshId, v: number) => boolean,
  ): Motion | null {
    this.lastEvent = e;
    let motion = base.at(e.x, e.y);
    if (motion === null) return base.motion;
    const prefs = this.app.prefs.getState().modeling;
    const sticky = this.app.session.getState().model.snap;
    const vertex = this.held.vertex || sticky.vertex;
    const grid = this.held.grid || sticky.grid;
    const increment = this.held.increment || sticky.increment;
    let candidate: SnapCandidate | null = null;
    if (motion.kind === 'translate') {
      if (vertex) {
        candidate = nearestVertex(this.app, base.paneId, base.drag.frame, e.x, e.y, prefs.vertexSnapRadiusPx, exclude);
      }
      if (candidate !== null) {
        motion = {
          kind: 'translate',
          delta: deltaTowards(base.handle, base.drag.pivot, base.drag.axes, candidate.world),
        };
      } else if (grid || increment) {
        motion = {
          kind: 'translate',
          delta: snapTranslation(
            motion.delta,
            base.handle,
            base.drag.pivot,
            base.drag.axes,
            { grid, increment },
            {
              grid: prefs.gridStep,
              move: prefs.increments.move,
            },
          ),
        };
      }
    } else if (increment) {
      motion = snapIncrement(motion, prefs.increments);
    }
    base.motion = motion;
    this.readout(base, e, candidate);
    return motion;
  }

  /**
   * The readout of a drag (§8.7): the dragged field and its value — for one axis, its value in the manipulator's frame
   * (a typed entry wins); for a plane or the view plane, the distance moved; for uniform scale, the factor.
   */
  private readout(base: MotionDragBase, e: ToolPointerEvent, candidate: SnapCandidate | null): void {
    const motion = base.motion;
    if (motion === null || e.paneId === null) return;
    const field = activeField(base.handle, motion.kind);
    const single = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'].includes(base.handle);
    let label = fieldLabel(field);
    let value = base.typed.get(field) ?? componentArgs(motion, base.frame)[field] ?? 0;
    if (!single && base.typed.size === 0) {
      if (motion.kind === 'translate') {
        label = 'Move';
        value = Math.hypot(...motion.delta);
      } else if (motion.kind === 'rotate') {
        label = 'Rotate';
        value = motion.angle;
      } else {
        label = 'Scale';
        value = motion.factors[0];
      }
    }
    setTransformReadout(this.app, {
      paneId: e.paneId,
      x: e.x,
      y: e.y,
      label,
      value: formatField(field, value),
      snap: candidate === null ? null : { x: candidate.x, y: candidate.y, label: candidate.label },
      ring: null,
    });
  }

  private clearReadout(): void {
    setTransformReadout(this.app, null);
    this.updateRing();
  }

  /** The capture window's target for a drag (§5.10): the motion's three fields, the dragged one active. */
  private numericTarget(
    base: MotionDragBase,
    current: () => Record<string, number>,
    apply: () => void,
    finish: (commit: boolean) => void,
  ): NumericTarget {
    return {
      fields: fieldDefs(base.motionKind),
      active: activeField(base.handle, base.motionKind),
      value: (field) => base.typed.get(field) ?? current()[field] ?? 0,
      set: (field, value) => {
        base.typed.set(field, value);
        apply();
      },
      confirm: () => {
        if (this.drag === null) return;
        this.drag = null;
        finish(true);
      },
      cancel: () => {
        if (this.drag === null) return;
        this.drag = null;
        finish(false);
      },
    };
  }

  // ---------- components ----------

  private beginComponents(
    tool: TransformToolId,
    gesture: TransformToolId | 'mmb',
    handle: ManipHandle,
    drag: DragFrame,
  ): Drag | null {
    const app = this.app;
    const kind = app.session.getState().model.componentMode as ComponentKind;
    const space: TransformSpace = transformSpace(app, tool);
    const motionKind =
      handleMode(handle) === 'rotate' ? 'rotate' : handleMode(handle) === 'scale' ? 'scale' : 'translate';
    const frame = quatOfAxesTuple(drag.axes);
    const base: MotionDragBase = {
      paneId: '',
      handle,
      drag,
      motionKind,
      at: motionAt(handle, drag),
      typed: new Map(),
      frame,
      motion: null,
    };
    // An open extrude session absorbs the gesture on its cap (§5.8, B12b).
    const absorb = app.extrude.beginAbsorb(gesture, space);
    if (absorb !== null) return this.absorbDrag(base, absorb);
    const sel = this.componentSelection(kind);
    if (sel.picks.length === 0) return null;
    const kernel = meshKernel();
    const op = kernel?.MESH_OPS['mesh.transformComponents'];
    if (op === undefined) return null;
    const targets = sel.picks.map((p) => p.mesh);
    // The args' frame: World → world axes; Object on one mesh → its axes; else the manipulator's frame as Component.
    const objectFrames = sel.picks.map((p) => rotationOf(p.world));
    const argSpace: TransformSpace =
      space === 'world'
        ? 'world'
        : space === 'object' && objectFrames.every((q) => sameQuat(q, objectFrames[0] ?? IDENTITY_Q))
          ? 'object'
          : 'component';
    const orientation = space === 'object' && argSpace === 'component' ? frame : sel.frame;
    const fixed = { pivot: [...drag.pivot], orientation: [...orientation], space: argSpace } as const;
    let values = componentArgs({ kind: 'translate', delta: [0, 0, 0] }, frame);
    const session = app.meshes.beginOp(op, targets, { ...values, ...fixed });
    const moved = new Map<MeshId, Set<number>>();
    for (const p of sel.picks) moved.set(p.mesh, new Set(p.verts));
    const exclude = (mesh: MeshId, v: number): boolean => moved.get(mesh)?.has(v) === true;
    let paneId = '';
    const apply = (): void => {
      const motion = base.motion;
      const next = motion === null ? values : componentArgs(motion, frame);
      for (const [field, value] of base.typed) next[field] = value;
      values = next;
      if (session.active) session.update({ ...values, ...fixed });
      if (motion?.kind === 'translate') {
        const d = motion.delta;
        this.livePivot = [drag.pivot[0] + d[0], drag.pivot[1] + d[1], drag.pivot[2] + d[2]];
        this.vm.refreshManipulatorSoon();
      }
    };
    const finish = (commit: boolean): void => {
      if (app.capture.state.armed === 'drag') app.capture.disarm();
      this.livePivot = null;
      this.clearReadout();
      const identity = base.motion === null || isIdentityMotion(base.motion);
      if (!commit || (identity && base.typed.size === 0) || !session.active) {
        if (session.active) session.cancel();
        this.vm.refreshManipulatorSoon();
        return;
      }
      const pinned = app.session.getState().model.componentPivot;
      const motion = base.motion;
      void app
        .runUntyped(
          'mesh.transformComponents',
          { ...values, ...fixed, meshes: targets, kind },
          { source: 'tool', panel: PANEL.viewport, ...(paneId === '' ? {} : { paneId }) },
        )
        .then((result) => {
          if (result.status === 'failed') app.services.notify.toast({ kind: 'error', text: result.error.message });
          // A pinned component pivot moves with the components it was pinned on.
          if (result.status === 'finished' && pinned !== null && motion?.kind === 'translate') {
            const state = app.session.getState();
            const d = motion.delta;
            app.session.setState({
              model: { ...state.model, componentPivot: [pinned[0] + d[0], pinned[1] + d[1], pinned[2] + d[2]] },
            });
          }
          this.vm.refreshManipulatorSoon();
        });
    };
    const target = this.numericTarget(base, () => values, apply, finish);
    app.capture.arm('drag', target);
    return {
      get paneId() {
        return paneId;
      },
      target,
      update: (e) => {
        paneId = e.paneId ?? paneId;
        base.paneId = paneId;
        if (!session.active) return;
        this.motionOf(base, e, exclude);
        apply();
      },
      finish,
    };
  }

  /** An open extrude session absorbs the drag (§5.8): world deltas about the session frame's pivot. */
  private absorbDrag(base: MotionDragBase, absorb: AbsorbGesture): Drag {
    let paneId = '';
    const finish = (commit: boolean): void => {
      this.clearReadout();
      if (commit) absorb.commit();
      else absorb.cancel();
    };
    return {
      get paneId() {
        return paneId;
      },
      target: null,
      update: (e) => {
        paneId = e.paneId ?? paneId;
        base.paneId = paneId;
        const motion = this.motionOf(base, e, () => false);
        if (motion === null) return;
        if (motion.kind === 'translate') absorb.update({ translate: motion.delta });
        else if (motion.kind === 'rotate') absorb.update({ rotate: quatFromAxisAngle(motion.axis, motion.angle) });
        else absorb.update({ scale: motion.factors });
      },
      finish,
    };
  }

  // ---------- objects ----------

  private beginObjects(handle: ManipHandle, drag: DragFrame): Drag | null {
    const app = this.app;
    const objects = topmostSelectedObjects(app);
    if (objects.length === 0) return null;
    const motionKind =
      handleMode(handle) === 'rotate' ? 'rotate' : handleMode(handle) === 'scale' ? 'scale' : 'translate';
    const label = motionKind === 'rotate' ? 'Rotate' : motionKind === 'scale' ? 'Scale' : 'Move';
    const frame = quatOfAxesTuple(drag.axes);
    const starts = objects.map((record) => objectStart(app, record, this.characterWorld));
    const moving = new Set<string>(objects.map((record) => record.id));
    const exclude = (mesh: MeshId): boolean => moving.has(mesh) || descendsFrom(app, mesh, moving);
    const base: MotionDragBase = {
      paneId: '',
      handle,
      drag,
      motionKind,
      at: motionAt(handle, drag),
      typed: new Map(),
      frame,
      motion: null,
    };
    let gesture: KeyEditGesture | null = null;
    let placements: Xf[] = starts.map((s) => s.placement);
    let paneId = '';
    const apply = (): void => {
      let motion = base.motion;
      if (motion === null) return;
      motion = withTyped(motion, base.typed, frame);
      placements = starts.map((start) => movedPlacement(start, motion, frame));
      if (gesture === null) gesture = beginKeyEditGesture(app, label);
      if (!gesture.active) return;
      const current = placements;
      gesture.update((tx) => {
        starts.forEach((start, i) => {
          const placement = current[i];
          if (placement === undefined) return;
          if (start.table === 'meshes') tx.patch('meshes', start.id as MeshId, { placement });
          else tx.patch('groups', start.id as never, { placement });
        });
      });
      if (motion.kind === 'translate') {
        const d = motion.delta;
        this.livePivot = [drag.pivot[0] + d[0], drag.pivot[1] + d[1], drag.pivot[2] + d[2]];
        this.vm.refreshManipulatorSoon();
      }
    };
    const finish = (commit: boolean): void => {
      if (app.capture.state.armed === 'drag') app.capture.disarm();
      this.livePivot = null;
      this.clearReadout();
      const g: KeyEditGesture | null = gesture;
      if (g?.active === true) g.cancel();
      const motion = base.motion;
      if (!commit || motion === null || (isIdentityMotion(motion) && base.typed.size === 0)) {
        this.vm.refreshManipulatorSoon();
        return;
      }
      void app
        .runUntyped(
          'scene.object.transform',
          { ids: starts.map((s) => s.id), placements },
          { source: 'tool', panel: PANEL.viewport, ...(paneId === '' ? {} : { paneId }) },
        )
        .then((result) => {
          if (result.status === 'failed') app.services.notify.toast({ kind: 'error', text: result.error.message });
          this.vm.refreshManipulatorSoon();
        });
    };
    const values = (): Record<string, number> => (base.motion === null ? {} : componentArgs(base.motion, frame));
    const target = this.numericTarget(base, values, apply, finish);
    app.capture.arm('drag', target);
    return {
      get paneId() {
        return paneId;
      },
      target,
      update: (e) => {
        paneId = e.paneId ?? paneId;
        base.paneId = paneId;
        this.motionOf(base, e, exclude);
        apply();
      },
      finish,
    };
  }

  // ---------- pivot editing ----------

  private beginPivot(press: Press, handle: ManipHandle, drag: DragFrame): Drag | null {
    const app = this.app;
    if (handleMode(handle) !== 'translate') return null;
    const component = app.session.getState().model.componentMode !== 'object';
    const lead = component ? null : (topmostSelectedObjects(app).at(-1) ?? null);
    if (!component && lead === null) return null;
    const base: MotionDragBase = {
      paneId: press.paneId,
      handle,
      drag,
      motionKind: 'translate',
      at: motionAt(handle, drag),
      typed: new Map(),
      frame: quatOfAxesTuple(drag.axes),
      motion: null,
    };
    let paneId = press.paneId;
    const finish = (commit: boolean): void => {
      const pivot = this.livePivot;
      this.livePivot = null;
      this.clearReadout();
      this.vm.refreshManipulatorSoon();
      if (!commit || pivot === null) return;
      if (component) {
        const state = app.session.getState();
        app.session.setState({ model: { ...state.model, componentPivot: pivot } });
        return;
      }
      if (lead === null) return;
      const inverse = mat4Invert(objectWorld(app, lead, this.characterWorld));
      if (inverse === null) return;
      void app.runUntyped(
        'mesh.pivot.set',
        { id: lead.id, pivot: applyPoint(inverse, pivot) },
        { source: 'tool', panel: PANEL.viewport, paneId },
      );
    };
    return {
      get paneId() {
        return paneId;
      },
      target: null,
      update: (e) => {
        paneId = e.paneId ?? paneId;
        base.paneId = paneId;
        const motion = this.motionOf(base, e, () => false);
        if (motion?.kind !== 'translate') return;
        const d = motion.delta;
        this.livePivot = [drag.pivot[0] + d[0], drag.pivot[1] + d[1], drag.pivot[2] + d[2]];
        this.vm.refreshManipulatorSoon();
      },
      finish,
    };
  }

  // ---------- Tweak ----------

  private beginTweak(press: Press): Drag | null {
    const app = this.app;
    const pick = press.pick;
    if (pick === null) return null;
    const service = app.components;
    const sel = service.get(pick.mesh, pick.kind);
    const set = pick.kind === 'vertex' ? sel.verts : pick.kind === 'edge' ? sel.edges : sel.faces;
    if (!set.has(pick.index)) {
      // The press replaces the selection with the component under it (no "Select" step: the Move carries it).
      const internals = componentInternals(service);
      for (const mesh of app.session.getState().model.hilite) {
        if (mesh === pick.mesh) continue;
        if (internals !== null) internals.clearKind(mesh, pick.kind);
      }
      service.apply(pick.mesh, pick.kind, [pick.index], 'replace');
      this.frameCache = null;
      this.vm.refreshManipulatorSoon();
    }
    const frame = this.vm.manipulatorFrame(press.paneId);
    const selection = this.componentSelection(pick.kind);
    if (frame === null || selection.centre === null) return null;
    const drag: DragFrame = {
      frame,
      pivot: selection.centre,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      start: { x: press.x, y: press.y },
    };
    return this.beginComponents('move', 'move', 'tview', drag);
  }

  // ---------- soft-select radius ----------

  private beginRadius(press: Press): Drag | null {
    const app = this.app;
    const start = app.session.getState().model.softSelect.radius;
    const frame = this.vm.manipulatorFrame(press.paneId);
    const unitsPerPx = frame?.unitsPerPx ?? 0.01;
    const fromZero = press.button === 1;
    this.radiusDragged = true;
    let radius = start;
    const set = (value: number): void => {
      const state = app.session.getState();
      app.session.setState({ model: { ...state.model, softSelect: { ...state.model.softSelect, radius: value } } });
    };
    return {
      paneId: press.paneId,
      target: null,
      update: (e) => {
        const dx = e.x - press.x;
        radius = fromZero
          ? Math.max(MIN_RADIUS, Math.abs(dx) * unitsPerPx)
          : Math.max(MIN_RADIUS, start * 2 ** (dx / RADIUS_DOUBLING_PX));
        set(radius);
        this.hover = { paneId: press.paneId, x: press.x, y: press.y };
        this.updateRing();
      },
      finish: (commit) => {
        if (!commit) {
          set(start);
        } else {
          set(start);
          void app.runUntyped('model.softSelect.set', { radius }, { source: 'tool' });
        }
        this.updateRing();
      },
    };
  }

  // ---------- the INPUTS field's virtual slider (§5.15 MMB rule, §8.6) ----------

  private beginInputs(press: Press): Drag | null {
    const app = this.app;
    const field = selectedInputsField(app);
    if (field === null) return null;
    const last = liveLastRun(app);
    let def: ParamDef | undefined;
    let start: ParamValue | undefined;
    let primitive: { readonly mesh: MeshId; readonly params: ParamValues; readonly kind: string } | null = null;
    if (field.entry === 'lastop') {
      if (last === null) return null;
      def = last.params.find((p) => p.name === field.param);
      start = last.args[field.param];
    } else {
      const record = app.store.get('meshes', field.mesh as MeshId);
      const generator = record?.generator ?? null;
      if (record === undefined || generator === null) return null;
      def = (PRIMITIVE_PARAMS[generator.kind] ?? []).find((p) => p.name === field.param);
      start = generator.params[field.param] ?? def?.default;
      primitive = { mesh: record.id, params: generator.params, kind: generator.kind };
    }
    if (def === undefined || typeof start !== 'number') return null;
    const paramDef = def;
    const rate = paramSliderRate(paramDef, app.prefs.getState().virtualSlider);
    const editsLast =
      field.entry === 'lastop' ||
      (primitive !== null &&
        last !== null &&
        last.id === `mesh.create.${primitive.kind}` &&
        last.targets[0] === primitive.mesh);
    const preview: CardPreview | null = editsLast ? beginCardPreview(app) : null;
    let raw = start;
    let value = start;
    let lastX = press.x;
    return {
      paneId: press.paneId,
      target: null,
      update: (e) => {
        const dx = e.x - lastX;
        lastX = e.x;
        if (dx === 0) return;
        raw += dx * rate * virtualSliderFactor({ shift: e.shift, mod: e.mod });
        const next = clampParamValue(paramDef, raw).value;
        if (next === value) return;
        value = next;
        if (preview !== null && !preview.slow) preview.update({ [paramDef.name]: value });
        setTransformReadout(app, {
          paneId: press.paneId,
          x: e.x,
          y: e.y,
          label: paramDef.label,
          value: formatParam(paramDef, value),
          snap: null,
          ring: null,
        });
      },
      finish: (commit) => {
        setTransformReadout(app, null);
        if (!commit || value === start) {
          preview?.cancel();
          return;
        }
        if (editsLast) {
          void app.runUntyped('edit.adjustLast', { args: { [paramDef.name]: value } }, { source: 'card' });
        } else if (primitive !== null) {
          void app.runUntyped(
            'mesh.primitive.set',
            { mesh: primitive.mesh, params: { ...primitive.params, [paramDef.name]: value } },
            { source: 'card' },
          );
        }
      },
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the soft-weight overlay and the radius ring

  private scheduleSoft(): void {
    if (this.softQueued || this.disposed) return;
    this.softQueued = true;
    queueMicrotask(() => {
      this.softQueued = false;
      if (!this.disposed) this.pushSoft(false);
    });
  }

  /** Pushes each hilited mesh's soft weights to the display (none when soft selection is off). */
  private pushSoft(clear: boolean): void {
    const display = modelSelectOf(this.app)?.display ?? null;
    if (display === null) return;
    const next = new Set<MeshId>();
    if (!clear) {
      for (const mesh of this.app.session.getState().model.hilite) {
        const weights = softWeightsOf(this.app, mesh);
        if (weights === null) continue;
        display.setSoftWeights(mesh, weights);
        next.add(mesh);
      }
    }
    for (const mesh of this.softPushed) if (!next.has(mesh)) display.setSoftWeights(mesh, null);
    this.softPushed = next;
  }

  private trackPointer(e: PointerEvent): void {
    if (!this.held.soft) return;
    const paneId = this.vm.paneAt(e.clientX, e.clientY);
    if (paneId === null) return;
    const rect = this.vm.paneRect(paneId);
    if (rect === null) return;
    if (this.drag === null) this.hover = { paneId, x: e.clientX - rect.x, y: e.clientY - rect.y };
    this.updateRing();
  }

  /** The radius ring at the pointer while `B` is held (§5.15). */
  private updateRing(): void {
    const current = transformReadout(this.app);
    const hover = this.hover;
    if (!this.held.soft || hover === null || this.app.session.getState().model.componentMode === 'object') {
      if (current?.ring !== null && current !== null) {
        setTransformReadout(this.app, current.label === null ? null : { ...current, ring: null });
      }
      return;
    }
    const frame = this.vm.manipulatorFrame(hover.paneId);
    const radius = this.app.session.getState().model.softSelect.radius;
    const r = frame === null || !(frame.unitsPerPx > 0) ? 0 : radius / frame.unitsPerPx;
    setTransformReadout(this.app, {
      paneId: hover.paneId,
      x: hover.x,
      y: hover.y,
      label: current?.label ?? null,
      value: current?.value ?? null,
      snap: current?.snap ?? null,
      ring: { x: hover.x, y: hover.y, r, label: `Radius ${radius.toFixed(2)} m` },
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // selection changes

  private signature(): string {
    const state = this.app.session.getState();
    const kind = state.model.componentMode;
    if (kind === 'object') return 'object';
    const parts: string[] = [kind];
    for (const mesh of state.model.hilite) {
      const sel = this.app.components.get(mesh, kind);
      const set = kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
      parts.push(`${mesh}:${Array.from(set.toArray()).join(',')}`);
    }
    return parts.join('|');
  }

  /** A changed component selection drops the pinned component pivot (Maya resets it with the selection). */
  private onSelectionChanged(): void {
    const next = this.signature();
    if (next === this.selectionSignature) return;
    this.selectionSignature = next;
    if (this.drag !== null) return;
    const state = this.app.session.getState();
    if (state.model.componentPivot !== null) setComponentPivot(this.app, null);
  }
}

function setComponentPivot(app: EditorApp, pivot: Vec3 | null): void {
  const state = app.session.getState();
  app.session.setState({ model: { ...state.model, componentPivot: pivot } });
}

/** A manipulator target on a pivot with a frame (every channel free: components and objects have no locks). */
function manipTarget(pivot: ReadonlyVec3, q: Quat): ManipTarget {
  const all: readonly [boolean, boolean, boolean] = [true, true, true];
  return {
    pivot: [pivot[0], pivot[1], pivot[2]],
    worldQ: q,
    parentQ: q,
    r: [0, 0, 0],
    order: 'xyz',
    keyable: { t: all, r: all, s: all },
  };
}

function formatParam(def: ParamDef, value: number): string {
  if (def.kind === 'distance') return `${value.toFixed(3)} m`;
  if (def.kind === 'angle') return `${((value * 180) / Math.PI).toFixed(1)}°`;
  if (def.kind === 'int') return String(Math.round(value));
  return value.toFixed(3);
}

/** Typed values override the pointer's per frame axis (§5.10). */
function withTyped(motion: Motion, typed: ReadonlyMap<string, number>, frame: Quat): Motion {
  if (typed.size === 0) return motion;
  const args = componentArgs(motion, frame);
  for (const [field, value] of typed) args[field] = value;
  if (motion.kind === 'translate') {
    return {
      kind: 'translate',
      delta: quatRotateVec3(frame, [args['translateX'] ?? 0, args['translateY'] ?? 0, args['translateZ'] ?? 0]),
    };
  }
  if (motion.kind === 'scale') {
    return { kind: 'scale', factors: [args['scaleX'] ?? 1, args['scaleY'] ?? 1, args['scaleZ'] ?? 1] };
  }
  return motion;
}

/** An object at the start of a drag: its placement, its parent's world matrix and its pivot in the scene. */
interface ObjectStart {
  readonly id: string;
  readonly table: 'meshes' | 'groups';
  readonly placement: Xf;
  readonly world: Mat4;
  readonly parent: Mat4;
  readonly parentInverse: Mat4 | null;
  readonly pivot: Vec3;
}

function objectStart(
  app: EditorApp,
  record: SceneObjectRecord,
  characterWorld: (character: CharacterId) => Mat4 | null,
): ObjectStart {
  const world = objectWorld(app, record, characterWorld);
  const local = mat4Compose(record.placement);
  const parent = mat4Multiply(world, mat4Invert(local) ?? local);
  const p = record.placement;
  return {
    id: record.id,
    table: 'data' in record ? 'meshes' : 'groups',
    placement: { t: [p.t[0], p.t[1], p.t[2]], q: [p.q[0], p.q[1], p.q[2], p.q[3]], s: [p.s[0], p.s[1], p.s[2]] },
    world,
    parent,
    parentInverse: mat4Invert(parent),
    pivot: pivotWorld(world, record.pivot),
  };
}

/** The placement of an object after a motion: translations move it, rotations and scales turn it about its pivot. */
export function movedPlacement(start: ObjectStart, motion: Motion, frame: Quat): Xf {
  const inverse = start.parentInverse;
  if (inverse === null) return start.placement;
  if (motion.kind === 'translate') {
    const d = motion.delta;
    const local = [
      (inverse[0] as number) * d[0] + (inverse[4] as number) * d[1] + (inverse[8] as number) * d[2],
      (inverse[1] as number) * d[0] + (inverse[5] as number) * d[1] + (inverse[9] as number) * d[2],
      (inverse[2] as number) * d[0] + (inverse[6] as number) * d[1] + (inverse[10] as number) * d[2],
    ];
    const t = start.placement.t;
    return {
      ...start.placement,
      t: [t[0] + (local[0] as number), t[1] + (local[1] as number), t[2] + (local[2] as number)],
    };
  }
  const moved = mat4Multiply(motionMatrix(motion, start.pivot, frame), start.world);
  const decomposed: ReadonlyXf = mat4Decompose(mat4Multiply(inverse, moved));
  if (motion.kind === 'rotate') return { ...decomposed, s: [...start.placement.s] as Vec3 } as Xf;
  return decomposed as Xf;
}

function descendsFrom(app: EditorApp, id: string, roots: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  let parent: string | null = app.store.get('meshes', id as MeshId)?.parent ?? null;
  while (parent !== null && !seen.has(parent)) {
    if (roots.has(parent)) return true;
    seen.add(parent);
    const next: { readonly parent: string | null } | undefined =
      app.store.get('meshes', parent as MeshId) ?? app.store.get('groups', parent as never);
    parent = next?.parent ?? null;
  }
  return false;
}
