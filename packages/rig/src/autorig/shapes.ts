import {
  mat4Decompose,
  type Quat,
  quatInvert,
  quatRotateVec3,
  quatShortestArc,
  type ReadonlyQuat,
  type ReadonlyVec3,
  type SplineSet,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ControlShape } from '@ekza-animator/doc';

// Control shapes for the auto-rig (MVP-SPEC §4.11.15). Built-in planar shapes are unit size in XY with normal +Z;
// `size` is the radius / half-extent in metres and `offset` places the shape in control-local space.

export type SizeGroup = 'torso' | 'jaw' | 'shoulder' | 'limb' | 'extremity' | 'finger' | 'generic';

/** fallback, min and max per group, as multiples of the character height H (fallback also from ℓ_b). */
const SIZE_RULES: Readonly<
  Record<SizeGroup, { readonly bone: number; readonly h: number; readonly min: number; readonly max: number }>
> = {
  torso: { bone: 0.15, h: 0.09, min: 0.05, max: 0.25 },
  // The jaw is not in the §4.11.15 table; it gets the hand/foot rule so it stays inside the head circle.
  jaw: { bone: 0.15, h: 0.04, min: 0.03, max: 0.1 },
  shoulder: { bone: 0.15, h: 0.04, min: 0.025, max: 0.1 },
  limb: { bone: 0.15, h: 0.035, min: 0.025, max: 0.15 },
  extremity: { bone: 0.15, h: 0.04, min: 0.03, max: 0.1 },
  finger: { bone: 0, h: 0.006, min: 0.006, max: 0.01 },
  generic: { bone: 0.15, h: 0.02, min: 0.01, max: 0.25 },
};

/** Where the shape centre sits along the bone, as a fraction of ℓ_b. */
const SLIDE: Readonly<Record<SizeGroup, number>> = {
  torso: 0.5,
  jaw: 0.5,
  shoulder: 0.5,
  limb: 0.25,
  extremity: 0.4,
  finger: 0,
  generic: 0.25,
};

/** `clamp(boneRadius ?? fallback, min·H, max·H)` with `fallback = max(0.15·ℓ_b, h·H)` (fingers: 0.006·H). */
export function controlSize(group: SizeGroup, boneRadius: number | null, boneLength: number, height: number): number {
  const rule = SIZE_RULES[group];
  const fallback = Math.max(rule.bone * boneLength, rule.h * height);
  const radius = boneRadius !== null && Number.isFinite(boneRadius) && boneRadius > 0 ? boneRadius : fallback;
  return clean(Math.min(Math.max(radius, rule.min * height), rule.max * height));
}

/** Rotation about X by −90°: lays a planar shape (normal +Z) flat on the floor (normal +Y). */
const FLOOR: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export function floorShape(kind: 'star', size: number): ControlShape {
  return makeShape(kind, size, [0, 0, 0], FLOOR, null);
}

/** Segments of the root circle (research 07 §5.3: 48-segment circles). */
const ROOT_SEGMENTS = 48;

/**
 * The root's `arrow4` + `circle` (MVP-SPEC §4.11.15) on the floor: a unit circle with four arrows pointing out of it
 * along ±X and ±Y (shape units, scaled by `size` like built-in shapes). One ControlShape has one kind, so the
 * combination is emitted as kind `custom` (docs/wp-notes/wp-3.md).
 */
export function rootShape(size: number): ControlShape {
  const circle: [number, number, number][] = [];
  for (let k = 0; k < ROOT_SEGMENTS; k++) {
    const angle = (2 * Math.PI * k) / ROOT_SEGMENTS;
    circle.push([clean(Math.cos(angle)), clean(Math.sin(angle)), 0]);
  }
  // One arrow along +X: a shaft from the circle to the tip with a head; the others are its quarter turns.
  const arrow: readonly (readonly [number, number])[] = [
    [1.05, -0.06],
    [1.3, -0.06],
    [1.3, -0.16],
    [1.5, 0],
    [1.3, 0.16],
    [1.3, 0.06],
    [1.05, 0.06],
  ];
  const turns: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const arrows = turns.map(([c, s]) => ({
    kind: 'poly' as const,
    closed: true,
    points: arrow.map(([x, y]): [number, number, number] => [clean(c * x - s * y), clean(s * x + c * y), 0]),
  }));
  const custom: SplineSet = { v: 1, splines: [{ kind: 'poly', closed: true, points: circle }, ...arrows] };
  return makeShape('custom', size, [0, 0, 0], FLOOR, custom);
}

/**
 * A circle-like shape around a bone: normal along the bone, centred `SLIDE[group]·ℓ` down it. `dirLocal` is the
 * unit bone direction in control-local space.
 */
export function boneShape(
  kind: 'circle' | 'halfCircle',
  group: SizeGroup,
  size: number,
  dirLocal: ReadonlyVec3,
  boneLength: number,
): ControlShape {
  const slide = SLIDE[group] * boneLength;
  const q = quatShortestArc([0, 0, 1], dirLocal);
  return makeShape(kind, size, [dirLocal[0] * slide, dirLocal[1] * slide, dirLocal[2] * slide], q, null);
}

/** Segments of the lollipop head circle. */
const HEAD_SEGMENTS = 24;

/**
 * Finger lollipop: a stick of length `stick` (metres) from the control pivot along `up` (control-local dorsal
 * normal) with a head circle of radius `size` facing along the finger: the head lies in the plane spanned by `up`
 * and the hand's lateral axis `up × along`, its normal follows the finger direction `along`. Neighbouring fingers'
 * heads then sit side by side in one plane, staggered in height by the per-joint stick lengths, instead of being
 * stacked face to face, which keeps every head pickable in a framed three-quarter hand view (§4.11.15 acceptance;
 * DECISIONS-OPEN E, R-1). Emitted as kind `custom` whose spline set is in shape units (scaled by `size` like
 * built-in shapes), because a rigid unit `lollipop` cannot express the per-joint stick length of §4.11.15.
 */
export function lollipopShape(size: number, stick: number, up: ReadonlyVec3, along: ReadonlyVec3): ControlShape {
  const length = stick / size;
  const head: [number, number, number][] = [];
  for (let k = 0; k < HEAD_SEGMENTS; k++) {
    const angle = (2 * Math.PI * k) / HEAD_SEGMENTS;
    head.push([clean(Math.sin(angle)), clean(length + 1 - Math.cos(angle)), 0]);
  }
  const custom: SplineSet = {
    v: 1,
    splines: [
      {
        kind: 'poly',
        closed: false,
        points: [
          [0, 0, 0],
          [0, clean(length), 0],
        ],
      },
      { kind: 'poly', closed: true, points: head },
    ],
  };
  const lateral: Vec3 = [
    up[1] * along[2] - up[2] * along[1],
    up[2] * along[0] - up[0] * along[2],
    up[0] * along[1] - up[1] * along[0],
  ];
  return makeShape('custom', size, [0, 0, 0], basisQuat(lateral, up), custom);
}

/** Rotation whose local +X follows `x` (orthogonalized) and local +Y follows `y`. */
export function basisQuat(x: ReadonlyVec3, y: ReadonlyVec3): Quat {
  const yn = normalize(y, [0, 1, 0]);
  const d = x[0] * yn[0] + x[1] * yn[1] + x[2] * yn[2];
  let xn = normalize([x[0] - d * yn[0], x[1] - d * yn[1], x[2] - d * yn[2]], [0, 0, 0]);
  if (xn[0] === 0 && xn[1] === 0 && xn[2] === 0) xn = anyPerpendicular(yn);
  const zn: Vec3 = [xn[1] * yn[2] - xn[2] * yn[1], xn[2] * yn[0] - xn[0] * yn[2], xn[0] * yn[1] - xn[1] * yn[0]];
  const m = new Float64Array(16);
  m.set([xn[0], xn[1], xn[2], 0, yn[0], yn[1], yn[2], 0, zn[0], zn[1], zn[2], 0, 0, 0, 0, 1]);
  return mat4Decompose(m).q;
}

/** A world direction expressed in the frame with rotation `frame` (q⁻¹ ⊗ v). */
export function toLocalDirection(frame: ReadonlyQuat, v: ReadonlyVec3): Vec3 {
  return quatRotateVec3(quatInvert(frame), v);
}

export function normalize(v: ReadonlyVec3, fallback: ReadonlyVec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-12)) return [fallback[0], fallback[1], fallback[2]];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function anyPerpendicular(v: ReadonlyVec3): Vec3 {
  const axis: Vec3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  return normalize([axis[0] - d * v[0], axis[1] - d * v[1], axis[2] - d * v[2]], [1, 0, 0]);
}

function makeShape(
  kind: string,
  size: number,
  t: ReadonlyVec3,
  q: ReadonlyQuat,
  custom: SplineSet | null,
): ControlShape {
  return {
    kind,
    size: clean(size),
    offset: {
      t: [clean(t[0]), clean(t[1]), clean(t[2])],
      // Rotations stay unrounded so they remain unit quaternions; `0 + x` turns −0 into +0, which a JSON round trip
      // (autosave and recovery, save and open) would do anyway (acceptance fix round 1).
      q: [0 + q[0], 0 + q[1], 0 + q[2], 0 + q[3]],
      s: [1, 1, 1],
    },
    custom,
    color: 'side',
    lineWidth: null,
  };
}

/** Rounds generated geometry to 1e-12 and removes −0 so documents stay readable and diff-friendly. */
export function clean(x: number): number {
  const rounded = Math.round(x * 1e12) / 1e12;
  return rounded === 0 ? 0 : rounded;
}
