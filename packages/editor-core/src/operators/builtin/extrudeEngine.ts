// The extrude session's engine (M6A-SPEC §5.8, ADR 0016 D7, Q-MOD-UI-7; B12b), a lazy chunk (§5.27) loaded by
// ./extrudeSession.ts on the first Model entry.
//
// - **Open**: after a finished `mesh.extrude` run from any source but the card (keyboard, menus, marking menus, the
//   Toolkit, smart extrude, `G`), and on `T` (`reopen`). The session frame is the §5.8 region frame of the first region
//   of the run's selection, taken before the run (the cap keeps the original face indices, so the frame of a later
//   `T` comes from a memo of that frame, else from the cap). In Model's select tool the extrude manipulator tool
//   (`VIEWPORT_TOOL.extrude`) takes over the viewport until the session ends.
// - **Absorb**: every manipulator drag and every W/E/R or MMB drag on the cap (`beginAbsorb`) converts its world-space
//   delta into the extrude's `local*` args (exact from any manipulator space: translate `t += Aᵀ·M⁻¹·Δt`, rotate
//   `R' = Aᵀ·ΔR·A·R` with A the args frame, scale always in the session frame), previews through the card preview
//   (`meshes.beginOp(…, {base: 'before-last'})`) and commits with one `edit.adjustLast`.
// - **Args undo stack**: each absorbed drag, typed value and card edit pushes its args; `edit.undo`/`edit.redo` step
//   through it first (`stepBack`/`stepForward`: an `edit.adjustLast` with the stack's entry, the history length
//   unchanged); undo at index 0 ends the session and undoes the extrude itself.
// - **End** (the §5.8 table): at the start of the ending gesture — the runner's hook before any other undoable or
//   selection operator and `edit.escape` (zero-drop), the mode and workspace switches (their operators call `end`),
//   a pivot edit (no drop), a remote change to a target mesh (zero-drop), the LastRun closing for any other reason.
// - **Zero-drop**: a session that ends by a dropping event with identity args undoes its extrude and toasts "Extrude
//   removed: it did not move" with an Undo action (`edit.redo`).
// - **Smart extrude** (`beginSmartExtrude`): `Shift` at the start of a handle drag ends the session (zero-drop) and
//   previews a new extrude whose drag becomes its `local*` args; release runs one `mesh.extrude` (one "Extrude" step),
//   which opens a new session.
import {
  eulerNear,
  eulerToQuat,
  mat4Decompose,
  type ParamValue,
  type ParamValues,
  type Quat,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type ReadonlyXf,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import type { BitSet, ComponentKind, EditMesh } from '@ekza-animator/mesh-core';
import { worldPlacement } from '../../mesh/context';
import { meshKernel } from '../../mesh/kernel';
import { targetsOf } from '../../mesh/operator';
import type {
  AbsorbGesture,
  EditorApp,
  ExtrudeSessionState,
  LastRun,
  MeshOpSession,
  OperatorDef,
  RunContext,
} from '../../types';
import { isRecord } from '../../workflows/util';
import { operatorContext } from '../registry';
import { type ExtrudeEngine, type ExtrudeEngineHost, sayModelHelp } from './extrudeSession';
import { adjustingOperator, LAST_RUN_CLOSED, liveLastRun, opsRuntime, pendingAdjust } from './lastop';

/** The extrude's value args at their identity (§5.8 zero-drop: every `local*`, `offset` and `thickness`). */
export const EXTRUDE_IDENTITY: Readonly<Record<string, number>> = Object.freeze({
  localTranslateX: 0,
  localTranslateY: 0,
  localTranslateZ: 0,
  localRotateX: 0,
  localRotateY: 0,
  localRotateZ: 0,
  localScaleX: 1,
  localScaleY: 1,
  localScaleZ: 1,
  offset: 0,
  thickness: 0,
});

/** True when an extrude's args leave the cap where the faces were (§5.8 zero-drop). */
export function isIdentityExtrude(args: ParamValues): boolean {
  for (const [name, identity] of Object.entries(EXTRUDE_IDENTITY)) {
    const value = args[name];
    if (value !== undefined && value !== identity) return false;
  }
  return true;
}

/** The toast and help line of a zero-drop (§5.8). */
export const EXTRUDE_REMOVED = 'Extrude removed: it did not move';
/** The viewport tool that draws the extrude manipulator (§4.7). */
export const EXTRUDE_TOOL = 'extrude';

/** Operators whose start ends the session without the zero-drop (§5.8: "a pivot edit starts"). */
const PIVOT_OPERATORS: ReadonlySet<string> = new Set([
  'model.pivot.editToggle',
  'mesh.pivot.set',
  'mesh.pivot.center',
  'mesh.pivot.bottomCenter',
  'mesh.pivot.reset',
  'mesh.pivot.bake',
]);

// ---------- frames and the args math (pure) ----------

/** A frame: pivot and orthonormal axes (mesh-local or world). */
export interface Frame {
  readonly pivot: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3];
}

/** A drag's world-space delta about the session frame's pivot (`AbsorbGesture.update`). */
export interface AbsorbDelta {
  readonly translate?: Vec3;
  readonly rotate?: Quat;
  readonly scale?: Vec3;
}

type M3 = readonly [number, number, number, number, number, number, number, number, number];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/** Row-major 3×3 of the placement's linear part (world from local: Q·S). */
export function placementLinear(xf: ReadonlyXf): M3 {
  const [qx, qy, qz, qw] = xf.q;
  const [sx, sy, sz] = xf.s;
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx,
    2 * (qx * qy - qz * qw) * sy,
    2 * (qx * qz + qy * qw) * sz,
    2 * (qx * qy + qz * qw) * sx,
    (1 - 2 * (qx * qx + qz * qz)) * sy,
    2 * (qy * qz - qx * qw) * sz,
    2 * (qx * qz - qy * qw) * sx,
    2 * (qy * qz + qx * qw) * sy,
    (1 - 2 * (qx * qx + qy * qy)) * sz,
  ];
}

const mulV = (m: M3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

function invert3(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

/** World point of a mesh-local point. */
export function toWorld(xf: ReadonlyXf, p: Vec3): Vec3 {
  return add(mulV(placementLinear(xf), p), [xf.t[0], xf.t[1], xf.t[2]]);
}

/** The world rotation of a mesh-local orthonormal frame (axes mapped by the placement, re-orthonormalized). */
export function worldAxes(xf: ReadonlyXf, axes: readonly [Vec3, Vec3, Vec3]): [Vec3, Vec3, Vec3] {
  const m = placementLinear(xf);
  const x = normalize(mulV(m, axes[0]));
  const y0 = mulV(m, axes[1]);
  const z = normalize(cross(x, y0));
  return [x, cross(z, x), z];
}

/** Quaternion of the rotation whose columns are `axes` (orthonormal, right-handed). */
export function axesQuat(axes: readonly [Vec3, Vec3, Vec3]): Quat {
  const [x, y, z] = axes;
  const m = new Float64Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]);
  const q = mat4Decompose(m).q;
  return [q[0], q[1], q[2], q[3]];
}

const numberArg = (args: ParamValues, name: string, fallback: number): number => {
  const value = args[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/**
 * The extrude's args after a drag (§5.8 "Conversion uses the args frame A"): `start` are the args when the drag began,
 * `frame` the session frame (mesh-local), `placement` the mesh's world placement. Translate and rotate are exact from
 * any manipulator space; scale multiplies the frame-aligned factors.
 */
export function absorbArgs(
  start: ParamValues,
  delta: AbsorbDelta,
  frame: Frame,
  placement: ReadonlyXf,
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...start };
  const world = start['space'] === 'world';
  const t: Vec3 = [
    numberArg(start, 'localTranslateX', 0),
    numberArg(start, 'localTranslateY', 0),
    numberArg(start, 'localTranslateZ', 0),
  ];
  const r: Vec3 = [
    numberArg(start, 'localRotateX', 0),
    numberArg(start, 'localRotateY', 0),
    numberArg(start, 'localRotateZ', 0),
  ];
  if (delta.translate !== undefined) {
    let d: Vec3 = delta.translate;
    if (!world) {
      const inverse = invert3(placementLinear(placement));
      const local = inverse === null ? d : mulV(inverse, d);
      d = [dot(frame.axes[0], local), dot(frame.axes[1], local), dot(frame.axes[2], local)];
    }
    out['localTranslateX'] = t[0] + d[0];
    out['localTranslateY'] = t[1] + d[1];
    out['localTranslateZ'] = t[2] + d[2];
  }
  if (delta.rotate !== undefined) {
    const qR = eulerToQuat(r, 'xyz');
    let q: Quat;
    if (world) q = quatMultiply(delta.rotate, qR);
    else {
      const qA = axesQuat(worldAxes(placement, frame.axes));
      q = quatMultiply(quatMultiply(quatInvert(qA), quatMultiply(delta.rotate, qA)), qR);
    }
    const e = eulerNear(q, 'xyz', r);
    out['localRotateX'] = e[0];
    out['localRotateY'] = e[1];
    out['localRotateZ'] = e[2];
  }
  if (delta.scale !== undefined) {
    out['localScaleX'] = Math.max(0, numberArg(start, 'localScaleX', 1) * delta.scale[0]);
    out['localScaleY'] = Math.max(0, numberArg(start, 'localScaleY', 1) * delta.scale[1]);
    out['localScaleZ'] = Math.max(0, numberArg(start, 'localScaleZ', 1) * delta.scale[2]);
  }
  return out;
}

/** The frame axes rotated by Euler xyz angles in that frame (columns of A·R, R = Rz·Ry·Rx). */
function rotatedAxes(axes: readonly [Vec3, Vec3, Vec3], r: Vec3): [Vec3, Vec3, Vec3] {
  const q = eulerToQuat(r, 'xyz');
  const col = (e: Vec3): Vec3 => {
    const v = quatRotateVec3(q, e);
    return add(add(scale(axes[0], v[0]), scale(axes[1], v[1])), scale(axes[2], v[2]));
  };
  return [col([1, 0, 0]), col([0, 1, 0]), col([0, 0, 1])];
}

/** Where the extrude manipulator sits (world): the moved pivot, the handle axes and the scale axes. */
export interface ExtrudeManipFrame {
  readonly pivot: Vec3;
  /** Translate and rotate handles: the cap's axes (`local`) or world axes (`world`, the manipulator's toggle). */
  readonly axes: readonly [Vec3, Vec3, Vec3];
  /** Scale handles: always the cap's axes (§5.8 "Scale always uses the session frame"). */
  readonly scaleAxes: readonly [Vec3, Vec3, Vec3];
  readonly space: 'local' | 'world';
}

const WORLD_AXES: readonly [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** The manipulator's frame for args `args` of an extrude whose region frame (mesh-local) is `frame`. */
export function manipulatorFrame(
  args: ParamValues,
  frame: Frame,
  placement: ReadonlyXf,
  space: 'local' | 'world',
): ExtrudeManipFrame {
  const t: Vec3 = [
    numberArg(args, 'localTranslateX', 0),
    numberArg(args, 'localTranslateY', 0),
    numberArg(args, 'localTranslateZ', 0),
  ];
  const r: Vec3 = [
    numberArg(args, 'localRotateX', 0),
    numberArg(args, 'localRotateY', 0),
    numberArg(args, 'localRotateZ', 0),
  ];
  let pivot: Vec3;
  let cap: readonly [Vec3, Vec3, Vec3];
  if (args['space'] === 'world') {
    pivot = add(toWorld(placement, frame.pivot), t);
    cap = rotatedAxes(WORLD_AXES, r);
  } else {
    const local = add(
      frame.pivot,
      add(add(scale(frame.axes[0], t[0]), scale(frame.axes[1], t[1])), scale(frame.axes[2], t[2])),
    );
    pivot = toWorld(placement, local);
    cap = worldAxes(placement, rotatedAxes(frame.axes, r));
  }
  return { pivot, axes: space === 'world' ? WORLD_AXES : cap, scaleAxes: cap, space };
}

// ---------- region frames (§5.8 step 4, step 7) ----------

/** The faces of the region of `faces` holding its lowest-index face (connected through shared edges). */
function firstRegion(m: EditMesh, faces: BitSet, together: boolean): number[] {
  const all = faces.toArray();
  const seed = all[0];
  if (seed === undefined) return [];
  if (!together) return [seed];
  const region = new Set<number>([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const f = queue.pop() as number;
    const first = m.faceCorner(f);
    let c = first;
    do {
      let o = m.cornerRadialNext(c);
      while (o !== c && o >= 0) {
        const g = m.cornerFace(o);
        if (faces.has(g) && !region.has(g)) {
          region.add(g);
          queue.push(g);
        }
        o = m.cornerRadialNext(o);
      }
      c = m.cornerNext(c);
    } while (c !== first);
  }
  return [...region].sort((a, b) => a - b);
}

function point(m: EditMesh, v: number): Vec3 {
  const p = m.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}

/** Newell normal and centroid of a face. */
function faceNormal(m: EditMesh, f: number): { normal: Vec3; centroid: Vec3 } {
  let n: Vec3 = [0, 0, 0];
  let c: Vec3 = [0, 0, 0];
  let count = 0;
  const first = m.faceCorner(f);
  let k = first;
  do {
    const a = point(m, m.cornerVert(k));
    const b = point(m, m.cornerVert(m.cornerNext(k)));
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    c = add(c, a);
    count++;
    k = m.cornerNext(k);
  } while (k !== first);
  return { normal: normalize(n), centroid: scale(c, 1 / Math.max(1, count)) };
}

/** §5.8 step 7 frame of the chain of the lowest-index selected border edge: X along it, Z the face normal, Y away. */
function edgeFrame(m: EditMesh, edges: BitSet): Frame | null {
  const e = edges.toArray()[0];
  if (e === undefined) return null;
  const a = point(m, m.edgeVert(e, 0));
  const b = point(m, m.edgeVert(e, 1));
  let x = normalize(sub(b, a));
  const corner = m.edgeCorner(e);
  const face = corner >= 0 ? faceNormal(m, m.cornerFace(corner)) : null;
  let z: Vec3 = face?.normal ?? [0, 1, 0];
  let y = normalize(cross(z, x));
  const mid = scale(add(a, b), 0.5);
  if (face !== null && dot(y, sub(mid, face.centroid)) < 0) {
    y = scale(y, -1);
    x = scale(x, -1);
  }
  z = cross(x, y);
  return { pivot: mid, axes: [x, y, z] };
}

// ---------- the engine ----------

interface Live {
  state: ExtrudeSessionState;
  /** The session frame (mesh-local) of `mesh`. */
  readonly local: Frame;
  readonly mesh: MeshId;
  /** The tool the manipulator tool replaced (restored when the session ends), null when none was replaced. */
  readonly previousTool: string | null;
  /** Adjusts in flight that step the args stack (they do not push). */
  stepping: number;
  /** No drag has been absorbed yet (Esc during the first drag after `Mod+E` also ends the session). */
  firstDrag: boolean;
}

interface Captured {
  readonly mesh: MeshId;
  readonly frame: Frame;
}

/** The extrude's value args of a LastRun (without `meshes`/`kind`). */
const argsOf = (last: LastRun): ParamValues => last.args;

function sameArgs(a: ParamValues, b: ParamValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** The patch from `start` to `next` (only the changed values). */
function patchOf(start: ParamValues, next: ParamValues): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(next)) if (start[key] !== value) out[key] = value;
  return out;
}

class Engine implements ExtrudeEngine {
  private live: Live | null = null;
  /** The frame captured before a new extrude ran (consumed when its session opens). */
  private pending: Captured | null = null;
  /** The last session's frame by the step of its extrude (`T` reopens with it). */
  private memo: (Captured & { stepId: number }) | null = null;
  /** The frame a smart extrude took before its preview moved the cap (its run takes it over). */
  private smart: Captured | null = null;

  constructor(private readonly host: ExtrudeEngineHost) {
    const app = host.app;
    app.session.subscribe((state, previous) => {
      const live = this.live;
      if (live === null || state.lastRun === previous.lastRun) return;
      const last = state.lastRun;
      if (last !== null && last.closed === LAST_RUN_CLOSED.remote) {
        this.endRemote();
        return;
      }
      if (last === null || last.closed !== null || last.id !== 'mesh.extrude') {
        // The card closed for a reason no operator reported (a store write, an undo elsewhere): the session ends
        // with it; its extrude may already be gone, so nothing is dropped.
        this.end('closed', { drop: false });
        return;
      }
      if (last.stepId !== live.state.stepId) {
        this.publish({ ...live.state, stepId: last.stepId });
        if (this.memo !== null && this.memo.mesh === live.mesh) this.memo = { ...this.memo, stepId: last.stepId };
      }
    });
    app.store.subscribe((batch) => {
      const live = this.live;
      if (live === null || (batch.origin !== 'remote' && batch.origin !== 'import')) return;
      const hit = batch.changes.some((change) => change.table === 'meshes' && live.state.meshes.includes(change.id));
      if (hit) this.endRemote();
    });
  }

  private get app(): EditorApp {
    return this.host.app;
  }

  get state(): ExtrudeSessionState | null {
    return this.live?.state ?? null;
  }

  private publish(state: ExtrudeSessionState): void {
    if (this.live === null) return;
    this.live.state = Object.freeze({ ...state });
    this.host.setState(this.live.state);
  }

  /** The args the session applies now (`stack[index]`). */
  private current(live: Live): ParamValues {
    return live.state.stack[live.state.index] ?? live.state.stack[0] ?? {};
  }

  private placementOf(mesh: MeshId): ReadonlyXf {
    const record = this.app.store.get('meshes', mesh);
    return record === undefined
      ? { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }
      : worldPlacement(this.app.store, record);
  }

  /** The mesh to read frames from: the open edit mesh, else one built from the stored revision. */
  private editMesh(mesh: MeshId): EditMesh | null {
    const runtime = this.app.meshes.get(mesh);
    if (runtime === undefined || runtime.state !== 'ready') return null;
    if (runtime.mesh !== null) return runtime.mesh;
    const data = runtime.data();
    const kernel = meshKernel();
    return data === null || kernel === null ? null : kernel.editMeshFrom(data);
  }

  /** The §5.8 frame of the first region of the current selection of `kind` (faces or border edges). */
  private frameOfSelection(mesh: MeshId, kind: ComponentKind, together: boolean): Frame | null {
    const kernel = meshKernel();
    const m = this.editMesh(mesh);
    if (kernel === null || m === null) return null;
    let sel;
    try {
      sel = this.app.components.get(mesh, kind);
    } catch {
      return null;
    }
    if (kind === 'face') {
      const region = firstRegion(m, sel.faces, together);
      if (region.length === 0) return null;
      try {
        const frame = kernel.regionFrame(m, region);
        return { pivot: [...frame.pivot] as Vec3, axes: frame.axes.map((a) => [...a] as Vec3) as [Vec3, Vec3, Vec3] };
      } catch {
        return null;
      }
    }
    return kind === 'edge' ? edgeFrame(m, sel.edges) : null;
  }

  /** The frame of the selection an extrude is about to run on (`args` as the runner coerced them). */
  captureFrame(args: unknown): Captured | null {
    const state = this.app.session.getState();
    const given = isRecord(args) ? args['kind'] : undefined;
    const mode = state.model.componentMode;
    const kind: ComponentKind | null =
      given === 'face' || given === 'edge' ? given : mode === 'face' || mode === 'edge' ? mode : null;
    if (kind === null) return null;
    const together = !(isRecord(args) && args['keepFacesTogether'] === false);
    for (const mesh of targetsOf(this.app, args, kind, false)) {
      const frame = this.frameOfSelection(mesh, kind, together);
      if (frame !== null) return { mesh, frame };
    }
    return null;
  }

  /** The session frame recovered from the cap (no frame was taken before the run): the cap's region frame, moved
   *  back by the extrude's translation. Exact when only `localTranslate*` moved the cap. */
  private frameFromCap(last: LastRun): Captured | null {
    const mesh = last.targets[0];
    if (mesh === undefined || last.kind === null) return null;
    const frame = this.frameOfSelection(mesh, last.kind, last.args['keepFacesTogether'] !== false);
    if (frame === null) return null;
    const args = argsOf(last);
    const t: Vec3 = [
      numberArg(args, 'localTranslateX', 0),
      numberArg(args, 'localTranslateY', 0),
      numberArg(args, 'localTranslateZ', 0),
    ];
    if (args['space'] === 'world') {
      const inverse = invert3(placementLinear(this.placementOf(mesh)));
      const back = inverse === null ? t : mulV(inverse, t);
      return { mesh, frame: { pivot: sub(frame.pivot, back), axes: frame.axes } };
    }
    const shift = add(add(scale(frame.axes[0], t[0]), scale(frame.axes[1], t[1])), scale(frame.axes[2], t[2]));
    return { mesh, frame: { pivot: sub(frame.pivot, shift), axes: frame.axes } };
  }

  private open(last: LastRun, captured: Captured | null): void {
    const frame = captured ?? this.frameFromCap(last);
    if (frame === null || last.stepId === null) return;
    const placement = this.placementOf(frame.mesh);
    const axes = worldAxes(placement, frame.frame.axes);
    const session = this.app.session.getState();
    const toolFree = session.tools.viewport === 'select' || session.tools.viewport === EXTRUDE_TOOL;
    const manipulator = toolFree && this.app.tools.get('viewport', EXTRUDE_TOOL) !== undefined;
    const state: ExtrudeSessionState = {
      stepId: last.stepId,
      meshes: [...last.targets],
      frame: { pivot: toWorld(placement, frame.frame.pivot), axes },
      stack: [{ ...argsOf(last) }],
      index: 0,
      manipSpace: 'local',
    };
    this.live = {
      state,
      local: frame.frame,
      mesh: frame.mesh,
      previousTool: manipulator && session.tools.viewport !== EXTRUDE_TOOL ? session.tools.viewport : null,
      stepping: 0,
      firstDrag: true,
    };
    this.memo = { ...frame, stepId: last.stepId };
    this.publish(state);
    if (manipulator && session.tools.viewport !== EXTRUDE_TOOL) {
      const tools = this.app.session.getState().tools;
      this.app.session.setState({ tools: { ...tools, viewport: EXTRUDE_TOOL } });
    }
  }

  beforeRun(def: OperatorDef<unknown, unknown, unknown>, args: unknown, ctx: RunContext | undefined): void {
    const adjust = ctx?.source === 'card' && adjustingOperator(this.app) === def.id;
    // `view.*` and `ui.*` (display, camera, panels, `T`) never end the session (§5.8 table).
    const display = def.id.startsWith('view.') || def.id.startsWith('ui.');
    if (this.live !== null && !adjust && !display) {
      const pivot = PIVOT_OPERATORS.has(def.id);
      const ends =
        def.flags?.undo === true ||
        def.flags?.selection === true ||
        def.id === 'edit.escape' ||
        // Leaving Model (its switch ends the session too; here before the run reads anything).
        (def.id === 'workspace.set' && isRecord(args) && args['workspace'] !== 'model') ||
        pivot;
      if (ends) this.end(def.id, { drop: !pivot });
    }
    // After the drop: the cap kept the original face indices, so the frame is that of the faces the run reads.
    if (def.id === 'mesh.extrude' && !adjust) {
      this.pending = this.smart ?? this.captureFrame(args);
      this.smart = null;
    }
  }

  afterRun(def: OperatorDef<unknown, unknown, unknown>, ctx: RunContext | undefined, stepId: number | null): void {
    if (def.id !== 'mesh.extrude') return;
    const last = liveLastRun(this.app);
    const adjust = ctx?.source === 'card' && adjustingOperator(this.app) === def.id;
    if (adjust) {
      const live = this.live;
      if (live === null || last === null || last.id !== 'mesh.extrude') return;
      const args = argsOf(last);
      if (live.stepping > 0) {
        this.publish({ ...live.state, stepId: last.stepId });
        return;
      }
      // A typed value, a card edit or an absorbed drag: one more entry on the args stack (above `index` dropped).
      const current = this.current(live);
      const stack = sameArgs(current, args)
        ? live.state.stack.slice(0, live.state.index + 1)
        : [...live.state.stack.slice(0, live.state.index + 1), { ...args }];
      this.publish({ ...live.state, stepId: last.stepId, stack, index: stack.length - 1 });
      return;
    }
    const captured = this.pending;
    this.pending = null;
    if (stepId === null || last === null || last.id !== 'mesh.extrude' || last.stepId !== stepId) return;
    if (ctx?.source === 'card') return;
    if (this.live !== null) this.end('extrude', { drop: false });
    this.open(last, captured);
  }

  end(reason: string, opts: { readonly drop: boolean }): void {
    const live = this.close();
    if (live !== null && opts.drop && reason !== 'undo') this.drop(live);
  }

  /**
   * Ends the session (state cleared, the manipulator tool's predecessor back unless `keepTool`: a smart extrude started
   * on the manipulator keeps its tool for the drag and the session it opens); returns what it ended.
   */
  private close(keepTool = false): Live | null {
    const live = this.live;
    if (live === null) return null;
    this.live = null;
    this.host.setState(null);
    if (!keepTool) this.restoreTool(live.previousTool);
    return live;
  }

  private restoreTool(previous: string | null): void {
    const tools = this.app.session.getState().tools;
    if (tools.viewport === EXTRUDE_TOOL) {
      this.app.session.setState({ tools: { ...tools, viewport: previous ?? 'select' } });
    }
  }

  /** §5.8 zero-drop: an ended session whose args are the identity undoes its extrude (while it is the top step). */
  private drop(live: Live): void {
    const app = this.app;
    if (!isIdentityExtrude(this.current(live)) || pendingAdjust(app) !== null) return;
    if (app.history.peekUndo()?.id !== live.state.stepId) return;
    app.history.undo();
    app.services.notify.toast({ kind: 'info', text: EXTRUDE_REMOVED, action: { label: 'Undo', op: 'edit.redo' } });
    sayModelHelp(app, EXTRUDE_REMOVED);
  }

  /** A remote change hit a target mesh (§5.8 table: ends, zero-drop): the drop waits until the store's emit ends. */
  private endRemote(): void {
    const live = this.close();
    if (live !== null) queueMicrotask(() => this.drop(live));
  }

  /** Re-runs the session's extrude with the stack's current entry (an args-stack step). */
  private runStackEntry(live: Live): void {
    const args = { ...this.current(live) };
    live.stepping++;
    const done = (): void => {
      live.stepping--;
    };
    this.app.runUntyped('edit.adjustLast', { args }).then(done, done);
  }

  stepBack(): boolean {
    const live = this.live;
    if (live === null) return false;
    if (live.state.index === 0) {
      // Undo at index 0 removes the extrude itself (edit.undo goes on to the history): the session ends with it.
      this.end('undo', { drop: false });
      return false;
    }
    this.publish({ ...live.state, index: live.state.index - 1 });
    this.runStackEntry(live);
    return true;
  }

  stepForward(): boolean {
    const live = this.live;
    if (live === null || live.state.index >= live.state.stack.length - 1) return false;
    this.publish({ ...live.state, index: live.state.index + 1 });
    this.runStackEntry(live);
    return true;
  }

  reopen(): boolean {
    if (this.live !== null) return true;
    const last = liveLastRun(this.app);
    if (last === null || last.id !== 'mesh.extrude') return false;
    const memo = this.memo !== null && this.memo.stepId === last.stepId ? this.memo : null;
    this.open(last, memo);
    return this.live !== null;
  }

  setManipSpace(space: 'local' | 'world'): void {
    const live = this.live;
    if (live === null || live.state.manipSpace === space) return;
    this.publish({ ...live.state, manipSpace: space });
  }

  beginAbsorb(
    _tool: 'move' | 'rotate' | 'scale' | 'mmb',
    _space: 'world' | 'object' | 'component',
  ): AbsorbGesture | null {
    const live = this.live;
    if (live === null) return null;
    const app = this.app;
    const start = { ...this.current(live) };
    const placement = this.placementOf(live.mesh);
    // The card preview from the pre-op mesh (no document writes); null while an adjust is in flight or the runtime
    // chunk is missing: the drag then updates on release.
    let preview: ReturnType<NonNullable<ReturnType<typeof opsRuntime>>['lastop']['beginCardPreview']> = null;
    try {
      preview = pendingAdjust(app) === null ? (opsRuntime()?.lastop.beginCardPreview(app) ?? null) : null;
    } catch {
      preview = null;
    }
    let next: ParamValues = start;
    let done = false;
    return {
      update(delta) {
        if (done) return;
        next = absorbArgs(start, delta, live.local, placement);
        preview?.update(patchOf(start, next));
      },
      commit: () => {
        if (done) return;
        done = true;
        const patch = patchOf(start, next);
        if (Object.keys(patch).length === 0) {
          preview?.cancel();
          return;
        }
        live.firstDrag = false;
        void (async () => {
          const pending = pendingAdjust(app);
          if (pending !== null) await pending;
          if (this.live !== live) {
            preview?.cancel();
            return;
          }
          await app.runUntyped('edit.adjustLast', { args: patch });
        })();
      },
      cancel() {
        if (done) return;
        done = true;
        preview?.cancel();
      },
    };
  }

  /** True while no drag has been absorbed into the session (Esc during it also ends the session, §5.8). */
  get firstDrag(): boolean {
    return this.live?.firstDrag ?? false;
  }

  /** The manipulator's frame now, or null without a session. */
  manipulator(): ExtrudeManipFrame | null {
    const live = this.live;
    if (live === null) return null;
    return manipulatorFrame(this.current(live), live.local, this.placementOf(live.mesh), live.state.manipSpace);
  }

  /** Smart extrude (§5.8): a new extrude whose args come from the drag; one "Extrude" step on commit. */
  beginSmart(ctx: RunContext | undefined): AbsorbGesture | null {
    const app = this.app;
    const def = app.operators.get('mesh.extrude');
    const kernel = meshKernel();
    const op = kernel?.MESH_OPS['mesh.extrude'];
    if (def === undefined || op === undefined || app.session.getState().workspace !== 'model') return null;
    const mode = app.session.getState().model.componentMode;
    if (mode !== 'face' && mode !== 'edge') return null;
    const runCtx: RunContext = { ...ctx, source: 'tool' };
    if ((def.poll?.(operatorContext(app, runCtx), {}) ?? true) !== true) return null;
    // Shift at the start always ends the open session first (its zero-drop included), then reads the selection.
    const ended = this.close(true);
    if (ended !== null) this.drop(ended);
    const previousTool = ended?.previousTool ?? null;
    /** A smart extrude that ran nothing hands the viewport back from the manipulator tool (no session to show). */
    const settle = (): void => {
      if (this.live === null) this.restoreTool(previousTool);
    };
    const captured = this.captureFrame({});
    if (captured === null) {
      settle();
      return null;
    }
    const targets = targetsOf(app, {}, mode, false);
    const defaults = app.prefs.getState().modeling.optionDefaults['mesh.extrude'] ?? {};
    const start: ParamValues = { ...defaults };
    const placement = this.placementOf(captured.mesh);
    let session: MeshOpSession | null = null;
    try {
      session = app.meshes.beginOp(op, targets, start);
    } catch {
      session = null;
    }
    let next: ParamValues = start;
    let done = false;
    return {
      update(delta) {
        if (done) return;
        next = absorbArgs(start, delta, captured.frame, placement);
        if (session?.active === true) session.update(next);
      },
      commit: () => {
        if (done) return;
        done = true;
        if (Object.keys(patchOf(start, next)).length === 0) {
          if (session?.active === true) session.cancel();
          settle();
          return;
        }
        this.smart = captured;
        void app.runUntyped('mesh.extrude', { ...next }, runCtx).then((result) => {
          if (result.status !== 'finished' && session?.active === true) session.cancel();
          settle();
        });
      },
      cancel() {
        if (done) return;
        done = true;
        if (session?.active === true) session.cancel();
        settle();
      },
    };
  }
}

/** Creates the engine of one app (the shim calls it once the chunk has loaded). */
export function createExtrudeEngine(host: ExtrudeEngineHost): ExtrudeEngine {
  return new Engine(host);
}

const engineOf = (app: EditorApp): Engine | null => {
  const shim = app.extrude as Partial<{ engine(): unknown }>;
  const engine = typeof shim.engine === 'function' ? shim.engine() : null;
  return engine instanceof Engine ? engine : null;
};

/** The extrude manipulator's frame (world), or null without a session or before the engine has loaded. */
export function extrudeManipulatorFrame(app: EditorApp): ExtrudeManipFrame | null {
  return engineOf(app)?.manipulator() ?? null;
}

/** True while no drag has been absorbed into the open session (the manipulator tool's Esc rule, §5.8). */
export function extrudeFirstDrag(app: EditorApp): boolean {
  return engineOf(app)?.firstDrag ?? false;
}

/**
 * Smart extrude (§5.8): `Shift` held at the start of a W/E/R (or extrude manipulator) handle drag with faces or border
 * edges selected. Ends the open session (zero-drop), previews a new extrude from the drag's world-space delta (the
 * same conversion as `beginAbsorb`) and runs one `mesh.extrude` on commit (`source: 'tool'`, one "Extrude" step; its
 * session opens). Null when there is nothing to extrude (object mode, no faces or border edges): the tool moves
 * normally, and so before the engine has loaded.
 */
export function beginSmartExtrude(app: EditorApp, ctx?: RunContext): AbsorbGesture | null {
  return engineOf(app)?.beginSmart(ctx) ?? null;
}
