// The Cube Lad (M6B-SPEC §0.7; C0, closed): a 1.70 m low-poly humanoid of 16 boxes, T-posed, X-symmetric, facing +Z,
// built in the editor from the design of fixtures/models/cube-lad-truth.json — one `mesh.create.cube` per box at its
// size, placed at its centre (`scene.object.transform`), then `mesh.combine` with the origin as pivot — so its points
// equal the points of fixtures/models/cube-lad.glb (tooling/make-mvp-fixtures.mjs) within 1e-6 m.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { createPrimitive, enterModel } from './m6a-model';
import { call, runOk } from './test-api';

export type Vec3 = readonly [number, number, number];

export interface CubeLadTruth {
  readonly height: number;
  readonly boxes: readonly { readonly name: string; readonly center: Vec3; readonly size: Vec3 }[];
  readonly markers: Readonly<Record<string, Vec3>>;
  readonly joints: Readonly<
    Record<string, { readonly position: Vec3; readonly parent: string | null; readonly tail: Vec3 | null }>
  >;
}

const fixture = (file: string): URL => new URL(`../../../../fixtures/models/${file}`, import.meta.url);

/** The design of the Cube Lad (boxes, truth markers, Standard 33 joints). */
export function cubeLadTruth(): CubeLadTruth {
  return JSON.parse(readFileSync(fixture('cube-lad-truth.json'), 'utf8')) as CubeLadTruth;
}

/** The welded points of fixtures/models/cube-lad.glb (POSITION, deduplicated), sorted. */
export function cubeLadGlbPoints(): Vec3[] {
  const bytes = readFileSync(fixture('cube-lad.glb'));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const bin = bytes.subarray(20 + jsonLength + 8);
  const accessor = json.accessors[json.meshes[0]?.primitives[0]?.attributes.POSITION ?? 0];
  if (accessor === undefined) throw new Error('cube-lad.glb has no POSITION');
  const view = json.bufferViews[accessor.bufferView] ?? {};
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const points: Vec3[] = [];
  for (let i = 0; i < accessor.count; i++) {
    const at = base + i * stride;
    points.push([bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)]);
  }
  return sortedUnique(points);
}

/** Points rounded to 1e-6 m, deduplicated and sorted (x, then y, then z). */
export function sortedUnique(points: readonly Vec3[]): Vec3[] {
  const round = (x: number): number => Math.round(x * 1e6) / 1e6 + 0;
  const unique = new Map<string, Vec3>();
  for (const p of points) {
    const q: Vec3 = [round(p[0]), round(p[1]), round(p[2])];
    unique.set(q.join(','), q);
  }
  return [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

/**
 * Builds the Cube Lad in Model and returns its mesh id (one combined scene mesh at identity placement). Leaves the
 * editor in Model with the Cube Lad selected.
 */
export async function buildCubeLad(page: Page): Promise<string> {
  if ((await call(page, 'state')).workspace !== 'model') await enterModel(page);
  const truth = cubeLadTruth();
  const meshes: string[] = [];
  for (const box of truth.boxes) {
    const mesh = await createPrimitive(page, 'cube', { width: box.size[0], height: box.size[1], depth: box.size[2] });
    await runOk(page, 'scene.object.transform', {
      ids: [mesh],
      placements: [{ t: [...box.center], q: [0, 0, 0, 1], s: [1, 1, 1] }],
    });
    meshes.push(mesh);
  }
  await runOk(page, 'select.objects', { ids: meshes, mode: 'replace' });
  await runOk(page, 'mesh.combine', { pivot: 'origin' });
  const rows = (await call(page, 'meshes')).filter((row) => row.owner === 'scene');
  expect(rows, 'one combined Cube Lad mesh').toHaveLength(1);
  const mesh = rows[0]?.id ?? '';
  await runOk(page, 'scene.rename', { id: mesh, name: 'Cube Lad' });
  return mesh;
}

/** The Cube Lad's welded points in world space as built in the editor, sorted (compare with `cubeLadGlbPoints`). */
export async function cubeLadPoints(page: Page, mesh: string): Promise<Vec3[]> {
  return sortedUnique((await call(page, 'meshPositions', mesh, undefined, 'world')) as unknown as Vec3[]);
}
