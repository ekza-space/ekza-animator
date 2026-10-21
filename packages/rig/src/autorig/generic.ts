import type { Side } from '@ekza-studio/doc';
import { nameBoneRef } from '../compile/bones';
import { boneShape, controlSize, toLocalDirection } from './shapes';
import { sanitizeNodeName, sideFromName } from './naming';
import { AXES_ALL, AXES_NONE, boneAxis, type ControlSpec, position, type RestContext, rotation } from './spec';

const UNIT_S = [1, 1, 1] as const;

/** Depth-first pre-order of the skeleton (children by node index). */
function depthFirstOrder(ctx: RestContext): number[] {
  const nodes = ctx.skeleton.nodes;
  const children: number[][] = nodes.map(() => []);
  const roots: number[] = [];
  nodes.forEach((node, i) => {
    if (node.parent >= 0 && node.parent < i) children[node.parent]?.push(i);
    else roots.push(i);
  });
  const order: number[] = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as number;
    order.push(node);
    const kids = children[node] as number[];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k] as number);
  }
  return order;
}

/**
 * Template keys `<prefix>.<stem>[#n]` for the given nodes, `#n` being the occurrence among identical stems in
 * depth-first order (the first occurrence has no suffix). The stem is the joint's stable key (`SkeletonDesc.jointKeys`,
 * model-sourced skeletons, M6B-SPEC §5.16 rule 1: a rename keeps the control) or else the sanitized node name.
 */
export function nodeKeys(ctx: RestContext, nodes: ReadonlySet<number>, prefix: string): Map<number, string> {
  const seen = new Map<string, number>();
  const keys = new Map<number, string>();
  const stems = ctx.skeleton.jointKeys;
  for (const node of depthFirstOrder(ctx)) {
    if (!nodes.has(node)) continue;
    const stem = stems?.[node];
    const base = stem !== undefined && stem !== '' ? stem : sanitizeNodeName(ctx.skeleton.nodes[node]?.name ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    keys.set(node, count === 0 ? `${prefix}.${base}` : `${prefix}.${base}#${count}`);
  }
  return keys;
}

/** Side of a node from its name and the key of its name-mirrored counterpart among `keys` (if any). */
function sideAndMirror(
  ctx: RestContext,
  node: number,
  keys: ReadonlyMap<number, string>,
  byName: ReadonlyMap<string, number[]>,
): { readonly side: Side; readonly mirrorKey: string | null } {
  const name = ctx.skeleton.nodes[node]?.name ?? '';
  const match = sideFromName(name);
  if (match === null) return { side: 'C', mirrorKey: null };
  const sameName = byName.get(name) ?? [];
  const occurrence = sameName.indexOf(node);
  const candidates = (byName.get(match.mirrored) ?? []).filter((other) => other !== node);
  const counterpart = candidates[Math.max(0, Math.min(occurrence, candidates.length - 1))];
  return { side: match.side, mirrorKey: counterpart === undefined ? null : (keys.get(counterpart) ?? null) };
}

function namesIndex(ctx: RestContext, nodes: ReadonlySet<number>): Map<string, number[]> {
  const byName = new Map<string, number[]>();
  for (const node of depthFirstOrder(ctx)) {
    if (!nodes.has(node)) continue;
    const name = ctx.skeleton.nodes[node]?.name ?? '';
    const list = byName.get(name);
    if (list === undefined) byName.set(name, [node]);
    else list.push(node);
  }
  return byName;
}

/** First child of `node` among `candidates` (SkeletonDesc order), else its first child node, else −1. */
function firstChild(ctx: RestContext, node: number, candidates: ReadonlySet<number>): number {
  let any = -1;
  const nodes = ctx.skeleton.nodes;
  for (let i = node + 1; i < nodes.length; i++) {
    if (nodes[i]?.parent !== node) continue;
    if (candidates.has(i)) return i;
    if (any === -1) any = i;
  }
  return any;
}

/** A bone-aligned FK control spec (generic rigs and secondary controls). */
function boneAlignedSpec(
  ctx: RestContext,
  node: number,
  key: string,
  parentKey: string | null,
  sided: { readonly side: Side; readonly mirrorKey: string | null },
  joints: ReadonlySet<number>,
  kind: 'generic' | 'secondary',
): ControlSpec {
  const q = rotation(ctx, node);
  const axis = boneAxis(ctx, node, firstChild(ctx, node, joints));
  const size = controlSize('generic', ctx.skeleton.boneRadii[node] ?? null, axis.length, ctx.height);
  return {
    key,
    name: key,
    side: sided.side,
    group: kind === 'secondary' ? 'secondary' : 'body',
    parentKey,
    restWorld: { t: position(ctx, node), q, s: UNIT_S },
    rotateOrder: 'xyz',
    keyable:
      kind === 'secondary' ? { t: AXES_NONE, r: AXES_ALL, s: AXES_NONE } : { t: AXES_ALL, r: AXES_ALL, s: AXES_ALL },
    drives: { bone: nameBoneRef(ctx.skeleton, node), mode: kind === 'secondary' ? 'rotate' : 'full' },
    mirrorKey: sided.mirrorKey,
    shape: boneShape('circle', 'generic', size, toLocalDirection(q, axis.dir), axis.length),
    hiddenByDefault: kind === 'secondary',
  };
}

/**
 * Generic 1:1 FK rig (MVP-SPEC §4.11.15): one bone-aligned control per skin joint (except node-constraint
 * destinations) with a `full` binding, parented to the control of the nearest ancestor joint.
 */
export function genericControlSpecs(ctx: RestContext, skip: ReadonlySet<number> = new Set()): ControlSpec[] {
  const joints = new Set<number>();
  ctx.skeleton.nodes.forEach((node, i) => {
    if (node.isJoint && !ctx.constrained.has(i) && !skip.has(i)) joints.add(i);
  });
  const keys = nodeKeys(ctx, joints, 'fk');
  const byName = namesIndex(ctx, joints);
  const specs: ControlSpec[] = [];
  const nodes = ctx.skeleton.nodes;
  for (let node = 0; node < nodes.length; node++) {
    if (!joints.has(node)) continue;
    let parent = nodes[node]?.parent ?? -1;
    while (parent >= 0 && !joints.has(parent)) parent = nodes[parent]?.parent ?? -1;
    const key = keys.get(node) as string;
    specs.push(
      boneAlignedSpec(
        ctx,
        node,
        key,
        parent >= 0 ? (keys.get(parent) ?? null) : null,
        sideAndMirror(ctx, node, keys, byName),
        joints,
        'generic',
      ),
    );
  }
  return specs;
}

/**
 * Secondary controls (MVP-SPEC §4.11.9, ADR 0004 §9): hidden, rotate-bound, bone-aligned FK controls for skin joints
 * that are not humanoid bones, spring-bone joints or node-constraint destinations, parented to the control that
 * drives the nearest driven ancestor bone. Joints without a driven ancestor get none (they never move with the
 * character's controls).
 */
export function secondaryControlSpecs(
  ctx: RestContext,
  drivenBy: ReadonlyMap<number, string>,
  skip: ReadonlySet<number> = new Set(),
): ControlSpec[] {
  const humanoidNodes = new Set(Object.values(ctx.skeleton.humanoid ?? {}));
  const nodes = ctx.skeleton.nodes;
  const controlOf = new Map(drivenBy);
  const nearestControl = (node: number): string | null => {
    let parent = nodes[node]?.parent ?? -1;
    while (parent >= 0) {
      const key = controlOf.get(parent);
      if (key !== undefined) return key;
      parent = nodes[parent]?.parent ?? -1;
    }
    return null;
  };
  const eligible = new Set<number>();
  nodes.forEach((node, i) => {
    if (!node.isJoint || humanoidNodes.has(i) || ctx.springs.has(i) || ctx.constrained.has(i) || skip.has(i)) return;
    eligible.add(i);
  });
  const keys = nodeKeys(ctx, eligible, 'sec');
  const byName = namesIndex(ctx, eligible);
  const joints = new Set<number>([...eligible, ...drivenBy.keys()]);
  const specs: ControlSpec[] = [];
  for (let node = 0; node < nodes.length; node++) {
    if (!eligible.has(node)) continue;
    const parentKey = nearestControl(node);
    if (parentKey === null) continue;
    const key = keys.get(node) as string;
    controlOf.set(node, key);
    specs.push(boneAlignedSpec(ctx, node, key, parentKey, sideAndMirror(ctx, node, keys, byName), joints, 'secondary'));
  }
  // A mirror key may name a joint that got no control (no driven ancestor); materializeControls drops it.
  return specs;
}
