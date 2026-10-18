// E2E-16 (bake into model) and E2E-17 (VRMA), MVP-SPEC §6.2, serial (E2E-17 exports the clip E2E-16 built):
// Seed-san with the wave clip on `fk.lowerArm.L` (rz 30°/−30°/30° at 0/15/30, `channel.setValues` + `key.set`).
// E2E-16 bakes it into the model: the download is a `.vrm` with no new validator errors, the original BIN prefix,
// `extensions.VRMC_vrm` unchanged and an animation `wave`, and the file imports back with rz(15) = −30°.
// E2E-17 writes a VRMA: it validates, declares VRMC_vrm_animation and, played by three-vrm-animation on Seed-san and
// Polybot (/e2e/vrma-check), gives the editor's normalized rotations (`flipYaw` on the VRM 0.x Polybot, §4.11.9).
import { type Browser, expect, type Page, type TestInfo, test } from '@playwright/test';
import {
  boneWorldRotations,
  type ExportedFile,
  exportOne,
  flipYaw,
  humanLocalFromWorlds,
  newValidatorErrors,
  type Quat,
  qangle,
  readGlb,
  sampleBytes,
  validatorErrors,
} from './helpers/g4-export';
import { controlId, seedWaveClip, type WaveSeed } from './helpers/seed';
import { call, expectKernelStarted, loadFile, openEditor, runOk } from './helpers/test-api';

const DEG = Math.PI / 180;
/** E2E-17 plays the VRMA at 10 frames over the wave (incl. the extreme at 15). */
const CHECK_FRAMES = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27] as const;

test.describe.configure({ mode: 'serial' });

let page: Page;
let seed: WaveSeed;

/** A page with the project's context options (viewport, scale, base URL): serial specs share one across tests. */
async function newProjectPage(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    ...(use.baseURL === undefined ? {} : { baseURL: use.baseURL }),
    ...(use.viewport === undefined ? {} : { viewport: use.viewport }),
    ...(use.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: use.deviceScaleFactor }),
  });
  return context.newPage();
}

test.beforeAll(async ({ browser }, testInfo) => {
  page = await newProjectPage(browser, testInfo);
});

test.afterAll(async () => {
  await page.context().close();
});

test('E2E-16: export, bake into model', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await expectKernelStarted(page);
  seed = await seedWaveClip(page, 'seed-san');

  const baked = await exportOne(page, { kind: 'bake-into-model', character: seed.character, clips: [seed.clip] });
  expect(baked.name).toMatch(/\.vrm$/);

  const source = sampleBytes('seed-san.vrm');
  expect(await newValidatorErrors(source, baked.bytes)).toEqual([]);

  // §4.11.11 rule 1: BIN bytes [0, align4(baseBinLength)) are kept verbatim; the clip is appended after them.
  const before = readGlb(source);
  const after = readGlb(baked.bytes);
  const baseBinLength = before.json.buffers?.[0]?.byteLength ?? 0;
  expect(baseBinLength).toBe(10_783_033);
  const appendOffset = Math.ceil(baseBinLength / 4) * 4;
  expect(after.bin.byteLength).toBeGreaterThan(appendOffset);
  expect(Buffer.compare(after.bin.subarray(0, appendOffset), before.bin.subarray(0, appendOffset))).toBe(0);
  expect(after.json.extensions?.['VRMC_vrm']).toEqual(before.json.extensions?.['VRMC_vrm']);
  expect((after.json.animations ?? []).map((animation) => animation.name)).toContain('wave');

  // Reload the file in a fresh editor: the clip `wave` comes back with rz(15) = −30°.
  const reload = await newProjectPage(browser, testInfo);
  try {
    await openEditor(reload);
    await loadFile(reload, baked.name, baked.bytes, { auto: true });
    await expect.poll(async () => (await call(reload, 'counts'))['characters']).toBe(1);
    const character = (await call(reload, 'characters'))[0]?.id ?? '';
    const wave = (await call(reload, 'clips', character)).find((clip) => clip.name === 'wave');
    expect(wave, 'the imported clip wave').toBeDefined();
    await runOk(reload, 'clip.setActive', { clip: wave?.id });
    const lowerArm = await controlId(reload, 'fk.lowerArm.L', character);
    const values = await call(reload, 'channelValues', lowerArm, 15);
    expect(Math.abs((values['rz'] ?? Number.NaN) - -30 * DEG)).toBeLessThan(1e-4);
  } finally {
    await reload.context().close();
  }
});

test('E2E-17: export, VRMA', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(seed === undefined, 'E2E-16 did not build the wave clip');

  const vrma = await exportOne(page, { kind: 'vrma', character: seed.character, clips: [seed.clip] });
  expect(vrma.name).toMatch(/\.vrma$/);
  expect(await validatorErrors(vrma.bytes)).toEqual([]);
  const { json } = readGlb(vrma.bytes);
  expect(json.extensionsUsed ?? []).toContain('VRMC_vrm_animation');

  // The editor's normalized rotations (humanLocal, §4.11.9) at the check frames, from its bone worlds: the clip
  // being played against the character's empty default clip (rest).
  const reference = await humanLocalAt(page, seed, CHECK_FRAMES);
  expect(qangle(reference[CHECK_FRAMES.indexOf(15)]?.['leftLowerArm'] ?? [0, 0, 0, 1], [0, 0, 0, 1])).toBeCloseTo(
    30 * DEG,
    3,
  );

  // Played by three-vrm-animation on Seed-san and Polybot.
  const clip = (await call(page, 'clips', seed.character)).find((candidate) => candidate.id === seed.clip);
  const times = CHECK_FRAMES.map((frame) => (frame - (clip?.start ?? 0)) / (clip?.fps ?? 30));
  const played = await playOnCheckPage(browser, testInfo, vrma, times);
  const vrmaBones = Object.keys(
    (json.extensions?.['VRMC_vrm_animation'] as { humanoid?: { humanBones?: object } } | undefined)?.humanoid
      ?.humanBones ?? {},
  );
  expect(Object.entries(played).map(([model, result]) => [model, result.metaVersion])).toEqual([
    ['seed-san', '1'],
    ['polybot', '0'],
  ]);
  for (const [model, result] of Object.entries(played)) {
    const shared = vrmaBones.filter((bone) => result.bones.includes(bone));
    expect(shared.length, `${model}: bones in both`).toBeGreaterThan(20);
    let maxError = 0;
    let worst = '';
    result.samples.forEach((sample, i) => {
      for (const bone of shared) {
        const n = reference[i]?.[bone];
        const got = sample.rotations[bone];
        if (n === undefined || got === undefined) throw new Error(`${model}: no rotation of ${bone}`);
        const error = qangle(got, result.metaVersion === '0' ? flipYaw(n) : n);
        if (error > maxError) [maxError, worst] = [error, `${bone} at frame ${CHECK_FRAMES[i]}`];
      }
    });
    test.info().annotations.push({
      type: 'vrma-check',
      description: `${model}: ${shared.length} bones × ${result.samples.length} frames, max error ${maxError.toExponential(2)} rad (${worst})`,
    });
    expect(maxError, `${model} (VRM ${result.metaVersion}): max error at ${worst}`).toBeLessThan(1e-3);
  }
});

/** `humanLocal` of the wave clip's character at `frames`, derived from `boneWorld` (rest: its empty default clip). */
async function humanLocalAt(editor: Page, wave: WaveSeed, frames: readonly number[]): Promise<Record<string, Quat>[]> {
  const vrm = readGlb(sampleBytes('seed-san.vrm')).json.extensions?.['VRMC_vrm'] as
    | { humanoid: { humanBones: Record<string, unknown> } }
    | undefined;
  const bones = Object.keys(vrm?.humanoid.humanBones ?? {});
  expect(bones).toContain('hips');
  const worlds = await boneWorldRotations(editor, wave.character, bones, frames);
  const empty = (await call(editor, 'clips', wave.character)).find((clip) => clip.id !== wave.clip);
  if (empty === undefined) throw new Error('the character has no clip besides wave');
  expect((await call(editor, 'curves', empty.id)).every((curve) => curve.keys.length === 0)).toBe(true);
  await runOk(editor, 'clip.setActive', { clip: empty.id });
  const [rest] = await boneWorldRotations(editor, wave.character, bones, [0]);
  await runOk(editor, 'clip.setActive', { clip: wave.clip });
  if (rest === undefined) throw new Error('no rest worlds');
  return worlds.map((world) => humanLocalFromWorlds(world, rest));
}

interface CheckResult {
  readonly metaVersion: '0' | '1';
  readonly bones: readonly string[];
  readonly samples: readonly { readonly time: number; readonly rotations: Readonly<Record<string, Quat>> }[];
}

/** Opens /e2e/vrma-check, waits for Seed-san and Polybot, plays the VRMA at `times` and returns the rotations. */
async function playOnCheckPage(
  browser: Browser,
  testInfo: TestInfo,
  vrma: ExportedFile,
  times: readonly number[],
): Promise<Record<string, CheckResult>> {
  const check = await newProjectPage(browser, testInfo);
  try {
    await check.goto('/e2e/vrma-check');
    await check.waitForFunction(() => window.__EKZA_VRMA_CHECK__ !== undefined);
    await check.evaluate(async () => {
      await window.__EKZA_VRMA_CHECK__?.ready;
    });
    await expect(check.getByTestId('vrma-check-status')).toHaveText(/^Ready/);
    const base64 = Buffer.from(vrma.bytes).toString('base64');
    return await check.evaluate(
      async ([data, at]) => {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const api = window.__EKZA_VRMA_CHECK__;
        if (api === undefined) throw new Error('no VRMA check API');
        return api.play(bytes, at);
      },
      [base64, times] as const,
    );
  } finally {
    await check.context().close();
  }
}

declare global {
  interface Window {
    __EKZA_VRMA_CHECK__?: {
      readonly ready: Promise<void>;
      play(vrma: Uint8Array, times: readonly number[]): Promise<Record<string, CheckResult>>;
    };
  }
}
