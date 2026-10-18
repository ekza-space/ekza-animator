import { EkzaError, type Mat4, mat4Decompose, quatAngle, type Quat } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import { TwoBoneCore } from '../ik/core';
import { solveBoneChannels, solveControlChannels } from '../inverse/solve';
import { internalsOf } from '../kernel/internals';
import { allocXfArrays, type XfArrays, xfaCopy, xfaFromMat4, xfaInvMul, xfaMulInv, xfaToMat4 } from '../math/xfa';
import { readControlChannels, writeControlChannels } from '../sampler/channels';
import type { ChannelBuffer, LimbDesc, LimbId, PoseBuffers, RigProgram } from '../types';
import { FOOT_F, FOOT_G, FootRoll } from './foot';
import { configureLimbCore } from './ik2';

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
  return mat4Decompose(pose.boneWorld.subarray(node * 16, node * 16 + 16)).q;
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
/**
 * The IK's mid-joint offset ω of the match pole rule is taken at the FK pose's own hinge bend below OMEGA_IK_FROM of
 * IK bend and at the IK's bend for the FK reach above OMEGA_IK_TO (smoothstep between): both agree for hinge poses;
 * the second puts the IK mid joint exactly in the FK bend plane of an off-hinge pose (β = 1), but near straight it
 * amplifies small reach changes (the IK bend changes like 1/sin t with the reach).
 */
const OMEGA_IK_FROM = 10 * DEG;
const OMEGA_IK_TO = 20 * DEG;

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
 * The parts of the §5.6 match pole rule that depend on the FK positions a, b, c (upper, mid, end) only: x̂ =
 * normalize(c − a), the hinge-implied flexion direction h = normalize(x̂ × k_fk) (a degenerate hinge, |x̂ × k_fk| <
 * 1e-6: the current pole direction from b) and the blend weight β = smoothstep(2°, 10°, θ)·smoothstep(0, 0.5, m̂·h)
 * (θ the bend between b − a and c − b, m̂ the normalized bend offset; β = 0 when |m| ≤ 1e-3·L).
 */
export function matchPoleBasis(
  a: V3,
  b: V3,
  c: V3,
  hingeWorld: V3,
  currentPole: V3,
  reach: number,
): { readonly x: V3; readonly h: V3; readonly beta: number } {
  const ac = sub(c, a);
  const x: V3 = len(ac) > 1e-12 ? scale(ac, 1 / len(ac)) : [0, -1, 0];
  let h = cross(x, hingeWorld);
  if (len(h) < 1e-6) {
    const toPole = perpendicular(sub(currentPole, b), x);
    h = len(toPole) > 1e-12 ? toPole : sub(currentPole, b);
  }
  h = len(h) > 1e-12 ? scale(h, 1 / len(h)) : [0, 0, 1];
  const m = perpendicular(sub(b, a), x);
  if (len(m) <= 1e-3 * reach) return { x, h, beta: 0 };
  const mHat = scale(m, 1 / len(m));
  const u = sub(b, a);
  const v = sub(c, b);
  const cosine = dot(u, v) / Math.max(1e-300, len(u) * len(v));
  const theta = Math.acos(Math.min(1, Math.max(-1, cosine)));
  return { x, h, beta: smoothstep(2 * DEG, 10 * DEG, theta) * smoothstep(0, 0.5, dot(mHat, h)) };
}

/** `v` rotated about the unit axis `x` by `angle` (Rodrigues). */
function rotateAbout(v: V3, x: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(x, v);
  const d = dot(x, v) * (1 - c);
  return [v[0] * c + k[0] * s + x[0] * d, v[1] * c + k[1] * s + x[1] * d, v[2] * c + k[2] * s + x[2] * d];
}

/** Signed angle about the unit axis `x` from `from` to `to` (both taken perpendicular to `x`); 0 when degenerate. */
function angleAbout(from: V3, to: V3, x: V3): number {
  const f = perpendicular(from, x);
  const t = perpendicular(to, x);
  if (len(f) < 1e-12 || len(t) < 1e-12) return 0;
  return Math.atan2(dot(x, cross(f, t)), dot(f, t));
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

/** W_ik = endWorld · K_end⁻¹ · F⁻¹ as a matrix, its translation moved by `shift` (the amendment C band). */
function ikWorldFor(
  program: RigProgram,
  desc: LimbDesc,
  ch: ChannelBuffer,
  endWorld: Mat4 | Float64Array,
  offset: number,
  shift: V3,
): Mat4 {
  const xf = allocXfArrays(2);
  xfaFromMat4(endWorld, offset, xf, 0);
  xfaMulInv(xf, 0, kEndOf(program, desc), 0, xf, 1);
  const roll = footRollAt(desc, ch);
  if (roll !== null) xfaMulInv(xf, 1, roll.xf, FOOT_F, xf, 1);
  const out = new Float64Array(16);
  xfaToMat4(xf, 1, out, 0);
  out[12] = (out[12] as number) + shift[0];
  out[13] = (out[13] as number) + shift[1];
  out[14] = (out[14] as number) + shift[2];
  return out;
}

/** The limb's two-bone solver (the op's rest data) under the parent world of its upper bone in `pose`. */
export function limbCore(program: RigProgram, desc: LimbDesc, pose: PoseBuffers): TwoBoneCore {
  const internals = internalsOf(program);
  const core = new TwoBoneCore();
  configureLimbCore(core, program, desc);
  const parent = internals.nodeParent[desc.nodes.upper] as number;
  const xf = allocXfArrays(1);
  if (parent === -1) xfaCopy(internals.facing, 0, xf, 0);
  else xfaFromMat4(pose.boneWorld, parent * 16, xf, 0);
  for (let i = 0; i < 3; i++) {
    core.parentT[i] = xf.t[i] as number;
    core.parentS[i] = xf.s[i] as number;
  }
  for (let i = 0; i < 4; i++) core.parentQ[i] = xf.q[i] as number;
  return core;
}

/**
 * Where the IK target must sit for the ik2 solver to land the end at `end` with the mid joint on the side `flexed`
 * (§5.3 amendment C): the translation that moves the IK control from `end` along the reach ray. Zero for limbs whose
 * rest is not hyperextended and for bends outside the transition band, where the solver lands the end on its target.
 * Inside the band (the bends from the rest's −T to T + W) the solver takes each bend at a distance shorter than its
 * reach, so the control sits that much closer to the upper bone than the end. A hyperextended side beyond the rest's
 * hyperextension cannot be reproduced; it is answered with the flexion of the same reach.
 */
function bandShift(core: TwoBoneCore, end: V3, flexed: boolean): V3 {
  const { hyper, width } = core.transitionBand();
  if (!(hyper > 0)) return [0, 0, 0];
  const a = core.upperPosition([0, 0, 0]);
  const ray = sub(end, a);
  const d = len(ray);
  if (!(d > 1e-12)) return [0, 0, 0];
  const t = ikBendFor(core, d, flexed);
  if (!(t > -hyper && t < hyper + width)) return [0, 0, 0];
  return scale(ray, (core.distanceForBend(t) - d) / d);
}

/**
 * The bend t (from greatest reach) the matched IK takes for an end at distance `d` from the upper bone, with the mid
 * joint on the side `flexed`: the flexion of that reach, or on the hyperextended side the hyperextension of that
 * reach while it does not exceed the rest's (a further hyperextension cannot be reproduced and flexes instead).
 */
function ikBendFor(core: TwoBoneCore, d: number, flexed: boolean): number {
  const { hyper } = core.transitionBand();
  const { spread } = core.bendAt(d);
  if (flexed || !(hyper > 0)) return spread;
  // The rest itself lies at spread T on the hyperextended side; rounding may put it a hair beyond.
  return spread <= hyper + 1e-9 ? -Math.min(spread, hyper) : spread;
}

/** Whether the mid joint of `pose` lies on the flexion side of the limb's hinge (m · (x̂ × k) > 0, §5.6). */
function flexedIn(program: RigProgram, desc: LimbDesc, pose: PoseBuffers): boolean {
  const a = position(pose, desc.nodes.upper);
  const b = position(pose, desc.nodes.mid);
  const c = position(pose, desc.nodes.end);
  const ac = sub(c, a);
  const x: V3 = len(ac) > 1e-12 ? scale(ac, 1 / len(ac)) : [0, -1, 0];
  return dot(perpendicular(sub(b, a), x), cross(x, worldHinge(program, desc, pose))) > 0;
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
  const end: V3 = [endWorld[12] as number, endWorld[13] as number, endWorld[14] as number];
  const shift = bandShift(limbCore(program, desc, pose), end, flexedIn(program, desc, pose));
  return solveControlChannels(
    program,
    pose,
    desc.params.ikControl,
    ikWorldFor(program, desc, ch, endWorld, 0, shift),
    reference,
  );
}

/**
 * The FK pose's bend about the limb's hinge, measured like the solver's bend t (from the chain's greatest reach,
 * > 0 flexion): the hinge part (swing-twist about the hinge) of the mid bone's rotation relative to the upper bone,
 * taken against their rest relation, less the rest's offset from greatest reach. Equals the IK's bend for every
 * hinge pose; a smooth function of the FK rotations (no reach singularity near straight, no branch switch).
 */
function hingeBendOf(program: RigProgram, desc: LimbDesc, pose: PoseBuffers, core: TwoBoneCore): number {
  const internals = internalsOf(program);
  const { upper, mid } = desc.nodes;
  const restQ = (node: number): Quat => [
    internals.restWorld.q[node * 4] as number,
    internals.restWorld.q[node * 4 + 1] as number,
    internals.restWorld.q[node * 4 + 2] as number,
    internals.restWorld.q[node * 4 + 3] as number,
  ];
  const relative = quatMul(conj(boneRotation(pose, upper)), boneRotation(pose, mid));
  const restRelative = quatMul(conj(restQ(upper)), restQ(mid));
  const delta = quatMul(conj(restRelative), relative);
  const hingeLocal = rotate(conj(restQ(mid)), [desc.params.hinge[0], desc.params.hinge[1], desc.params.hinge[2]]);
  const gamma = 2 * Math.atan2(dot([delta[0], delta[1], delta[2]], hingeLocal), delta[3]);
  const t = gamma - core.transitionBand().base;
  return Math.atan2(Math.sin(t), Math.cos(t));
}

/**
 * Match IK to FK (§5.6): IK control channels from the FK end world (W_ik = W_end,fk · K_end⁻¹ · F⁻¹ at the current
 * foot-roll attributes), `twist` 0 and the pole by the match pole rule, at distance D from b (the current pole
 * distance when ≥ 0.25·L, else L).
 *
 * The rule's blend towards the actual bend offset m̂ is taken relative to the IK's own mid joint (a refinement that
 * keeps the rule exact on real rests, docs/wp-notes/m2a-rig-ik.md M2A-A1-2): the pole direction is h turned about x̂
 * by β·ψ, ψ the signed angle from ω to the FK offset m, where ω is the direction (about x̂, from h) of the offset the
 * IK gives the mid joint with the pole along h. ω comes from the rest geometry (`TwoBoneCore.offsetAngleAt`) at the
 * FK pose's own hinge bend (`hingeBendOf`, on the flexion side) for IK bends up to 10° and at the IK's bend for the
 * FK reach from 20° (`OMEGA_IK_FROM`/`TO`). A hinge pose gives ψ = 0 and the exact M1-style pole, also when the rest
 * bend leaves the hinge plane by a little (Seed-san's knees) or a lot (Polybot's splayed legs); an off-hinge knee
 * (mocap ab-duction or twist) turns the IK bend plane towards the actual knee (into the FK bend plane at β = 1 from
 * 20° of bend); near-straight and hyperextended limbs (β = 0) use h. No IK evaluation and no solver branch enters ω,
 * and ψ never wraps while β > 0 (|ω| < π/2 on the flexion side and m̂·h > 0), so the pole moves continuously with
 * the FK pose. The pole is placed so that its offset from the a → c line points along p̂ (the ik2 twist aligns the
 * hinge-implied direction with that offset, §5.3 B).
 *
 * The IK control sits at the FK end, except on a limb whose rest is hyperextended when the FK bend lies in the
 * solver's transition band (§5.3 amendment C, `bandShift`): it then sits on the reach ray at the distance for which
 * the solver takes the FK bend, so the end still lands on the FK end.
 *
 * Only the IK and pole controls are matched (`fk.toes` keeps its channels): with a ball roll the toes rule keeps
 * the IK toes planted, so they differ from the FK toes (§5.3 step 6). The errors compare the IK result (evaluated
 * with ikFk 1 and the other channels of `ch`) with `fkPose`: end and mid joint positions and the largest
 * world-rotation difference of the chain bones.
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
  const { x, h, beta } = matchPoleBasis(a, b, c, worldHinge(program, desc, fkPose), currentPole, reach);
  const core = limbCore(program, desc, fkPose);
  const currentDistance = len(sub(currentPole, b));
  const distance = currentDistance >= 0.25 * reach ? currentDistance : reach;
  const m = perpendicular(sub(b, a), x);
  const poleReference = reference.get(p.pole) ?? readControlChannels(program, ch, p.pole);
  const poleValuesAlong = (direction: V3): ChannelValues => {
    const off = sub(m, scale(direction, dot(m, direction)));
    const poleWorld = fkPose.controlWorld.slice(poleSlot * 16, poleSlot * 16 + 16);
    poleWorld[12] = b[0] + direction[0] * distance - off[0];
    poleWorld[13] = b[1] + direction[1] * distance - off[1];
    poleWorld[14] = b[2] + direction[2] * distance - off[2];
    return solveControlChannels(program, fkPose, p.pole, poleWorld, poleReference);
  };

  const ikReference = reference.get(p.ikControl) ?? readControlChannels(program, ch, p.ikControl);
  const ikValues: ChannelValues = {
    ...solveControlChannels(
      program,
      fkPose,
      p.ikControl,
      ikWorldFor(program, desc, ch, fkPose.boneWorld, end * 16, bandShift(core, c, dot(m, h) > 0)),
      ikReference,
    ),
  };
  if (desc.attrSlots.twist >= 0) ikValues['@twist'] = 0;

  // The pole: h turned about x̂ by β·ψ, ψ the angle from the IK's own mid-joint offset ω (with the pole along h) to
  // the FK offset m. A hinge pose gives ψ = 0 (the exact M1-style pole).
  let poleValues = poleValuesAlong(h);
  if (beta > 0) {
    const omegaFk = core.offsetAngleAt(Math.abs(hingeBendOf(program, desc, fkPose, core)));
    const tIk = ikBendFor(core, len(sub(c, a)), dot(m, h) > 0);
    const lambda = smoothstep(OMEGA_IK_FROM, OMEGA_IK_TO, tIk);
    const omega = lambda > 0 ? omegaFk + lambda * (core.offsetAngleAt(tIk) - omegaFk) : omegaFk;
    const psi = angleAbout(rotateAbout(h, x, omega), m, x);
    if (psi !== 0) poleValues = poleValuesAlong(rotateAbout(h, x, beta * psi));
  }

  // The IK pose with these channels (ikFk 1, the other channels of `ch`) for the errors.
  const scratch = program.allocChannels();
  scratch.values.set(ch.values.subarray(0, scratch.values.length));
  scratch.attrs.set(ch.attrs.subarray(0, scratch.attrs.length));
  writeControlChannels(program, scratch, p.ikControl, ikValues);
  writeControlChannels(program, scratch, p.pole, poleValues);
  if (desc.attrSlots.ikFk >= 0) scratch.attrs[desc.attrSlots.ikFk] = 1;
  const ikPose = program.allocPose();
  program.evaluate(scratch, ikPose);

  const values = new Map<ControlId, ChannelValues>([
    [p.ikControl, ikValues],
    [p.pole, poleValues],
  ]);
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
