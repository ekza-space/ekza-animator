// Picking and stamps of the Paint Skin Weights tool (M6B-SPEC §5.11; C6; lazy): a ray through a pane point against the
// POSED triangles of the active character's bound meshes (the CPU-skinned points the skinned display draws, so posed
// painting hits what is on screen), the brush radius from CSS px to metres at the hit depth, and the points of one
// stamp: Surface reach (Dijkstra over the point graph with posed edge lengths, from the hit triangle's corners: no
// painting through to the other leg) or Volume (Euclidean), front faces only (a point qualifies when one of its
// triangles faces the camera), strength = opacity × falloff(d / r) with smooth `1 − 3t² + 2t³`, linear `1 − t` or
// constant 1.
import { quatRotateVec3, type ReadonlyVec3, type Vec3 } from '@ekza-studio/anim-core';
import type { BrushSettings } from '@ekza-studio/editor-core';
import type { StrokeStamp } from '@ekza-studio/mesh-core';
import type { CameraSnapshot } from '../../../types';
import { paneRay, type Ray3, rayTriangle } from '../../model/paint/pick';

export { paneRay, type Ray3 };

/** The test-rotate ring's radius (CSS px, §5.11). */
export const ROTATE_RING_PX = 48;

/** A bound mesh as the brush sees it (character space = world for model characters at the origin). */
export interface PaintSurface {
  readonly mesh: string;
  /** Posed points, 3 per point. */
  readonly positions: ArrayLike<number>;
  /** Point triangles (3 per triangle). */
  readonly tris: ArrayLike<number>;
  /** Point graph (CSR). */
  readonly graph: { readonly start: ArrayLike<number>; readonly next: ArrayLike<number> };
  /** Incident triangles per point (CSR). */
  readonly pointTris: { readonly start: ArrayLike<number>; readonly tris: ArrayLike<number> };
  /** Character placement (world = q·(s·p) + t). */
  readonly placement: {
    readonly t: ReadonlyVec3;
    readonly q: readonly [number, number, number, number];
    readonly s: ReadonlyVec3;
  };
}

export interface SurfaceHit {
  readonly surface: PaintSurface;
  readonly tri: number;
  /** World point of the hit. */
  readonly point: Vec3;
  /** Distance along the ray. */
  readonly t: number;
}

/** A point of a surface in world space. */
export function worldPoint(surface: PaintSurface, v: number): Vec3 {
  const { t, q, s } = surface.placement;
  const p: Vec3 = [
    (surface.positions[3 * v] as number) * s[0],
    (surface.positions[3 * v + 1] as number) * s[1],
    (surface.positions[3 * v + 2] as number) * s[2],
  ];
  const r = quatRotateVec3(q, p);
  return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
}

/** World positions of every point of a surface (one pass per pointer frame). */
export function worldPositions(surface: PaintSurface): Float64Array {
  const P = Math.floor(surface.positions.length / 3);
  const out = new Float64Array(3 * P);
  for (let v = 0; v < P; v++) out.set(worldPoint(surface, v), 3 * v);
  return out;
}

const at = (w: Float64Array, v: number): Vec3 => [w[3 * v] as number, w[3 * v + 1] as number, w[3 * v + 2] as number];

/** The nearest hit of a ray on the surfaces (posed), or null. */
export function pickSurfaces(
  surfaces: readonly PaintSurface[],
  ray: Ray3,
  world?: ReadonlyMap<PaintSurface, Float64Array>,
): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  for (const surface of surfaces) {
    const w = world?.get(surface) ?? worldPositions(surface);
    const T = Math.floor(surface.tris.length / 3);
    for (let i = 0; i < T; i++) {
      const a = surface.tris[3 * i] as number;
      const b = surface.tris[3 * i + 1] as number;
      const c = surface.tris[3 * i + 2] as number;
      const t = rayTriangle(ray, at(w, a), at(w, b), at(w, c));
      if (t === null || (best !== null && t >= best.t)) continue;
      best = {
        surface,
        tri: i,
        t,
        point: [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t],
      };
    }
  }
  return best;
}

/** World metres per CSS px at a world point seen by a pane camera of height `h` px. */
export function metresPerPx(camera: CameraSnapshot, h: number, point: ReadonlyVec3): number {
  if (h < 1) return 0;
  if (camera.projection !== 'perspective') return camera.orthoHeight / h;
  const forward = quatRotateVec3(camera.quaternion, [0, 0, -1]);
  const depth =
    (point[0] - camera.position[0]) * forward[0] +
    (point[1] - camera.position[1]) * forward[1] +
    (point[2] - camera.position[2]) * forward[2];
  return (2 * Math.tan(camera.fovY / 2) * Math.max(depth, 1e-6)) / h;
}

/** The brush falloff at t = d / r (§5.11). */
export function falloff(kind: BrushSettings['falloff'], t: number): number {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  if (kind === 'linear') return 1 - t;
  if (kind === 'constant') return 1;
  return 1 - 3 * t * t + 2 * t * t * t;
}

/** Whether point `v` has a triangle facing the camera. */
function facesCamera(
  surface: PaintSurface,
  w: Float64Array,
  v: number,
  camera: CameraSnapshot,
  forward: Vec3,
): boolean {
  const from = surface.pointTris.start[v] as number;
  const to = surface.pointTris.start[v + 1] as number;
  for (let k = from; k < to; k++) {
    const tri = surface.pointTris.tris[k] as number;
    const a = at(w, surface.tris[3 * tri] as number);
    const b = at(w, surface.tris[3 * tri + 1] as number);
    const c = at(w, surface.tris[3 * tri + 2] as number);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number),
      (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number),
      (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number),
    ];
    const view: Vec3 =
      camera.projection === 'perspective'
        ? [a[0] - camera.position[0], a[1] - camera.position[1], a[2] - camera.position[2]]
        : forward;
    if ((n[0] as number) * view[0] + (n[1] as number) * view[1] + (n[2] as number) * view[2] < 0) return true;
  }
  return from === to;
}

/**
 * The points one stamp reaches from a hit and their strengths (ascending point order). `radius` in world metres.
 */
export function stampAt(
  hit: SurfaceHit,
  radius: number,
  brush: Pick<BrushSettings, 'opacity' | 'falloff' | 'reach' | 'frontOnly'>,
  camera: CameraSnapshot,
  world?: Float64Array,
): StrokeStamp {
  const surface = hit.surface;
  const w = world ?? worldPositions(surface);
  const P = Math.floor(w.length / 3);
  const forward = quatRotateVec3(camera.quaternion, [0, 0, -1]);
  const dist = new Map<number, number>();
  const d = (v: number, p: ReadonlyVec3): number =>
    Math.hypot((w[3 * v] as number) - p[0], (w[3 * v + 1] as number) - p[1], (w[3 * v + 2] as number) - p[2]);
  if (brush.reach === 'volume') {
    for (let v = 0; v < P; v++) {
      const dv = d(v, hit.point);
      if (dv <= radius) dist.set(v, dv);
    }
  } else {
    // Dijkstra over the point graph from the hit triangle's corners (small heaps: a binary heap over the frontier).
    const heap: [number, number][] = [];
    const push = (v: number, dv: number): void => {
      heap.push([dv, v]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if ((heap[p] as [number, number])[0] <= dv) break;
        [heap[p], heap[i]] = [heap[i] as [number, number], heap[p] as [number, number]];
        i = p;
      }
    };
    const pop = (): [number, number] | undefined => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0 && last !== undefined) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && (heap[l] as [number, number])[0] < (heap[m] as [number, number])[0]) m = l;
          if (r < heap.length && (heap[r] as [number, number])[0] < (heap[m] as [number, number])[0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i] as [number, number], heap[m] as [number, number]];
          i = m;
        }
      }
      return top;
    };
    for (let k = 0; k < 3; k++) {
      const v = surface.tris[3 * hit.tri + k] as number;
      push(v, d(v, hit.point));
    }
    for (let item = pop(); item !== undefined; item = pop()) {
      const [dv, v] = item;
      if (dv > radius || dist.has(v)) continue;
      dist.set(v, dv);
      const from = surface.graph.start[v] as number;
      const to = surface.graph.start[v + 1] as number;
      for (let n = from; n < to; n++) {
        const u = surface.graph.next[n] as number;
        if (dist.has(u)) continue;
        const du =
          dv +
          Math.hypot(
            (w[3 * u] as number) - (w[3 * v] as number),
            (w[3 * u + 1] as number) - (w[3 * v + 1] as number),
            (w[3 * u + 2] as number) - (w[3 * v + 2] as number),
          );
        if (du <= radius) push(u, du);
      }
    }
  }
  const points: number[] = [];
  const strength: number[] = [];
  for (const v of [...dist.keys()].sort((a, b) => a - b)) {
    if (brush.frontOnly && !facesCamera(surface, w, v, camera, forward)) continue;
    const s = brush.opacity * falloff(brush.falloff, radius > 0 ? (dist.get(v) as number) / radius : 0);
    if (!(s > 0)) continue;
    points.push(v);
    strength.push(s);
  }
  return { points: Uint32Array.from(points), strength: Float32Array.from(strength) };
}

/** The point of a hit triangle nearest the hit (Sample, Pick Influence). */
export function nearestCorner(hit: SurfaceHit, world?: Float64Array): number {
  const w = world ?? worldPositions(hit.surface);
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3; k++) {
    const v = hit.surface.tris[3 * hit.tri + k] as number;
    const dv = Math.hypot(
      (w[3 * v] as number) - hit.point[0],
      (w[3 * v + 1] as number) - hit.point[1],
      (w[3 * v + 2] as number) - hit.point[2],
    );
    if (dv < bestD || (dv === bestD && v < best)) {
      best = v;
      bestD = dv;
    }
  }
  return best;
}

/** A world point projected into a pane (CSS px, pane-relative), or null behind the camera. */
export function projectToPane(
  camera: CameraSnapshot,
  w: number,
  h: number,
  point: ReadonlyVec3,
): { readonly x: number; readonly y: number } | null {
  const inv: [number, number, number, number] = [
    -camera.quaternion[0],
    -camera.quaternion[1],
    -camera.quaternion[2],
    camera.quaternion[3],
  ];
  const local = quatRotateVec3(inv, [
    point[0] - camera.position[0],
    point[1] - camera.position[1],
    point[2] - camera.position[2],
  ]);
  const aspect = w / h;
  let ndcX: number;
  let ndcY: number;
  if (camera.projection === 'perspective') {
    if (local[2] >= -1e-9) return null;
    const tan = Math.tan(camera.fovY / 2);
    ndcX = local[0] / (-local[2] * tan * aspect);
    ndcY = local[1] / (-local[2] * tan);
  } else {
    const half = camera.orthoHeight / 2;
    ndcX = local[0] / (half * aspect);
    ndcY = local[1] / half;
  }
  return { x: ((ndcX + 1) / 2) * w, y: ((1 - ndcY) / 2) * h };
}
