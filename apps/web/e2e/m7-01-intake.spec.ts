// M7 G-a (MODELING-PLAN §7.2, §7.3) in the browser: a 96,824-triangle textured AI-like model (procedural,
// `@ekza-studio/io/testing`: facing +X, one unit tall, a fragmented atlas) is imported into Model and cleaned by the
// intake preset — the chain runs in the intake worker (the meshoptimizer WASM loads there, never on the route) — to
// ≤ 3,000 triangles and ≤ 16 colours in one undo step, standing 1.70 m tall facing +Z, with no reported error. The
// worker's times are the §3.12 budget report (`m7ga` lines in the output). With `EKZA_M7GA_SHOTS` set to a folder the
// before/after screenshots of the perspective pane are written there too (always attached to the test).
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeAiLikeGlb } from '@ekza-studio/io/testing';
import { expect, type Page, test } from '@playwright/test';
import { call, expectKernelStarted, failOnReportedError, openEditor, run, runOk } from './helpers/test-api';

interface Outcome {
  readonly meshes: readonly string[];
  readonly palette: string | null;
  readonly triangles: { readonly before: number; readonly after: number };
  readonly colours: number | null;
  readonly steps: readonly { readonly kind: string; readonly ms: number; readonly facts: Record<string, unknown> }[];
  readonly worker: boolean;
  readonly ms: number;
}

/** Runs an operator whose args carry bytes (sent base64-encoded, rebuilt as a Uint8Array in the page). */
async function runWithBytes(page: Page, op: string, args: Record<string, unknown>, bytes: Uint8Array) {
  const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  return page.evaluate(
    async ([id, rest, data]) => {
      const binary = atob(data);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
      const api = window.__EKZA_STUDIO_TEST__;
      if (api === undefined) throw new Error('no test API');
      return api.run(id, { ...rest, bytes: array });
    },
    [op, args, base64] as const,
  );
}

async function shot(page: Page, name: string, framed = true): Promise<Buffer> {
  // Without the wire overlay (at 97k triangles it hides the texture) and framed on the model.
  await runOk(page, 'view.display.set', { patch: { wireOnShaded: false }, paneId: 'pane-persp' });
  if (framed) await runOk(page, 'view.frame', { what: 'all', paneId: 'pane-persp' });
  // The model's texture decodes asynchronously: give the frame time to show it.
  await page.waitForTimeout(1500);
  const image = await page.screenshot();
  return save(name, image);
}

function save(name: string, image: Buffer): Buffer {
  const folder = process.env['EKZA_M7GA_SHOTS'];
  if (folder !== undefined && folder !== '') {
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${folder}/${name}.png`, image);
  }
  return image;
}

/** Frames the arm on +X (the faces whose centre lies beyond the shoulder), then returns to object mode. */
async function frameArm(page: Page, mesh: string): Promise<void> {
  const positions = await call(page, 'meshPositions', mesh);
  const faces = await call(page, 'meshFaces', mesh);
  const arm = faces.flatMap((face, f) => {
    const x = face.reduce((sum, v) => sum + ((positions[v] as number[])[0] as number), 0) / face.length;
    return x > 0.35 ? [f] : [];
  });
  expect(arm.length).toBeGreaterThan(20);
  await runOk(page, 'model.hilite', { meshes: [mesh], mode: 'replace' });
  await runOk(page, 'select.mode', { mode: 'face' });
  await runOk(page, 'select.components', { mesh, kind: 'face', indices: arm, mode: 'replace' });
  await runOk(page, 'view.frame', { what: 'selection', paneId: 'pane-persp' });
  await runOk(page, 'select.components', { mesh, kind: 'face', indices: [], mode: 'replace' });
  await runOk(page, 'select.mode', { mode: 'object' });
}

test('M7 G-a: the intake preset cleans an AI-like model in the intake worker (≤ 3k triangles, ≤ 16 colours)', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const model = makeAiLikeGlb();
  await openEditor(page);
  await expectKernelStarted(page);
  await runOk(page, 'workspace.set', { workspace: 'model' });
  const imported = await runWithBytes(page, 'mesh.importStatic', { name: 'generated.glb' }, model);
  expect(imported.status).toBe('finished');
  const meshes = (imported as { value: { meshes: string[] } }).value.meshes;
  await testInfo.attach('ga-before', { body: await shot(page, 'ga-before'), contentType: 'image/png' });

  const outcome = await runOk<Outcome>(page, 'mesh.intake', { meshes, preset: 'character', forward: '+x' });
  expect(outcome.worker).toBe(true);
  expect(outcome.triangles.before).toBe(96_824);
  expect(outcome.triangles.after).toBeLessThanOrEqual(3000);
  expect(outcome.colours).toBeLessThanOrEqual(16);
  expect(outcome.steps.map((step) => step.kind)).toEqual(['normalize', 'reduce', 'quadrangulate', 'paletteBake']);
  const history = await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.history());
  expect(history?.undo.at(-1)).toBe('Intake');
  await testInfo.attach('ga-after', { body: await shot(page, 'ga-after'), contentType: 'image/png' });
  // The palette bake never reads the atlas background (black between the 241 charts): no face is near-black on the
  // arm, and the close-up shows it.
  const bake = outcome.steps.find((step) => step.kind === 'paletteBake');
  expect(bake?.facts['backgroundSamples']).toBeGreaterThan(0);
  await frameArm(page, meshes[0] as string);
  await testInfo.attach('ga-after-arm', { body: await shot(page, 'ga-after-arm', false), contentType: 'image/png' });
  const shading = await call(page, 'shading', meshes[0] as string);
  testInfo.annotations.push({ type: 'm7ga-shading', description: JSON.stringify(shading) });
  process.stdout.write(`m7ga shading after intake: ${JSON.stringify(shading)}; bake ${JSON.stringify(bake?.facts)}\n`);
  const report = `m7ga browser worker: ${outcome.steps.map((s) => `${s.kind} ${s.ms.toFixed(1)} ms`).join(', ')}; chain ${outcome.ms.toFixed(1)} ms`;
  testInfo.annotations.push({ type: 'm7ga-budget', description: report });
  process.stdout.write(`${report}\n`);

  // The same model reduced alone (100k → 3k in the worker): the §3.12 budget line.
  // Back to the import: undo the arm framing's selection steps (Model records selections) and the intake.
  for (let guard = 0; guard < 20; guard++) {
    const steps = await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.history().undo ?? []);
    const top = steps.at(-1);
    await runOk(page, 'edit.undo');
    if (top === 'Intake') break;
  }
  const reduced = await runOk<Outcome>(page, 'mesh.reduce', { meshes, preset: 'character' });
  expect(reduced.worker).toBe(true);
  const reduceLine = `m7ga browser worker reduce 96,824 → ${reduced.triangles.after}: ${reduced.ms.toFixed(1)} ms`;
  testInfo.annotations.push({ type: 'm7ga-budget', description: reduceLine });
  process.stdout.write(`${reduceLine}\n`);

  // Nothing is left broken: a refused run says why, and no error was reported.
  const refused = await run(page, 'mesh.reduce', { meshes, preset: 'hero' });
  expect(refused.status).toBe('cancelled');
  await failOnReportedError(page);
});
