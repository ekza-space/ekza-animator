// E2E-MOD-12 (M6A-SPEC §10.1; B8): Make editable on Polybot. The sample's body is listed as a virtual `asset` row
// with its derived id; `mesh.makeEditable` creates the record under that id (badge `edit`) holding the welded body;
// the synthetic prohibited-modification VRM is refused with a reason and gets no record. The loop-and-export part
// inserts an edge loop on the forearm (B3's `mesh.insertLoop`) and bakes into the model: validator 0 errors,
// untouched JSON and BIN prefix, new vertices weighted between their edge's endpoints and every morph target with
// NORMAL; it is gated on B3 (§10.1 Gates column) and reads the body through B7's mesh test API. A last B8 check (not
// part of E2E-MOD-12, gated on B7's primitives) reads a static export back through three.js in the page and finds it
// in lastExport().
import { readFileSync } from 'node:fs';
import { derivedId } from '@ekza-studio/doc';
import { expect, test } from '@playwright/test';
import { exportOne, readGlb, sampleBytes, validatorErrors } from './helpers/g4-export';
import { accessorValues as values, bodyOf, changedValues, dot, forearmRingEdge, type Json } from './helpers/m6a-bake';
import { seedSample, seedWaveClip } from './helpers/seed';
import {
  call,
  expectKernelStarted,
  lastExport,
  loadFile,
  openEditor,
  run,
  runOk,
  waitForCount,
} from './helpers/test-api';

const PROHIBITED = new URL('../../../fixtures/synthetic/prohibited-modification.vrm', import.meta.url);

/** Polybot's body made editable: io's weld of its 1,722 glTF vertices (pinned by io's mesh-from-gltf tests). */
const POLYBOT_BODY = { v: 1184, e: 3260, f: 2130, c: 6390, tris: 2130 } as const;

test('E2E-MOD-12: Make editable on Polybot (derived id, badge edit) and the licence refusal', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  const id = derivedId('mesh', 'asset', [character], '', 0);
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === id) ?? null, { timeout: 30_000 })
    .toMatchObject({ badge: 'asset', manifest: null, runtime: 'none', owner: `char:${character}` });

  const made = await runOk<{ mesh: string }>(page, 'mesh.makeEditable', { character, meshIndex: 0 });
  expect(made.mesh).toBe(id);
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === id)?.runtime, { timeout: 30_000 })
    .toBe('ready');
  const row = (await call(page, 'meshes')).find((candidate) => candidate.id === id);
  expect(row).toMatchObject({ badge: 'edit', rev: 1, faceted: false, generator: null });
  // The record holds the welded body: its counts, and a mesh the kernel validates without problems.
  const info = await call(page, 'meshInfo', id);
  expect(info?.counts).toEqual(POLYBOT_BODY);
  expect(info?.problems).toBe(0);
  expect(info?.layers).toEqual(expect.arrayContaining(['uv0', 'normal.custom', 'skin.joints', 'skin.weights']));
  // No virtual row is left for the body.
  expect((await call(page, 'meshes')).filter((candidate) => candidate.badge === 'asset')).toEqual([]);

  // The prohibited-modification VRM: refused with a reason, no record.
  await loadFile(page, 'prohibited-modification.vrm', new Uint8Array(readFileSync(PROHIBITED)), { auto: true });
  await waitForCount(page, 'characters', 2);
  const other = (await call(page, 'characters')).find((candidate) => candidate.id !== character)?.id ?? '';
  const otherId = derivedId('mesh', 'asset', [other], '', 0);
  await expect
    .poll(async () => (await call(page, 'meshes')).find((candidate) => candidate.id === otherId)?.badge ?? null, {
      timeout: 30_000,
    })
    .toBe('asset');
  const refused = await run(page, 'mesh.makeEditable', { character: other, meshIndex: 0 });
  expect(refused.status).toBe('cancelled');
  expect(refused.status === 'cancelled' ? refused.reason : '').toMatch(/modification/);
  const records = (await call(page, 'meshes')).filter((candidate) => candidate.badge !== 'asset');
  expect(records.map((candidate) => candidate.id)).toEqual([id]);
});

// ---------- the loop-and-export part (B3) ----------

test('E2E-MOD-12 (loop and export): bake an edge loop on the forearm into Polybot', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { character, clip } = await seedWaveClip(page, 'polybot');
  const id = derivedId('mesh', 'asset', [character], '', 0);
  await runOk(page, 'mesh.makeEditable', { character, meshIndex: 0 });
  const body = await bodyOf(page, id);
  const before = readGlb(sampleBytes('polybot.vrm'));
  const seedEdge = forearmRingEdge(body, before.json);
  // A scripted kernel-op run outside a component mode names its kind (§4.6 `MeshOpArgs.kind`, as E2E-MOD-09 does).
  await runOk(page, 'mesh.insertLoop', { meshes: [id], kind: 'edge', seedEdge, weight: 0.5 });
  const baked = await exportOne(page, { kind: 'bake-into-model', character, clips: [clip] });
  expect(await validatorErrors(baked.bytes)).toEqual([]);
  const after = readGlb(baked.bytes);
  expect(changedValues(before.json, after.json)).toEqual([]);
  // The BIN prefix is byte-identical up to the baseline length.
  const marker = ((after.json['asset'] as Json)['extras'] as Json)['ekza_animator_bake_v2'] as Json;
  expect(marker).toMatchObject({ version: 2 });
  const baseBinLength = marker['baseBinLength'] as number;
  const prefix = (bin: Uint8Array): Buffer => Buffer.from(bin.subarray(0, baseBinLength));
  expect(Buffer.compare(prefix(after.bin), prefix(before.bin))).toBe(0);

  // New vertices: weights sum to 1 and lie between their edge endpoints' weights (union of joints).
  const meshes = after.json['meshes'] as Json[];
  const primitive = ((meshes[0]?.['primitives'] ?? []) as Json[])[0] as Json;
  const attributes = primitive['attributes'] as Record<string, number>;
  const position = values(after, attributes['POSITION'] ?? -1);
  const joints = values(after, attributes['JOINTS_0'] ?? -1);
  const weights = values(after, attributes['WEIGHTS_0'] ?? -1);
  const count = position.length / 3;
  const key = (p: readonly number[]): string => p.map((c) => Math.fround(c)).join(',');
  const known = new Set(body.positions.map(key));
  const weightOf = (point: number, joint: number): number => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (body.joints[point]?.[k] === joint) w += body.weights[point]?.[k] ?? 0;
    return w;
  };
  let added = 0;
  for (let v = 0; v < count; v++) {
    const sum = [0, 1, 2, 3].reduce((total, k) => total + (weights[4 * v + k] ?? 0), 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    const p = [position[3 * v] ?? 0, position[3 * v + 1] ?? 0, position[3 * v + 2] ?? 0];
    if (known.has(key(p))) continue;
    added++;
    // The original edge the new vertex lies on.
    const edge = body.edges.findIndex(([i, j]) => {
      const pa = body.positions[i] ?? [];
      const pb = body.positions[j] ?? [];
      const ab = [0, 1, 2].map((k) => (pb[k] ?? 0) - (pa[k] ?? 0));
      const ap = [0, 1, 2].map((k) => (p[k] ?? 0) - (pa[k] ?? 0));
      const t = dot(ap, ab) / dot(ab, ab);
      return t > 0 && t < 1 && Math.hypot(...ap.map((c, k) => c - t * (ab[k] ?? 0))) < 1e-5;
    });
    expect(edge, `vertex ${v} lies on an original edge`).toBeGreaterThanOrEqual(0);
    const [a, b] = body.edges[edge] ?? [0, 0];
    for (const joint of new Set([...(body.joints[a] ?? []), ...(body.joints[b] ?? [])])) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (joints[4 * v + k] === joint) w += weights[4 * v + k] ?? 0;
      expect(w).toBeGreaterThanOrEqual(Math.min(weightOf(a, joint), weightOf(b, joint)) - 1e-6);
      expect(w).toBeLessThanOrEqual(Math.max(weightOf(a, joint), weightOf(b, joint)) + 1e-6);
    }
  }
  expect(added).toBeGreaterThan(0);

  // Every morph target that had NORMAL still has it, with the primitive's vertex count and finite values.
  for (const target of primitive['targets'] as Record<string, number>[]) {
    expect(target['NORMAL']).toBeDefined();
    const normal = values(after, target['NORMAL'] ?? -1);
    expect(normal.length).toBe(3 * count);
    expect(normal.every(Number.isFinite)).toBe(true);
  }
});

// ---------- B8's static export in the browser (§6.2 `file.exportModel`, §4.8 `lastExport()`) ----------

// Needs a scene mesh, which B7's `mesh.create.cube` creates (a stub until B7 lands): the export is read back through
// three.js's GLTFLoader in the page (the display loader), and lastExport() reports it with its lints and read-back.
test('file.exportModel in the browser: the three.js read-back and lastExport()', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { mesh: cube } = await runOk<{ mesh: string }>(page, 'mesh.create.cube');
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === cube)?.runtime, { timeout: 30_000 })
    .toBe('ready');
  const download = page.waitForEvent('download', { timeout: 60_000 });
  const result = await run(page, 'file.exportModel', {
    objects: [cube],
    fileName: 'cube.glb',
    profile: 'local/generic',
  });
  expect(result.status).toBe('finished');
  expect((await download).suggestedFilename()).toBe('cube.glb');
  const last = await page.evaluate(() => {
    const value = window.__EKZA_ANIMATOR_TEST__?.lastExport() ?? null;
    return value === null ? null : { fileName: value.fileName, lints: value.lints, readBack: value.readBack };
  });
  expect(last).toMatchObject({
    fileName: 'cube.glb',
    readBack: {
      ok: true,
      kind: 'static',
      meshes: 1,
      primitives: 1,
      triangles: 12,
      three: { ok: true, primitives: 1, triangles: 12 },
    },
  });
  expect((last?.lints ?? []).filter((lint) => (lint as { severity?: string }).severity === 'error')).toEqual([]);
  const bytes = (await lastExport(page))?.bytes;
  expect(bytes).toBeDefined();
  expect(await validatorErrors(new Uint8Array(bytes ?? []))).toEqual([]);
});
