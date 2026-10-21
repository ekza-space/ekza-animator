// Face picking of the Paint Colour tool (M6A-SPEC §5.19; B13): a ray through a pane point (from the pane's camera
// snapshot and size) against the triangulation of every authored mesh the pane draws, nearest hit first. It reads
// the kernel runtimes only (positions, the cached triangulation, the world placement through groups), so it works
// whether or not a mesh-view display is loaded; hidden objects, objects outside a pane's isolate list and hidden faces
// are never picked.
import { quatRotateVec3, type ReadonlyVec3, type Vec3 } from '@ekza-studio/anim-core';
import type { MeshId, MeshRecord } from '@ekza-studio/doc';
import { type EditorApp, worldPlacement } from '@ekza-studio/editor-core';
import type { CameraSnapshot } from '../../../types';

/** What picking needs of the viewport: the pane's camera and its size in CSS px. */
export interface PaintView {
  camera(paneId: string): CameraSnapshot;
  paneRect(paneId: string): { readonly w: number; readonly h: number } | null;
}

export interface Ray3 {
  readonly origin: Vec3;
  readonly dir: Vec3;
  /** Orthographic rays hit geometry on either side of the camera position (no near plane in the pick). */
  readonly ortho: boolean;
}

export interface FaceHit {
  readonly mesh: MeshId;
  readonly face: number;
  readonly point: Vec3;
  readonly t: number;
}

/** The world ray through a pane point (pane CSS px, origin top-left), or null for an unknown or empty pane. */
export function paneRay(view: PaintView, paneId: string, x: number, y: number): Ray3 | null {
  const rect = view.paneRect(paneId);
  if (rect === null || rect.w < 1 || rect.h < 1) return null;
  let camera: CameraSnapshot;
  try {
    camera = view.camera(paneId);
  } catch {
    return null;
  }
  const aspect = rect.w / rect.h;
  const ndcX = (x / rect.w) * 2 - 1;
  const ndcY = 1 - (y / rect.h) * 2;
  const forward = quatRotateVec3(camera.quaternion, [0, 0, -1]);
  if (camera.projection === 'perspective') {
    const tan = Math.tan(camera.fovY / 2);
    const local: Vec3 = [ndcX * tan * aspect, ndcY * tan, -1];
    const dir = normalize(quatRotateVec3(camera.quaternion, local));
    return { origin: [...camera.position] as Vec3, dir, ortho: false };
  }
  const half = camera.orthoHeight / 2;
  const offset = quatRotateVec3(camera.quaternion, [ndcX * half * aspect, ndcY * half, 0]);
  return {
    origin: [camera.position[0] + offset[0], camera.position[1] + offset[1], camera.position[2] + offset[2]],
    dir: normalize(forward),
    ortho: true,
  };
}

function normalize(v: ReadonlyVec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The authored meshes a pane draws (live, ready, not hidden, inside the pane's isolate list when it has one). */
export function paintableMeshes(app: EditorApp, paneId: string): readonly MeshRecord[] {
  const state = app.session.getState().model;
  const isolate = state.isolate[paneId] ?? null;
  const isolated = isolate === null ? null : new Set<string>(isolate);
  return app.store.list('meshes').filter((record) => {
    if (record.data === null || state.hiddenObjects.has(record.id)) return false;
    if (isolated !== null && !inIsolate(app, record, isolated)) return false;
    return app.meshes.get(record.id)?.state === 'ready';
  });
}

/** An object or one of its ancestors is in the isolate list. */
function inIsolate(app: EditorApp, record: MeshRecord, isolated: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  let id: string | null = record.id;
  while (id !== null && !seen.has(id)) {
    if (isolated.has(id)) return true;
    seen.add(id);
    const node: { readonly parent: string | null } | undefined = id.startsWith('grp_')
      ? app.store.get('groups', id as never)
      : app.store.get('meshes', id as MeshId);
    id = node?.parent ?? null;
  }
  return false;
}

const EPS = 1e-12;

/** Möller–Trumbore: the ray parameter of the hit, or null. Two-sided. */
export function rayTriangle(ray: Ray3, a: ReadonlyVec3, b: ReadonlyVec3, c: ReadonlyVec3): number | null {
  const e1x = b[0] - a[0];
  const e1y = b[1] - a[1];
  const e1z = b[2] - a[2];
  const e2x = c[0] - a[0];
  const e2y = c[1] - a[1];
  const e2z = c[2] - a[2];
  const [dx, dy, dz] = ray.dir;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < EPS) return null;
  const inv = 1 / det;
  const tx = ray.origin[0] - a[0];
  const ty = ray.origin[1] - a[1];
  const tz = ray.origin[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return ray.ortho || t > 0 ? t : null;
}

/** The nearest face of `meshes` under `ray`, or null. */
export function pickFace(app: EditorApp, meshes: readonly MeshRecord[], ray: Ray3): FaceHit | null {
  let best: FaceHit | null = null;
  for (const record of meshes) {
    const runtime = app.meshes.get(record.id);
    const data = runtime?.data() ?? null;
    if (runtime === undefined || data === null) continue;
    const open = runtime.mesh;
    const position = open?.position ?? data.position;
    const cornerVert = (c: number): number => (open === null ? (data.cornerVert[c] as number) : open.cornerVert(c));
    let hidden: { readonly faces: { has(i: number): boolean } } | null = null;
    try {
      hidden = app.components.hidden(record.id);
    } catch {
      hidden = null;
    }
    const world = worldPlacement(app.store, record);
    const toWorld = (v: number): Vec3 => {
      const p: Vec3 = [
        (position[3 * v] as number) * world.s[0],
        (position[3 * v + 1] as number) * world.s[1],
        (position[3 * v + 2] as number) * world.s[2],
      ];
      const r = quatRotateVec3(world.q, p);
      return [r[0] + world.t[0], r[1] + world.t[1], r[2] + world.t[2]];
    };
    const tri = runtime.triangulation();
    for (let i = 0; i < tri.triFace.length; i++) {
      const face = tri.triFace[i] as number;
      if (hidden?.faces.has(face) === true) continue;
      const a = toWorld(cornerVert(tri.tris[3 * i] as number));
      const b = toWorld(cornerVert(tri.tris[3 * i + 1] as number));
      const c = toWorld(cornerVert(tri.tris[3 * i + 2] as number));
      const t = rayTriangle(ray, a, b, c);
      if (t === null || (best !== null && t >= best.t)) continue;
      best = {
        mesh: record.id,
        face,
        t,
        point: [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t],
      };
    }
  }
  return best;
}

/** The face under a pane point among the meshes the pane draws, or null. */
export function faceAt(app: EditorApp, view: PaintView, paneId: string, x: number, y: number): FaceHit | null {
  const ray = paneRay(view, paneId, x, y);
  return ray === null ? null : pickFace(app, paintableMeshes(app, paneId), ray);
}
