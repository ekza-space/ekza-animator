import { EkzaError, type Quat, quatSlerp } from '@ekza-animator/anim-core';
import type { ConstraintRecord, ControlId, SolverRecord } from '@ekza-animator/doc';
import { TwoBoneCore } from '../ik/core';
import { internalsOf } from '../kernel/internals';
import type { RigOpImpl } from '../kernel/ops';
import {
  allocXfArrays,
  type XfArrays,
  xfaCopy,
  xfaFromMat4,
  xfaInvMul,
  xfaMul,
  xfaMulInv,
  xfaToMat4,
} from '../math/xfa';
import {
  type ChannelBuffer,
  LIMB_ATTR,
  type LimbAttr,
  type LimbDesc,
  type PoseBuffers,
  type RigOpCompileContext,
  type RigProgram,
} from '../types';
import { FOOT_BALL_W, FOOT_F, FootRoll } from './foot';
import {
  controlDescendants,
  type LimbNodes,
  nodeSubtree,
  type ParsedIk2,
  parseIk2Params,
  resolveLimbNodes,
} from './template';

// The `ik2` rig op (M2A-SPEC §5.3): two-bone IK with pole, twist, soft IK and (legs) foot roll in the foot frame,
// blended with FK by the limb's `ikFk` attribute in chain-relative local space. Writes the chain's subtree and the
// controls below the FK chain (follow rule), keeps the toes planted under ball roll (toes rule), and returns false
// at ikFk 0 so the kernel leaves every bone local bit-identical to a program without the op. `run` allocates
// nothing: every buffer lives in the `state` built by `compile`.

const ROLE_UPPER = 0;
const ROLE_INTER = 1;
const ROLE_MID = 2;
const ROLE_END = 3;

/** Scratch elements of `Ik2State.xf`. */
const PA = 0;
const IK = 1;
const TGT = 2;
const TMP = 3;
const REL = 4;
const CW = 5;
const XF_COUNT = 6;

interface Ik2State {
  readonly limb: LimbDesc;
  readonly core: TwoBoneCore;
  readonly foot: FootRoll | null;
  readonly parentNode: number;
  readonly facing: XfArrays;
  readonly ikSlot: number;
  readonly poleSlot: number;
  readonly attr: Readonly<Record<LimbAttr, number>>;
  readonly reach: number;
  /** Written nodes in index order. */
  readonly nodes: Int32Array;
  /** Chain path upper → end as indices into `nodes`, with their roles. */
  readonly path: Int32Array;
  readonly role: Uint8Array;
  /** Index into `nodes` of the chain parent of each path entry (upper for mid, mid for end; −1 otherwise). */
  readonly chainParent: Int32Array;
  readonly endIndex: number;
  /** Index into `nodes` of the toes bone, −1 without toes. */
  readonly toesIndex: number;
  /** Delta used by each written node that is not on the path (−1 for path nodes and the toes). */
  readonly nodeAnchor: Int32Array;
  /** Written control slots and the delta each follows. */
  readonly controls: Int32Array;
  readonly controlAnchor: Int32Array;
  /** Rest locals of the written nodes (positions of mid and end come from them). */
  readonly restLocal: XfArrays;
  /** K_end = (W⁰_ik)⁻¹ · W⁰_end. */
  readonly kEnd: XfArrays;
  readonly fkN: XfArrays;
  readonly newN: XfArrays;
  readonly fkC: XfArrays;
  readonly newC: XfArrays;
  /** Δ per path entry, then Δ_toes. */
  readonly delta: XfArrays;
  readonly xf: XfArrays;
  readonly qa: Quat;
  readonly qb: Quat;
}

function limbNodesOf(
  record: ConstraintRecord | SolverRecord,
  ctx: RigOpCompileContext,
): {
  readonly parsed: ParsedIk2;
  readonly nodes: LimbNodes;
} {
  const parsed = parseIk2Params(record);
  return { parsed, nodes: resolveLimbNodes(record, parsed, ctx) };
}

/** Controls below fk.upper / fk.mid / fk.end (excluding those three), which the op moves with the chain. */
function writtenControls(parsed: ParsedIk2, ctx: RigOpCompileContext): ControlId[] {
  const { fk } = parsed.params;
  return controlDescendants(ctx, [fk.upper, fk.mid, fk.end]);
}

export const ik2Op: RigOpImpl = {
  reads(record, ctx) {
    const { parsed, nodes } = limbNodesOf(record, ctx);
    const p = parsed.params;
    const unresolved = [nodes.upper, nodes.mid, nodes.end].filter((node) => node < 0);
    return {
      controls: [p.ikControl, p.pole, p.fk.upper, p.fk.mid, p.fk.end],
      nodes: unresolved.length > 0 ? unresolved : nodes.parent >= 0 ? [nodes.parent] : [],
    };
  },
  writes(record, ctx) {
    const { parsed, nodes } = limbNodesOf(record, ctx);
    if (nodes.upper < 0 || nodes.mid < 0 || nodes.end < 0) return { controls: [], nodes: [-1] };
    const controls = writtenControls(parsed, ctx);
    const p = parsed.params;
    if (controls.includes(p.ikControl) || controls.includes(p.pole)) {
      throw new EkzaError('invalid-record', `ik2 ${record.id}: the IK or pole control lies below the FK chain`);
    }
    return { controls, nodes: nodeSubtree(ctx, nodes.upper) };
  },
  compile(record, ctx) {
    return compileState(record, ctx);
  },
  run(_record, ctx) {
    return runIk2(ctx.state as Ik2State | undefined, ctx.pose, ctx.channels);
  },
};

/**
 * The LimbDesc of a scheduled `ik2` op (§5.4 rule 4), from its params and the compile context; `restWorld` holds the
 * skeleton's rest worlds (for the rest lengths).
 */
export function buildLimbDesc(record: SolverRecord, ctx: RigOpCompileContext, restWorld: XfArrays): LimbDesc {
  const { parsed, nodes } = limbNodesOf(record, ctx);
  const p = parsed.params;
  const pos = (node: number): [number, number, number] => [
    restWorld.t[node * 3] as number,
    restWorld.t[node * 3 + 1] as number,
    restWorld.t[node * 3 + 2] as number,
  ];
  const dist = (x: number, y: number): number => {
    const a = pos(x);
    const b = pos(y);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  const attrSlots = {} as Record<LimbAttr, number>;
  for (const name of Object.keys(LIMB_ATTR) as LimbAttr[]) attrSlots[name] = ctx.attrSlot(p.ikControl, name);
  return {
    id: p.limb,
    solver: record.id,
    params: { ...p, hinge: parsed.hinge },
    nodes: { upper: nodes.upper, mid: nodes.mid, end: nodes.end, toes: nodes.toes },
    attrSlots,
    lengths: {
      upper: dist(nodes.upper, nodes.mid),
      lower: dist(nodes.mid, nodes.end),
      restReach: dist(nodes.upper, nodes.end),
    },
    fkControls: [p.fk.upper, p.fk.mid, p.fk.end],
    ikControls: [p.ikControl, p.pole],
  };
}

function compileState(
  record: ConstraintRecord | SolverRecord,
  ctx: RigOpCompileContext & { readonly program: RigProgram },
): Ik2State {
  const program = ctx.program;
  const limb = program.limbs.find((candidate) => candidate.solver === record.id);
  if (limb === undefined) throw new EkzaError('invalid-record', `ik2 ${record.id}: no compiled limb`);
  const internals = internalsOf(program);
  const p = limb.params;
  const { upper, mid, end } = limb.nodes;
  const parsed = parseIk2Params(record);

  // Written nodes and the chain path.
  const nodeList = nodeSubtree(ctx, upper);
  const indexOf = new Map(nodeList.map((node, i) => [node, i]));
  const pathNodes: number[] = [];
  for (let node = end; node !== -1; node = internals.nodeParent[node] as number) {
    pathNodes.push(node);
    if (node === upper) break;
  }
  pathNodes.reverse();
  const path = Int32Array.from(pathNodes, (node) => indexOf.get(node) as number);
  const role = Uint8Array.from(pathNodes, (node) =>
    node === upper ? ROLE_UPPER : node === mid ? ROLE_MID : node === end ? ROLE_END : ROLE_INTER,
  );
  const upperIndex = indexOf.get(upper) as number;
  const midIndex = indexOf.get(mid) as number;
  const endIndex = indexOf.get(end) as number;
  const chainParent = Int32Array.from(pathNodes, (node) => (node === mid ? upperIndex : node === end ? midIndex : -1));
  const toes = limb.nodes.toes >= 0 && indexOf.has(limb.nodes.toes) ? limb.nodes.toes : -1;
  const toesIndex = toes === -1 ? -1 : (indexOf.get(toes) as number);
  const toesDelta = path.length;
  const pathPosition = new Map(pathNodes.map((node, i) => [node, i]));
  const inToes = (node: number): boolean => {
    for (let current = node; current !== -1; current = internals.nodeParent[current] as number) {
      if (current === toes) return true;
      if (current === end) return false;
    }
    return false;
  };
  const nodeAnchor = Int32Array.from(nodeList, (node) => {
    if (pathPosition.has(node) || node === toes) return -1;
    if (toes !== -1 && inToes(node)) return toesDelta;
    for (let current = node; current !== -1; current = internals.nodeParent[current] as number) {
      const position = pathPosition.get(current);
      if (position !== undefined) return position;
    }
    return 0;
  });

  // Written controls: each follows the bone of its nearest chain-control ancestor (fk.toes and below: the toes).
  const written = writtenControls(parsed, ctx);
  const chainControl = new Map<ControlId, number>([
    [p.fk.upper, pathPosition.get(upper) as number],
    [p.fk.mid, pathPosition.get(mid) as number],
    [p.fk.end, pathPosition.get(end) as number],
  ]);
  const toesControl = toes === -1 ? null : p.fk.toes;
  const byId = new Map(program.controls.map((control) => [control.id, control]));
  const controlAnchor = Int32Array.from(written, (id) => {
    for (let current: ControlId | null = id; current !== null; current = byId.get(current)?.parent ?? null) {
      if (current === toesControl) return toesDelta;
      const anchor = chainControl.get(current);
      if (anchor !== undefined) return anchor;
    }
    return pathPosition.get(end) as number;
  });
  const controls = Int32Array.from(written, (id) => program.controlIndex.get(id) as number);

  // Rest data.
  const restLocal = allocXfArrays(nodeList.length);
  nodeList.forEach((node, i) => xfaCopy(internals.restLocal, node, restLocal, i));
  const core = new TwoBoneCore();
  const rest = internals.restWorld;
  const scratch = allocXfArrays(2);
  xfaCopy(internals.restLocal, upper, scratch, 0);
  setCoreXf(scratch, 0, core.upperT, core.upperQ, core.upperS);
  xfaInvMul(rest, upper, rest, mid, scratch, 0);
  setCoreXf(scratch, 0, core.midT, core.midQ, core.midS);
  xfaInvMul(rest, mid, rest, end, scratch, 0);
  setCoreXf(scratch, 0, core.endT, core.endQ, null);
  // hingeLocal = q(W⁰_mid)⁻¹ ⊗ hinge
  const qx = -(rest.q[mid * 4] as number);
  const qy = -(rest.q[mid * 4 + 1] as number);
  const qz = -(rest.q[mid * 4 + 2] as number);
  const qw = rest.q[mid * 4 + 3] as number;
  const [hx, hy, hz] = p.hinge;
  const tx = 2 * (qy * hz - qz * hy);
  const ty = 2 * (qz * hx - qx * hz);
  const tz = 2 * (qx * hy - qy * hx);
  core.hingeLocal[0] = hx + qw * tx + (qy * tz - qz * ty);
  core.hingeLocal[1] = hy + qw * ty + (qz * tx - qx * tz);
  core.hingeLocal[2] = hz + qw * tz + (qx * ty - qy * tx);
  core.restReach = limb.lengths.restReach;
  core.useEndRotation = true;

  const ikSlot = program.controlIndex.get(p.ikControl) as number;
  const poleSlot = program.controlIndex.get(p.pole) as number;
  const kEnd = allocXfArrays(1);
  xfaInvMul(internals.controlRest, ikSlot, rest, end, kEnd, 0);

  return {
    limb,
    core,
    foot: p.foot === null ? null : new FootRoll(p.foot),
    parentNode: internals.nodeParent[upper] as number,
    facing: internals.facing,
    ikSlot,
    poleSlot,
    attr: limb.attrSlots,
    reach: limb.lengths.upper + limb.lengths.lower,
    nodes: Int32Array.from(nodeList),
    path,
    role,
    chainParent,
    endIndex,
    toesIndex,
    nodeAnchor,
    controls,
    controlAnchor,
    restLocal,
    kEnd,
    fkN: allocXfArrays(nodeList.length),
    newN: allocXfArrays(nodeList.length),
    fkC: allocXfArrays(controls.length),
    newC: allocXfArrays(controls.length),
    delta: allocXfArrays(path.length + 1),
    xf: allocXfArrays(XF_COUNT),
    qa: [0, 0, 0, 1],
    qb: [0, 0, 0, 1],
  };
}

function setCoreXf(
  xf: XfArrays,
  i: number,
  t: [number, number, number],
  q: Quat,
  s: [number, number, number] | null,
): void {
  t[0] = xf.t[i * 3] as number;
  t[1] = xf.t[i * 3 + 1] as number;
  t[2] = xf.t[i * 3 + 2] as number;
  q[0] = xf.q[i * 4] as number;
  q[1] = xf.q[i * 4 + 1] as number;
  q[2] = xf.q[i * 4 + 2] as number;
  q[3] = xf.q[i * 4 + 3] as number;
  if (s !== null) {
    s[0] = xf.s[i * 3] as number;
    s[1] = xf.s[i * 3 + 1] as number;
    s[2] = xf.s[i * 3 + 2] as number;
  }
}

function attrValue(channels: ChannelBuffer, slot: number, fallback: number): number {
  if (slot < 0 || slot >= channels.attrs.length) return fallback;
  const value = channels.attrs[slot] as number;
  return Number.isFinite(value) ? value : fallback;
}

/** q(a[ai])⁻¹ · q(b[bi]) into `out`. */
function relativeQuat(a: XfArrays, ai: number, b: XfArrays, bi: number, out: Quat): void {
  const ax = -(a.q[ai * 4] as number);
  const ay = -(a.q[ai * 4 + 1] as number);
  const az = -(a.q[ai * 4 + 2] as number);
  const aw = a.q[ai * 4 + 3] as number;
  const bx = b.q[bi * 4] as number;
  const by = b.q[bi * 4 + 1] as number;
  const bz = b.q[bi * 4 + 2] as number;
  const bw = b.q[bi * 4 + 3] as number;
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** World of chain bone `i` of `o`: rotation q(parent) · q, position parent · rest local t, scale parent ∘ rest s. */
function composeChainBone(
  parent: XfArrays,
  pi: number,
  rotationParent: XfArrays,
  ri: number,
  q: Quat,
  rest: XfArrays,
  restIndex: number,
  o: XfArrays,
  oi: number,
): void {
  // Rotation: q(rotationParent[ri]) · q
  const ax = rotationParent.q[ri * 4] as number;
  const ay = rotationParent.q[ri * 4 + 1] as number;
  const az = rotationParent.q[ri * 4 + 2] as number;
  const aw = rotationParent.q[ri * 4 + 3] as number;
  const rx = ax * q[3] + aw * q[0] + ay * q[2] - az * q[1];
  const ry = ay * q[3] + aw * q[1] + az * q[0] - ax * q[2];
  const rz = az * q[3] + aw * q[2] + ax * q[1] - ay * q[0];
  const rw = aw * q[3] - ax * q[0] - ay * q[1] - az * q[2];
  const inv = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
  // Position and scale: parent · (rest local t, s).
  const px = parent.q[pi * 4] as number;
  const py = parent.q[pi * 4 + 1] as number;
  const pz = parent.q[pi * 4 + 2] as number;
  const pw = parent.q[pi * 4 + 3] as number;
  const sx = parent.s[pi * 3] as number;
  const sy = parent.s[pi * 3 + 1] as number;
  const sz = parent.s[pi * 3 + 2] as number;
  const vx = sx * (rest.t[restIndex * 3] as number);
  const vy = sy * (rest.t[restIndex * 3 + 1] as number);
  const vz = sz * (rest.t[restIndex * 3 + 2] as number);
  const tx = 2 * (py * vz - pz * vy);
  const ty = 2 * (pz * vx - px * vz);
  const tz = 2 * (px * vy - py * vx);
  o.t[oi * 3] = (parent.t[pi * 3] as number) + vx + pw * tx + (py * tz - pz * ty);
  o.t[oi * 3 + 1] = (parent.t[pi * 3 + 1] as number) + vy + pw * ty + (pz * tx - px * tz);
  o.t[oi * 3 + 2] = (parent.t[pi * 3 + 2] as number) + vz + pw * tz + (px * ty - py * tx);
  o.q[oi * 4] = rx * inv;
  o.q[oi * 4 + 1] = ry * inv;
  o.q[oi * 4 + 2] = rz * inv;
  o.q[oi * 4 + 3] = rw * inv;
  o.s[oi * 3] = sx * (rest.s[restIndex * 3] as number);
  o.s[oi * 3 + 1] = sy * (rest.s[restIndex * 3 + 1] as number);
  o.s[oi * 3 + 2] = sz * (rest.s[restIndex * 3 + 2] as number);
}

/** q = slerp(q_fk, σ·q_ik, w); q_ik exactly at w = 1. */
function blend(fk: Quat, ik: Quat, w: number, out: Quat): void {
  if (w >= 1) {
    out[0] = ik[0];
    out[1] = ik[1];
    out[2] = ik[2];
    out[3] = ik[3];
    return;
  }
  quatSlerp(fk, ik, w, out);
}

function runIk2(state: Ik2State | undefined, pose: PoseBuffers, channels: ChannelBuffer): boolean {
  if (state === undefined) return false;
  const { attr, core, xf, fkN, newN, delta, nodes, path, role, restLocal, qa, qb } = state;
  const w = Math.min(1, Math.max(0, attrValue(channels, attr.ikFk, 0)));
  if (!(w > 0)) return false;

  // FK worlds of everything the op writes, the parent of the chain and the IK and pole controls.
  for (let i = 0; i < nodes.length; i++) xfaFromMat4(pose.boneWorld, (nodes[i] as number) * 16, fkN, i);
  const controls = state.controls;
  for (let j = 0; j < controls.length; j++) {
    xfaFromMat4(pose.controlWorld, (controls[j] as number) * 16, state.fkC, j);
  }
  if (state.parentNode === -1) xfaCopy(state.facing, 0, xf, PA);
  else xfaFromMat4(pose.boneWorld, state.parentNode * 16, xf, PA);
  xfaFromMat4(pose.controlWorld, state.ikSlot * 16, xf, IK);

  // 1. Effective end target: W_ik · F · K_end (legs: foot roll in the foot frame).
  const foot = state.foot;
  if (foot !== null) {
    foot.compute(
      attrValue(channels, attr.roll, 0),
      attrValue(channels, attr.bank, 0),
      attrValue(channels, attr.heelTwist, 0),
      attrValue(channels, attr.toeTwist, 0),
    );
    xfaMul(xf, IK, foot.xf, FOOT_F, xf, TMP);
    xfaMul(xf, TMP, state.kEnd, 0, xf, TGT);
  } else {
    xfaMul(xf, IK, state.kEnd, 0, xf, TGT);
  }

  // 2. Solve.
  core.parentT[0] = xf.t[PA * 3] as number;
  core.parentT[1] = xf.t[PA * 3 + 1] as number;
  core.parentT[2] = xf.t[PA * 3 + 2] as number;
  core.parentQ[0] = xf.q[PA * 4] as number;
  core.parentQ[1] = xf.q[PA * 4 + 1] as number;
  core.parentQ[2] = xf.q[PA * 4 + 2] as number;
  core.parentQ[3] = xf.q[PA * 4 + 3] as number;
  core.parentS[0] = xf.s[PA * 3] as number;
  core.parentS[1] = xf.s[PA * 3 + 1] as number;
  core.parentS[2] = xf.s[PA * 3 + 2] as number;
  core.target[0] = xf.t[TGT * 3] as number;
  core.target[1] = xf.t[TGT * 3 + 1] as number;
  core.target[2] = xf.t[TGT * 3 + 2] as number;
  core.endWorldQ[0] = xf.q[TGT * 4] as number;
  core.endWorldQ[1] = xf.q[TGT * 4 + 1] as number;
  core.endWorldQ[2] = xf.q[TGT * 4 + 2] as number;
  core.endWorldQ[3] = xf.q[TGT * 4 + 3] as number;
  const pole = state.poleSlot * 16;
  core.pole[0] = pose.controlWorld[pole + 12] as number;
  core.pole[1] = pose.controlWorld[pole + 13] as number;
  core.pole[2] = pose.controlWorld[pole + 14] as number;
  core.twist = attrValue(channels, attr.twist, 0);
  core.soft = Math.min(0.25, Math.max(0, attrValue(channels, attr.soft, 0))) * state.reach;
  core.solve();

  // 3–4. Blend in chain-relative local space and compose the chain top-down.
  for (let k = 0; k < path.length; k++) {
    const i = path[k] as number;
    const r = role[k] as number;
    if (r === ROLE_INTER) {
      const prev = path[k - 1] as number;
      xfaInvMul(fkN, prev, fkN, i, xf, TMP);
      xfaMul(newN, prev, xf, TMP, newN, i);
      continue;
    }
    if (r === ROLE_UPPER) {
      relativeQuat(xf, PA, fkN, i, qa);
      blend(qa, core.upperLocal, w, qb);
      composeChainBone(xf, PA, xf, PA, qb, restLocal, i, newN, i);
      continue;
    }
    const chain = state.chainParent[k] as number;
    const prev = path[k - 1] as number;
    relativeQuat(fkN, chain, fkN, i, qa);
    blend(qa, r === ROLE_MID ? core.midLocal : core.endLocal, w, qb);
    composeChainBone(newN, prev, newN, chain, qb, restLocal, i, newN, i);
  }
  for (let k = 0; k < path.length; k++) {
    const i = path[k] as number;
    xfaMulInv(newN, i, fkN, i, delta, k);
  }

  // 6. Toes rule: W_toes = W_end,new · C_w · (W_end,fk⁻¹ · W_toes,fk), C_w = K_end⁻¹ · Ball(w·ballRoll)⁻¹ · K_end.
  const toes = state.toesIndex;
  const toesDelta = path.length;
  if (toes !== -1) {
    const end = state.endIndex;
    xfaInvMul(fkN, end, fkN, toes, xf, REL);
    if (foot !== null && foot.ballRoll !== 0) {
      foot.computeBall(w);
      xfaInvMul(foot.xf, FOOT_BALL_W, state.kEnd, 0, xf, TMP);
      xfaInvMul(state.kEnd, 0, xf, TMP, xf, CW);
      xfaMul(xf, CW, xf, REL, xf, REL);
    }
    xfaMul(newN, end, xf, REL, newN, toes);
    xfaMulInv(newN, toes, fkN, toes, delta, toesDelta);
  }

  // 5. Follow rule for every other written node and control.
  const nodeAnchor = state.nodeAnchor;
  for (let i = 0; i < nodes.length; i++) {
    const anchor = nodeAnchor[i] as number;
    if (anchor < 0) continue;
    xfaMul(delta, anchor, fkN, i, newN, i);
  }
  const controlAnchor = state.controlAnchor;
  for (let j = 0; j < controls.length; j++) {
    xfaMul(delta, controlAnchor[j] as number, state.fkC, j, state.newC, j);
  }

  // 7. Write the new worlds.
  for (let i = 0; i < nodes.length; i++) xfaToMat4(newN, i, pose.boneWorld, (nodes[i] as number) * 16);
  for (let j = 0; j < controls.length; j++) xfaToMat4(state.newC, j, pose.controlWorld, (controls[j] as number) * 16);
  return true;
}
