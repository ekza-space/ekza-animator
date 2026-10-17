import type { RotateOrder, Vec3 } from '@ekza-animator/anim-core';
import type { ControlShape, HumanBoneName } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES } from '../humanoid/bones';
import {
  fingerJoint,
  humanBoneGroup,
  humanBoneSide,
  humanChainChildren,
  humanDisplayName,
  humanNodeIndices,
  humanTemplateKey,
  mirrorHumanBone,
  nearestHumanAncestor,
} from '../humanoid/map';
import { boneShape, controlSize, floorShape, lollipopShape, normalize, rootShape, type SizeGroup } from './shapes';
import { AXES_ALL, AXES_NONE, boneAxis, type ControlSpec, position, type RestContext } from './spec';

const IDENTITY_Q = [0, 0, 0, 1] as const;
const UNIT_S = [1, 1, 1] as const;

/** Rotate order per humanoid bone (ADR 0004, research 07 §5.2). */
function humanRotateOrder(name: HumanBoneName): RotateOrder {
  switch (humanBoneGroup(name)) {
    case 'shoulder':
      return 'yxz';
    case 'limb':
      if (name.endsWith('UpperArm')) return 'yxz';
      if (name.endsWith('LowerArm')) return 'xzy';
      return 'yzx';
    case 'extremity':
      return name.endsWith('Hand') ? 'xyz' : 'yzx';
    case 'finger':
      return 'xyz';
    case 'torso':
    case 'head':
    case 'jaw':
    case 'eye':
      return 'zxy';
  }
}

/**
 * The humanoid FK template (MVP-SPEC §4.11.15, ADR 0004 §9): `root` → `cog` → `fk.hips` (pelvis, translateRotate)
 * and `fk.spine` (under `cog`) → chest … head → jaw; shoulders → arms → hands → fingers; legs under `fk.hips`.
 * Only bones present get controls (missing optional bones collapse to the nearest present ancestor); eyes and
 * node-constraint destinations are not rigged. Controls are world-aligned in canonical space.
 */
export function humanoidControlSpecs(ctx: RestContext): ControlSpec[] {
  const { skeleton, height } = ctx;
  const nodes = humanNodeIndices(skeleton);
  const nodeOf = (name: HumanBoneName): number => nodes[HUMAN_BONE_NAMES.indexOf(name)] as number;
  const rigged = (name: HumanBoneName): boolean => {
    const node = nodeOf(name);
    return node !== -1 && humanBoneGroup(name) !== 'eye' && !ctx.constrained.has(node);
  };

  const hips = position(ctx, nodeOf('hips'));
  const specs: ControlSpec[] = [
    {
      key: 'root',
      name: 'Root',
      side: 'C',
      group: 'body',
      parentKey: null,
      restWorld: { t: [hips[0], 0, hips[2]], q: IDENTITY_Q, s: UNIT_S },
      rotateOrder: 'zxy',
      keyable: { t: AXES_ALL, r: AXES_ALL, s: AXES_NONE },
      drives: null,
      mirrorKey: null,
      shape: rootShape(0.35 * height),
      hiddenByDefault: false,
    },
    {
      key: 'cog',
      name: 'COG',
      side: 'C',
      group: 'body',
      parentKey: 'root',
      restWorld: { t: hips, q: IDENTITY_Q, s: UNIT_S },
      rotateOrder: 'zxy',
      keyable: { t: AXES_ALL, r: AXES_ALL, s: AXES_NONE },
      drives: null,
      mirrorKey: null,
      shape: floorShape('star', 0.18 * height),
      hiddenByDefault: false,
    },
  ];

  const dorsal = { L: handDorsal(ctx, nodeOf, 'L'), R: handDorsal(ctx, nodeOf, 'R') };
  for (const name of HUMAN_BONE_NAMES) {
    if (!rigged(name)) continue;
    const node = nodeOf(name);
    const ancestor = nearestHumanAncestor(name, rigged);
    let parentKey: string;
    if (name === 'hips' || name === 'spine') parentKey = 'cog';
    else if (ancestor === null) parentKey = 'cog';
    else parentKey = humanTemplateKey(ancestor);
    const childName = humanChainChildren(name).find(rigged);
    const axis = boneAxis(ctx, node, childName === undefined ? -1 : nodeOf(childName));
    const side = humanBoneSide(name);
    const counterpart = mirrorHumanBone(name);
    specs.push({
      key: humanTemplateKey(name),
      name: humanDisplayName(name),
      side,
      group: humanBoneGroup(name) === 'finger' ? 'fingers' : humanBoneGroup(name) === 'jaw' ? 'face' : 'body',
      parentKey,
      restWorld: { t: position(ctx, node), q: IDENTITY_Q, s: UNIT_S },
      rotateOrder: humanRotateOrder(name),
      keyable: { t: AXES_NONE, r: AXES_ALL, s: AXES_NONE },
      drives: { bone: { humanoid: name }, mode: name === 'hips' ? 'translateRotate' : 'rotate' },
      mirrorKey: counterpart === null ? null : humanTemplateKey(counterpart),
      shape: humanShape(ctx, name, node, axis, side === 'R' ? dorsal.R : dorsal.L),
      hiddenByDefault: false,
    });
  }
  return specs;
}

function humanShape(
  ctx: RestContext,
  name: HumanBoneName,
  node: number,
  axis: { readonly dir: Vec3; readonly length: number },
  dorsal: Vec3,
): ControlShape {
  const radius = ctx.skeleton.boneRadii[node] ?? null;
  const group = humanBoneGroup(name);
  if (group === 'finger') {
    const size = controlSize('finger', radius, axis.length, ctx.height);
    return lollipopShape(size, (0.02 + 0.008 * fingerJoint(name)) * ctx.height, dorsal, axis.dir);
  }
  const sizeGroup: SizeGroup = group === 'head' ? 'torso' : group === 'eye' ? 'extremity' : group;
  const size = controlSize(sizeGroup, radius, axis.length, ctx.height);
  return boneShape(group === 'shoulder' ? 'halfCircle' : 'circle', sizeGroup, size, axis.dir, axis.length);
}

/**
 * Dorsal (back-of-hand) normal at rest: lateral (index → little knuckles reversed) × finger direction, signed per
 * side so that a T-pose with palms down gives +Y. Falls back to +Y orthogonalized against the finger direction.
 */
function handDorsal(ctx: RestContext, nodeOf: (name: HumanBoneName) => number, side: 'L' | 'R'): Vec3 {
  const p = side === 'L' ? 'left' : 'right';
  const hand = nodeOf(`${p}Hand` as HumanBoneName);
  if (hand === -1) return [0, 1, 0];
  const first = (names: readonly string[]): number => {
    for (const name of names) {
      const node = nodeOf(`${p}${name}` as HumanBoneName);
      if (node !== -1) return node;
    }
    return -1;
  };
  const tip = first(['MiddleProximal', 'IndexProximal', 'RingProximal', 'LittleProximal']);
  const h = position(ctx, hand);
  const along: Vec3 = tip === -1 ? [side === 'L' ? 1 : -1, 0, 0] : normalize(sub(position(ctx, tip), h), [1, 0, 0]);
  const index = first(['IndexProximal']);
  const little = first(['LittleProximal', 'RingProximal']);
  if (index !== -1 && little !== -1 && index !== little) {
    const lateral = sub(position(ctx, index), position(ctx, little));
    const cross: Vec3 = [
      lateral[1] * along[2] - lateral[2] * along[1],
      lateral[2] * along[0] - lateral[0] * along[2],
      lateral[0] * along[1] - lateral[1] * along[0],
    ];
    const sign = side === 'L' ? 1 : -1;
    const dorsal = normalize([cross[0] * sign, cross[1] * sign, cross[2] * sign], [0, 0, 0]);
    if (dorsal[0] !== 0 || dorsal[1] !== 0 || dorsal[2] !== 0) return dorsal;
  }
  const d = along[1];
  return normalize([-d * along[0], 1 - d * along[1], -d * along[2]], [0, 0, 1]);
}

function sub(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  ];
}
