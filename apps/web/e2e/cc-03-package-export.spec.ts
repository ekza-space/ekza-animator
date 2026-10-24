// CHARACTER-CONTRACT-SPEC §8.4–§8.10, §9 F2 (C2): the OMOBA hero package, end to end in the browser. The Cube Lad is
// rigged in Auto-Rig and bound to Wildspark; Run and Shockline get their clips from the library with the contract's
// settings (`target.slot.create`); a contact moved past the 0.15 s limit blocks the package in ⑤ (the *OMOBA hero
// package* target lists the contract row with its one-tap fix, Download disabled); *Set contact* fixes it and the
// download is one VRM 1.0 whose `ekza_package_v1` names the two custom slots and seven defaults. In Studio (Continue in
// Studio) the time slider shows the clip's contact ◆, the window bracket and the limit line; dragging the ◆ past the
// limit is one *Set Contact* step and the Export dialog's *OMOBA character* profile blocks until the Target panel's
// fix runs; then the dialog exports the package. Set `EKZA_CC_SCREENSHOTS=<dir>` to save the pictures there.
import { parseGlb } from '@ekza-studio/io';
import { expect, type Page, test } from '@playwright/test';
import {
  checkOf,
  chooseTarget,
  download,
  gotoExport,
  riggedCubeLad,
  setAuthorAndLicence,
  thumbnailRendered,
} from './helpers/ar-export';
import { expectStudioShown } from './helpers/ar-host';
import { history } from './helpers/autorig';
import { sliderPoint } from './helpers/m2a-timing';
import { call, lastExport, runOk } from './helpers/test-api';

test.describe.configure({ timeout: 300_000 });

const SHOTS = process.env['EKZA_CC_SCREENSHOTS'];
const shot = async (page: Page, name: string, testId?: string): Promise<void> => {
  if (SHOTS === undefined) return;
  if (testId === undefined) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  else await page.getByTestId(testId).screenshot({ path: `${SHOTS}/${name}.png` });
};

interface Manifest {
  readonly slots: Readonly<Record<string, { readonly mode: string; readonly animation?: number }>>;
  readonly target: { readonly id: string; readonly requirementId: string };
}

async function manifestOf(bytes: Uint8Array): Promise<{ manifest: Manifest; names: string[] }> {
  const json = (await parseGlb(bytes)).json as unknown as {
    asset: { extras: Record<string, unknown> };
    animations?: { name?: string }[];
  };
  return {
    manifest: json.asset.extras['ekza_package_v1'] as Manifest,
    names: (json.animations ?? []).map((animation) => animation.name ?? ''),
  };
}

const markersOf = async (page: Page): Promise<Record<string, number> | null> => {
  const text = await page.getByTestId('timeline-canvas').getAttribute('data-contract-markers');
  return text === null ? null : (JSON.parse(text) as Record<string, number>);
};

test('E2E-CC-03: OMOBA hero package — slot clips, a blocked rule and its fix, Auto-Rig ⑤ and Studio', async ({
  page,
}) => {
  const character = await riggedCubeLad(page);
  await runOk(page, 'target.bind', { character, game: 'omoba', target: 'wildspark' });
  const { clip: run } = await runOk<{ clip: string }>(page, 'target.slot.create', {
    character,
    slot: 'base.run',
    from: 'library',
    libraryClip: 'run',
  });
  const { clip: zap } = await runOk<{ clip: string }>(page, 'target.slot.create', {
    character,
    slot: 'skill.wild_zap.release',
    from: 'library',
    libraryClip: 'pistol-shoot',
  });
  expect((await history(page)).undo.at(-1)).toBe('Use Clip for Shockline (W) — release');
  // the contact past the edge-release limit: 0.30 s > 0.15 s
  const start = (await call(page, 'clips', character)).find((clip) => clip.id === zap)?.start ?? 0;
  await runOk(page, 'target.marker.set', { clip: zap, marker: 'contact', frame: start + 9 });

  // ⑤: the OMOBA hero package is blocked by the contract row; its fix is one tap
  await gotoExport(page);
  await thumbnailRendered(page);
  await setAuthorAndLicence(page);
  await chooseTarget(page, 'omoba-hero');
  const contact = checkOf(page, 'contract.clip.markers');
  await expect(contact).toHaveAttribute('data-state', 'error');
  await expect(contact).toContainText('Contact 0.30 s > 0.15 s');
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  await shot(page, 'autorig-export-blocked');
  await page.getByTestId('ar-export-fix-contract.clip.markers').click();
  await expect(contact).toHaveCount(0);
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Set contact · Shockline (W) — release');
  const file = await download(page);
  expect(file.name).toBe('cube-lad.vrm');
  const { manifest, names } = await manifestOf(file.bytes);
  expect(manifest.target).toEqual({ id: 'wildspark', requirementId: 'character.wildspark' });
  expect(Object.values(manifest.slots).filter((fill) => fill.mode === 'custom')).toHaveLength(2);
  expect(Object.values(manifest.slots).filter((fill) => fill.mode === 'default')).toHaveLength(7);
  expect(names).toEqual(['base.run', 'skill.wild_zap.release']);
  await shot(page, 'autorig-export-saved');

  // Studio: the time slider shows the contract's marks for the active slot clip
  await page.getByTestId('ar-export-continue-studio').click();
  await expectStudioShown(page);
  await runOk(page, 'clip.setActive', { clip: zap });
  await expect.poll(() => markersOf(page), { timeout: 30_000 }).toEqual({ contact: start + 1 });
  await shot(page, 'timeline-markers', 'timeline-canvas');
  await shot(page, 'studio-timeline-markers');

  // drag the ◆ past the limit: one Set Contact step
  const box = await page.getByTestId('timeline-canvas').boundingBox();
  if (box === null) throw new Error('no time slider');
  const from = await sliderPoint(page, start + 1);
  const to = await sliderPoint(page, start + 8);
  await page.mouse.move(from.x, box.y + 14);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, box.y + 14, { steps: 4 });
  await page.mouse.move(to.x, box.y + 14, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => markersOf(page)).toEqual({ contact: start + 8 });
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Set Contact');

  // the Target panel shows the issue and its fix
  await page.getByTestId('menu-windows').click();
  await page.getByTestId('menu-item-shell.windows.panel.target').click();
  await expect(page.getByTestId('target-row-skill.wild_zap.release')).toHaveAttribute('data-status', 'invalid');
  await expect(page.getByTestId('target-row-fix-skill.wild_zap.release-clip.markers')).toHaveText('Set contact');
  await shot(page, 'target-panel-blocked', 'target-panel');

  // the Export dialog's OMOBA character profile blocks until the fix runs
  await runOk(page, 'ui.open', { dialog: 'export' });
  await expect(page.getByTestId('export-character')).toBeVisible();
  await page.getByTestId('export-char-profile').selectOption('ekza/omoba-humanoid-v2');
  await expect(page.getByTestId('export-char-package-clips')).toContainText('Shockline W - release');
  await expect(page.getByTestId('export-char-blocked')).toContainText('error');
  await expect(page.getByTestId('export-confirm')).toBeDisabled();
  await shot(page, 'export-dialog-blocked');
  await runOk(page, 'target.fix', { character, slot: 'skill.wild_zap.release', rule: 'clip.markers' });
  await expect(page.getByTestId('export-char-blocked')).toHaveCount(0);
  await shot(page, 'export-dialog-ready');
  await page.getByTestId('export-confirm').click();
  await expect.poll(async () => (await lastExport(page))?.fileName ?? null, { timeout: 120_000 }).toBe('Cube_Lad.vrm');
  const last = await lastExport(page);
  const exported = await manifestOf(new Uint8Array(last?.bytes ?? []));
  expect(exported.names).toEqual(['base.run', 'skill.wild_zap.release']);
  expect(exported.manifest.slots['base.run']).toEqual({ mode: 'custom', animation: 0, markers: {} });
  expect(run).toBeDefined();
});
