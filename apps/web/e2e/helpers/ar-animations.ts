// Auto-Rig ④ Animations e2e helpers (AUTORIG-SPEC §10 D5, E2E-AR-06): reach ④ with a character — the Cube Lad loaded
// at ① through `?sample=` (the wizard's subject), then made a character with the operators D4's step runs
// (`skel.quickRig.commit` with the truth markers, `skin.bind`; D4's UI is not merged at D5's merge, §11 "merge-time
// parts"), or the Polybot VRM sample, which ① routes straight to ④ — and read the clips of the character, their
// exported `ekza_animation_v1` metadata (slot, loop, tags, root motion) and bone worlds of the shipped playback.
import { expect, type Page } from '@playwright/test';
import { openAutoRigReady } from './ar-host';
import { autorig } from './autorig';
import { cubeLadTruth } from './m6b-cube-lad';
import { call, run, runOk } from './test-api';

const DEG = Math.PI / 180;

/** Waits for ④ with its library grid shown. */
export async function waitForAnimations(page: Page): Promise<void> {
  await expect.poll(async () => (await autorig(page))?.step, { timeout: 30_000 }).toBe('animations');
  await expect(page.getByTestId('ar-anim-grid')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ar-clip-card-walk')).toBeVisible();
}

/** The subject character id (the session's, or the model character Create Skeleton made of the subject meshes). */
export async function subjectCharacter(page: Page): Promise<string> {
  const state = await autorig(page);
  if (state?.subject.character !== null && state?.subject.character !== undefined) return state.subject.character;
  const characters = await call(page, 'characters');
  const model = characters.find((c) => c.source === 'model');
  if (model === undefined) throw new Error('no character');
  return model.id;
}

/**
 * ④ with the rigged Cube Lad: `?sample=cube-lad` (① sets the subject), then Quick Rig's commit with the truth markers
 * (Standard 33) and Bind Skin as operator runs, then Alt+4. Returns the character.
 */
export async function animationsWithCubeLad(page: Page, query = ''): Promise<string> {
  await openAutoRigReady(page, `&sample=cube-lad${query}`);
  await expect
    .poll(async () => (await autorig(page))?.subject.meshes.length ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const meshes = (await autorig(page))?.subject.meshes ?? [];
  await runOk(page, 'workspace.set', { workspace: 'rig' });
  await runOk(page, 'skel.quickRig.commit', {
    preset: 'standard33',
    markers: cubeLadTruth().markers,
    meshes,
    flexion: 2 * DEG,
  });
  await runOk(page, 'skin.bind', {});
  await expect.poll(async () => (await autorig(page))?.reachable['animations'], { timeout: 30_000 }).toBe(true);
  await page.keyboard.press('Alt+Digit4');
  await waitForAnimations(page);
  return subjectCharacter(page);
}

/** ④ with the Polybot VRM sample (① routes an already rigged avatar to ④, AS-AR-4). Returns the character. */
export async function animationsWithVrm(page: Page): Promise<string> {
  await openAutoRigReady(page, '&sample=polybot');
  await waitForAnimations(page);
  return subjectCharacter(page);
}

/** The character's clips (test API). */
export function clipsOf(page: Page, character: string) {
  return call(page, 'clips', character);
}

/** The character's clip named `name`. */
export async function clipNamed(page: Page, character: string, name: string) {
  const clip = (await clipsOf(page, character)).find((c) => c.name === name);
  if (clip === undefined) throw new Error(`no clip ${name}`);
  return clip;
}

/** The `ekza_animation_v1` clip entry of a GLB/VRMA (its JSON chunk). */
function animationMeta(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as {
    asset: { extras?: { ekza_animation_v1?: { clips: Record<string, unknown>[] } } };
  };
  const clip = json.asset.extras?.ekza_animation_v1?.clips[0];
  if (clip === undefined) throw new Error('no ekza_animation_v1 clip');
  return clip;
}

/** A clip's exported metadata (the shipped VRMA export): slot, loop, tags, root motion, provenance. */
export async function exportedMeta(
  page: Page,
  character: string,
  clip: string,
): Promise<{
  slot: string | null;
  loop: boolean;
  tags: string[];
  rootMotion: string;
  derivedFrom: { title: string; author: string; license: string; sourceSha256: string | null }[];
}> {
  const result = await run(page, 'file.export', {
    kind: 'vrma',
    character,
    clips: [clip],
    fileNamePattern: '{clip}',
    closeLoop: false,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
  });
  expect(result.status, JSON.stringify(result)).toBe('finished');
  const base64 = await page.evaluate(() => {
    const last = window.__EKZA_STUDIO_TEST__?.lastExport();
    if (last === null || last === undefined) return null;
    let binary = '';
    for (const byte of last.bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  if (base64 === null) throw new Error('no export');
  return animationMeta(new Uint8Array(Buffer.from(base64, 'base64'))) as never;
}

/** World position of a humanoid bone of the character's active clip at a clip frame (the shipped playback). */
export async function boneAt(page: Page, character: string, bone: string, frame: number): Promise<number[]> {
  return (await call(page, 'boneWorld', character, bone, frame)).t;
}

/** The preview the library plays (null when none). */
export async function libraryPreview(page: Page): Promise<{ clip: string; seconds: number } | null> {
  return (await call(page, 'library'))?.preview ?? null;
}

/** The app's Mod key for this page (the host's platform detection: the Desktop Chrome device reports Windows). */
export function modKey(page: Page): Promise<'Meta' | 'Control'> {
  return page.evaluate(() => {
    const data = (navigator as Navigator & { readonly userAgentData?: { readonly platform?: string } }).userAgentData;
    return /mac|iphone|ipad|ipod/i.test(data?.platform ?? navigator.platform ?? '') ? 'Meta' : 'Control';
  });
}
