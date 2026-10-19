// Occlusion by whole meshes (M6A-SPEC §5.6 camera-based selection; research 10 §5: "a component is visible if a ray
// from the camera to it hits nothing closer"). A picker tests its own mesh; the meshes around it (other hilited meshes,
// the surfaces of meshes outside the hilite set) answer whether a world segment from the camera to a candidate crosses
// one of their drawn triangles. `TriangleOccluder` is the surface-side answer: a three-mesh-bvh BVH over a static
// triangle list, built only once a segment reaches its bounding box.
import type { Triangulation } from '@ekza-animator/mesh-core';
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Topo } from './topo';

/** Relative margin at the segment's far end: a surface through the candidate itself does not hide it. */
export const OCCLUSION_MARGIN = 1e-4;

/** Something drawn that can hide a component from the camera (§5.6). */
export interface PickOccluder {
  /**
   * True when a drawn triangle crosses the world segment from `from` to `to`, short of a relative margin of 1e-4 at
   * `to` (a surface touching the candidate does not hide it). Implementations must not change `from` or `to`.
   */
  occludes(from: Vector3, to: Vector3): boolean;
}

/** The far limit of a segment of length `d` (local units) under the margin, ≤ 0 when there is nothing to test. */
export function segmentFar(d: number): number {
  return d * (1 - OCCLUSION_MARGIN) - 1e-7;
}

/**
 * Sets `ray` to the segment `from`–`to` (world) mapped by `inverse` into a mesh's local space and returns the local far
 * limit (≤ 0: nothing to test). `a` and `b` are scratch vectors of the caller.
 */
export function localSegment(inverse: Matrix4, from: Vector3, to: Vector3, ray: Ray, a: Vector3, b: Vector3): number {
  a.copy(from).applyMatrix4(inverse);
  b.copy(to).applyMatrix4(inverse);
  ray.origin.copy(a);
  ray.direction.subVectors(b, a);
  const d = ray.direction.length();
  if (!(d > 0)) return 0;
  ray.direction.divideScalar(d);
  return segmentFar(d);
}

/** The local index of every triangle of a triangulation (corners mapped to their vertices). */
export function triangleIndex(t: Topo, tri: Triangulation): Uint32Array {
  const out = new Uint32Array(tri.tris.length);
  for (let i = 0; i < out.length; i++) out[i] = t.cv[tri.tris[i] as number] as number;
  return out;
}

/**
 * A static triangle list as an occluder (a `MeshSurface`, which draws every face). The BVH is built on the first
 * segment that reaches the local bounding box, so meshes nowhere near the line of sight never pay for one.
 */
export class TriangleOccluder implements PickOccluder {
  private readonly positions: Float32Array;
  private readonly index: Uint32Array;
  private readonly box = new Box3();
  private readonly inverse = new Matrix4();
  private readonly ray = new Ray();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly entry = new Vector3();
  private geometry: BufferGeometry | null = null;
  private bvh: MeshBVH | null = null;

  constructor(position: ArrayLike<number>, points: number, index: Uint32Array, world: Matrix4) {
    this.positions = new Float32Array(3 * points);
    for (let i = 0; i < 3 * points; i++) this.positions[i] = position[i] as number;
    this.index = index;
    this.box.makeEmpty();
    for (let k = 0; k < index.length; k++) {
      const v = 3 * (index[k] as number);
      this.a.set(this.positions[v] as number, this.positions[v + 1] as number, this.positions[v + 2]);
      this.box.expandByPoint(this.a);
    }
    this.setWorld(world);
  }

  /** The world-from-local matrix the triangles are drawn with. */
  setWorld(world: Matrix4): void {
    this.inverse.copy(world).invert();
  }

  /** True once the BVH exists (tests). */
  get built(): boolean {
    return this.bvh !== null;
  }

  occludes(from: Vector3, to: Vector3): boolean {
    if (this.index.length === 0) return false;
    const far = localSegment(this.inverse, from, to, this.ray, this.a, this.b);
    if (!(far > 0)) return false;
    const entry = this.ray.intersectBox(this.box, this.entry);
    if (entry === null || entry.distanceTo(this.ray.origin) > far) return false;
    if (this.bvh === null) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
      geometry.setIndex(new BufferAttribute(this.index, 1));
      this.geometry = geometry;
      this.bvh = new MeshBVH(geometry);
    }
    return this.bvh.raycastFirst(this.ray, DoubleSide, 0, far) !== null;
  }

  dispose(): void {
    this.geometry?.dispose();
    this.geometry = null;
    this.bvh = null;
  }
}
