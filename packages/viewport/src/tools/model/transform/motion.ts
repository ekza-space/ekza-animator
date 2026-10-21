// Pointer → motion maths of Model's transform drags (M6A-SPEC §5.15; B12a): the same handle rules as the shipped
// control drags (`manipulators/drag.ts`), but producing a world-space motion — a translation, a rotation about an
// axis through the pivot, or per-axis scale factors along the manipulator's axes — that the runtime turns into
// `mesh.transformComponents` args, object placements or a moved pivot. MMB drags use the same rules with a
// virtual handle (the last-picked one, else the view plane, the view axis or uniform scale). Pure functions of the
// drag start and the pointer: a drag never accumulates error.
import type { ReadonlyVec3, Vec3 } from '@ekza-studio/anim-core';
import { cameraForward, rayLineParameter, rayPlane, ringScreenTangent } from '../../../manipulators/drag';
import type { ManipMode } from '../../../manipulators/ManipulatorKit';
import type { ManipHandle } from '../../../types';
import type { ManipulatorFrame } from './types';

/** What a drag does to the selection, in world space. */
export type Motion =
  | { readonly kind: 'translate'; readonly delta: Vec3 }
  | { readonly kind: 'rotate'; readonly axis: Vec3; readonly angle: number }
  | { readonly kind: 'scale'; readonly factors: Vec3 };

export const TRANSLATE_AXIS: Partial<Record<ManipHandle, 0 | 1 | 2>> = { tx: 0, ty: 1, tz: 2 };
export const ROTATE_AXIS: Partial<Record<ManipHandle, 0 | 1 | 2>> = { rx: 0, ry: 1, rz: 2 };
export const SCALE_AXIS: Partial<Record<ManipHandle, 0 | 1 | 2>> = { sx: 0, sy: 1, sz: 2 };
/** Plane handles: their normal axis. */
export const PLANE_NORMAL: Partial<Record<ManipHandle, 0 | 1 | 2>> = { tyz: 0, txz: 1, txy: 2 };

const TRANSLATE_HANDLES = new Set<ManipHandle>(['tx', 'ty', 'tz', 'txy', 'tyz', 'txz', 'tview']);
const ROTATE_HANDLES = new Set<ManipHandle>(['rx', 'ry', 'rz', 'rview']);
const SCALE_HANDLES = new Set<ManipHandle>(['sx', 'sy', 'sz', 'suniform']);

/** The handles of a manipulator mode. */
export function handleMode(handle: ManipHandle): ManipMode | null {
  if (TRANSLATE_HANDLES.has(handle)) return 'translate';
  if (ROTATE_HANDLES.has(handle)) return 'rotate';
  if (SCALE_HANDLES.has(handle)) return 'scale';
  return null;
}

/**
 * The handle an MMB drag follows (§5.15): the last-picked handle when it belongs to the mode, else the view plane
 * (move), the view axis (rotate) or uniform scale.
 */
export function mmbHandle(mode: ManipMode, last: ManipHandle | null): ManipHandle {
  if (last !== null && handleMode(last) === mode) return last;
  return mode === 'translate' ? 'tview' : mode === 'rotate' ? 'rview' : 'suniform';
}

/** The pane and frame a drag reads (frozen at its start). */
export interface DragFrame {
  readonly frame: ManipulatorFrame;
  readonly pivot: ReadonlyVec3;
  readonly axes: readonly [ReadonlyVec3, ReadonlyVec3, ReadonlyVec3];
  readonly start: { readonly x: number; readonly y: number };
}

/** The motion of a drag on `handle` for a pointer at pane CSS px (null while not computable). */
export function motionAt(handle: ManipHandle, drag: DragFrame): (x: number, y: number) => Motion | null {
  const mode = handleMode(handle);
  if (mode === 'translate') return translateMotion(handle, drag);
  if (mode === 'rotate') return rotateMotion(handle, drag);
  if (mode === 'scale') return scaleMotion(handle, drag);
  return () => null;
}

function translateMotion(handle: ManipHandle, drag: DragFrame): (x: number, y: number) => Motion | null {
  const { frame, pivot, axes } = drag;
  const origin = [0, 0, 0];
  const dir = [0, 0, 0];
  const axisIndex = TRANSLATE_AXIS[handle];
  const normalIndex = PLANE_NORMAL[handle];
  const forward = cameraForward(frame.camera);
  const hitAt = (x: number, y: number): Vec3 | null => {
    frame.projector.ray(frame.camera, x, y, origin, dir);
    if (axisIndex !== undefined) {
      const u = axes[axisIndex];
      const s = rayLineParameter(origin, dir, pivot, u);
      return s === null ? null : [pivot[0] + u[0] * s, pivot[1] + u[1] * s, pivot[2] + u[2] * s];
    }
    return rayPlane(origin, dir, pivot, normalIndex !== undefined ? axes[normalIndex] : forward);
  };
  const start = hitAt(drag.start.x, drag.start.y);
  return (x, y) => {
    const hit = start === null ? null : hitAt(x, y);
    if (start === null || hit === null) return null;
    return { kind: 'translate', delta: [hit[0] - start[0], hit[1] - start[1], hit[2] - start[2]] };
  };
}

function rotateMotion(handle: ManipHandle, drag: DragFrame): (x: number, y: number) => Motion | null {
  const { frame, pivot } = drag;
  const k = ROTATE_AXIS[handle];
  const axis: Vec3 = k === undefined ? frame.ringAxis('rview') : ([...drag.axes[k]] as Vec3);
  const grab =
    frame.ringGrab(handle, drag.start.x, drag.start.y) ??
    ([pivot[0], pivot[1] + frame.unitsPerPx * 60, pivot[2]] as Vec3);
  const tangent = ringScreenTangent(frame.projector, pivot, axis, grab);
  const speed = Math.hypot(tangent[0], tangent[1]);
  return (x, y) => {
    if (speed < 1e-6) return null;
    const dx = x - drag.start.x;
    const dy = y - drag.start.y;
    return { kind: 'rotate', axis, angle: (dx * tangent[0] + dy * tangent[1]) / (speed * speed) };
  };
}

/** The smallest uniform factor (a uniform drag never collapses or mirrors the selection). */
export const MIN_UNIFORM_SCALE = 0.01;

function scaleMotion(handle: ManipHandle, drag: DragFrame): (x: number, y: number) => Motion | null {
  const { frame, pivot, axes } = drag;
  const k = SCALE_AXIS[handle];
  if (k === undefined) {
    const unit = Math.max(frame.sizePx, 1);
    return (x, y) => {
      const f = Math.max(MIN_UNIFORM_SCALE, 1 + (x - drag.start.x - (y - drag.start.y)) / unit);
      return { kind: 'scale', factors: [f, f, f] };
    };
  }
  const axis = axes[k];
  const origin = [0, 0, 0];
  const dir = [0, 0, 0];
  const along = (x: number, y: number): number | null => {
    frame.projector.ray(frame.camera, x, y, origin, dir);
    return rayLineParameter(origin, dir, pivot, axis);
  };
  const s0 = along(drag.start.x, drag.start.y);
  return (x, y) => {
    const s = along(x, y);
    if (s0 === null || s === null || Math.abs(s0) < 1e-9) return null;
    const factors: Vec3 = [1, 1, 1];
    factors[k] = s / s0;
    return { kind: 'scale', factors };
  };
}

/** The axes a handle moves along (translate: the axis, the plane's two axes, all three for the view plane). */
export function movedAxes(handle: ManipHandle): readonly (0 | 1 | 2)[] {
  const axis = TRANSLATE_AXIS[handle];
  if (axis !== undefined) return [axis];
  const normal = PLANE_NORMAL[handle];
  if (normal !== undefined) return ([0, 1, 2] as const).filter((k) => k !== normal);
  return [0, 1, 2];
}

/** Whether a motion changes nothing. */
export function isIdentityMotion(motion: Motion): boolean {
  if (motion.kind === 'translate') return motion.delta.every((v) => v === 0);
  if (motion.kind === 'rotate') return motion.angle === 0;
  return motion.factors.every((f) => f === 1);
}
