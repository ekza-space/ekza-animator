import type { ReadonlyXf, RotateOrder } from '@ekza-studio/anim-core';
import {
  type Axes,
  type Binding,
  type ControlId,
  type ControlRecord,
  type ControlShape,
  controlId,
  type RigId,
  type Side,
} from '@ekza-studio/doc';
import { restWorlds } from '../humanoid/rest';
import type { XfArrays } from '../math/xfa';
import type { SkeletonDesc } from '../types';
import { orderKey } from './naming';

/** A control before IDs, sibling order and mirror IDs are assigned. */
export interface ControlSpec {
  readonly key: string;
  readonly name: string;
  readonly side: Side;
  readonly group: ControlRecord['group'];
  readonly parentKey: string | null;
  readonly restWorld: ReadonlyXf;
  readonly rotateOrder: RotateOrder;
  readonly keyable: { readonly t: Axes; readonly r: Axes; readonly s: Axes };
  readonly drives: Binding | null;
  /** Template key of the counterpart; resolved to an ID only if that control exists. */
  readonly mirrorKey: string | null;
  readonly shape: ControlShape;
  readonly hiddenByDefault: boolean;
}

export const AXES_ALL: Axes = [true, true, true];
export const AXES_NONE: Axes = [false, false, false];

/** Shared measurements of a skeleton at rest. */
export interface RestContext {
  readonly skeleton: SkeletonDesc;
  readonly worlds: XfArrays;
  /** Character height H in metres. */
  readonly height: number;
  readonly constrained: ReadonlySet<number>;
  readonly springs: ReadonlySet<number>;
}

export function restContext(skeleton: SkeletonDesc): RestContext {
  const worlds = restWorlds(skeleton);
  return {
    skeleton,
    worlds,
    height: characterHeight(skeleton, worlds),
    constrained: new Set(skeleton.constrainedNodes),
    springs: new Set(skeleton.springJoints),
  };
}

/** H: the skeleton's height, else the vertical extent of the joints, else 1.7 m. */
function characterHeight(skeleton: SkeletonDesc, worlds: XfArrays): number {
  if (Number.isFinite(skeleton.height) && skeleton.height > 0) return skeleton.height;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  skeleton.nodes.forEach((node, i) => {
    if (!node.isJoint) return;
    const y = worlds.t[i * 3 + 1] as number;
    min = Math.min(min, y);
    max = Math.max(max, y);
  });
  const extent = max - min;
  return Number.isFinite(extent) && extent > 1e-3 ? extent : 1.7;
}

export function position(ctx: RestContext, node: number): [number, number, number] {
  return [ctx.worlds.t[node * 3] as number, ctx.worlds.t[node * 3 + 1] as number, ctx.worlds.t[node * 3 + 2] as number];
}

export function rotation(ctx: RestContext, node: number): [number, number, number, number] {
  const q = ctx.worlds.q;
  return [q[node * 4] as number, q[node * 4 + 1] as number, q[node * 4 + 2] as number, q[node * 4 + 3] as number];
}

/**
 * Unit direction and length ℓ_b of a bone at rest: towards `child` when it is a distinct point, otherwise (leaves)
 * continuing the parent → bone direction with half the parent length (MVP-SPEC §4.11.15).
 */
export function boneAxis(
  ctx: RestContext,
  node: number,
  child: number,
): { readonly dir: [number, number, number]; readonly length: number } {
  const p = position(ctx, node);
  if (child >= 0) {
    const c = position(ctx, child);
    const d: [number, number, number] = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
    const length = Math.hypot(d[0], d[1], d[2]);
    if (length > 1e-6) return { dir: [d[0] / length, d[1] / length, d[2] / length], length };
  }
  const parent = ctx.skeleton.nodes[node]?.parent ?? -1;
  if (parent >= 0 && parent < node) {
    const q = position(ctx, parent);
    const d: [number, number, number] = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const length = Math.hypot(d[0], d[1], d[2]);
    if (length > 1e-6) return { dir: [d[0] / length, d[1] / length, d[2] / length], length: 0.5 * length };
  }
  return { dir: [0, 1, 0], length: 0.05 * ctx.height };
}

/** Assigns IDs, sibling order keys and mirror IDs. Specs must list parents before children. */
export function materializeControls(specs: readonly ControlSpec[], rig: RigId): ControlRecord[] {
  const keys = new Set(specs.map((spec) => spec.key));
  const siblingCount = new Map<string | null, number>();
  return specs.map((spec): ControlRecord => {
    const parentKey = spec.parentKey !== null && keys.has(spec.parentKey) ? spec.parentKey : null;
    const index = siblingCount.get(parentKey) ?? 0;
    siblingCount.set(parentKey, index + 1);
    const mirror: ControlId | null =
      spec.mirrorKey !== null && keys.has(spec.mirrorKey) ? controlId(rig, spec.mirrorKey) : null;
    return {
      id: controlId(rig, spec.key),
      rig,
      key: spec.key,
      name: spec.name,
      side: spec.side,
      group: spec.group,
      parent: parentKey === null ? null : controlId(rig, parentKey),
      order: orderKey(index),
      restWorld: spec.restWorld,
      rotateOrder: spec.rotateOrder,
      keyable: spec.keyable,
      locked: { t: AXES_NONE, r: AXES_NONE, s: AXES_NONE },
      drives: spec.drives,
      mirror,
      attrs: {},
      shape: spec.shape,
      hiddenByDefault: spec.hiddenByDefault,
      deleted: null,
    };
  });
}
