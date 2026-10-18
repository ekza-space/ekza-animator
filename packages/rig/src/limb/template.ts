import { EkzaError } from '@ekza-animator/anim-core';
import type { BoneRef, ConstraintRecord, ControlId, HumanBoneName, SolverRecord } from '@ekza-animator/doc';
import type { FootRollParams, Ik2Params, LimbId, RigOpCompileContext } from '../types';
import { LIMB_IDS } from '../types';

// Limb templates (M2A-SPEC §5.2): the humanoid bones and FK controls of each limb, the template keys and names of
// its IK records, and the parsing of `Ik2Params` (solver params version 1) shared by the op and the compiler.

export interface LimbTemplate {
  readonly id: LimbId;
  readonly kind: 'leg' | 'arm';
  readonly side: 'L' | 'R';
  /** +1 left, −1 right (FootRollParams.side). */
  readonly sign: 1 | -1;
  readonly upper: HumanBoneName;
  readonly mid: HumanBoneName;
  readonly end: HumanBoneName;
  readonly toes: HumanBoneName | null;
  readonly fkUpper: string;
  readonly fkMid: string;
  readonly fkEnd: string;
  readonly fkToes: string | null;
  readonly ikKey: string;
  readonly poleKey: string;
  readonly solverKey: string;
  /** 'L Leg', 'R Arm': the limb in warnings and labels. */
  readonly label: string;
  readonly ikName: string;
  readonly poleName: string;
  /** The mid joint in warnings: 'knee' or 'elbow'. */
  readonly joint: 'knee' | 'elbow';
}

function template(id: LimbId): LimbTemplate {
  const [kind, side] = id.split('.') as ['leg' | 'arm', 'L' | 'R'];
  const prefix = side === 'L' ? 'left' : 'right';
  const human = (name: string): HumanBoneName => `${prefix}${name}` as HumanBoneName;
  const leg = kind === 'leg';
  return {
    id,
    kind,
    side,
    sign: side === 'L' ? 1 : -1,
    upper: human(leg ? 'UpperLeg' : 'UpperArm'),
    mid: human(leg ? 'LowerLeg' : 'LowerArm'),
    end: human(leg ? 'Foot' : 'Hand'),
    toes: leg ? human('Toes') : null,
    fkUpper: `fk.${leg ? 'upperLeg' : 'upperArm'}.${side}`,
    fkMid: `fk.${leg ? 'lowerLeg' : 'lowerArm'}.${side}`,
    fkEnd: `fk.${leg ? 'foot' : 'hand'}.${side}`,
    fkToes: leg ? `fk.toes.${side}` : null,
    ikKey: `ik.${id}`,
    poleKey: `pole.${id}`,
    solverKey: `ik2.${id}`,
    label: `${side} ${leg ? 'Leg' : 'Arm'}`,
    ikName: `${side} ${leg ? 'Leg' : 'Arm'} IK`,
    poleName: `${side} ${leg ? 'Knee' : 'Elbow'} Pole`,
    joint: leg ? 'knee' : 'elbow',
  };
}

export const LIMB_TEMPLATES: Readonly<Record<LimbId, LimbTemplate>> = {
  'leg.L': template('leg.L'),
  'leg.R': template('leg.R'),
  'arm.L': template('arm.L'),
  'arm.R': template('arm.R'),
};

export function isLimbId(value: unknown): value is LimbId {
  return typeof value === 'string' && (LIMB_IDS as readonly string[]).includes(value);
}

/** The counterpart limb (`leg.L` ↔ `leg.R`). */
export function mirrorLimb(limb: LimbId): LimbId {
  const t = LIMB_TEMPLATES[limb];
  return `${t.kind}.${t.side === 'L' ? 'R' : 'L'}` as LimbId;
}

/** Validated `Ik2Params` with the hinge normalized (the record's own object otherwise). */
export interface ParsedIk2 {
  readonly params: Ik2Params;
  readonly hinge: readonly [number, number, number];
}

function invalid(record: { readonly id: string }, message: string): EkzaError {
  return new EkzaError('invalid-record', `ik2 ${record.id}: ${message}`);
}

function isBoneRef(value: unknown): value is BoneRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  if (typeof ref['humanoid'] === 'string') return true;
  return typeof ref['name'] === 'string' && (ref['parentName'] === null || typeof ref['parentName'] === 'string');
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Checks `FootRollParams` (§5.2.3); returns the reason it is invalid, or null. */
export function footParamsProblem(foot: unknown): string | null {
  if (typeof foot !== 'object' || foot === null) return 'foot must be an object or null';
  const f = foot as Record<string, unknown>;
  if (f['side'] !== 1 && f['side'] !== -1) return 'foot.side must be 1 or -1';
  const ground = f['ground'];
  if (!Array.isArray(ground) || ground.length !== 3 || !ground.every(finite)) {
    return 'foot.ground must be three finite numbers';
  }
  if (!finite(f['yaw'])) return 'foot.yaw must be a finite number';
  for (const key of ['heelBack', 'ballFront', 'toeFront', 'innerWidth', 'outerWidth'] as const) {
    const value = f[key];
    if (!finite(value) || value < 0) return `foot.${key} must be a finite number ≥ 0`;
  }
  const beta = f['breakAngle'];
  if (!finite(beta) || beta < 0 || beta > Math.PI / 2) return 'foot.breakAngle must lie in [0, π/2]';
  return null;
}

/**
 * Parses and validates `SolverRecord.params` of an `ik2` solver (M2A-SPEC §4.3 `Ik2Params` v1). Throws
 * EkzaError('invalid-record' | 'unsupported') with the reason; the compiler then disables the op and warns (§5.4
 * rule 4). Bone and control existence is checked by the op's declarations (dangling references).
 */
export function parseIk2Params(record: ConstraintRecord | SolverRecord): ParsedIk2 {
  const raw = record.params as Record<string, unknown> | null | undefined;
  if (typeof raw !== 'object' || raw === null) throw invalid(record, 'params must be an object');
  if (raw['v'] !== 1) {
    throw new EkzaError('unsupported', `ik2 ${record.id}: params version ${String(raw['v'])} is not supported`);
  }
  if (!isLimbId(raw['limb'])) throw invalid(record, `unknown limb ${String(raw['limb'])}`);
  const bones = raw['bones'] as Record<string, unknown> | undefined;
  if (typeof bones !== 'object' || bones === null) throw invalid(record, 'bones must be an object');
  for (const key of ['upper', 'mid', 'end'] as const) {
    if (!isBoneRef(bones[key])) throw invalid(record, `bones.${key} must be a bone reference`);
  }
  if (bones['toes'] !== null && !isBoneRef(bones['toes'])) throw invalid(record, 'bones.toes must be a bone or null');
  const fk = raw['fk'] as Record<string, unknown> | undefined;
  if (typeof fk !== 'object' || fk === null) throw invalid(record, 'fk must be an object');
  for (const key of ['upper', 'mid', 'end'] as const) {
    if (typeof fk[key] !== 'string') throw invalid(record, `fk.${key} must be a control id`);
  }
  if (fk['toes'] !== null && typeof fk['toes'] !== 'string') throw invalid(record, 'fk.toes must be a control or null');
  if (typeof raw['ikControl'] !== 'string') throw invalid(record, 'ikControl must be a control id');
  if (typeof raw['pole'] !== 'string') throw invalid(record, 'pole must be a control id');
  const rawHinge = raw['hinge'];
  if (!Array.isArray(rawHinge) || rawHinge.length !== 3 || !rawHinge.every(finite)) {
    throw invalid(record, 'hinge must be three finite numbers');
  }
  const hinge = rawHinge as unknown as readonly [number, number, number];
  const norm = Math.hypot(hinge[0], hinge[1], hinge[2]);
  if (!(norm > 1e-9)) throw invalid(record, 'hinge must not be zero');
  if (raw['foot'] !== null) {
    const problem = footParamsProblem(raw['foot']);
    if (problem !== null) throw invalid(record, problem);
  }
  const ids = [fk['upper'], fk['mid'], fk['end'], raw['ikControl'], raw['pole']];
  if (new Set(ids).size !== ids.length) throw invalid(record, 'the FK, IK and pole controls must be distinct');
  return {
    params: raw as unknown as Ik2Params,
    hinge: [hinge[0] / norm, hinge[1] / norm, hinge[2] / norm],
  };
}

/** Node indices of a parsed limb: −1 for an unresolved bone. */
export interface LimbNodes {
  readonly upper: number;
  readonly mid: number;
  readonly end: number;
  readonly toes: number;
  /** Parent node of the upper bone (−1: the character root). */
  readonly parent: number;
}

/** Whether `ancestor` is `node` or one of its ancestors. */
export function isAncestorNode(ctx: RigOpCompileContext, ancestor: number, node: number): boolean {
  const nodes = ctx.skeleton.nodes;
  for (let current = node; current >= 0 && current < nodes.length; current = nodes[current]?.parent ?? -1) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * Resolves the chain bones of a parsed limb and checks that they form a chain (upper ⊐ mid ⊐ end ⊐ toes).
 * Unresolved bones are −1 (the declarations then report a dangling reference); a broken chain throws.
 */
export function resolveLimbNodes(
  record: SolverRecord | ConstraintRecord,
  parsed: ParsedIk2,
  ctx: RigOpCompileContext,
): LimbNodes {
  const { bones } = parsed.params;
  const upper = ctx.resolveBone(bones.upper);
  const mid = ctx.resolveBone(bones.mid);
  const end = ctx.resolveBone(bones.end);
  const toes = bones.toes === null ? -1 : ctx.resolveBone(bones.toes);
  if (upper >= 0 && mid >= 0 && end >= 0) {
    if (upper === mid || mid === end || !isAncestorNode(ctx, upper, mid) || !isAncestorNode(ctx, mid, end)) {
      throw invalid(record, 'bones.upper, bones.mid and bones.end do not form a chain');
    }
    if (toes >= 0 && (toes === end || !isAncestorNode(ctx, end, toes))) {
      throw invalid(record, 'bones.toes is not below bones.end');
    }
  }
  const parent = upper >= 0 ? (ctx.skeleton.nodes[upper]?.parent ?? -1) : -1;
  return { upper, mid, end, toes, parent: Number.isInteger(parent) && parent >= 0 && parent < upper ? parent : -1 };
}

/** Every descendant (by control parent pointers) of `roots`, excluding the roots, in depth-first order. */
export function controlDescendants(ctx: RigOpCompileContext, roots: readonly ControlId[]): ControlId[] {
  const rootSet = new Set(roots);
  const out: ControlId[] = [];
  const seen = new Set<ControlId>(roots);
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const current = stack.pop() as ControlId;
    if (!rootSet.has(current)) out.push(current);
    const children = ctx.controlChildren(current);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i] as ControlId;
      if (seen.has(child)) continue;
      seen.add(child);
      stack.push(child);
    }
  }
  return out;
}

/** `node` and every node below it, in index order. */
export function nodeSubtree(ctx: RigOpCompileContext, node: number): number[] {
  const out: number[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    out.push(current);
    for (const child of ctx.nodeChildren(current)) stack.push(child);
  }
  return out.sort((a, b) => a - b);
}

/** A foot-roll parameter set with every field present (the record's own object). */
export function footOf(params: Ik2Params): FootRollParams | null {
  return params.foot ?? null;
}
