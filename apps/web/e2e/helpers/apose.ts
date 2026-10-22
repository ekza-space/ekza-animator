// AUTORIG-SPEC §10 A0 e2e helpers (E2E-AR-A0): A-posed Polybot imported static, rigged through Quick Rig's One-Click
// guess and bound in its own pose, ready for Straighten to T-Pose; the T-pose truth; the checklist ② line.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { enterRig } from './m6b-rig';
import { createSkeleton, startQuickRig } from './m6b-skeleton-ui';
import { call, expectKernelStarted, openEditor, runOk } from './test-api';

export type Vec3 = readonly [number, number, number];

const fixture = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${file}`, import.meta.url)));

/** Polybot's truth joints per pose (`fixtures/models/polybot-truth.json`). */
export function polybotTruth(pose: 'apose' | 'tpose'): {
  readonly height: number;
  readonly humanoid: Record<string, Vec3>;
} {
  const truth = JSON.parse(new TextDecoder().decode(fixture('polybot-truth.json'))) as {
    poses: Record<'apose' | 'tpose', { height: number; humanoid: Record<string, Vec3> }>;
  };
  return truth.poses[pose];
}

/** `mesh.importStatic` of a fixture through the test API (the bytes cross into the page as base64). */
export async function importStatic(page: Page, file: string): Promise<{ meshes: string[] }> {
  const base64 = Buffer.from(fixture(file)).toString('base64');
  const result = await page.evaluate(
    async ([data, name]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return await window.__EKZA_STUDIO_TEST__?.run('mesh.importStatic', { bytes, name });
    },
    [base64, file] as const,
  );
  expect(result?.status, `mesh.importStatic: ${result?.reason ?? result?.error?.message ?? ''}`).toBe('finished');
  return result?.value as { meshes: string[] };
}

/**
 * A-posed Polybot in Rig & Skin: imported static, selected, Quick Rig from the checklist (One-Click guess; the A-pose
 * notice asserted), Create Skeleton, then ③ Bind Skin (one step each). Returns the character and its bound mesh.
 */
export async function aposedPolybotBound(page: Page): Promise<{ readonly character: string; readonly mesh: string }> {
  await openEditor(page);
  await expectKernelStarted(page);
  const imported = await importStatic(page, 'polybot-unskinned.glb');
  await enterRig(page);
  await runOk(page, 'select.objects', { ids: imported.meshes, mode: 'replace' });
  const state = await startQuickRig(page);
  expect(state.aPose).toBe(true);
  await expect(page.getByTestId('quickrig-apose')).toHaveText(
    'A-posed arms: the skeleton follows them; after Bind Skin, Straighten to T-Pose makes the rest a VRM T-pose',
  );
  const character = await createSkeleton(page);
  const before = (await call(page, 'history')).undo.length;
  await page.getByTestId('rtk-step-3-btn').click();
  await expect.poll(async () => (await call(page, 'history')).undo.length, { timeout: 30_000 }).toBe(before + 1);
  expect((await call(page, 'history')).undo.at(-1)).toBe('Bind Skin');
  const mesh = (await call(page, 'meshes')).find((row) => row.owner === `char:${character}`)?.id ?? '';
  expect(mesh).not.toBe('');
  return { character, mesh };
}

/** Validation row codes for the Ekza profile. */
export async function rowCodes(page: Page): Promise<string[]> {
  return (await call(page, 'validation', 'ekza/space-avatar-v1')).map((row) => row.code);
}

/** Shows the Rig Toolkit (Windows › Rig Toolkit: Bind Skin brings Paint Weights to the front of the dock). */
export async function showRigToolkit(page: Page): Promise<void> {
  await page.getByTestId('menu-windows').click();
  await page.getByTestId('menu-item-rig.windows.rigToolkit').click();
  await expect(page.getByTestId('rtk-step-2')).toBeVisible();
}

/** The text of checklist step ② (label and detail). */
export async function checklistTwo(page: Page): Promise<string> {
  return (await page.getByTestId('rtk-step-2').textContent()) ?? '';
}

/** Every humanoid joint's distance to the T-pose truth, in H (the joints above `limit`). */
export async function offTPoseTruth(page: Page, character: string, limit: number): Promise<[string, number][]> {
  const truth = polybotTruth('tpose');
  const joints = (await call(page, 'skeleton', character))?.joints ?? [];
  const out: [string, number][] = [];
  for (const joint of joints) {
    const target = joint.humanBone === null ? undefined : truth.humanoid[joint.humanBone];
    if (target === undefined) continue;
    const d = Math.hypot(...[0, 1, 2].map((k) => (joint.restPosition[k] ?? 0) - (target[k] as number))) / truth.height;
    if (d > limit) out.push([joint.humanBone as string, d]);
  }
  return out;
}
