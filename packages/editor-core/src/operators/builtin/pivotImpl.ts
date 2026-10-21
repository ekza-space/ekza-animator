// Pivots and Freeze/Reset Transformations, the lazy half (M6A-SPEC §5.13, §5.15; B12a): bounds, the matrices of
// Bake Pivot and Freeze Transformations and their `mesh.applyTransform` commits (B4's kernel op). `pivot.ts` holds the
// eager definitions (labels, polls, argument checks); their `prepare` loads this module (§5.27: the eager route keeps
// descriptors, registrations and polls only).
import {
  EkzaError,
  type Mat4,
  mat4Compose,
  mat4Decompose,
  mat4Invert,
  mat4Multiply,
  type ReadonlyVec3,
  type ReadonlyXf,
  type Vec3,
  type Xf,
} from '@ekza-studio/anim-core';
import type { MeshId, MeshRecord, ReadView, Tx } from '@ekza-studio/doc';
import { attachMeshes, meshKernel } from '../../mesh';
import { runSeed } from '../../mesh/seed';
import type { ApplyContext, EditorApp } from '../../types';
import { childrenOf, descendantMeshes, type FreezeParts, type ObjectRecord, objectRecord, patchObject } from './pivot';

function ownerKey(record: ObjectRecord): string {
  return 'character' in record.owner ? `char:${record.owner.character}` : 'scene';
}

/** The scene matrix of an object: the character root (character-owned), then the placements from the top down. */
export function objectMatrix(view: ReadView, record: ObjectRecord): Mat4 {
  const chain: ReadonlyXf[] = [record.placement];
  const seen = new Set<string>([record.id]);
  let parent: string | null = record.parent;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    const next = objectRecord(view, parent);
    if (next === null || ownerKey(next) !== ownerKey(record)) break;
    chain.push(next.placement);
    parent = next.parent;
  }
  let world: Mat4 | null = null;
  if ('character' in record.owner) {
    const character = view.get('characters', record.owner.character);
    if (character !== undefined) world = mat4Compose(character.placement);
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const local = mat4Compose(chain[i] as ReadonlyXf);
    world = world === null ? local : mat4Multiply(world, local);
  }
  return world ?? mat4Compose(record.placement);
}

// ---------------------------------------------------------------------------------------------------------------
// bounds

/** Local-space positions of a ready mesh, or null while its runtime is not ready. */
function meshPositions(
  app: EditorApp,
  id: MeshId,
): { readonly position: ArrayLike<number>; readonly n: number } | null {
  const runtime = app.meshes.get(id);
  if (runtime === undefined || runtime.state !== 'ready') return null;
  const data = runtime.data();
  if (data === null) return null;
  return { position: data.position, n: data.counts.points };
}

interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

function apply4(m: Mat4, x: number, y: number, z: number): Vec3 {
  return [
    (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
    (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
    (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
  ];
}

/**
 * Bounds of an object in its own space: a mesh's points; a group's descendant meshes' points mapped into the
 * group. 'loading' while a mesh is not ready; null for an object without points.
 */
export function objectBounds(app: EditorApp, record: ObjectRecord): Bounds | null | 'loading' {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: Vec3): void => {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, p[k] as number);
      max[k] = Math.max(max[k] as number, p[k] as number);
    }
  };
  const meshes: { readonly mesh: MeshRecord; readonly toLocal: Mat4 | null }[] = [];
  if ('data' in record) meshes.push({ mesh: record, toLocal: null });
  else {
    const inverse = mat4Invert(objectMatrix(app.store, record));
    if (inverse === null) return null;
    for (const mesh of descendantMeshes(app.store, record)) {
      if (mesh.data === null) continue;
      meshes.push({ mesh, toLocal: mat4Multiply(inverse, objectMatrix(app.store, mesh)) });
    }
  }
  for (const { mesh, toLocal } of meshes) {
    const points = meshPositions(app, mesh.id);
    if (points === null) return 'loading';
    const p = points.position;
    for (let v = 0; v < points.n; v++) {
      const x = p[3 * v] as number;
      const y = p[3 * v + 1] as number;
      const z = p[3 * v + 2] as number;
      add(toLocal === null ? [x, y, z] : apply4(toLocal, x, y, z));
    }
  }
  return min[0] <= max[0] ? { min, max } : null;
}

/** A pivot from the bounds (`center`, `bottomCenter`) or the origin (`reset`). */
function pivotFrom(kind: 'center' | 'bottomCenter' | 'reset', bounds: Bounds | null): Vec3 | null {
  if (kind === 'reset') return [0, 0, 0];
  if (bounds === null) return null;
  const cx = 0.5 * (bounds.min[0] + bounds.max[0]);
  const cz = 0.5 * (bounds.min[2] + bounds.max[2]);
  return kind === 'center' ? [cx, 0.5 * (bounds.min[1] + bounds.max[1]), cz] : [cx, bounds.min[1], cz];
}

/** Center Pivot, Pivot to Bottom Center, Reset Pivot on each target. */
export function applyPivotFrom(
  app: EditorApp,
  tx: Tx,
  targets: readonly ObjectRecord[],
  kind: 'center' | 'bottomCenter' | 'reset',
): void {
  for (const record of targets) {
    const bounds = kind === 'reset' ? null : objectBounds(app, record);
    const next = pivotFrom(kind, bounds === 'loading' ? null : bounds);
    if (next !== null) patchObject(tx, record, { pivot: next });
  }
}

/** Moves the children of an object by `delta` in its space (T(delta)·C), keeping their world placement when the
 *  object's own frame moved by −delta. */
function shiftChildren(tx: Tx, record: ObjectRecord, delta: ReadonlyVec3): void {
  for (const child of childrenOf(tx, record)) {
    const t = child.placement.t;
    patchObject(tx, child, {
      placement: { ...child.placement, t: [t[0] + delta[0], t[1] + delta[1], t[2] + delta[2]] },
    });
  }
}

/** `placement.t + R·(s ∘ v)`: where a local point v sits in the parent. */
function inParent(placement: ReadonlyXf, v: ReadonlyVec3): Vec3 {
  const m = mat4Compose(placement);
  return apply4(m, v[0], v[1], v[2]);
}

/** Runs `mesh.applyTransform {matrix}` on one mesh inside the operator's transaction (B4's kernel op). */
function applyMatrix(ctx: ApplyContext, tx: Tx, opId: string, mesh: MeshId, matrix: Mat4): void {
  const kernel = meshKernel();
  const meshes = attachMeshes(ctx.app);
  const op = kernel?.MESH_OPS['mesh.applyTransform'];
  if (kernel === null || meshes === null || op === undefined) {
    throw new EkzaError('mesh-loading', 'Mesh tools are loading');
  }
  meshes.commitOp(tx, op, [mesh], { matrix: Array.from(matrix) }, { seed: runSeed(ctx, opId), kind: null });
}

const isZero = (v: ReadonlyVec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;

/** Bake Pivot: the geometry (and the children) move by −pivot, the placement by +R·S·pivot; the pivot is the origin. */
export function applyBakePivot(ctx: ApplyContext, tx: Tx, targets: readonly ObjectRecord[]): void {
  for (const target of targets) {
    const record = objectRecord(tx, target.id);
    if (record === null || isZero(record.pivot)) continue;
    const p = record.pivot;
    if ('data' in record && record.data !== null) {
      const shift = mat4Compose({ t: [-p[0], -p[1], -p[2]], q: [0, 0, 0, 1], s: [1, 1, 1] });
      applyMatrix(ctx, tx, 'mesh.pivot.bake', record.id, shift);
    }
    shiftChildren(tx, record, [-p[0], -p[1], -p[2]]);
    patchObject(tx, record, {
      placement: { ...record.placement, t: inParent(record.placement, p) },
      pivot: [0, 0, 0],
    });
  }
}

/** The placement with the frozen parts reset to identity. */
export function frozenPlacement(placement: ReadonlyXf, parts: FreezeParts): Xf {
  return {
    t: parts.translate ? [0, 0, 0] : [placement.t[0], placement.t[1], placement.t[2]],
    q: parts.rotate ? [0, 0, 0, 1] : [placement.q[0], placement.q[1], placement.q[2], placement.q[3]],
    s: parts.scale ? [1, 1, 1] : [placement.s[0], placement.s[1], placement.s[2]],
  };
}

/** M = P′⁻¹·P: the mesh-local matrix that keeps the world where it was once the placement is P′. */
export function freezeMatrix(placement: ReadonlyXf, next: ReadonlyXf): Mat4 | null {
  const inverse = mat4Invert(mat4Compose(next));
  return inverse === null ? null : mat4Multiply(inverse, mat4Compose(placement));
}

function isIdentityMatrix(m: Mat4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs((m[i] as number) - (i % 5 === 0 ? 1 : 0)) > 1e-12) return false;
  return true;
}

/** Freeze Transformations on the meshes (parents first): geometry by M, children by M·C, pivot by M. */
export function applyFreeze(ctx: ApplyContext, tx: Tx, meshes: readonly MeshRecord[], parts: FreezeParts): void {
  for (const target of meshes) {
    // Parents first: a child's placement already carries its frozen parent's compensation.
    const record = tx.get('meshes', target.id);
    if (record === undefined) continue;
    const next = frozenPlacement(record.placement, parts);
    const matrix = freezeMatrix(record.placement, next);
    if (matrix === null || isIdentityMatrix(matrix)) continue;
    applyMatrix(ctx, tx, 'mesh.freezeTransforms', record.id, matrix);
    for (const child of childrenOf(tx, record)) {
      patchObject(tx, child, { placement: mat4Decompose(mat4Multiply(matrix, mat4Compose(child.placement))) });
    }
    tx.patch('meshes', record.id, { placement: next, pivot: apply4(matrix, ...record.pivot) });
  }
}

/** Every descendant mesh of a group (re-exported for the bounds' callers). */
export function meshesUnder(view: ReadView, record: ObjectRecord): MeshRecord[] {
  return descendantMeshes(view, record);
}
