// Auto-Rig D6 e2e helpers (AUTORIG-SPEC §10 D6, E2E-AR-07): a character built for ⑤ — a sample loaded through ①'s
// UI, then the Studio operators the later steps compose (D4's `autorig.rig` and D5's `autorig.clip.add` land
// separately): `skel.quickRig.commit` with the truth markers, `skin.bind`, the library's clips by `library.useClip`
// — the ⑤ step reached through the stepper, *Download* captured as a browser download, and the §5.6.1 requests that
// Studio's own export operators take for the same file (FR-AR-12).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_EXPORT_REDUCE } from '@ekza-studio/io';
import { expect, type Page } from '@playwright/test';
import { openAutoRigReady } from './ar-host';
import { waitForReport } from './ar-model';
import { autorig, history } from './autorig';
import { cubeLadTruth } from './m6b-cube-lad';
import { call, runOk } from './test-api';

const DEG = Math.PI / 180;

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The export column's check row (`tpose`, `meta`, `size`, … or an uncovered rule id). */
export const checkOf = (page: Page, id: string) => page.getByTestId(`ar-export-check-${id}`);

/**
 * `/autorig` with the Cube Lad loaded through ①'s sample button, made a character with Quick Rig's commit (truth
 * markers, Standard 33) and bound (`skin.bind`): ③ is done, so ④ and ⑤ are reachable. Returns the character.
 */
export async function riggedCubeLad(page: Page): Promise<string> {
  await openAutoRigReady(page);
  await page.locator('[data-sample="cube-lad"]').click();
  const state = await waitForReport(page, 'cube-lad.glb');
  const { character } = await runOk<{ character: string }>(page, 'skel.quickRig.commit', {
    preset: 'standard33',
    markers: cubeLadTruth().markers,
    meshes: state.subject.meshes,
    flexion: 2 * DEG,
  });
  await runOk(page, 'skin.bind', {});
  await expect.poll(async () => (await autorig(page))?.reachable.export, { timeout: 30_000 }).toBe(true);
  return character;
}

/** Adds library clips with Use Clip (one undo step each); returns their clip ids in order. */
export async function useClips(page: Page, character: string, clips: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const clip of clips) {
    const { clip: id } = await runOk<{ clip: string }>(page, 'library.useClip', { character, clip });
    ids.push(id);
  }
  return ids;
}

/** Goes to ⑤ through the stepper and waits for its column. */
export async function gotoExport(page: Page): Promise<void> {
  await page.locator('[data-step="export"] button').click();
  await expect.poll(async () => (await autorig(page))?.step).toBe('export');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Export/);
  await expect(page.getByTestId('ar-export-panel')).toBeVisible();
}

/** Fills the avatar's author and picks a licence through C10's fields (two undo steps). */
export async function setAuthorAndLicence(page: Page, author = 'Tester', licence = 'cc0'): Promise<void> {
  const authors = page.getByTestId('vrm-meta-authors');
  await authors.fill(author);
  await authors.press('Enter');
  await page.getByTestId(`vrm-licence-${licence}`).click();
  await expect(checkOf(page, 'meta')).toHaveAttribute('data-state', 'ok');
  await expect(checkOf(page, 'licence')).toHaveAttribute('data-state', 'ok');
}

/** Waits until ⑤'s entry rendered the thumbnail (§5.6.3: automatic on the first entry). */
export async function thumbnailRendered(page: Page): Promise<void> {
  await expect
    .poll(async () => (await history(page)).undo.includes('Render Thumbnail'), { timeout: 30_000 })
    .toBe(true);
  await expect(page.getByTestId('ar-export-thumb-image')).toBeVisible({ timeout: 30_000 });
}

/** Chooses a target in the radio group (the kit opens *For developers* first). */
export async function chooseTarget(page: Page, target: 'ekza-vrm' | 'glb' | 'vrma' | 'omoba-kit'): Promise<void> {
  if (target === 'omoba-kit' && (await page.getByTestId('ar-export-target-omoba-kit').count()) === 0) {
    await page.getByTestId('ar-export-developers').click();
  }
  await page.getByTestId(`ar-export-target-${target}`).click();
  await expect(page.getByTestId(`ar-export-target-${target}`)).toHaveAttribute('data-state', 'checked');
  await expect.poll(async () => (await autorig(page))?.slices['export']).toMatchObject({ target });
}

/** Clicks *Download* and returns the saved file (its name, bytes and SHA-256). */
export async function download(page: Page): Promise<{ name: string; bytes: Uint8Array; sha: string }> {
  const saved = page.waitForEvent('download', { timeout: 120_000 });
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  await page.getByTestId('ar-primary').click();
  const file = await saved;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  await expect(page.getByTestId('ar-export-result')).toHaveAttribute('data-saved', 'true');
  return { name: file.suggestedFilename(), bytes, sha: sha256(bytes) };
}

/** The §5.6.1 character request of a target (what `autorig.export` passes to `runExportCharacter`). */
export function characterRequest(
  character: string,
  target: 'ekza-vrm' | 'glb',
  fileName: string,
  clips: readonly string[] = [],
): Record<string, unknown> {
  return target === 'glb'
    ? {
        character,
        fileName,
        format: 'glb',
        profile: 'local/generic',
        clips,
        includeProps: null,
        material: null,
        thumbnail: 'none',
        validate: true,
      }
    : {
        character,
        fileName,
        format: 'vrm',
        profile: 'ekza/space-avatar-v1',
        clips: 'slots',
        includeProps: null,
        material: null,
        thumbnail: 'stored',
        validate: true,
      };
}

/** The `file.export` request of the VRMA target or an imported avatar's bake (the Export dialog's defaults). */
export function fileExportRequest(
  character: string,
  kind: 'vrma' | 'bake-into-model',
  base: string,
  clips: readonly string[],
  closeLoop: boolean,
  profile: string | null,
): Record<string, unknown> {
  return {
    kind,
    character,
    clips,
    fileNamePattern: kind === 'vrma' ? `${base}-{clip}` : base,
    closeLoop,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile,
    reduce: DEFAULT_EXPORT_REDUCE,
  };
}

/** Runs a Studio export operator through the test API; returns its artifacts' names and SHA-256 (no bytes). */
export async function studioExport(
  page: Page,
  op: 'file.exportCharacter' | 'file.export',
  args: Record<string, unknown>,
): Promise<{ fileName: string; sha256: string; errors: string[] }[]> {
  const ran = await page.evaluate(
    async ([id, request]) => {
      const result = await window.__EKZA_STUDIO_TEST__?.run(id, request);
      const artifacts = (Array.isArray(result?.value) ? result.value : []) as {
        fileName: string;
        sha256: string;
        lints: { severity: string; code: string }[];
      }[];
      return {
        status: result?.status ?? 'failed',
        reason: result?.reason ?? result?.error?.message ?? '',
        artifacts: artifacts.map((a) => ({
          fileName: a.fileName,
          sha256: a.sha256,
          errors: a.lints.filter((l) => l.severity === 'error').map((l) => l.code),
        })),
      };
    },
    [op, args] as const,
  );
  expect(ran.status, `${op}: ${ran.reason}`).toBe('finished');
  return ran.artifacts;
}

/** The clips of a character with the given names, in the document's order. */
export async function clipIds(page: Page, character: string): Promise<{ id: string; name: string; loop: boolean }[]> {
  return (await call(page, 'clips', character)).map((clip) => ({ id: clip.id, name: clip.name, loop: clip.loop }));
}

const RESULTS = resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/autorig');

/** Writes an export to `test-results/autorig/` for the local OMOBA run (§11); returns the path. */
export function keepExport(name: string, bytes: Uint8Array): string {
  mkdirSync(RESULTS, { recursive: true });
  const path = resolve(RESULTS, name);
  writeFileSync(path, bytes);
  return path;
}
