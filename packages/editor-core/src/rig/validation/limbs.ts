// Separate parts and the limbs their weights reach (AUTORIG-SPEC §5.4; AR-R4-5, the owner's AR-D10-7 call). A
// segmented low-poly character is many meshes: the body (the trunk the limbs hang from) and its parts — hands, shoes, a
// hairdo, a collar. Automatic weights bind each part by distance, so the side cubes of a wide hairdo next to the
// shoulders follow the upper arms while the rest of it follows the head: the part stretches between two limbs. Here:
//
// - `limbRegions`: every joint's body region (head, torso, an arm, a leg) from its own or its nearest ancestor's VRM
//   bone; the torso joins the others (a leg part may blend into the hips, an arm part into the chest);
// - `reachOf`: per separate part, the regions that carry a real share of its weight (fingers counting as their hand,
//   toes as their foot) and its best joint — the main bone of its own (largest) region passing nearest the part's
//   centre (the head for a hairdo, the hand for a mitten);
// - `crossLimbParts`: the parts that reach two regions that do not meet (the head and an arm, both legs, a leg and the
//   hand hanging beside it): the Validation row `skin.cross-limb` and Auto-Rig's *Separate parts move rigidly*, which
//   binds each of them again — rigidly to its best joint (`skin.bind {method: 'rigid-islands', joints: [best]}`, M6b's
//   rigid attach), or, for a part spanning a hinge of its own limb (a whole-leg cylinder, knee inside), with
//   automatic weights over that limb's joints only, so the knee still bends and the hand no longer pulls the thigh.
//
// Pure reads of the records and the resident mesh data; nothing is written here.
import type { CharacterId, JointId, JointRecord, MeshId, MeshRecord } from '@ekza-studio/doc';
import type { SkinWeights } from '@ekza-studio/mesh-core';
import type { EditorApp } from '../../types';
import { characterMeshes, characterSkeleton, meshData, skinOf } from './inputs';

export type LimbRegion = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

/** A region counts for a part when it holds at least this share of the part's weight (pruned crumbs do not). */
export const REGION_SHARE = 0.02;

const TORSO: ReadonlySet<string> = new Set(['hips', 'spine', 'chest', 'upperChest']);
const HEAD: ReadonlySet<string> = new Set(['neck', 'head', 'jaw', 'leftEye', 'rightEye']);

/** The region of a VRM human bone. */
export function regionOfBone(bone: string): LimbRegion {
  if (HEAD.has(bone)) return 'head';
  if (TORSO.has(bone)) return 'torso';
  const side = bone.startsWith('left') ? 'left' : bone.startsWith('right') ? 'right' : null;
  if (side === null) return 'torso';
  return /Leg|Foot|Toes/.test(bone) ? `${side}Leg` : `${side}Arm`;
}

/** Every joint's region: its own VRM bone's, else its nearest mapped ancestor's, else the torso. */
export function limbRegions(joints: readonly JointRecord[]): ReadonlyMap<string, LimbRegion> {
  const byId = new Map(joints.map((joint) => [joint.id as string, joint]));
  const out = new Map<string, LimbRegion>();
  const regionOf = (joint: JointRecord, depth: number): LimbRegion => {
    const known = out.get(joint.id);
    if (known !== undefined) return known;
    const parent = joint.parent === null ? undefined : byId.get(joint.parent);
    const region =
      joint.humanBone !== null
        ? regionOfBone(joint.humanBone)
        : parent === undefined || depth > joints.length
          ? 'torso'
          : regionOf(parent, depth + 1);
    out.set(joint.id, region);
    return region;
  };
  for (const joint of joints) regionOf(joint, 0);
  return out;
}

/** The bones a part is bound to as a whole: fingers count as their hand, toes as their foot, eyes and jaw as the head. */
const MAIN_BONES: ReadonlySet<string> = new Set([
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  ...['left', 'right'].flatMap((side) =>
    ['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot'].map((bone) => `${side}${bone}`),
  ),
]);

/** Every joint's main bone joint: itself or its nearest ancestor with a main VRM bone (itself without one). */
export function mainBones(joints: readonly JointRecord[]): ReadonlyMap<string, JointId> {
  const byId = new Map(joints.map((joint) => [joint.id as string, joint]));
  const out = new Map<string, JointId>();
  for (const joint of joints) {
    let at: JointRecord | undefined = joint;
    for (let guard = 0; at !== undefined && guard <= joints.length; guard++) {
      if (at.humanBone !== null && MAIN_BONES.has(at.humanBone)) break;
      at = at.parent === null ? undefined : byId.get(at.parent);
    }
    out.set(joint.id, at?.id ?? joint.id);
  }
  return out;
}

const TORSO_BONES: ReadonlySet<string> = new Set(['hips', 'spine', 'chest', 'upperChest']);

/** The bounds of a mesh's points. */
function boundsOf(position: Float32Array): readonly [readonly number[], readonly number[]] {
  const lo = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const hi = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < position.length; i++) {
    const k = i % 3;
    lo[k] = Math.min(lo[k] as number, position[i] as number);
    hi[k] = Math.max(hi[k] as number, position[i] as number);
  }
  return [lo, hi];
}

/**
 * The body of a multi-part character: the mesh whose bounds hold the most torso joints (hips, spine, chests) — the
 * trunk every limb hangs from, whatever its pose or tessellation (ties: more points). Null for one mesh.
 */
export function bodyMeshOf(
  app: Pick<EditorApp, 'meshes'>,
  meshes: readonly MeshRecord[],
  joints: readonly JointRecord[],
): MeshId | null {
  if (meshes.length < 2) return null;
  const torso = joints.filter((joint) => joint.humanBone !== null && TORSO_BONES.has(joint.humanBone));
  let best: MeshId | null = null;
  let most = -1;
  let points = -1;
  for (const mesh of meshes) {
    const data = meshData(app, mesh);
    if (data === null) continue;
    const [lo, hi] = boundsOf(data.position);
    const inside = torso.filter((joint) =>
      joint.restPosition.every((v, k) => v >= (lo[k] as number) - 1e-3 && v <= (hi[k] as number) + 1e-3),
    ).length;
    const n = data.position.length / 3;
    if (inside > most || (inside === most && n > points)) {
      most = inside;
      points = n;
      best = mesh.id;
    }
  }
  return best;
}

/** How a separate part that reaches two limbs is bound again (AR-R4-5). */
export interface PartBind {
  /** The joint mask: the best joint alone (rigid), or every deforming joint of the part's own limb. */
  readonly joints: readonly JointId[];
  /** True: weight 1 on the one joint (`rigid-islands`); false: automatic weights over the limb's joints. */
  readonly rigid: boolean;
}

export interface PartReach {
  readonly mesh: MeshId;
  /** The regions holding at least `REGION_SHARE` of the part's weight, the largest share first. */
  readonly regions: readonly LimbRegion[];
  /** The main bone joint of its own region (the largest) whose bone passes nearest the part's centre. */
  readonly best: JointId | null;
  /** How *Separate parts move rigidly* binds it: rigid on `best`, or — a part spanning a hinge of its limb (a whole
   *  leg, knee and all) — automatic weights over its own limb's joints, so the knee still bends. */
  readonly bind: PartBind | null;
}

/** A limb part spans a hinge when two of its limb's main bones each hold at least this share of its weight. */
export const HINGE_SHARE = 0.15;

const segmentDistance = (p: readonly number[], a: readonly number[], b: readonly number[]): number => {
  const ab = [0, 1, 2].map((k) => (b[k] ?? 0) - (a[k] ?? 0));
  const ap = [0, 1, 2].map((k) => (p[k] ?? 0) - (a[k] ?? 0));
  const len2 = ab.reduce((sum, v) => sum + v * v, 0);
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ap.reduce((sum, v, k) => sum + v * (ab[k] ?? 0), 0) / len2));
  return Math.hypot(...[0, 1, 2].map((k) => (ap[k] ?? 0) - t * (ab[k] ?? 0)));
};

/** The reach of one bound part (its skin and positions) and how it would be bound again. */
export function reachOf(
  mesh: MeshId,
  skin: SkinWeights,
  position: Float32Array,
  joints: readonly JointRecord[],
  regions: ReadonlyMap<string, LimbRegion>,
): PartReach {
  const main = mainBones(joints);
  const mass = new Map<JointId, number>();
  let total = 0;
  for (let i = 0; i < skin.weights.length; i++) {
    const w = skin.weights[i] as number;
    if (w <= 0) continue;
    const key = skin.palette[skin.joints[i] as number]?.key;
    if (key === undefined) continue;
    const bone = main.get(key) ?? (key as JointId);
    mass.set(bone, (mass.get(bone) ?? 0) + w);
    total += w;
  }
  const byRegion = new Map<LimbRegion, number>();
  for (const [bone, m] of mass) {
    const region = regions.get(bone) ?? 'torso';
    byRegion.set(region, (byRegion.get(region) ?? 0) + m);
  }
  const reached = [...byRegion]
    .filter(([, m]) => total > 0 && m / total >= REGION_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([region]) => region);
  const own = reached[0];
  if (own === undefined) return { mesh, regions: reached, best: null, bind: null };
  // the part's centre (its points' mean) and the nearest bone of its own region (head → first child, else tail)
  const n = position.length / 3;
  const centre = [0, 0, 0];
  for (let i = 0; i < position.length; i++) centre[i % 3] = (centre[i % 3] as number) + (position[i] as number) / n;
  const byId = new Map(joints.map((joint) => [joint.id as string, joint]));
  const bones = [...mass.keys()].filter((bone) => (regions.get(bone) ?? 'torso') === own).sort();
  let best: JointId | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const bone of bones) {
    const joint = byId.get(bone);
    if (joint === undefined) continue;
    const child = joints.find((other) => other.parent === joint.id);
    const d = segmentDistance(centre, joint.restPosition, child?.restPosition ?? joint.tail ?? joint.restPosition);
    if (
      d < nearest - 1e-9 ||
      (Math.abs(d - nearest) <= 1e-9 && (mass.get(bone) ?? 0) > (mass.get(best as JointId) ?? 0))
    ) {
      nearest = d;
      best = bone;
    }
  }
  const limb = own !== 'head' && own !== 'torso';
  const hinge = limb && bones.filter((bone) => (mass.get(bone) ?? 0) >= HINGE_SHARE * total).length >= 2;
  const bind: PartBind | null = hinge
    ? {
        joints: joints
          .filter((joint) => joint.role === 'bone' && (regions.get(joint.id) ?? 'torso') === own)
          .map((joint) => joint.id),
        rigid: false,
      }
    : best === null
      ? null
      : { joints: [best], rigid: true };
  return { mesh, regions: reached, best, bind };
}

/** Whether a part reaches two regions that do not meet (the torso meets every other region; nothing else meets). */
export const crossesLimbs = (reach: Pick<PartReach, 'regions'>): boolean =>
  reach.regions.filter((region) => region !== 'torso').length >= 2;

/**
 * The separate parts of a character (every bound mesh but the body) whose weights reach two limbs that do not meet,
 * in mesh order. Empty for a one-mesh character, without a skeleton, or while a part's data is loading.
 */
export function crossLimbParts(app: Pick<EditorApp, 'store' | 'meshes'>, character: CharacterId): PartReach[] {
  const found = characterSkeleton(app.store, character);
  if (found === null) return [];
  const meshes = characterMeshes(app.store, character);
  const body = bodyMeshOf(app, meshes, found.joints);
  if (body === null) return [];
  const regions = limbRegions(found.joints);
  const out: PartReach[] = [];
  for (const mesh of meshes) {
    if (mesh.id === body) continue;
    const skin = skinOf(app, mesh);
    const data = meshData(app, mesh);
    if (skin === null || data === null) continue;
    const reach = reachOf(mesh.id, skin, data.position, found.joints, regions);
    if (crossesLimbs(reach)) out.push(reach);
  }
  return out;
}

/**
 * The binds of *Separate parts move rigidly* (AR-R4-5): one `skin.bind` per joint mask — the cross-limb parts that
 * span no hinge rigidly on their best joint (`method: 'rigid-islands'`), the limb parts spanning one with automatic
 * weights over their own limb's joints.
 */
export function rigidPartBinds(
  app: Pick<EditorApp, 'store' | 'meshes'>,
  character: CharacterId,
): { readonly joints: readonly JointId[]; readonly rigid: boolean; readonly meshes: readonly MeshId[] }[] {
  const groups = new Map<string, { joints: readonly JointId[]; rigid: boolean; meshes: MeshId[] }>();
  for (const part of crossLimbParts(app, character)) {
    if (part.bind === null) continue;
    const key = `${part.bind.rigid}:${part.bind.joints.join(',')}`;
    const group = groups.get(key) ?? { joints: part.bind.joints, rigid: part.bind.rigid, meshes: [] };
    group.meshes.push(part.mesh);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A part's name without a modelling tool's namespace (`Tema_lowpoly_v0_14:pCube63` → `pCube63`). */
export const partName = (name: string): string => name.slice(name.lastIndexOf(':') + 1) || name;

const REGION_LABEL: Readonly<Record<LimbRegion, string>> = {
  head: 'the head',
  torso: 'the torso',
  leftArm: 'the left arm',
  rightArm: 'the right arm',
  leftLeg: 'the left leg',
  rightLeg: 'the right leg',
};

/** "the head, the left arm and the right arm". */
export function regionList(regions: readonly LimbRegion[]): string {
  const labels = regions.map((region) => REGION_LABEL[region]);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
