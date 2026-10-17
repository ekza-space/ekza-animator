// Canonical rest worlds of a SkeletonDesc: rest locals composed parent-first, with the model→canonical `facing`
// applied at the scene roots (MVP-SPEC §4.11.9). Transforms compose as T·R·S (exact for uniform scale, which is what
// humanoid rigs use), matching the synthetic rest-pose fixture.
import { mat4Compose, type ReadonlyXf, type Xf, xfMultiply } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import type { SkeletonDesc, SkeletonNode } from '@ekza-animator/rig';

/** Rest world transform of every node (SkeletonDesc order) in canonical character space. */
export function restWorlds(skeleton: Pick<SkeletonDesc, 'nodes' | 'facing'>): Xf[] {
  return restWorldsOf(skeleton.nodes, skeleton.facing);
}

export function restWorldsOf(nodes: readonly SkeletonNode[], facing: SkeletonDesc['facing']): Xf[] {
  const root: ReadonlyXf = { t: [0, 0, 0], q: facing, s: [1, 1, 1] };
  const worlds: Xf[] = [];
  for (const node of nodes) {
    const parent = node.parent === -1 ? root : (worlds[node.parent] as Xf);
    worlds.push(xfMultiply(parent, node.restLocal));
  }
  return worlds;
}

/** Rest world matrices (column-major, canonical space) of every node. */
export function restWorldMatrices(skeleton: Pick<SkeletonDesc, 'nodes' | 'facing'>): Float64Array[] {
  return restWorlds(skeleton).map((xf) => mat4Compose(xf));
}

/** Canonical rest world positions of the mapped humanoid bones. */
export function humanoidRestPositions(
  skeleton: Pick<SkeletonDesc, 'nodes' | 'facing' | 'humanoid'>,
): Partial<Record<HumanBoneName, readonly [number, number, number]>> {
  const out: Partial<Record<HumanBoneName, readonly [number, number, number]>> = {};
  if (skeleton.humanoid === null) return out;
  const worlds = restWorlds(skeleton);
  for (const [bone, node] of Object.entries(skeleton.humanoid) as [HumanBoneName, number][]) {
    const world = worlds[node];
    if (world !== undefined) out[bone] = [world.t[0], world.t[1], world.t[2]];
  }
  return out;
}
