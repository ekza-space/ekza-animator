import { expect, test } from '@playwright/test';
import { validatorErrors } from './helpers/g4-export';
import { buildLowpolyLad } from './helpers/m6a-aslp-script';
import { glbJson, readAccessor } from './helpers/m6a-model-content';
import { openModel } from './helpers/m6a-model';
import { call, expectKernelStarted, lastExport, runOk } from './helpers/test-api';

// AS-LP-S, part A "Character (static)" (M6A-SPEC §10.3; owner INT): the scripted twin of AS-LP-A replays the Part A
// steps in order (`helpers/m6a-aslp-script.ts`) and checks the result: ≤ 3,000 triangles; at least two loops at the
// elbows and knees, a shoulder ring and an armpit loop (the topology helper below reads vertex rings across the arm
// and leg segments); one material and one palette texture ≤ 128²; Mesh Check clean (no non-manifold, zero-area or
// loose elements); every off-seam vertex partnered within 1 mm; min Y = 0 ± 5 mm; transforms frozen; the operator log
// (`history().undo`) names each tool of Part A.

/** Every tool Part A names, by its history label. */
const TOOLS = [
  'Humanoid Guides',
  'Extrude',
  'Insert Edge Loop',
  'Multi-Cut',
  'Delete',
  'Combine',
  'Bridge',
  'Mirror',
  'Slide Edge',
  'Target Weld',
  'Flip Triangle Edge',
  'Bevel',
  'Set Normal Angle',
  'Assign Colour',
  'Freeze Transformations',
];

const BAD_CHECKS = /^(non-manifold|zero-area|zero-length|loose)/;

/** Distinct coordinates (1 mm) along `axis` shared by at least `size` vertices inside a window: the rings there. */
function rings(
  positions: readonly (readonly number[])[],
  axis: 0 | 1,
  from: number,
  to: number,
  size: number,
  where: (p: readonly number[]) => boolean,
): number[] {
  const lo = Math.min(from, to) + 1e-3;
  const hi = Math.max(from, to) - 1e-3;
  const buckets = new Map<number, number>();
  for (const p of positions) {
    const value = p[axis] ?? 0;
    if (value <= lo || value >= hi || !where(p)) continue;
    const key = Math.round(value * 1000);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets].filter(([, n]) => n >= size).map(([key]) => key / 1000);
}

test('AS-LP-S part A — the scripted Lowpoly Lad (static character)', async ({ page }) => {
  test.setTimeout(300_000);
  await openModel(page);
  await expectKernelStarted(page);
  const lad = await buildLowpolyLad(page);
  test.info().annotations.push({ type: 'AS-LP-A steps', description: lad.steps.join('\n') });
  const log = lad.steps.join('\n');

  // Mesh Check clean and the symmetry partners (1 mm) on both meshes; transforms frozen.
  for (const mesh of [lad.body, lad.head]) {
    const problems = (await call(page, 'meshCheck', mesh))
      .map((row) => row.code)
      .filter((code) => BAD_CHECKS.test(code));
    expect(problems, `${mesh} Mesh Check\n${log}`).toEqual([]);
    await runOk(page, 'model.symmetry.set', { meshes: [mesh], mode: 'object-x' });
    const symmetry = await call(page, 'symmetry', mesh);
    expect(symmetry?.tolerance, 'the partner tolerance').toBeLessThanOrEqual(0.001);
    expect(symmetry?.unmatched, `${mesh} unmatched`).toBe(0);
    const info = await call(page, 'meshInfo', mesh);
    expect(info?.stats.nonManifoldEdges).toBe(0);
    expect(info?.stats.nonManifoldVerts).toBe(0);
    expect(info?.stats.boundaryLoops).toBe(0);
  }

  // The operator log names each tool of Part A.
  const labels = new Set((await call(page, 'history')).undo);
  expect(
    TOOLS.filter((tool) => !labels.has(tool)),
    [...labels].join(', '),
  ).toEqual([]);

  // The static export (the Humanoid group is the root).
  await runOk(page, 'select.mode', { mode: 'object' });
  await runOk(page, 'file.exportModel', {
    objects: [lad.group],
    fileName: 'lowpoly-lad.glb',
    profile: 'local/generic',
  });
  const exported = await lastExport(page);
  if (exported === null) throw new Error('nothing exported');
  const bytes = new Uint8Array(exported.bytes);
  expect(await validatorErrors(bytes)).toEqual([]);
  const json = glbJson(bytes) as {
    nodes: { mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    meshes: { primitives: { indices?: number; attributes: Record<string, number> }[] }[];
    accessors: { count: number }[];
    materials?: unknown[];
    textures?: unknown[];
    images?: { bufferView?: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  let triangles = 0;
  const positions: number[][] = [];
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      triangles += (json.accessors[primitive.indices ?? primitive.attributes['POSITION'] ?? -1]?.count ?? 0) / 3;
      positions.push(...readAccessor(bytes, primitive.attributes['POSITION'] ?? -1));
    }
  }
  test.info().annotations.push({ type: 'AS-LP-A triangles', description: String(triangles) });
  expect(triangles).toBeLessThanOrEqual(3_000);
  expect(json.materials ?? []).toHaveLength(1);
  expect(json.textures ?? []).toHaveLength(1);
  // The palette texture: a PNG of at most 128 × 128 (IHDR width and height).
  const view = json.bufferViews[json.images?.[0]?.bufferView ?? -1];
  const bin = bytes.subarray(20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true) + 8);
  const png = bin.subarray(view?.byteOffset ?? 0, (view?.byteOffset ?? 0) + (view?.byteLength ?? 0));
  const ihdr = new DataView(png.buffer, png.byteOffset + 16, 8);
  expect(ihdr.getUint32(0)).toBeLessThanOrEqual(128);
  expect(ihdr.getUint32(4)).toBeLessThanOrEqual(128);
  // Transforms frozen: the mesh nodes carry no transform.
  for (const node of json.nodes.filter((n) => n.mesh !== undefined)) {
    expect(node.matrix).toBeUndefined();
    for (const [value, identity] of [
      [node.translation, [0, 0, 0]],
      [node.rotation, [0, 0, 0, 1]],
      [node.scale, [1, 1, 1]],
    ] as const) {
      if (value !== undefined) expect(value).toEqual(identity);
    }
  }
  // Grounded: min Y = 0 ± 5 mm.
  const minY = Math.min(...positions.map((p) => p[1] ?? 0));
  expect(Math.abs(minY)).toBeLessThanOrEqual(0.005);

  // The topology helper: rings of vertices across the arm (8-sided) and leg segments, on the +X side.
  const { elbow, knee, shoulder, armpit } = lad.landmarks;
  const arm = (p: readonly number[]): boolean => (p[0] ?? 0) > 0;
  expect(rings(positions, 0, elbow[0], elbow[1], 8, arm).length, 'elbow loops').toBeGreaterThanOrEqual(2);
  expect(rings(positions, 1, knee[0], knee[1], 6, arm).length, 'knee loops').toBeGreaterThanOrEqual(2);
  expect(rings(positions, 0, shoulder[0], shoulder[1], 8, arm).length, 'shoulder ring').toBeGreaterThanOrEqual(1);
  // Between the chest and the arm the bridge's middle ring and the armpit loop are not planar: count their vertices
  // (8 each) strictly inside the bridge.
  const bridge = positions.filter((p) => (p[0] ?? 0) > armpit[0] + 1e-3 && (p[0] ?? 0) < armpit[1] - 1e-3);
  expect(bridge.length, 'the bridge ring and the armpit loop').toBeGreaterThanOrEqual(16);
});
