import { EkzaError } from '../errors';
import type { Quat, ReadonlyQuat, ReadonlyVec3, RotateOrder, ThreeEulerOrder, Vec3 } from '../types';
import { quatMultiply, quatRotateVec3 } from './quat';

// Rotate orders use the common DCC semantics: the first letter is applied first (inner), the last letter last
// (outer). For order (i, j, k): R = R_k(e[k])·R_j(e[j])·R_i(e[i]) with column vectors, which is three.js order
// "KJI" (research 07 §1.3). Euler triples are always indexed by axis ([rx, ry, rz]), never by role.

type Axis = 0 | 1 | 2;
type AxisTriple = readonly [inner: Axis, middle: Axis, outer: Axis];

const TAU = 2 * Math.PI;
const HALF_PI = Math.PI / 2;

const ORDER_AXES: Readonly<Record<RotateOrder, AxisTriple>> = {
  xyz: [0, 1, 2],
  yzx: [1, 2, 0],
  zxy: [2, 0, 1],
  xzy: [0, 2, 1],
  yxz: [1, 0, 2],
  zyx: [2, 1, 0],
};

const TO_THREE: Readonly<Record<RotateOrder, ThreeEulerOrder>> = {
  xyz: 'ZYX',
  yzx: 'XZY',
  zxy: 'YXZ',
  xzy: 'YZX',
  yxz: 'ZXY',
  zyx: 'XYZ',
};

const FROM_THREE: Readonly<Record<ThreeEulerOrder, RotateOrder>> = {
  ZYX: 'xyz',
  XZY: 'yzx',
  YXZ: 'zxy',
  YZX: 'xzy',
  ZXY: 'yxz',
  XYZ: 'zyx',
};

/**
 * Below this |cos(middle)| the inner/outer split is numerically meaningless (only their sum or difference is
 * defined), so `eulerNear` keeps the reference inner angle. At 1e-9 the rotation error introduced by pinning is
 * below 4e-9 rad, while just above it the split noise is about 2e-16 / 1e-9 = 2e-7 rad.
 */
const GIMBAL_COS_EPSILON = 1e-9;
/** quatToEuler treats a half-angle magnitude this close to 0 or π as exact gimbal lock (0/0 in atan2). */
const DEGENERATE_EPSILON = 1e-12;

// Module scratch (single-threaded; no function here re-enters another while holding these).
const scratchA: Quat = [0, 0, 0, 1];
const scratchB: Quat = [0, 0, 0, 1];
const scratchC: Quat = [0, 0, 0, 1];
const scratchE: Vec3 = [0, 0, 0];

export function toThreeEulerOrder(order: RotateOrder): ThreeEulerOrder {
  const three = TO_THREE[order];
  if (three === undefined) throw new EkzaError('unsupported', `Unknown rotate order '${String(order)}'`);
  return three;
}

export function fromThreeEulerOrder(order: ThreeEulerOrder): RotateOrder {
  const dcc = FROM_THREE[order];
  if (dcc === undefined) throw new EkzaError('unsupported', `Unknown three.js Euler order '${String(order)}'`);
  return dcc;
}

/** Axis indices (0 = x, 1 = y, 2 = z) in application order: inner (first), middle (gimbal axis), outer (last). */
export function rotateOrderAxes(order: RotateOrder): readonly [inner: 0 | 1 | 2, middle: 0 | 1 | 2, outer: 0 | 1 | 2] {
  const axes = ORDER_AXES[order];
  if (axes === undefined) throw new EkzaError('unsupported', `Unknown rotate order '${String(order)}'`);
  return axes;
}

/** Quaternion of the Euler triple `e` ([rx, ry, rz], radians) in DCC rotate order `order`. */
export function eulerToQuat(e: ReadonlyVec3, order: RotateOrder, out: Quat = [0, 0, 0, 1]): Quat {
  const axes = rotateOrderAxes(order);
  const i = axes[0];
  const j = axes[1];
  const k = axes[2];
  axisQuat(i, e[i], scratchA);
  axisQuat(j, e[j], scratchB);
  quatMultiply(scratchB, scratchA, scratchC);
  axisQuat(k, e[k], scratchA);
  return quatMultiply(scratchA, scratchC, out);
}

/**
 * One Euler triple of `q` in `order`: middle angle in [−π/2, π/2], inner and outer in [−π, π] (three.js ranges).
 * At exact gimbal lock the inner angle is 0. Uses the direct quaternion method of Bernardes & Viollet (2022),
 * which stays accurate to rounding near gimbal lock, unlike matrix-based extraction.
 */
export function quatToEuler(q: ReadonlyQuat, order: RotateOrder, out: Vec3 = [0, 0, 0]): Vec3 {
  const axes = rotateOrderAxes(order);
  const i = axes[0];
  const j = axes[1];
  const k = axes[2];
  // +1 for cyclic orders (xyz, yzx, zxy), −1 for the others.
  const sign = ((i - j) * (j - k) * (k - i)) / 2;
  const norm = Math.hypot(q[0], q[1], q[2], q[3]);
  if (norm === 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const w = q[3] / norm;
  const qi = q[i] / norm;
  const qj = q[j] / norm;
  const qk = (q[k] / norm) * sign;
  // Tait–Bryan sequences are rewritten as a proper (i, j, i) sequence by a fixed π/2 rotation about j.
  const a = w - qj;
  const b = qi + qk;
  const c = qj + w;
  const d = qk - qi;
  const theta = 2 * Math.atan2(Math.hypot(c, d), Math.hypot(a, b));
  const halfSum = Math.atan2(b, a);
  const halfDiff = Math.atan2(d, c);
  let inner: number;
  let outer: number;
  if (theta <= DEGENERATE_EPSILON) {
    inner = 0;
    outer = 2 * halfSum;
  } else if (theta >= Math.PI - DEGENERATE_EPSILON) {
    inner = 0;
    outer = 2 * halfDiff;
  } else {
    inner = halfSum - halfDiff;
    outer = halfSum + halfDiff;
  }
  out[i] = wrapPi(inner);
  out[j] = theta - HALF_PI;
  out[k] = wrapPi(outer * sign);
  return out;
}

/**
 * The Euler triple of `q` closest (L1, after unwrapping by 2π) to `reference`, choosing between the two
 * equivalent triples (research 07 §14.3). Near gimbal lock the reference inner angle is kept and the outer angle
 * solved, so keys written from manipulator drags never flip. `reference` is normally the control's current
 * channel values.
 */
export function eulerNear(q: ReadonlyQuat, order: RotateOrder, reference: ReadonlyVec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const axes = rotateOrderAxes(order);
  const i = axes[0];
  const j = axes[1];
  const k = axes[2];
  const e = quatToEuler(q, order, scratchE);
  if (Math.abs(Math.cos(e[j])) < GIMBAL_COS_EPSILON) {
    e[i] = reference[i];
    // q = q_k(c)·q_j(b)·q_i(a)  ⇒  q_k(c) = q·q_i(−a)·q_j(−b)
    axisQuat(i, -e[i], scratchA);
    axisQuat(j, -e[j], scratchB);
    quatMultiply(q, scratchA, scratchC);
    quatMultiply(scratchC, scratchB, scratchC);
    e[k] = 2 * Math.atan2(scratchC[k], scratchC[3]);
  }
  pickNearest(e, i, j, k, reference, out);
  return out;
}

/**
 * The standard DCC Euler filter on synchronized samples, in place and sequential: each sample becomes the equivalent
 * triple (2π unwrap, or the alternate (a + π, π − b, c + π)) nearest to the already-filtered previous sample.
 */
export function eulerFilter(samples: Vec3[], order: RotateOrder): void {
  const axes = rotateOrderAxes(order);
  const i = axes[0];
  const j = axes[1];
  const k = axes[2];
  for (let n = 1; n < samples.length; n++) {
    const prev = samples[n - 1] as Vec3;
    const cur = samples[n] as Vec3;
    pickNearest(cur, i, j, k, prev, cur);
  }
}

/**
 * Gimbal ring axes for the Euler angles `e`, indexed by channel ([x ring, y ring, z ring]), as unit vectors in the
 * control's parent·offset frame: the outer axis is fixed, the middle axis is rotated by the outer angle, the inner
 * axis by the outer then the middle angle. Each axis is the instantaneous rotation axis of its channel.
 */
export function gimbalAxes(e: ReadonlyVec3, order: RotateOrder): readonly [x: Vec3, y: Vec3, z: Vec3] {
  const order3 = rotateOrderAxes(order);
  const i = order3[0];
  const j = order3[1];
  const k = order3[2];
  const axes: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  axes[k][k] = 1;
  const outerQ = axisQuat(k, e[k], [0, 0, 0, 1]);
  const unitJ: Vec3 = [0, 0, 0];
  unitJ[j] = 1;
  quatRotateVec3(outerQ, unitJ, axes[j]);
  const outerMiddleQ = quatMultiply(outerQ, axisQuat(j, e[j], [0, 0, 0, 1]));
  const unitI: Vec3 = [0, 0, 0];
  unitI[i] = 1;
  quatRotateVec3(outerMiddleQ, unitI, axes[i]);
  return axes;
}

/** Rotation by `angle` about coordinate axis `axis`. */
function axisQuat(axis: Axis, angle: number, out: Quat): Quat {
  const half = angle * 0.5;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[axis] = Math.sin(half);
  out[3] = Math.cos(half);
  return out;
}

/** Writes into `out` whichever of `e` and its alternate triple, unwrapped towards `ref`, is nearer (L1) to `ref`. */
function pickNearest(e: ReadonlyVec3, i: Axis, j: Axis, k: Axis, ref: ReadonlyVec3, out: Vec3): void {
  const ai = unwrap(e[i], ref[i]);
  const aj = unwrap(e[j], ref[j]);
  const ak = unwrap(e[k], ref[k]);
  const bi = unwrap(e[i] + Math.PI, ref[i]);
  const bj = unwrap(Math.PI - e[j], ref[j]);
  const bk = unwrap(e[k] + Math.PI, ref[k]);
  const distA = Math.abs(ai - ref[i]) + Math.abs(aj - ref[j]) + Math.abs(ak - ref[k]);
  const distB = Math.abs(bi - ref[i]) + Math.abs(bj - ref[j]) + Math.abs(bk - ref[k]);
  if (distA <= distB) {
    out[i] = ai;
    out[j] = aj;
    out[k] = ak;
  } else {
    out[i] = bi;
    out[j] = bj;
    out[k] = bk;
  }
}

/** `angle` shifted by a multiple of 2π to lie within π of `ref`. */
function unwrap(angle: number, ref: number): number {
  return angle + TAU * Math.round((ref - angle) / TAU);
}

function wrapPi(angle: number): number {
  if (angle > Math.PI) return angle - TAU;
  if (angle < -Math.PI) return angle + TAU;
  return angle;
}
