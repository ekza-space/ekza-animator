import {
  type AttrDef,
  type ControlId,
  type ControlRecord,
  type ControlShape,
  controlId,
  fractionalIndex,
  type SolverRecord,
  solverId,
} from '@ekza-animator/doc';
import { hasRequiredHumanoid } from '../autorig/autoRig';
import { clean } from '../autorig/shapes';
import { restContext } from '../autorig/spec';
import { bendOf } from '../ik/core';
import type { FootRollParams, Ik2Params, LimbId, RigDefinition, SkeletonDesc } from '../types';
import { LIMB_IDS } from '../types';
import { footprintShape, measureFootParams } from './foot';
import { LIMB_TEMPLATES, type LimbTemplate } from './template';

// Limb IK records (M2A-SPEC §5.2): IK and pole controls with the limb attributes, and the `ik2` solver records, for
// `autoRig(…, { ik })` and `rig.addLimbIk`. Deterministic: control IDs `controlId(rig, key)`, solver IDs
// `solverId(rig, 'ik2.<limb>')`, so two peers adding IK to the same rig write identical records.

const AXES_ALL = [true, true, true] as const;
const AXES_NONE = [false, false, false] as const;
const IDENTITY_Q = [0, 0, 0, 1] as const;
const UNIT_S = [1, 1, 1] as const;
const IDENTITY_OFFSET = { t: [0, 0, 0], q: IDENTITY_Q, s: UNIT_S } as const;
/** A rest bend against the hinge beyond this warns (§5.2.1). */
const HYPEREXTENDED_REST = (2 * Math.PI) / 180;

/** The attributes of a limb's IK control (§5.2 table); legs carry all seven, arms the first three. */
export function limbAttrs(kind: 'leg' | 'arm', ikFkDefault: number): Record<string, AttrDef> {
  const angle = (mirror: 'copy' | 'negate'): AttrDef => ({
    type: 'float',
    default: 0,
    keyable: true,
    unit: 'angle',
    mirror,
  });
  const attrs: Record<string, AttrDef> = {
    ikFk: {
      type: 'float',
      default: ikFkDefault,
      min: 0,
      max: 1,
      keyable: true,
      stepped: true,
      label: 'IK/FK',
      mirror: 'copy',
      keyAll: false,
    },
    soft: { type: 'float', default: 0, min: 0, max: 0.25, keyable: true, mirror: 'copy', keyAll: false },
    twist: angle('negate'),
  };
  if (kind === 'leg') {
    attrs['roll'] = angle('copy');
    attrs['bank'] = angle('copy');
    attrs['heelTwist'] = angle('negate');
    attrs['toeTwist'] = angle('negate');
  }
  return attrs;
}

type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] as number) - (b[0] as number),
  (a[1] as number) - (b[1] as number),
  (a[2] as number) - (b[2] as number),
];
const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
  (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
  (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
];
const norm = (a: readonly number[]): number => Math.hypot(a[0] as number, a[1] as number, a[2] as number);
const scaled = (a: readonly number[], s: number): V3 => [
  (a[0] as number) * s,
  (a[1] as number) * s,
  (a[2] as number) * s,
];

/**
 * §5.2.1 hinge: normalize(x̂⁰ × s), legs s = (0, 0, −1), arms (0, 0, 1); the R07 table when |x̂⁰ × s| < 0.1. x̂⁰ is
 * the rest direction `from` → `to`: the upper arm for arms (§5.2.1 as written), the LOWER leg for legs (the bone that
 * swings back; a deviation recorded in docs/wp-notes/m2a-rig-ik.md). Both agree on straight limbs; on Polybot, whose
 * thighs splay 28.6° outward over vertical shins, the thigh would tilt the knee hinge by 28.6° in the frontal plane,
 * so knee flexion about x (the FK controls' and the normalized humanoid convention) would not be a hinge motion and
 * imported clips would keep the legs FK.
 */
export function limbHinge(t: LimbTemplate, from: readonly number[], to: readonly number[]): V3 {
  const dir = sub(to, from);
  const len = norm(dir);
  const swingDir: V3 = t.kind === 'leg' ? [0, 0, -1] : [0, 0, 1];
  const c = len > 1e-12 ? cross(scaled(dir, 1 / len), swingDir) : ([0, 0, 0] as V3);
  const n = norm(c);
  if (n < 0.1) {
    if (t.kind === 'leg') return [1, 0, 0];
    return t.side === 'L' ? [0, -1, 0] : [0, 1, 0];
  }
  return scaled(c, 1 / n);
}

/**
 * §5.2.2 rest pole, placed so the IK twist is exactly zero at rest: with x̂⁰ = normalize(c⁰ − a⁰), the bend offset
 * m⁰ = (b⁰ − a⁰) − ((b⁰ − a⁰)·x̂⁰)x̂⁰ and the hinge-implied flexion direction h⁰ = normalize(x̂⁰ × k⁰), the pole is
 * b⁰ + h⁰·(l1 + l2) − m⁰_off, where m⁰_off = m⁰ − (m⁰·h⁰)h⁰ is the part of the rest bend that does not lie along
 * the hinge plane. For a rest bent about its hinge (or straight) this is the spec's b⁰ + p̂⁰·(l1 + l2); for a rest
 * that bends off the hinge (Polybot's legs) the pole stays in front of the knee instead of beside it.
 */
export function restPole(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  hinge: readonly number[],
  reach: number,
): V3 {
  const ac = sub(c, a);
  const acLen = norm(ac);
  const x: V3 = acLen > 1e-12 ? scaled(ac, 1 / acLen) : [0, -1, 0];
  const ab = sub(b, a);
  const m = sub(ab, scaled(x, dot(ab, x)));
  let h = cross(x, hinge);
  const hLen = norm(h);
  if (hLen > 1e-9) h = scaled(h, 1 / hLen);
  else {
    // The hinge lies along the chain: the rest bend (or any perpendicular) gives the side.
    const mLen = norm(m);
    h = mLen > 1e-12 ? scaled(m, 1 / mLen) : anyPerpendicular(x);
  }
  const along = dot(m, h);
  const off = sub(m, scaled(h, along));
  return [
    (b[0] as number) + h[0] * reach - off[0],
    (b[1] as number) + h[1] * reach - off[1],
    (b[2] as number) + h[2] * reach - off[2],
  ];
}

function anyPerpendicular(v: V3): V3 {
  const axis: V3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const p = sub(axis, scaled(v, dot(axis, v)));
  return scaled(p, 1 / norm(p));
}

function shape(kind: string, size: number, custom: ControlShape['custom'] = null): ControlShape {
  return { kind, size: clean(size), offset: IDENTITY_OFFSET, custom, color: 'side', lineWidth: null };
}

function liveControls(def: RigDefinition): ControlRecord[] {
  return def.controls.filter((control) => control.deleted === null || control.deleted === undefined);
}

/**
 * The IK controls and `ik2` solvers of the requested limbs (M2A-SPEC §5.2), in `LIMB_IDS` order. Only for humanoid
 * skeletons and for limbs whose three chain bones exist and are driven by their FK controls; a missing limb, or one
 * that already has IK, is skipped with a warning. `ikFkDefault: 'by-limb'` gives legs 1 and arms 0 (new rigs);
 * `0` gives every limb 0 (`rig.addLimbIk`: existing animation stays unchanged).
 */
export function limbIkRecords(
  def: RigDefinition,
  skeleton: SkeletonDesc,
  opts: { readonly limbs: readonly LimbId[]; readonly ikFkDefault: 'by-limb' | 0 },
): {
  readonly controls: readonly ControlRecord[];
  readonly solvers: readonly SolverRecord[];
  readonly warnings: readonly string[];
} {
  const warnings: string[] = [];
  const controls: ControlRecord[] = [];
  const solvers: SolverRecord[] = [];
  if (!hasRequiredHumanoid(skeleton)) {
    return { controls, solvers, warnings: ['Limb IK needs a humanoid rig (the 15 VRM-required bones)'] };
  }
  const rig = def.rig.id;
  const live = liveControls(def);
  const byKey = new Map(live.map((control) => [control.key, control]));
  const byId = new Map(live.map((control) => [control.id, control]));
  const liveSolvers = new Set(
    def.solvers.filter((s) => s.deleted === null || s.deleted === undefined).map((solver) => solver.id),
  );
  const ctx = restContext(skeleton);
  const position = (node: number): V3 => [
    ctx.worlds.t[node * 3] as number,
    ctx.worlds.t[node * 3 + 1] as number,
    ctx.worlds.t[node * 3 + 2] as number,
  ];
  const humanoid = skeleton.humanoid ?? {};
  const root = byKey.get('root') ?? null;
  const rootId: ControlId | null = root === null ? null : root.id;
  let order: string | null = null;
  for (const control of live) {
    if (control.parent === rootId && (order === null || control.order > order)) order = control.order;
  }
  const nextOrder = (): string => {
    order = fractionalIndex(order, null);
    return order;
  };

  const requested = LIMB_IDS.filter((limb) => opts.limbs.includes(limb));
  const added = new Set<LimbId>();
  const pending: { readonly t: LimbTemplate; readonly ik: ControlRecord; readonly pole: ControlRecord }[] = [];
  for (const limb of requested) {
    const t = LIMB_TEMPLATES[limb];
    const nodeOf = (bone: string): number => {
      const node = (humanoid as Record<string, number | undefined>)[bone];
      return node !== undefined && Number.isInteger(node) && node >= 0 && node < skeleton.nodes.length ? node : -1;
    };
    const upper = nodeOf(t.upper);
    const mid = nodeOf(t.mid);
    const end = nodeOf(t.end);
    const missingBone = [t.upper, t.mid, t.end].find((bone) => nodeOf(bone) === -1);
    if (missingBone !== undefined) {
      warnings.push(`${t.label}: the ${missingBone} bone is missing; no IK was added`);
      continue;
    }
    const drives = (key: string, bone: string): ControlRecord | null => {
      const control = byKey.get(key);
      const ref = control?.drives?.bone;
      return control !== undefined && ref !== undefined && 'humanoid' in ref && ref.humanoid === bone ? control : null;
    };
    const fkUpper = drives(t.fkUpper, t.upper);
    const fkMid = drives(t.fkMid, t.mid);
    const fkEnd = drives(t.fkEnd, t.end);
    if (fkUpper === null || fkMid === null || fkEnd === null) {
      warnings.push(`${t.label}: the limb is not driven by its FK controls; no IK was added`);
      continue;
    }
    const ikId = controlId(rig, t.ikKey);
    const poleId = controlId(rig, t.poleKey);
    const solver = solverId(rig, t.solverKey);
    if (byId.has(ikId) || byId.has(poleId) || byKey.has(t.ikKey) || byKey.has(t.poleKey) || liveSolvers.has(solver)) {
      warnings.push(`${t.label} already has IK`);
      continue;
    }
    const toesNode = t.toes === null ? -1 : nodeOf(t.toes);
    const fkToes = t.fkToes === null || t.toes === null || toesNode === -1 ? null : drives(t.fkToes, t.toes);

    const a = position(upper);
    const b = position(mid);
    const c = position(end);
    const l1 = norm(sub(b, a));
    const l2 = norm(sub(c, b));
    const hinge = t.kind === 'leg' ? limbHinge(t, b, c) : limbHinge(t, a, b);
    const restBend = bendOf(sub(b, a), sub(c, b), hinge, [0, 0, 0]);
    if (restBend < -HYPEREXTENDED_REST) {
      warnings.push(
        `${t.label}: the rest pose bends the ${t.joint} ${((-restBend * 180) / Math.PI).toFixed(1)}° against its hinge (hyperextended); IK reaches the rest pose and bends the normal way for closer targets`,
      );
    }
    const pole = restPole(a, b, c, hinge, l1 + l2);

    let foot: FootRollParams | null = null;
    if (t.kind === 'leg') {
      const footSize = fkEnd.shape.size;
      const measured = measureFootParams({
        skeleton,
        position,
        foot: end,
        toes: toesNode,
        side: t.sign,
        footSize: Number.isFinite(footSize) && footSize > 0 ? footSize : 0.04 * ctx.height,
        label: t.label,
      });
      warnings.push(...measured.warnings);
      foot = measured.params;
    }
    const ikFkDefault = opts.ikFkDefault === 'by-limb' ? (t.kind === 'leg' ? 1 : 0) : 0;
    const params: Ik2Params = {
      v: 1,
      limb,
      bones: {
        upper: { humanoid: t.upper },
        mid: { humanoid: t.mid },
        end: { humanoid: t.end },
        toes: toesNode === -1 || t.toes === null ? null : { humanoid: t.toes },
      },
      fk: { upper: fkUpper.id, mid: fkMid.id, end: fkEnd.id, toes: fkToes === null ? null : fkToes.id },
      ikControl: ikId,
      pole: poleId,
      hinge: [clean(hinge[0]), clean(hinge[1]), clean(hinge[2])],
      foot,
    };
    const ik: ControlRecord = {
      id: ikId,
      rig,
      key: t.ikKey,
      name: t.ikName,
      side: t.side,
      group: 'body',
      parent: rootId,
      order: nextOrder(),
      restWorld: { t: [c[0], c[1], c[2]], q: IDENTITY_Q, s: UNIT_S },
      rotateOrder: 'zxy',
      keyable: { t: AXES_ALL, r: AXES_ALL, s: AXES_NONE },
      locked: { t: AXES_NONE, r: AXES_NONE, s: AXES_NONE },
      drives: null,
      mirror: null,
      attrs: limbAttrs(t.kind, ikFkDefault),
      shape:
        foot === null
          ? shape('cube', 1.2 * (Number.isFinite(fkEnd.shape.size) ? fkEnd.shape.size : 0.04 * ctx.height))
          : shape('custom', 1, footprintShape(foot)),
      hiddenByDefault: false,
      deleted: null,
    };
    const poleControl: ControlRecord = {
      id: poleId,
      rig,
      key: t.poleKey,
      name: t.poleName,
      side: t.side,
      group: 'body',
      parent: rootId,
      order: nextOrder(),
      restWorld: { t: [clean(pole[0]), clean(pole[1]), clean(pole[2])], q: IDENTITY_Q, s: UNIT_S },
      rotateOrder: 'xyz',
      keyable: { t: AXES_ALL, r: AXES_NONE, s: AXES_NONE },
      locked: { t: AXES_NONE, r: AXES_NONE, s: AXES_NONE },
      drives: null,
      mirror: null,
      attrs: {},
      shape: shape('diamond', 0.015 * ctx.height),
      hiddenByDefault: false,
      deleted: null,
    };
    pending.push({ t, ik, pole: poleControl });
    solvers.push({
      id: solver,
      rig,
      type: 'ik2',
      params: params as unknown as Record<string, unknown>,
      enabled: true,
      deleted: null,
    });
    added.add(limb);
  }

  // Mirror pairs: the counterpart limb's controls, added now or already in the rig.
  for (const { t, ik, pole } of pending) {
    const other = LIMB_TEMPLATES[`${t.kind}.${t.side === 'L' ? 'R' : 'L'}` as LimbId];
    const otherIk = controlId(rig, other.ikKey);
    const otherPole = controlId(rig, other.poleKey);
    const exists = (id: ControlId): boolean => byId.has(id) || pending.some((p) => p.ik.id === id || p.pole.id === id);
    controls.push({ ...ik, mirror: exists(otherIk) ? otherIk : null });
    controls.push({ ...pole, mirror: exists(otherPole) ? otherPole : null });
  }
  return { controls, solvers, warnings };
}
