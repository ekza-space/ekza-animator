// Manipulator drag maths (MVP-SPEC §4.11.16, research 07 §14.3): pointer positions → channel edits for every
// dragged control. Pure functions of the drag-start state and the current pointer, so a drag never accumulates
// error and the result is testable without a renderer.
import {
  eulerNear,
  eulerToQuat,
  type Mat4,
  mat4Compose,
  mat4Decompose,
  mat4Invert,
  mat4Multiply,
  type Quat,
  quatFromAxisAngle,
  quatInvert,
  quatMultiply,
  type ReadonlyVec3,
  type RotateOrder,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import type { ChannelEdit, ManipSpace } from '@ekza-animator/editor-core';
import type { Camera } from 'three';
import type { PaneProjector } from '../picking/geometry';
import type { ManipHandle } from '../types';

/** Drag-start state of one dragged control. */
export interface DragControl {
  readonly control: ControlId;
  readonly order: RotateOrder;
  readonly t0: Vec3;
  readonly r0: Vec3;
  /** Scene-space parent·offset frame P = W · L⁻¹ (column-major). */
  readonly parent: Mat4;
  /** Rotation of P. */
  readonly parentQ: Quat;
  /** Rotation of the control's scene-space world matrix W (= parentQ · q(r0)). */
  readonly worldQ: Quat;
  /** Channels the drag may write: keyable and not locked. */
  readonly keyable: {
    readonly t: readonly [boolean, boolean, boolean];
    readonly r: readonly [boolean, boolean, boolean];
  };
  /** Locked rotate channels: a ring whose channel is locked leaves the control alone (see `rotateEdits`). */
  readonly lockedR: readonly [boolean, boolean, boolean];
}

/** Builds a DragControl from the control's scene-space world matrix and its current channel values. */
export function dragControl(args: {
  readonly control: ControlId;
  readonly order: RotateOrder;
  readonly world: Mat4;
  readonly t: ReadonlyVec3;
  readonly r: ReadonlyVec3;
  readonly s: ReadonlyVec3;
  readonly keyable: DragControl['keyable'];
  /** Locked rotate channels; default none. */
  readonly lockedR?: DragControl['lockedR'];
}): DragControl {
  const qr = eulerToQuat(args.r, args.order);
  const local = mat4Compose({ t: [...args.t] as Vec3, q: qr, s: [...args.s] as Vec3 });
  const inverse = mat4Invert(local) ?? local;
  const parent = mat4Multiply(args.world, inverse);
  const parentQ = mat4Decompose(parent).q;
  return {
    control: args.control,
    order: args.order,
    t0: [args.t[0], args.t[1], args.t[2]],
    r0: [args.r[0], args.r[1], args.r[2]],
    parent,
    parentQ,
    worldQ: quatMultiply(parentQ, qr),
    keyable: args.keyable,
    lockedR: args.lockedR ?? [false, false, false],
  };
}

/** The pane a drag happens in: projection of world points and pointer rays (frozen at drag start). */
export interface DragView {
  readonly camera: Camera;
  readonly projector: PaneProjector;
}

export interface DragSession {
  readonly handle: ManipHandle;
  /** Channel edits for the pointer at pane CSS px (x, y). */
  update(x: number, y: number): readonly ChannelEdit[];
  /** Last rotation angle (radians) or translation distance (metres) along the handle, for readouts. */
  readonly amount: number;
}

const AXIS_OF: Partial<Record<ManipHandle, 0 | 1 | 2>> = { tx: 0, ty: 1, tz: 2, rx: 0, ry: 1, rz: 2 };
const PLANE_NORMAL_OF: Partial<Record<ManipHandle, 0 | 1 | 2>> = { tyz: 0, txz: 1, txy: 2 };

// ---------------------------------------------------------------------------------------------------------------
// translate

/**
 * Translate drag: axis handles move along an axis (closest point between the pointer ray and the axis line), plane
 * handles in a plane, `tview` in the screen plane through the pivot. Every control moves by the same scene-space
 * delta, converted into its own parent·offset frame.
 */
export function translateDrag(args: {
  readonly handle: ManipHandle;
  readonly pivot: ReadonlyVec3;
  /** Unit handle axes in scene space (world or object frame). */
  readonly axes: readonly [ReadonlyVec3, ReadonlyVec3, ReadonlyVec3];
  readonly controls: readonly DragControl[];
  readonly view: DragView;
  readonly start: { readonly x: number; readonly y: number };
}): DragSession {
  const { handle, pivot, axes, view } = args;
  const origin = [0, 0, 0];
  const dir = [0, 0, 0];
  const axisIndex = AXIS_OF[handle];
  const normalIndex = PLANE_NORMAL_OF[handle];
  const forward = cameraForward(view.camera);

  const hitAt = (x: number, y: number): Vec3 | null => {
    view.projector.ray(view.camera, x, y, origin, dir);
    if (axisIndex !== undefined) {
      const s = rayLineParameter(origin, dir, pivot, axes[axisIndex]);
      if (s === null) return null;
      const u = axes[axisIndex];
      return [pivot[0] + u[0] * s, pivot[1] + u[1] * s, pivot[2] + u[2] * s];
    }
    const normal = normalIndex !== undefined ? axes[normalIndex] : forward;
    return rayPlane(origin, dir, pivot, normal);
  };

  const start = hitAt(args.start.x, args.start.y);
  let amount = 0;
  return {
    handle,
    get amount() {
      return amount;
    },
    update(x: number, y: number): readonly ChannelEdit[] {
      const hit = start === null ? null : hitAt(x, y);
      if (start === null || hit === null) return [];
      const delta: Vec3 = [hit[0] - start[0], hit[1] - start[1], hit[2] - start[2]];
      amount = Math.hypot(delta[0], delta[1], delta[2]);
      return translateEdits(args.controls, delta);
    },
  };
}

/** Edits that move every control by a scene-space delta (converted into each parent·offset frame). */
export function translateEdits(controls: readonly DragControl[], delta: ReadonlyVec3): ChannelEdit[] {
  const edits: ChannelEdit[] = [];
  for (const c of controls) {
    const local = solveLinear(c.parent, delta);
    if (local === null) continue;
    const channels = ['tx', 'ty', 'tz'] as const;
    for (let i = 0; i < 3; i++) {
      if (!(c.keyable.t[i] ?? false)) continue;
      edits.push({
        control: c.control,
        channel: channels[i] as 'tx',
        value: (c.t0[i] as number) + (local[i] as number),
      });
    }
  }
  return edits;
}

// ---------------------------------------------------------------------------------------------------------------
// rotate

/**
 * Rotate drag on a ring. The angle is the pointer's travel along the ring's screen tangent at the grab point divided
 * by the ring's screen speed there (px per radian): dragging along the ring makes the grabbed point follow the
 * pointer. Gimbal rings add the angle to their own channel; object/world/view rings rotate through quaternions and
 * convert back with `eulerNear` against the previous values.
 */
export function rotateDrag(args: {
  readonly handle: ManipHandle;
  readonly space: ManipSpace;
  readonly pivot: ReadonlyVec3;
  /** Unit rotation axis of the dragged ring in scene space (for gimbal rings: the gimbal axis). */
  readonly axis: ReadonlyVec3;
  /** Grab point on the ring (scene space). */
  readonly grab: ReadonlyVec3;
  readonly controls: readonly DragControl[];
  readonly view: DragView;
  readonly start: { readonly x: number; readonly y: number };
}): DragSession & { readonly tangentPx: readonly [number, number] } {
  const tangent = ringScreenTangent(args.view.projector, args.pivot, args.axis, args.grab);
  const speed = Math.hypot(tangent[0], tangent[1]);
  const references = args.controls.map((c) => [...c.r0] as Vec3);
  let amount = 0;
  return {
    handle: args.handle,
    tangentPx: tangent,
    get amount() {
      return amount;
    },
    update(x: number, y: number): readonly ChannelEdit[] {
      if (speed < 1e-6) return [];
      const dx = x - args.start.x;
      const dy = y - args.start.y;
      const angle = (dx * tangent[0] + dy * tangent[1]) / (speed * speed);
      amount = angle;
      return rotateEdits(args.handle, args.space, args.controls, args.axis, angle, references);
    },
  };
}

/**
 * Edits for rotating every control by `angle` about the handle's axis. `references` (per control, updated in place)
 * keeps the Euler solution continuous across updates. Controls whose channel of the dragged ring is locked get no
 * edits at all.
 */
export function rotateEdits(
  handle: ManipHandle,
  space: ManipSpace,
  controls: readonly DragControl[],
  sceneAxis: ReadonlyVec3,
  angle: number,
  references: Vec3[],
): ChannelEdit[] {
  const edits: ChannelEdit[] = [];
  const channels = ['rx', 'ry', 'rz'] as const;
  const axisIndex = AXIS_OF[handle];
  controls.forEach((c, i) => {
    const reference = references[i] ?? ([...c.r0] as Vec3);
    // Maya: dragging a ring whose channel is locked leaves the control alone in every space; it never turns the
    // control about the other two axes instead (object/world rings would otherwise write the unlocked channels).
    if (handle !== 'rview' && axisIndex !== undefined && c.lockedR[axisIndex]) return;
    if (space === 'gimbal' && handle !== 'rview' && axisIndex !== undefined) {
      if (!(c.keyable.r[axisIndex] ?? false)) return;
      edits.push({
        control: c.control,
        channel: channels[axisIndex],
        value: c.r0[axisIndex] + angle,
      });
      return;
    }
    const q0 = eulerToQuat(c.r0, c.order);
    let q: Quat;
    if (space === 'object' && handle !== 'rview' && axisIndex !== undefined) {
      const local: Vec3 = [0, 0, 0];
      local[axisIndex] = 1;
      q = quatMultiply(q0, quatFromAxisAngle(local, angle));
    } else {
      // Scene-space axis → q_L' = q_P⁻¹ · Δ · q_P · q_L0.
      const delta = quatFromAxisAngle(sceneAxis, angle);
      q = quatMultiply(quatMultiply(quatMultiply(quatInvert(c.parentQ), delta), c.parentQ), q0);
    }
    const r = eulerNear(q, c.order, reference);
    references[i] = r;
    for (let k = 0; k < 3; k++) {
      if (!(c.keyable.r[k] ?? false)) continue;
      edits.push({ control: c.control, channel: channels[k] as 'rx', value: r[k] as number });
    }
  });
  return edits;
}

/**
 * Screen velocity (px per radian) of the grab point when the ring rotates by +θ about `axis`: the projected
 * derivative of p(θ) = c + R(axis, θ)(g − c), i.e. of axis × (g − c).
 */
export function ringScreenTangent(
  projector: PaneProjector,
  pivot: ReadonlyVec3,
  axis: ReadonlyVec3,
  grab: ReadonlyVec3,
): [number, number] {
  const arm: Vec3 = [grab[0] - pivot[0], grab[1] - pivot[1], grab[2] - pivot[2]];
  const v = cross(axis, arm);
  const eps = 1e-4;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  if (!projector.project(grab[0], grab[1], grab[2], a)) return [0, 0];
  if (!projector.project(grab[0] + v[0] * eps, grab[1] + v[1] * eps, grab[2] + v[2] * eps, b)) return [0, 0];
  return [((b[0] as number) - (a[0] as number)) / eps, ((b[1] as number) - (a[1] as number)) / eps];
}

// ---------------------------------------------------------------------------------------------------------------
// helpers

export function cameraForward(camera: Camera): Vec3 {
  const e = camera.matrixWorld.elements;
  const x = -e[8];
  const y = -e[9];
  const z = -e[10];
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/** Parameter s of the point on line (p + s·u) closest to the ray; null when the ray runs along the line. */
export function rayLineParameter(
  origin: ArrayLike<number>,
  dir: ArrayLike<number>,
  p: ReadonlyVec3,
  u: ReadonlyVec3,
): number | null {
  const d0 = dir[0] as number;
  const d1 = dir[1] as number;
  const d2 = dir[2] as number;
  const w0 = p[0] - (origin[0] as number);
  const w1 = p[1] - (origin[1] as number);
  const w2 = p[2] - (origin[2] as number);
  const a = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const b = u[0] * d0 + u[1] * d1 + u[2] * d2;
  const c = d0 * d0 + d1 * d1 + d2 * d2;
  const d = u[0] * w0 + u[1] * w1 + u[2] * w2;
  const e = d0 * w0 + d1 * w1 + d2 * w2;
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9 * a * c) return null;
  return (b * e - c * d) / denom;
}

/** Intersection of a ray with the plane through p with normal n; null when parallel. */
export function rayPlane(
  origin: ArrayLike<number>,
  dir: ArrayLike<number>,
  p: ReadonlyVec3,
  n: ReadonlyVec3,
): Vec3 | null {
  const denom = n[0] * (dir[0] as number) + n[1] * (dir[1] as number) + n[2] * (dir[2] as number);
  if (Math.abs(denom) < 1e-9) return null;
  const t =
    (n[0] * (p[0] - (origin[0] as number)) +
      n[1] * (p[1] - (origin[1] as number)) +
      n[2] * (p[2] - (origin[2] as number))) /
    denom;
  return [
    (origin[0] as number) + (dir[0] as number) * t,
    (origin[1] as number) + (dir[1] as number) * t,
    (origin[2] as number) + (dir[2] as number) * t,
  ];
}

export function cross(a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Solves M₃ₓ₃ · x = v for the linear part of a column-major 4×4 matrix; null when singular. */
export function solveLinear(m: Mat4, v: ReadonlyVec3): Vec3 | null {
  const a = m[0] as number;
  const b = m[4] as number;
  const c = m[8] as number;
  const d = m[1] as number;
  const e = m[5] as number;
  const f = m[9] as number;
  const g = m[2] as number;
  const h = m[6] as number;
  const i = m[10] as number;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return [
    ((e * i - f * h) * v[0] + (c * h - b * i) * v[1] + (b * f - c * e) * v[2]) * inv,
    ((f * g - d * i) * v[0] + (a * i - c * g) * v[1] + (c * d - a * f) * v[2]) * inv,
    ((d * h - e * g) * v[0] + (b * g - a * h) * v[1] + (a * e - b * d) * v[2]) * inv,
  ];
}
