// Scale drag maths (M6A-SPEC §4.7, §6.2; B9): the viewport Scale tool (`R`) on controls (Animate: `sx/sy/sz`
// channels) and on scene objects (Model object mode: mesh and group placements). Axis handles scale along one object
// axis by the ratio of the pointer's position along the axis to the grab position (Maya: crossing the pivot mirrors);
// the centre handle scales uniformly by the horizontal-minus-vertical pointer travel in units of the manipulator
// size (right or up grows). Pure functions of the drag start and the pointer, so a drag never accumulates error.
import { quatRotateVec3, type ReadonlyVec3, type ReadonlyXf, type Vec3, type Xf } from '@ekza-animator/anim-core';
import type { ChannelEdit } from '@ekza-animator/editor-core';
import type { ManipHandle } from '../../types';
import { type DragControl, type DragSession, type DragView, rayLineParameter } from '../drag';

export type ScaleHandle = 'sx' | 'sy' | 'sz' | 'suniform';
export const SCALE_HANDLES: readonly ScaleHandle[] = ['sx', 'sy', 'sz', 'suniform'];
const AXIS: Readonly<Record<Exclude<ScaleHandle, 'suniform'>, 0 | 1 | 2>> = { sx: 0, sy: 1, sz: 2 };
/** The smallest uniform factor (a uniform drag never collapses or mirrors a whole object). */
export const MIN_UNIFORM_SCALE = 0.01;

export function isScaleHandle(handle: ManipHandle): handle is ScaleHandle {
  return handle === 'sx' || handle === 'sy' || handle === 'sz' || handle === 'suniform';
}

/** Where a scale drag happens: the handle, the pivot and object axes (scene space), the pane and the start. */
export interface ScaleDragArgs {
  readonly handle: ScaleHandle;
  readonly pivot: ReadonlyVec3;
  readonly axes: readonly [ReadonlyVec3, ReadonlyVec3, ReadonlyVec3];
  readonly view: DragView;
  readonly start: { readonly x: number; readonly y: number };
  /** The manipulator size in CSS px (the uniform handle's unit of travel). */
  readonly sizePx: number;
}

/**
 * The per-axis factors (object axes) of a scale drag for a pointer position; null while they cannot be computed
 * (the pointer ray runs along the axis, or the grab sits on the pivot).
 */
export function scaleFactors(args: ScaleDragArgs): (x: number, y: number) => Vec3 | null {
  const { handle, pivot, axes, view } = args;
  if (handle === 'suniform') {
    const unit = Math.max(args.sizePx, 1);
    return (x, y) => {
      const f = Math.max(MIN_UNIFORM_SCALE, 1 + (x - args.start.x - (y - args.start.y)) / unit);
      return [f, f, f];
    };
  }
  const k = AXIS[handle];
  const axis = axes[k];
  const origin = [0, 0, 0];
  const dir = [0, 0, 0];
  const along = (x: number, y: number): number | null => {
    view.projector.ray(view.camera, x, y, origin, dir);
    return rayLineParameter(origin, dir, pivot, axis);
  };
  const s0 = along(args.start.x, args.start.y);
  return (x, y) => {
    const s = along(x, y);
    if (s0 === null || s === null || Math.abs(s0) < 1e-9) return null;
    const factors: Vec3 = [1, 1, 1];
    factors[k] = s / s0;
    return factors;
  };
}

/** Scale channel edits: every control's keyable `s` channels times the factors (each in its own object axes). */
export function scaleEdits(controls: readonly DragControl[], factors: ReadonlyVec3): ChannelEdit[] {
  const edits: ChannelEdit[] = [];
  const channels = ['sx', 'sy', 'sz'] as const;
  for (const c of controls) {
    const keyable = c.keyable.s;
    if (keyable === undefined) continue;
    for (let i = 0; i < 3; i++) {
      if (!(keyable[i] ?? false)) continue;
      edits.push({
        control: c.control,
        channel: channels[i] as 'sx',
        value: (c.s0[i] as number) * (factors[i] as number),
      });
    }
  }
  return edits;
}

/** A Scale tool drag on controls: channel edits for the pointer, like the move and rotate drags. */
export function scaleDrag(args: ScaleDragArgs & { readonly controls: readonly DragControl[] }): DragSession {
  const factorsAt = scaleFactors(args);
  const k = args.handle === 'suniform' ? 0 : AXIS[args.handle];
  let amount = 1;
  return {
    handle: args.handle,
    get amount() {
      return amount;
    },
    update(x: number, y: number): readonly ChannelEdit[] {
      const factors = factorsAt(x, y);
      if (factors === null) return [];
      amount = factors[k];
      return scaleEdits(args.controls, factors);
    },
  };
}

/** A scene object (mesh or group) at the start of a scale drag: its placement and its pivot (object space). */
export interface ScaleObject {
  readonly id: string;
  readonly placement: ReadonlyXf;
  readonly pivot: ReadonlyVec3;
}

/**
 * The placement of an object scaled by per-axis factors in its own axes about its pivot: the scale multiplies, the
 * translation moves so the pivot keeps its place in the parent (t' = t + R((S − S′)·p)).
 */
export function scalePlacement(object: ScaleObject, factors: ReadonlyVec3): Xf {
  const { t, q, s } = object.placement;
  const s2: Vec3 = [s[0] * factors[0], s[1] * factors[1], s[2] * factors[2]];
  const p = object.pivot;
  const local: Vec3 = [(s[0] - s2[0]) * p[0], (s[1] - s2[1]) * p[1], (s[2] - s2[2]) * p[2]];
  const shift = quatRotateVec3(q, local);
  return { t: [t[0] + shift[0], t[1] + shift[1], t[2] + shift[2]], q: [q[0], q[1], q[2], q[3]], s: s2 };
}

/** A Scale tool drag on scene objects: the placements for the pointer (null while not computable). */
export interface ObjectScaleSession {
  readonly handle: ScaleHandle;
  readonly ids: readonly string[];
  /** The factor along the dragged axis (uniform: the factor), for readouts. */
  readonly amount: number;
  update(x: number, y: number): readonly Xf[] | null;
}

export function objectScaleDrag(
  args: ScaleDragArgs & { readonly objects: readonly ScaleObject[] },
): ObjectScaleSession {
  const factorsAt = scaleFactors(args);
  const k = args.handle === 'suniform' ? 0 : AXIS[args.handle];
  let amount = 1;
  return {
    handle: args.handle,
    ids: args.objects.map((object) => object.id),
    get amount() {
      return amount;
    },
    update(x: number, y: number): readonly Xf[] | null {
      const factors = factorsAt(x, y);
      if (factors === null) return null;
      amount = factors[k];
      return args.objects.map((object) => scalePlacement(object, factors));
    },
  };
}
