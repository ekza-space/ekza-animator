import { EkzaError, type Mat4, mat4Decompose, quatAngle, type Quat } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import { solveBoneChannels, solveControlChannels } from '../inverse/solve';
import { internalsOf } from '../kernel/internals';
import { allocXfArrays, type XfArrays, xfaFromMat4, xfaInvMul, xfaMulInv, xfaToMat4 } from '../math/xfa';
import { readControlChannels, writeControlChannels } from '../sampler/channels';
import type { ChannelBuffer, LimbDesc, LimbId, PoseBuffers, RigProgram } from '../types';
import { FOOT_F, FOOT_G, FootRoll } from './foot';

// IK/FK matching (M2A-SPEC §5.6), Plant Feet on IK legs (§5.8) and the foot-roll pivots (§5.3.1). These run on
// user actions and imports, not per frame, so they may allocate.

type V3 = [number, number, number];

function limbDesc(program: RigProgram, limb: LimbId): LimbDesc {
  const desc = program.limbs.find((candidate) => candidate.id === limb);
  if (desc === undefined) {
    throw new EkzaError('invalid-record', `Rig program ${program.rigId} has no ${limb} IK limb`, { limb });
  }
  return desc;
}

/** The limb a control belongs to: its FK chain (upper, mid, end, toes), IK control or pole; null otherwise. */
export function limbOfControl(program: RigProgram, control: ControlId): LimbDesc | null {
  for (const limb of program.limbs) {
    const p = limb.params;
    if (
      control === p.ikControl ||
      control === p.pole ||
      control === p.fk.upper ||
      control === p.fk.mid ||
      control === p.fk.end ||
      (p.fk.toes !== null && control === p.fk.toes)
    ) {
      return limb;
    }
  }
  return null;
}

/** Copies `ch` into `scratch`, sets the limb's ikFk to `ikFk` and evaluates into `out` (matching side buffers). */
export function evaluateWithLimbMode(
  program: RigProgram,
  ch: ChannelBuffer,
  limb: LimbId,
  ikFk: number,
  scratch: ChannelBuffer,
  out: PoseBuffers,
): void {
  const desc = limbDesc(program, limb);
  scratch.values.set(ch.values.subarray(0, scratch.values.length));
  scratch.attrs.set(ch.attrs.subarray(0, scratch.attrs.length));
  const slot = desc.attrSlots.ikFk;
  if (slot >= 0 && slot < scratch.attrs.length) scratch.attrs[slot] = ikFk;
  program.evaluate(scratch, out);
}

function position(pose: PoseBuffers, node: number): V3 {
  return [
    pose.boneWorld[node * 16 + 12] as number,
    pose.boneWorld[node * 16 + 13] as number,
    pose.boneWorld[node * 16 + 14] as number,
  ];
}

function boneRotation(pose: PoseBuffers, node: number): Quat {
  return mat4Decompose(pose.boneWorld.subarray(node * 16, node * 16 + 16) as Mat4).q;
}

/**
 * Match FK to IK (§5.6): channels of `fk.upper`, `fk.mid`, `fk.end` and `fk.toes` (when present) that reproduce
 * those bones' worlds in `ikPose` (the pose evaluated with ikFk 1), solved top-down with eulerNear against
 * `reference` (the current channels).
 */
export function matchFkToIk(
  program: RigProgram,
  ikPose: PoseBuffers,
  limb: LimbId,
  reference: ReadonlyMap<ControlId, ChannelValues>,
): Map<ControlId, ChannelValues> {
  const desc = limbDesc(program, limb);
  const p = desc.params;
  const targets = new Map<number, Mat4>();
  for (const node of [desc.nodes.upper, desc.nodes.mid, desc.nodes.end]) {
    targets.set(node, ikPose.boneWorld.slice(node * 16, node * 16 + 16));
  }
  if (desc.nodes.toes >= 0 && p.fk.toes !== null) {
    targets.set(desc.nodes.toes, ikPose.boneWorld.slice(desc.nodes.toes * 16, desc.nodes.toes * 16 + 16));
  }
  const solved = solveBoneChannels(program, ikPose, targets, reference);
  const out = new Map<ControlId, ChannelValues>();
  for (const id of [p.fk.upper, p.fk.mid, p.fk.end, p.fk.toes]) {
    if (id === null) continue;
    const values = solved.get(id);
    if (values !== undefined) out.set(id, values);
  }
  return out;
}

const DEG = Math.PI / 180;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const perpendicular = (v: V3, axis: V3): V3 => sub(v, scale(axis, dot(v, axis)));

/** World hinge of the limb in `pose`: q(W_mid) ⊗ (q(W⁰_mid)⁻¹ ⊗ hinge). */
function worldHinge(program: RigProgram, desc: LimbDesc, pose: PoseBuffers): V3 {
  const internals = internalsOf(program);
  const mid = desc.nodes.mid;
  const scratch = allocXfArrays(2);
  xfaFromMat4(pose.boneWorld, mid * 16, scratch, 0);
  xfaInvMul(internals.restWorld, mid, scratch, 0, scratch, 1);
  const q: Quat = [scratch.q[4] as number, scratch.q[5] as number, scratch.q[6] as number, scratch.q[7] as number];
  // q(W_mid) · q(W⁰_mid)⁻¹ = q(W⁰_mid) · (q(W⁰_mid)⁻¹ · q(W_mid)) · q(W⁰_mid)⁻¹: rotate the canonical hinge by the
  // world delta D = q(W_mid) · q(W⁰_mid)⁻¹.
  const r0: Quat = [
    internals.restWorld.q[mid * 4] as number,
    internals.restWorld.q[mid * 4 + 1] as number,
    internals.restWorld.q[mid * 4 + 2] as number,
    internals.restWorld.q[mid * 4 + 3] as number,
  ];
  const d = quatMul(quatMul(r0, q), conj(r0));
  return rotate(d, [desc.params.hinge[0], desc.params.hinge[1], desc.params.hinge[2]]);
}

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
    a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
    a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function conj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

function rotate(q: Quat, v: V3): V3 {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
    v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
    v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
}

/**
 * Whether the limb's rest bend lies in its hinge plane (the bend offset m⁰ along ±h⁰ within 18°, or negligible):
 * then the spec's match pole blend towards the actual mid-joint direction applies; a rest that bends off the hinge
 * (Polybot's legs and arms) matches with the hinge-implied direction only (see `matchPoleDirection`).
 */
export function limbRestIsPlanar(program: RigProgram, desc: LimbDesc): boolean {
  const rest = internalsOf(program).restWorld;
  const at = (node: number): V3 => [
    rest.t[node * 3] as number,
    rest.t[node * 3 + 1] as number,
    rest.t[node * 3 + 2] as number,
  ];
  const a = at(desc.nodes.upper);
  const b = at(desc.nodes.mid);
  const c = at(desc.nodes.end);
  const reach = desc.lengths.upper + desc.lengths.lower;
  const ac = sub(c, a);
  if (len(ac) < 1e-12) return true;
  const x = scale(ac, 1 / len(ac));
  const m = perpendicular(sub(b, a), x);
  if (len(m) <= 1e-3 * reach) return true;
  const h = cross(x, [desc.params.hinge[0], desc.params.hinge[1], desc.params.hinge[2]]);
  if (len(h) < 1e-9) return false;
  return Math.abs(dot(m, h)) / (len(m) * len(h)) >= Math.cos(18 * DEG);
}

/**
 * §5.6 match pole rule: the pole direction p̂ from the FK positions a, b, c (upper, mid, end) and the FK world
 * hinge. h = normalize(x̂ × k_fk) (degenerate hinge: the current pole direction from b). For a planar rest (see
 * `limbRestIsPlanar`), p̂ = normalize((1 − β)·h + β·m̂) with β = smoothstep(2°, 10°, θ)·smoothstep(0, 0.5, m̂·h)
 * (θ the bend between b − a and c − b, m̂ the normalized bend offset when |m| > 1e-3·L); otherwise p̂ = h, the
 * direction the ik2 op's twist aligns with the pole (§5.3 amendment B), which reproduces every hinge pose exactly.
 */
export function matchPoleDirection(
  a: V3,
  b: V3,
  c: V3,
  hingeWorld: V3,
  currentPole: V3,
  reach: number,
  planar: boolean,
): V3 {
  const ac = sub(c, a);
  const x: V3 = len(ac) > 1e-12 ? scale(ac, 1 / len(ac)) : [0, -1, 0];
  let h = cross(x, hingeWorld);
  if (len(h) < 1e-6) {
    const toPole = perpendicular(sub(currentPole, b), x);
    h = len(toPole) > 1e-12 ? toPole : sub(currentPole, b);
  }
  h = len(h) > 1e-12 ? scale(h, 1 / len(h)) : [0, 0, 1];
  if (!planar) return h;
  const m = perpendicular(sub(b, a), x);
  if (len(m) <= 1e-3 * reach) return h;
  const mHat = scale(m, 1 / len(m));
  const u = sub(b, a);
  const v = sub(c, b);
  const cosine = dot(u, v) / Math.max(1e-300, len(u) * len(v));
  const theta = Math.acos(Math.min(1, Math.max(-1, cosine)));
  const beta = smoothstep(2 * DEG, 10 * DEG, theta) * smoothstep(0, 0.5, dot(mHat, h));
  const p: V3 = [
    (1 - beta) * h[0] + beta * mHat[0],
    (1 - beta) * h[1] + beta * mHat[1],
    (1 - beta) * h[2] + beta * mHat[2],
  ];
  return scale(p, 1 / len(p));
}

/** K_end = (W⁰_ik)⁻¹ · W⁰_end into element 0 of a new XfArrays. */
function kEndOf(program: RigProgram, desc: LimbDesc): XfArrays {
  const internals = internalsOf(program);
  const out = allocXfArrays(1);
  const slot = program.controlIndex.get(desc.params.ikControl) as number;
  xfaInvMul(internals.controlRest, slot, internals.restWorld, desc.nodes.end, out, 0);
  return out;
}

function attr(ch: ChannelBuffer, slot: number): number {
  if (slot < 0 || slot >= ch.attrs.length) return 0;
  const value = ch.attrs[slot] as number;
  return Number.isFinite(value) ? value : 0;
}

/** The leg's foot roll at the attribute values of `ch`; null for arms. */
function footRollAt(desc: LimbDesc, ch: ChannelBuffer): FootRoll | null {
  const foot = desc.params.foot;
  if (foot === null) return null;
  const roll = new FootRoll(foot);
  roll.compute(
    attr(ch, desc.attrSlots.roll),
    attr(ch, desc.attrSlots.bank),
    attr(ch, desc.attrSlots.heelTwist),
    attr(ch, desc.attrSlots.toeTwist),
  );
  return roll;
}

/** W_ik = endWorld · K_end⁻¹ · F⁻¹ as a matrix. */
function ikWorldFor(
  program: RigProgram,
  desc: LimbDesc,
  ch: ChannelBuffer,
  endWorld: Mat4 | Float64Array,
  offset: number,
): Mat4 {
  const xf = allocXfArrays(2);
  xfaFromMat4(endWorld, offset, xf, 0);
  xfaMulInv(xf, 0, kEndOf(program, desc), 0, xf, 1);
  const roll = footRollAt(desc, ch);
  if (roll !== null) xfaMulInv(xf, 1, roll.xf, FOOT_F, xf, 1);
  const out = new Float64Array(16);
  xfaToMat4(xf, 1, out, 0);
  return out;
}

/**
 * IK control channels that put the limb's end bone at `endWorld` with the foot-roll attributes of `ch`
 * (W_ik = endWorld · K_end⁻¹ · F⁻¹, §5.8 Plant Feet on IK legs), parents taken from `pose`, rotations eulerNear
 * `reference`.
 */
export function ikControlForEndWorld(
  program: RigProgram,
  pose: PoseBuffers,
  ch: ChannelBuffer,
  limb: LimbId,
  endWorld: Mat4,
  reference: ChannelValues,
): ChannelValues {
  const desc = limbDesc(program, limb);
  return solveControlChannels(
    program,
    pose,
    desc.params.ikControl,
    ikWorldFor(program, desc, ch, endWorld, 0),
    reference,
  );
}

/**
 * Match IK to FK (§5.6): IK control channels from the FK end world (W_ik = W_end,fk · K_end⁻¹ · F⁻¹ at the current
 * foot-roll attributes), `twist` 0 and the pole by the match pole rule, at distance D from b (the current pole
 * distance when ≥ 0.25·L, else L), placed so that its offset from the a → c line points along p̂ (the bend offset's
 * part outside the p̂ plane is taken off: the ik2 twist aligns the hinge-implied direction with the pole, §5.3 B).
 * Only the IK and pole controls are matched (`fk.toes` keeps its channels): with a ball roll the toes rule keeps
 * the IK toes planted, so they differ from the FK toes (§5.3 step 6). The errors compare the IK result (evaluated with ikFk 1 and the other channels of `ch`) with `fkPose`: end
 * and mid joint positions and the largest world-rotation difference of the chain bones.
 */
export function matchIkToFk(
  program: RigProgram,
  fkPose: PoseBuffers,
  ch: ChannelBuffer,
  limb: LimbId,
  reference: ReadonlyMap<ControlId, ChannelValues>,
): {
  readonly values: Map<ControlId, ChannelValues>;
  readonly endErrorM: number;
  readonly midErrorM: number;
  readonly maxRotationErrorRad: number;
} {
  const desc = limbDesc(program, limb);
  const p = desc.params;
  const { upper, mid, end } = desc.nodes;
  const a = position(fkPose, upper);
  const b = position(fkPose, mid);
  const c = position(fkPose, end);
  const reach = desc.lengths.upper + desc.lengths.lower;
  const poleSlot = program.controlIndex.get(p.pole) as number;
  const currentPole: V3 = [
    fkPose.controlWorld[poleSlot * 16 + 12] as number,
    fkPose.controlWorld[poleSlot * 16 + 13] as number,
    fkPose.controlWorld[poleSlot * 16 + 14] as number,
  ];
  const direction = matchPoleDirection(
    a,
    b,
    c,
    worldHinge(program, desc, fkPose),
    currentPole,
    reach,
    limbRestIsPlanar(program, desc),
  );
  const currentDistance = len(sub(currentPole, b));
  const distance = currentDistance >= 0.25 * reach ? currentDistance : reach;
  const ac = sub(c, a);
  const x: V3 = len(ac) > 1e-12 ? scale(ac, 1 / len(ac)) : [0, -1, 0];
  const m = perpendicular(sub(b, a), x);
  const off = sub(m, scale(direction, dot(m, direction)));
  const pole: V3 = [
    b[0] + direction[0] * distance - off[0],
    b[1] + direction[1] * distance - off[1],
    b[2] + direction[2] * distance - off[2],
  ];

  const ikReference = reference.get(p.ikControl) ?? readControlChannels(program, ch, p.ikControl);
  const ikValues: ChannelValues = {
    ...solveControlChannels(
      program,
      fkPose,
      p.ikControl,
      ikWorldFor(program, desc, ch, fkPose.boneWorld, end * 16),
      ikReference,
    ),
  };
  if (desc.attrSlots.twist >= 0) ikValues['@twist'] = 0;
  const poleWorld = fkPose.controlWorld.slice(poleSlot * 16, poleSlot * 16 + 16);
  poleWorld[12] = pole[0];
  poleWorld[13] = pole[1];
  poleWorld[14] = pole[2];
  const poleValues = solveControlChannels(
    program,
    fkPose,
    p.pole,
    poleWorld,
    reference.get(p.pole) ?? readControlChannels(program, ch, p.pole),
  );
  const values = new Map<ControlId, ChannelValues>([
    [p.ikControl, ikValues],
    [p.pole, poleValues],
  ]);

  // Errors of the IK result against the FK pose.
  const scratch = program.allocChannels();
  scratch.values.set(ch.values.subarray(0, scratch.values.length));
  scratch.attrs.set(ch.attrs.subarray(0, scratch.attrs.length));
  for (const [control, channels] of values) writeControlChannels(program, scratch, control, channels);
  if (desc.attrSlots.ikFk >= 0) scratch.attrs[desc.attrSlots.ikFk] = 1;
  const ikPose = program.allocPose();
  program.evaluate(scratch, ikPose);
  let maxRotationErrorRad = 0;
  for (const node of [upper, mid, end]) {
    maxRotationErrorRad = Math.max(
      maxRotationErrorRad,
      quatAngle(boneRotation(ikPose, node), boneRotation(fkPose, node)),
    );
  }
  return {
    values,
    endErrorM: len(sub(position(ikPose, end), c)),
    midErrorM: len(sub(position(ikPose, mid), b)),
    maxRotationErrorRad,
  };
}

/**
 * World positions of a leg's foot-roll pivots (§5.3.1) for the IK control world in `pose` and the attributes of
 * `ch`: heel, ball, inner and outer ride on F = Bank·Heel·Toe·Ball (the ball, inner and outer pivots lie on the ball
 * roll's axis), the toe tip on Bank·Heel·Toe. Null for arms, limbs without foot parameters and unknown limbs.
 */
export function footPivotWorlds(
  program: RigProgram,
  pose: PoseBuffers,
  ch: ChannelBuffer,
  limb: LimbId,
): {
  readonly heel: Float64Array;
  readonly ball: Float64Array;
  readonly toe: Float64Array;
  readonly inner: Float64Array;
  readonly outer: Float64Array;
} | null {
  const desc = program.limbs.find((candidate) => candidate.id === limb);
  if (desc === undefined || desc.params.foot === null) return null;
  const roll = footRollAt(desc, ch) as FootRoll;
  const slot = program.controlIndex.get(desc.params.ikControl) as number;
  const xf = allocXfArrays(1);
  xfaFromMat4(pose.controlWorld, slot * 16, xf, 0);
  const apply = (element: number, p: V3): Float64Array => {
    const local = transformPoint(roll.xf, element, p);
    return Float64Array.from(transformPoint(xf, 0, local));
  };
  const pv = roll.pivots;
  return {
    heel: apply(FOOT_F, pv.heel),
    ball: apply(FOOT_F, pv.ball),
    toe: apply(FOOT_G, pv.toe),
    inner: apply(FOOT_F, pv.inner),
    outer: apply(FOOT_F, pv.outer),
  };
}

/** t + q ⊗ (s ∘ p) of element `i`. */
function transformPoint(xf: XfArrays, i: number, p: V3): V3 {
  const qx = xf.q[i * 4] as number;
  const qy = xf.q[i * 4 + 1] as number;
  const qz = xf.q[i * 4 + 2] as number;
  const qw = xf.q[i * 4 + 3] as number;
  const v: V3 = [
    p[0] * (xf.s[i * 3] as number),
    p[1] * (xf.s[i * 3 + 1] as number),
    p[2] * (xf.s[i * 3 + 2] as number),
  ];
  const r = rotate([qx, qy, qz, qw], v);
  return [r[0] + (xf.t[i * 3] as number), r[1] + (xf.t[i * 3 + 1] as number), r[2] + (xf.t[i * 3 + 2] as number)];
}
