// Controls of the non-humanoid joints of model-sourced skeletons (M6B-SPEC §5.16 rule 5; C1). A skeleton is
// model-sourced when skeletonFromDoc built it (`SkeletonDesc.jointKeys` present); `props`/`helpers` name its prop and
// helper joints. Keys use the joints' stable keys (`prop.<key>`, `sock.<key>`), so a rename keeps every control.
//
// - Prop joints: a visible control `prop.<key>` (group body, the joint's side, parent `root`, drives the joint
//   translate + rotate, keyable t and r, shape `diamond` sized 0.04 H, rotate order xyz).
// - Helper joints other than a skeleton root (sockets): a visible control `sock.<key>` (group body, parent = the control
//   driving the nearest driven ancestor bone, else `root`; drives translate + rotate; keyable t and r; shape `diamond`
//   sized 0.03 H). A root helper (no parent joint) gets none.
// Both kinds are kept out of the secondary and generic controls (`modelSkip`).
import type { Side } from '@ekza-studio/doc';
import { nameBoneRef } from '../compile/bones';
import type { SkeletonDesc } from '../types';
import { sideFromName } from './naming';
import { AXES_ALL, AXES_NONE, type ControlSpec, position, type RestContext, rotation } from './spec';
import { pointShape } from './shapes';

const UNIT_S = [1, 1, 1] as const;
export const PROP_SHAPE_H = 0.04;
export const SOCKET_SHAPE_H = 0.03;

/** True for skeletons skeletonFromDoc built (model-sourced characters, M6b). */
export function isModelSkeleton(skeleton: SkeletonDesc): boolean {
  return skeleton.jointKeys !== undefined;
}

/** Prop joints and non-root helper joints: they get `prop.`/`sock.` controls, never secondary or generic ones. */
export function modelSkip(skeleton: SkeletonDesc): Set<number> {
  const skip = new Set<number>(skeleton.props ?? []);
  for (const helper of skeleton.helpers ?? []) if ((skeleton.nodes[helper]?.parent ?? -1) !== -1) skip.add(helper);
  return skip;
}

/** The joint's side from its name (`.L`, `_R`, `left…`; SkeletonDesc carries no sides), else centre. */
function sideOf(skeleton: SkeletonDesc, node: number): Side {
  return sideFromName(skeleton.nodes[node]?.name ?? '')?.side ?? 'C';
}

/**
 * The prop and socket control specs (rule 5). `drivenBy` maps nodes to the key of the control that drives them (the
 * body controls generated before); `rootKey` is the root control's key or null (generic rigs have none).
 */
export function propAndSocketSpecs(
  ctx: RestContext,
  drivenBy: ReadonlyMap<number, string>,
  rootKey: string | null,
): ControlSpec[] {
  const { skeleton, height } = ctx;
  const stems = skeleton.jointKeys ?? [];
  const keyOf = (node: number): string => stems[node] ?? `node${node}`;
  const nearestDriven = (node: number): string | null => {
    let parent = skeleton.nodes[node]?.parent ?? -1;
    while (parent >= 0) {
      const key = drivenBy.get(parent);
      if (key !== undefined) return key;
      parent = skeleton.nodes[parent]?.parent ?? -1;
    }
    return null;
  };
  const spec = (node: number, prefix: 'prop' | 'sock', parentKey: string | null, size: number): ControlSpec => {
    const key = `${prefix}.${keyOf(node)}`;
    return {
      key,
      name: key,
      side: sideOf(skeleton, node),
      group: 'body',
      parentKey,
      restWorld: { t: position(ctx, node), q: rotation(ctx, node), s: UNIT_S },
      rotateOrder: 'xyz',
      keyable: { t: AXES_ALL, r: AXES_ALL, s: AXES_NONE },
      drives: { bone: nameBoneRef(skeleton, node), mode: 'translateRotate' },
      mirrorKey: null,
      shape: pointShape('diamond', size * height),
      hiddenByDefault: false,
    };
  };
  const made: { readonly node: number; readonly spec: ControlSpec }[] = [];
  for (const node of [...(skeleton.props ?? [])].sort((a, b) => a - b)) {
    made.push({ node, spec: spec(node, 'prop', rootKey, PROP_SHAPE_H) });
  }
  for (const node of [...(skeleton.helpers ?? [])].sort((a, b) => a - b)) {
    if ((skeleton.nodes[node]?.parent ?? -1) === -1) continue;
    made.push({ node, spec: spec(node, 'sock', nearestDriven(node) ?? rootKey, SOCKET_SHAPE_H) });
  }
  // L/R pairs by the joints' names (the controls of mirrored props and sockets mirror each other).
  const keyOfName = new Map<string, string>();
  for (const { node, spec: s } of made) keyOfName.set(skeleton.nodes[node]?.name ?? '', s.key);
  return made.map(({ node, spec: s }) => {
    const match = sideFromName(skeleton.nodes[node]?.name ?? '');
    const mirrorKey = match === null ? null : (keyOfName.get(match.mirrored) ?? null);
    return mirrorKey === null || mirrorKey === s.key ? s : { ...s, mirrorKey };
  });
}
