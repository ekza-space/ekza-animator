import { expect, test } from '@playwright/test';
import { clickKey, dragBy, hoverGraph } from './helpers/g2-graph';
import {
  curvesShape,
  ekzaClipMeta,
  exportClipVrma,
  importAnimationBytes,
  openClipLibrary,
  previewClip,
  readLibrary,
  starterPackFile,
} from './helpers/m6b-clip-library';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-LIB-02 (M6B-SPEC §0.7, §0.4.7; C12): Use Clip and edit it. Polybot; Use Clip on Sword attack → one undo step;
// the clip's curves, keys, fps and range deep-equal a `file.importAnimation` of the same bytes, its name is
// "Sword attack", `loop` false, slot `attack`, provenance CC0 Quaternius; Use Clip on Walk → `loop` true, slot `walk`;
// a Graph Editor key drag edits it; undo removes the edit and then the clip; a clip whose served bytes are altered by a
// route intercept turns its card disabled on Play.

test('E2E-LIB-02: Use Clip and edit it', async ({ page }) => {
  // The served Punch is altered on the way (a damaged download or a stale cache): its checksum must refuse it.
  await page.route('**/library/animations/punch.vrma', async (route) => {
    const response = await route.fetch();
    const body = Buffer.from(await response.body());
    body[200] = (body[200] ?? 0) ^ 0xff;
    await route.fulfill({ response, body });
  });
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  await openClipLibrary(page);

  // Use Clip Sword attack: one undo step, the clip active and named after the label.
  const undoBefore = (await call(page, 'history')).undo.length;
  await page.getByTestId('clip-use-sword-attack').click();
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Use Clip Sword attack');
  expect((await call(page, 'history')).undo.length).toBe(undoBefore + 1);
  const sword = (await call(page, 'clips', character)).find((clip) => clip.name === 'Sword attack');
  if (sword === undefined) throw new Error('no Sword attack clip');
  expect(sword.loop).toBe(false);
  expect((await call(page, 'state')).activeClip).toBe(sword.id);

  // The same bytes through file.importAnimation: equal curves, keys, fps and range.
  const [plain] = await importAnimationBytes(
    page,
    'sword-attack.vrma',
    starterPackFile('sword-attack.vrma'),
    character,
  );
  if (plain === undefined) throw new Error('no imported clip');
  const plainRecord = (await call(page, 'clips', character)).find((clip) => clip.id === plain);
  expect([plainRecord?.fps, plainRecord?.start, plainRecord?.end]).toEqual([sword.fps, sword.start, sword.end]);
  expect(await curvesShape(page, sword.id)).toEqual(await curvesShape(page, plain));
  // The VRMA's animation name is the UAL clip (`Sword_Attack`): the plain import's /loop/i rule agrees.
  expect(plainRecord?.loop).toBe(false);

  // Slot and provenance, read back through the shipped VRMA exporter (`ekza_animation_v1`).
  const swordMeta = ekzaClipMeta(await exportClipVrma(page, character, sword.id));
  expect([swordMeta.slot, swordMeta.redistributable]).toEqual(['attack', 'yes']);
  expect(swordMeta.derivedFrom[0]).toMatchObject({ title: 'Sword_Attack', author: 'Quaternius', license: 'CC0-1.0' });

  // Use Clip Walk: loop on, slot walk.
  await page.getByTestId('clip-use-walk').click();
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Use Clip Walk');
  const walk = (await call(page, 'clips', character)).find((clip) => clip.name === 'Walk');
  if (walk === undefined) throw new Error('no Walk clip');
  expect(walk.loop).toBe(true);
  const walkMeta = ekzaClipMeta(await exportClipVrma(page, character, walk.id));
  expect([walkMeta.slot, walkMeta.loop]).toEqual(['walk', true]);

  // The Graph Editor edits it like any clip: drag one rz key of the left upper arm.
  const arm = await controlId(page, 'fk.upperArm.L');
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  await runOk(page, 'graph.frame', { what: 'all' });
  const curve = (await call(page, 'curves', walk.id, arm)).find((candidate) => candidate.channel === 'rz');
  const key = curve?.keys[Math.floor((curve?.keys.length ?? 0) / 2)];
  if (curve === undefined || key === undefined) throw new Error('no rz key on fk.upperArm.L');
  await hoverGraph(page);
  const at = await clickKey(page, key.id, 'the rz key');
  const steps = (await call(page, 'history')).undo.length;
  await dragBy(page, at, 0, -40);
  await expect
    .poll(
      async () =>
        (await call(page, 'curves', walk.id, arm)).find((c) => c.id === curve.id)?.keys.find((k) => k.id === key.id)?.v,
    )
    .not.toBe(key.v);
  expect((await call(page, 'history')).undo.length).toBe(steps + 1);

  // Undo: first the key edit, then the clip.
  await runOk(page, 'edit.undo');
  await expect
    .poll(
      async () =>
        (await call(page, 'curves', walk.id, arm)).find((c) => c.id === curve.id)?.keys.find((k) => k.id === key.id)?.v,
    )
    .toBe(key.v);
  await runOk(page, 'edit.undo');
  await expect.poll(async () => (await call(page, 'clips', character)).some((clip) => clip.id === walk.id)).toBe(false);

  // An altered download: Play turns the card disabled with the reason; nothing plays.
  await page.getByTestId('clip-play-punch').click();
  await expect(page.getByTestId('clip-failed-punch')).toHaveText('The file failed its checksum');
  await expect(page.getByTestId('clip-card-punch')).toHaveAttribute('data-disabled', 'true');
  await expect(page.getByTestId('clip-play-punch')).toBeDisabled();
  await expect(page.getByTestId('clip-use-punch')).toBeDisabled();
  expect(await previewClip(page)).toBeNull();
  const library = await readLibrary(page);
  expect(library?.clips.find((clip) => clip.id === 'punch')?.ok).toBe(false);
  expect(library?.clips.find((clip) => clip.id === 'walk')?.ok).toBe(true);
});
