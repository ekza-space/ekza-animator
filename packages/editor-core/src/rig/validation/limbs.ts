// Separate parts and the limbs their weights reach (AUTORIG-SPEC §5.4; AR-R4-5, the owner's AR-D10-7 call). A
// segmented low-poly character is many meshes: the body (the trunk the limbs hang from) and its parts — hands, shoes, a
// hairdo, a collar. Automatic weights bind each part by distance, so the side cubes of a wide hairdo next to the
// shoulders follow the upper arms while the rest of it follows the head: the part stretches between two limbs. Here:
//
// - `limbRegions`: every joint's body region (head, torso, an arm, a leg) from its own or its nearest ancestor's VRM
//   bone; the torso joins the others (a leg part may blend into the hips, an arm part into the chest);
// - `partReach`: per separate part, the regions that carry a real share of its weight and its best joint — the
//   weighted joint whose bone passes nearest the part's centre (the head for a hairdo, the chest for a collar);
// - `crossLimbParts`: the parts that reach two regions that do not meet (the head and an arm, both legs): the
//   Validation row `skin.cross-limb` and Auto-Rig's *Separate parts move rigidly*, which binds each of them to its best
//   joint alone (`skin.bind {method: 'rigid-islands', joints: [best]}`, M6b's rigid attach).
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

/**
 * The body of a multi-part character: the mesh that carries the most weight on the torso's joints (hips, spine,
 * chests) — the trunk every limb hangs from, whatever its pose (a straightened I-pose makes no part taller). Null for
 * one mesh or before a bind.
 */
export function bodyMeshOf(
  app: Pick<EditorApp, 'meshes'>,
  meshes: readonly MeshRecord[],
  regions: ReadonlyMap<string, LimbRegion>,
): MeshId | null {
  if (meshes.length < 2) return null;
  let best: MeshId | null = null;
  let most = 0;
  for (const mesh of meshes) {
    const skin = skinOf(app, mesh);
    if (skin === null) continue;
    let torso = 0;
    for (let i = 0; i < skin.weights.length; i++) {
      const key = skin.palette[skin.joints[i] as number]?.key;
      if (key !== undefined && (regions.get(key) ?? 'torso') === 'torso') torso += skin.weights[i] as number;
    }
    if (torso > most) {
      most = torso;
      best = mesh.id;
    }
  }
  return best;
}

export interface PartReach {
  readonly mesh: MeshId;
  /** The regions holding at least `REGION_SHARE` of the part's weight, the largest share first. */
  readonly regions: readonly LimbRegion[];
  /** The weighted joint whose bone passes nearest the part's centre (null: an unweighted part). */
  readonly best: JointId | null;
  /** Every joint the part carries weight on. */
  readonly joints: readonly JointId[];
}

const segmentDistance = (p: readonly number[], a: readonly number[], b: readonly number[]): number => {
  const ab = [0, 1, 2].map((k) => (b[k] ?? 0) - (a[k] ?? 0));
  const ap = [0, 1, 2].map((k) => (p[k] ?? 0) - (a[k] ?? 0));
  const len2 = ab.reduce((sum, v) => sum + v * v, 0);
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ap.reduce((sum, v, k) => sum + v * (ab[k] ?? 0), 0) / len2));
  return Math.hypot(...[0, 1, 2].map((k) => (ap[k] ?? 0) - t * (ab[k] ?? 0)));
};

/** The reach of one bound part (its skin and positions). */
export function reachOf(
  mesh: MeshId,
  skin: SkinWeights,
  position: Float32Array,
  joints: readonly JointRecord[],
  regions: ReadonlyMap<string, LimbRegion>,
): PartReach {
  const mass = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < skin.weights.length; i++) {
    const w = skin.weights[i] as number;
    if (w <= 0) continue;
    const key = skin.palette[skin.joints[i] as number]?.key;
    if (key === undefined) continue;
    mass.set(key, (mass.get(key) ?? 0) + w);
    total += w;
  }
  const byRegion = new Map<LimbRegion, number>();
  for (const [key, m] of mass) {
    const region = regions.get(key) ?? 'torso';
    byRegion.set(region, (byRegion.get(region) ?? 0) + m);
  }
  const reached = [...byRegion]
    .filter(([, m]) => total > 0 && m / total >= REGION_SHARE)
    .sort((a, b) => b[1] - a[1])
    .map(([region]) => region);
  // the part's centre (its points' mean) and the weighted joint whose bone (head → first child, else tail) is nearest
  const n = position.length / 3;
  const centre = [0, 0, 0];
  for (let i = 0; i < position.length; i++) centre[i % 3] = (centre[i % 3] as number) + (position[i] as number) / n;
  const byId = new Map(joints.map((joint) => [joint.id as string, joint]));
  let best: JointId | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const key of [...mass.keys()].sort()) {
    const joint = byId.get(key);
    if (joint === undefined) continue;
    const child = joints.find((other) => other.parent === joint.id);
    const tail = child?.restPosition ?? joint.tail ?? joint.restPosition;
    const d = segmentDistance(centre, joint.restPosition, tail);
    // ties: the joint with more weight on the part
    if (d < nearest - 1e-9 || (Math.abs(d - nearest) <= 1e-9 && (mass.get(key) ?? 0) > (mass.get(best ?? '') ?? 0))) {
      nearest = d;
      best = joint.id;
    }
  }
  return { mesh, regions: reached, best, joints: [...mass.keys()] as JointId[] };
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
  const regions = limbRegions(found.joints);
  const body = bodyMeshOf(app, meshes, regions);
  if (body === null) return [];
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

/** The rigid binds that make the cross-limb parts follow their best joint: one `skin.bind` per joint. */
export function rigidPartBinds(
  app: Pick<EditorApp, 'store' | 'meshes'>,
  character: CharacterId,
): { readonly joint: JointId; readonly meshes: readonly MeshId[] }[] {
  const groups = new Map<JointId, MeshId[]>();
  for (const part of crossLimbParts(app, character)) {
    if (part.best === null) continue;
    groups.set(part.best, [...(groups.get(part.best) ?? []), part.mesh]);
  }
  return [...groups].map(([joint, meshes]) => ({ joint, meshes }));
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
