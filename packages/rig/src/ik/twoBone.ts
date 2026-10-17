import {
  mat4Decompose,
  type Quat,
  quatFromAxisAngle,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  type ReadonlyVec3,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { TwoBoneIkInput, TwoBoneIkOutput } from '../types';

// Stateless analytic two-bone IK (research 07 §9.2): seeded from the rest pose under the current parent, the mid
// joint bends about its hinge axis only, the chain then swings onto the target ray and twists about it so that the
// mid joint lies in the plane of (upper joint, target, pole). Canonical character space.

const sub = (a: ReadonlyVec3, b: ReadonlyVec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: ReadonlyVec3, b: ReadonlyVec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: ReadonlyVec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: ReadonlyVec3, b: ReadonlyVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: ReadonlyVec3, b: ReadonlyVec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: ReadonlyVec3): number => Math.hypot(a[0], a[1], a[2]);

/** Rotation taking direction `from` onto `to`; antiparallel inputs rotate by π about `fallbackAxis`. */
function swing(from: Vec3, to: Vec3, fallbackAxis: Vec3): Quat {
  const lf = length(from);
  const lt = length(to);
  if (lf < 1e-12 || lt < 1e-12) return [0, 0, 0, 1];
  const c = dot(from, to) / (lf * lt);
  if (c < -1 + 1e-12) {
    // Project the fallback axis off `from` so the half-turn keeps the bend plane.
    const f = scale(from, 1 / lf);
    let axis = sub(fallbackAxis, scale(f, dot(fallbackAxis, f)));
    if (length(axis) < 1e-9) axis = Math.abs(f[0]) < 0.9 ? cross(f, [1, 0, 0]) : cross(f, [0, 1, 0]);
    return quatFromAxisAngle(axis, Math.PI);
  }
  const axis = cross(from, to);
  const w = lf * lt + dot(from, to);
  return quatNormalize([axis[0], axis[1], axis[2], w]);
}

/** Uniform scale of a decomposed transform (mean of the axis scales). */
function uniform(s: ReadonlyVec3): number {
  return (Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2])) / 3;
}

/** Angle γ about unit `k` that brings |u + R_k(γ)·v| to `d`, on the flexion side (positive bend about k). */
function bendAngle(u: Vec3, v: Vec3, k: Vec3, d: number): number {
  // |u + R v|² = |u|² + |v|² + 2·(u·v∥ + cos γ·(u·v⊥) + sin γ·(u·(k × v⊥)))
  const vPar = scale(k, dot(v, k));
  const vPerp = sub(v, vPar);
  const a = dot(u, vPerp);
  const b = dot(u, cross(k, vPerp));
  const r = Math.hypot(a, b);
  if (r < 1e-15) return 0;
  const c = (d * d - dot(u, u) - dot(v, v)) / 2 - dot(u, vPar);
  const base = Math.atan2(b, a);
  const spread = Math.acos(Math.min(1, Math.max(-1, c / r)));
  const candidates = [base + spread, base - spread];
  // Prefer the solution whose resulting bend (signed angle from u to v' about k) is non-negative (flexion).
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const gamma of candidates) {
    const rv = add(vPar, add(scale(vPerp, Math.cos(gamma)), scale(cross(k, vPerp), Math.sin(gamma))));
    const bend = Math.atan2(dot(k, cross(u, rv)), dot(u, rv));
    const wrapped = Math.atan2(Math.sin(gamma), Math.cos(gamma));
    const score = (bend < -1e-12 ? 10 : 0) + Math.abs(wrapped);
    if (score < bestScore) {
      bestScore = score;
      best = wrapped;
    }
  }
  return best;
}

/**
 * Solves the chain for `input` into `out` (local rotations relative to the respective parents). The mid bone only
 * rotates about `hingeLocal`; the end reaches `target` exactly when it is within reach (|l1 − l2| + ε .. l1 + l2 − ε,
 * ε = 1e-5·(l1 + l2)), else the chain straightens towards it and `reached` is false. `soft` > 0 eases the reach
 * near full extension: targets closer than l1 + l2 − soft are still reached exactly, farther ones fall short and are
 * reported as not reached. `twist` adds a roll about the chain axis.
 */
export function solveTwoBoneIk(input: TwoBoneIkInput, out: TwoBoneIkOutput): void {
  const pa = mat4Decompose(input.parentWorld);
  const sPa = uniform(pa.s);
  const qU0 = quatNormalize(input.upperRest.q);
  const qM0 = quatNormalize(input.midRest.q);
  const qE0 = quatNormalize(input.endRest.q);
  const sU = sPa * uniform(input.upperRest.s);
  const sM = sU * uniform(input.midRest.s);
  const tM0 = scale(input.midRest.t, sU);
  const tE0 = scale(input.endRest.t, sM);

  // 1. Seed from rest under the current parent.
  let qU = quatMultiply(pa.q, qU0);
  const a = add(pa.t, quatRotateVec3(pa.q, scale(input.upperRest.t, sPa)));
  let qM = quatMultiply(qU, qM0);
  let b = add(a, quatRotateVec3(qU, tM0));
  let c = add(b, quatRotateVec3(qM, tE0));
  const l1 = length(tM0);
  const l2 = length(tE0);
  const total = l1 + l2;

  // 2. Reach distance, optionally softened, clamped into the reachable band.
  const toTarget = sub(input.target, a);
  const dRaw = length(toTarget);
  const xHat = dRaw > 1e-9 ? scale(toTarget, 1 / dRaw) : normalizeOr(sub(c, a), [0, -1, 0]);
  let d = dRaw;
  const soft = Math.max(0, input.soft);
  if (soft > 0 && dRaw > total - soft) d = total - soft + soft * (1 - Math.exp(-(dRaw - (total - soft)) / soft));
  const epsilon = 1e-5 * total;
  const lo = Math.abs(l1 - l2) + epsilon;
  const hi = total - epsilon;
  // Inside the band; softening shortens `d` past l1 + l2 − soft, which the end-to-target check below reports.
  const reachable = dRaw >= lo - 1e-12 && dRaw <= hi + 1e-12;
  d = Math.min(Math.max(d, lo), hi);

  // 3. Bend the mid bone about its hinge only.
  const k = normalizeOr(quatRotateVec3(qM, input.hingeLocal), [1, 0, 0]);
  const gamma = bendAngle(sub(b, a), sub(c, b), k, d);
  qM = quatMultiply(quatFromAxisAngle(k, gamma), qM);
  c = add(b, quatRotateVec3(qM, tE0));

  // 4. Swing the chain so the end lies on the target ray.
  const qS = swing(sub(c, a), xHat, k);
  qU = quatMultiply(qS, qU);
  qM = quatMultiply(qS, qM);
  b = add(a, quatRotateVec3(qU, tM0));

  // 5. Twist about the chain axis so the mid joint lies in the (a, target, pole) plane.
  const ab = sub(b, a);
  const m = sub(ab, scale(xHat, dot(ab, xHat)));
  const ap = sub(input.pole, a);
  const n = sub(ap, scale(xHat, dot(ap, xHat)));
  const phi = length(m) > 1e-9 && length(n) > 1e-9 ? Math.atan2(dot(xHat, cross(m, n)), dot(m, n)) : 0;
  const qT = quatFromAxisAngle(xHat, phi + input.twist);
  qU = quatMultiply(qT, qU);
  qM = quatMultiply(qT, qM);

  // 6. End orientation: the given world rotation, else its rest local under the solved mid bone.
  const qE = input.endWorldRotation === null ? quatMultiply(qM, qE0) : quatNormalize(input.endWorldRotation);

  // 7. Locals.
  quatNormalize(quatMultiply(quatInvert(pa.q), qU), out.upperLocal);
  quatNormalize(quatMultiply(quatInvert(qU), qM), out.midLocal);
  quatNormalize(quatMultiply(quatInvert(qM), qE), out.endLocal);
  const end = add(add(a, quatRotateVec3(qU, tM0)), quatRotateVec3(qM, tE0));
  out.reached = reachable && length(sub(end, input.target)) <= 1e-6 * Math.max(total, 1e-9);
}

function normalizeOr(v: Vec3, fallback: Vec3): Vec3 {
  const len = length(v);
  return len > 1e-12 ? scale(v, 1 / len) : fallback;
}
