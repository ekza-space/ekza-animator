import { expect, type Page, test } from '@playwright/test';
import { buildHumanoid } from './helpers/m6a-humanoid-script';
import { MODEL_PANE, openModel } from './helpers/m6a-model';
import { call, lastExport, runOk } from './helpers/test-api';
import { validatorErrors } from './helpers/g4-export';

// E2E-MOD-15 "Scripted low-poly humanoid" (M6A-SPEC §10.1; owner INT): research 10 §7's base-tool sequence through
// operators only (`helpers/m6a-humanoid-script.ts`), run twice in fresh pages: ≤ 3,000 triangles, closed, manifold,
// no winding or manifold problem in Mesh Check, the same V/E/F and manifest on both runs; the exported static GLB
// loads in three.js (/e2e/model-check) with the HUD's triangle count.

interface Built {
  readonly mesh: string;
  readonly counts: { v: number; e: number; f: number; c: number; tris: number };
  readonly manifest: string;
  readonly steps: readonly string[];
}

async function build(page: Page): Promise<Built> {
  await openModel(page);
  const { mesh, steps } = await buildHumanoid(page);
  const info = await call(page, 'meshInfo', mesh);
  if (info === null) throw new Error('no humanoid mesh');
  return { mesh, counts: info.counts, manifest: info.manifest, steps };
}

test('E2E-MOD-15 — scripted low-poly humanoid', async ({ page, context }) => {
  test.setTimeout(240_000);
  const first = await build(page);
  test.info().annotations.push({ type: 'humanoid steps', description: first.steps.join('; ') });
  test.info().annotations.push({
    type: 'humanoid counts',
    description: `${first.counts.v}/${first.counts.e}/${first.counts.f}, ${first.counts.tris} triangles`,
  });

  // ≤ 3,000 triangles; closed; manifold; Mesh Check without winding or manifold problems.
  const info = await call(page, 'meshInfo', first.mesh);
  const log = first.steps.join('\n');
  expect(first.counts.tris, log).toBeLessThanOrEqual(3_000);
  expect(info?.stats.boundaryLoops, log).toBe(0);
  expect(info?.stats.nonManifoldEdges, log).toBe(0);
  expect(info?.stats.nonManifoldVerts, log).toBe(0);
  const problems = (await call(page, 'meshCheck', first.mesh)).map((row) => row.code);
  expect(problems.filter((code) => code === 'inconsistent-winding' || code.startsWith('non-manifold'))).toEqual([]);
  // Symmetric again after Mirror: every off-seam vertex has its partner.
  await runOk(page, 'model.symmetry.set', { meshes: [first.mesh], mode: 'object-x' });
  await expect.poll(async () => (await call(page, 'symmetry', first.mesh))?.unmatched).toBe(0);

  // The same script in a fresh page builds the same mesh.
  const again = await context.newPage();
  const second = await build(again);
  expect(second.counts).toEqual(first.counts);
  expect(second.manifest).toBe(first.manifest);
  await again.close();

  // The static GLB: valid, and three.js reads the HUD's triangle count.
  await runOk(page, 'select.mode', { mode: 'object' });
  await runOk(page, 'file.exportModel', { objects: [first.mesh], fileName: 'humanoid.glb', profile: 'local/generic' });
  const exported = await lastExport(page);
  if (exported === null) throw new Error('nothing exported');
  const bytes = new Uint8Array(exported.bytes);
  expect(await validatorErrors(bytes)).toEqual([]);
  const hud = await call(page, 'hud', MODEL_PANE);
  expect(hud?.scene['tris']).toBe(first.counts.tris);
  const reader = await context.newPage();
  await reader.goto('/e2e/model-check');
  await reader.waitForFunction(() => window.__EKZA_MODEL_CHECK__ !== undefined);
  const read = await reader.evaluate(async (base64) => {
    const binary = atob(base64);
    const glb = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) glb[i] = binary.charCodeAt(i);
    return (await window.__EKZA_MODEL_CHECK__?.read(glb)) ?? null;
  }, Buffer.from(bytes).toString('base64'));
  expect(read?.triangles).toBe(hud?.scene['tris']);
  expect(read?.meshes).toHaveLength(1);
  await reader.close();
});

declare global {
  interface Window {
    __EKZA_MODEL_CHECK__?: {
      read(glb: Uint8Array): Promise<{
        readonly meshes: readonly { readonly name: string; readonly triangles: number; readonly vertices: number }[];
        readonly triangles: number;
        readonly materials: number;
        readonly textures: number;
      }>;
    };
  }
}
