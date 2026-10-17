// Mesh-click picking (M1-stretch, MVP-SPEC §1.2, §4.11.16): a CPU raycast against the visible meshes of a pane with
// the current skinning and morphs applied (three's Mesh.raycast). The hit triangle's dominant joint (skin weights ×
// barycentric coordinates) names the node; the caller maps it to the nearest driving control. Clicks only, never
// hover: a skinned raycast costs O(triangles) skinned vertices.
import type { CharacterId } from '@ekza-animator/doc';
import type { LoadedModel } from '@ekza-animator/io/three';
import {
  type Box3,
  type BufferAttribute,
  type Camera,
  type Face,
  type Intersection,
  type InterleavedBufferAttribute,
  type Mesh,
  type Object3D,
  Raycaster,
  type SkinnedMesh,
  Vector2,
  type Vector3,
} from 'three';
import { LAYER } from '../layers';

/** One character's meshes and the inverse of `LoadedModel.nodeObjects`. */
export interface MeshPickTarget {
  readonly character: CharacterId;
  readonly model: LoadedModel;
  readonly nodeOf: ReadonlyMap<Object3D, number>;
}

export interface MeshHit {
  readonly character: CharacterId;
  /** SkeletonDesc node index of the dominant joint (skinned) or of the nearest node ancestor (rigid meshes). */
  readonly node: number;
  /** Distance from the ray origin (scene units). */
  readonly distance: number;
}

type SkinAttribute = BufferAttribute | InterleavedBufferAttribute;

export class MeshPicker {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  /** Pose stamp each skinned mesh's bounding sphere was last computed for (three caches it from the first pose). */
  private readonly boundsStamp = new WeakMap<SkinnedMesh, number>();

  constructor() {
    this.raycaster.layers.set(LAYER.mesh);
  }

  /**
   * The nearest mesh hit under normalized device coordinates (`ndcX`, `ndcY`) of `camera`, or null. `poseStamp`
   * changes whenever any pose changed; skinned bounding spheres are recomputed for a new stamp only.
   */
  pick(
    camera: Camera,
    ndcX: number,
    ndcY: number,
    targets: Iterable<MeshPickTarget>,
    poseStamp: number,
  ): MeshHit | null {
    this.raycaster.setFromCamera(this.ndc.set(ndcX, ndcY), camera);
    let best: MeshHit | null = null;
    const hits: Intersection[] = [];
    for (const target of targets) {
      hits.length = 0;
      target.model.root.traverseVisible((object) => {
        const mesh = object as Mesh;
        if (mesh.isMesh !== true || !mesh.layers.test(this.raycaster.layers)) return;
        if (isSkinned(mesh) && this.boundsStamp.get(mesh) !== poseStamp) {
          mesh.computeBoundingSphere();
          // three's typings say Box3, but it stays null until someone computes it; a stale box would reject hits.
          if ((mesh as { readonly boundingBox: Box3 | null }).boundingBox !== null) mesh.computeBoundingBox();
          this.boundsStamp.set(mesh, poseStamp);
        }
        mesh.raycast(this.raycaster, hits);
      });
      for (const hit of hits) {
        if (best !== null && hit.distance >= best.distance) continue;
        const node = nodeOfHit(hit, target.nodeOf);
        if (node !== null) best = { character: target.character, node, distance: hit.distance };
      }
    }
    return best;
  }
}

/** Inverse of `LoadedModel.nodeObjects`. */
export function nodeIndexOf(model: LoadedModel): Map<Object3D, number> {
  const map = new Map<Object3D, number>();
  model.nodeObjects.forEach((object, index) => {
    if (object !== null) map.set(object, index);
  });
  return map;
}

function isSkinned(mesh: Mesh): mesh is SkinnedMesh {
  return (mesh as Partial<SkinnedMesh>).isSkinnedMesh === true;
}

function nodeOfHit(hit: Intersection, nodeOf: ReadonlyMap<Object3D, number>): number | null {
  const mesh = hit.object as Mesh;
  if (isSkinned(mesh) && hit.face !== null && hit.face !== undefined) {
    const joint = dominantJoint(mesh, hit.face, hit.barycoord);
    const node = joint === null ? null : nearestNode(joint, nodeOf);
    if (node !== null) return node;
  }
  return nearestNode(mesh, nodeOf);
}

/** The node itself or its nearest ancestor that is a skeleton node. */
function nearestNode(object: Object3D, nodeOf: ReadonlyMap<Object3D, number>): number | null {
  for (let o: Object3D | null = object; o !== null; o = o.parent) {
    const node = nodeOf.get(o);
    if (node !== undefined) return node;
  }
  return null;
}

/**
 * The joint with the largest influence at the hit point: Σ over the triangle's vertices of barycentric weight × skin
 * weight (ties: lower joint index, for determinism).
 */
export function dominantJoint(mesh: SkinnedMesh, face: Face, barycoord: Vector3 | null | undefined): Object3D | null {
  const geometry = mesh.geometry;
  const indices = geometry.getAttribute('skinIndex') as SkinAttribute | undefined;
  const weights = geometry.getAttribute('skinWeight') as SkinAttribute | undefined;
  if (indices === undefined || weights === undefined) return null;
  const vertices = [face.a, face.b, face.c] as const;
  const bary =
    barycoord === null || barycoord === undefined ? [1 / 3, 1 / 3, 1 / 3] : [barycoord.x, barycoord.y, barycoord.z];
  const influence = new Map<number, number>();
  for (let v = 0; v < 3; v++) {
    const vertex = vertices[v] as number;
    const b = bary[v] as number;
    for (let i = 0; i < indices.itemSize; i++) {
      const w = weights.getComponent(vertex, i) * b;
      if (w <= 0) continue;
      const joint = indices.getComponent(vertex, i);
      influence.set(joint, (influence.get(joint) ?? 0) + w);
    }
  }
  let best = -1;
  let bestWeight = 0;
  for (const [joint, weight] of influence) {
    if (weight > bestWeight || (weight === bestWeight && joint < best)) {
      best = joint;
      bestWeight = weight;
    }
  }
  return best < 0 ? null : (mesh.skeleton.bones[best] ?? null);
}
