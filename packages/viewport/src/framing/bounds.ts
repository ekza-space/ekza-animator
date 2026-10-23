// Adapted from ekza-avatar-renderer/src/bounds.ts @ 33c417c (MIT, © Wotori / Ekza). Changes: TypeScript strict
// style, three ≥ 0.186 only (applyBoneTransform), no world-matrix update (the viewport keeps matrices current through
// SceneSync), returns null for empty bounds and accepts several roots.
import { Box3, type BufferAttribute, type Mesh, type Object3D, type SkinnedMesh, Vector3 } from 'three';

/** Posed axis-aligned bounds in scene space. */
export interface SpatialBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

type PositionAttribute = Pick<BufferAttribute, 'count' | 'getX' | 'getY' | 'getZ'>;

function readPosition(target: Vector3, attribute: PositionAttribute, index: number): Vector3 {
  return target.set(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
}

function applyMorphTargets(mesh: Mesh, index: number, position: Vector3, base: Vector3, morph: Vector3): void {
  const influences = mesh.morphTargetInfluences;
  const targets = mesh.geometry.morphAttributes['position'] as PositionAttribute[] | undefined;
  if (influences === undefined || targets === undefined || targets.length === 0) return;
  base.copy(position);
  for (let t = 0; t < targets.length; t++) {
    const influence = influences[t] ?? 0;
    const target = targets[t];
    if (influence === 0 || target === undefined) continue;
    readPosition(morph, target, index);
    if (mesh.geometry.morphTargetsRelative) position.addScaledVector(morph, influence);
    else position.addScaledVector(morph.sub(base), influence);
  }
}

/**
 * Measures the geometry three actually renders (skinning and morph targets applied), not the static accessor
 * bounds. CPU work per vertex: use on demand (framing), never per frame. World matrices must be current.
 * `hidden`: hidden meshes under a visible root count too (Rig & Skin hides the display's bound meshes while mesh-view
 * draws them; AR-D8-4).
 */
export function measureSpatialBounds(roots: Iterable<Object3D>, hidden = false): SpatialBounds | null {
  const bounds = new Box3().makeEmpty();
  const position = new Vector3();
  const base = new Vector3();
  const morph = new Vector3();
  for (const root of roots) {
    if (!root.visible) continue;
    root[hidden ? 'traverse' : 'traverseVisible']((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh !== true) return;
      const attribute = mesh.geometry.getAttribute('position') as PositionAttribute | undefined;
      if (attribute === undefined) return;
      const skinned = mesh as SkinnedMesh;
      if (skinned.isSkinnedMesh === true) skinned.skeleton.update();
      for (let i = 0; i < attribute.count; i++) {
        readPosition(position, attribute, i);
        applyMorphTargets(mesh, i, position, base, morph);
        if (skinned.isSkinnedMesh === true) skinned.applyBoneTransform(i, position);
        position.applyMatrix4(mesh.matrixWorld);
        if (Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
          bounds.expandByPoint(position);
        }
      }
    });
  }
  if (bounds.isEmpty()) return null;
  return {
    minX: bounds.min.x,
    maxX: bounds.max.x,
    minY: bounds.min.y,
    maxY: bounds.max.y,
    minZ: bounds.min.z,
    maxZ: bounds.max.z,
  };
}

/** Bounds of xyz triplets (NaN entries skipped); null when there is no finite point. */
export function pointBounds(points: Iterable<Float32Array>): SpatialBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const array of points) {
    for (let i = 0; i + 2 < array.length; i += 3) {
      const x = array[i] as number;
      const y = array[i + 1] as number;
      const z = array[i + 2] as number;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  return minX > maxX ? null : { minX, maxX, minY, maxY, minZ, maxZ };
}

export function unionBounds(a: SpatialBounds | null, b: SpatialBounds | null): SpatialBounds | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}
