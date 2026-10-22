// E2E-AR-06 (AUTORIG-SPEC §10 D5, §5.5, §11): ④ Animations on the rigged Cube Lad (made a character with the operators
// D4's step runs: D4's UI is not part of D5's merge). AS-AR-1 steps 7–8 through the UI: search "walk", Speed 1.2 and In
// place, Add = one undo step "Use Clip Walk" with slot `walk`, root motion in place and the `ar-*` tags; Idle and Sword
// attack (Mirror on) make three clips and the sword is mirrored (the left hand does what the right did). Then ✎ /
// Update replaces the Walk in one step keeping its name and slot; the slot chip runs the shipped clip settings; ✕ is
// the shipped Delete Clip; the keys `/`, `A`, Space and Esc; a parametrized preview never touches the document.
import { expect, test } from '@playwright/test';
import {
  animationsWithCubeLad,
  boneAt,
  clipNamed,
  clipsOf,
  exportedMeta,
  libraryPreview,
  modKey,
} from './helpers/ar-animations';
import { autorig, history } from './helpers/autorig';
import { call, runOk } from './helpers/test-api';

const WALK_TAGS = ['ar-walk', 'ar-speed-120', 'ar-inplace'];

test.describe.configure({ timeout: 120_000 });

test('AS-AR-1 steps 7–8: Walk ×1.2 in place, Idle and a mirrored Sword attack, each one Use Clip step', async ({
  page,
}) => {
  const character = await animationsWithCubeLad(page);
  const before = (await history(page)).undo.length;

  // step 7: search "walk" → the Walk card; Speed 1.2 (four 0.05 steps by keyboard), In place; Add
  await page.getByTestId('ar-anim-search').fill('walk');
  await expect(page.getByTestId('ar-anim-grid').locator('button')).toHaveCount(1);
  await page.getByTestId('ar-clip-card-walk').click();
  await expect.poll(async () => (await libraryPreview(page))?.clip).toBe('walk');
  await page.getByTestId('ar-param-speed').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.getByTestId('ar-param-inplace').check();
  await expect(page.getByTestId('ar-anim-preview')).toContainText('×1.2');
  // the parametrized preview restarts and never touches the document
  await expect.poll(async () => (await libraryPreview(page))?.clip).toBe('walk');
  expect((await history(page)).undo.length).toBe(before);
  await page.getByTestId('ar-clip-add').click();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Walk');
  expect((await history(page)).undo.length).toBe(before + 1);
  await expect(page.getByTestId('ar-status')).toContainText('Added Walk');
  const walk = await clipNamed(page, character, 'Walk');
  const meta = await exportedMeta(page, character, walk.id);
  expect([meta.slot, meta.loop, meta.rootMotion]).toEqual(['walk', true, 'in-place']);
  expect(meta.tags).toEqual(WALK_TAGS);
  expect(meta.derivedFrom[0]).toMatchObject({ title: 'Walk_Loop', author: 'Quaternius', license: 'CC0-1.0' });
  // in place: the hips end where they start (X/Z)
  await runOk(page, 'clip.setActive', { clip: walk.id });
  const first = await boneAt(page, character, 'hips', walk.start);
  const last = await boneAt(page, character, 'hips', walk.end);
  expect(Math.abs((first[0] as number) - (last[0] as number))).toBeLessThan(1e-3);
  expect(Math.abs((first[2] as number) - (last[2] as number))).toBeLessThan(1e-3);
  // the row: plays through the shipped path (active clip, timeline playing)
  await page.getByTestId(`ar-char-clip-play-${walk.id}`).click();
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(true);
  await page.getByTestId(`ar-char-clip-play-${walk.id}`).click();
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(false);

  // step 8: Idle, then Sword attack with Mirror
  await page.getByTestId('ar-anim-search').fill('');
  await page.getByTestId('ar-clip-card-idle').click();
  await page.getByTestId('ar-clip-add').click();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Idle');
  await page.getByTestId('ar-anim-category-combat').click();
  await expect(page.getByTestId('ar-clip-card-idle')).toHaveCount(0);
  await page.getByTestId('ar-clip-card-sword-attack').click();
  await page.getByTestId('ar-param-mirror').check();
  await page.getByTestId('ar-clip-add').click();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Sword attack');
  expect((await history(page)).undo.length).toBe(before + 3);
  const names = (await clipsOf(page, character)).map((c) => c.name);
  expect(names.filter((n) => ['Walk', 'Idle', 'Sword attack'].includes(n))).toEqual(['Walk', 'Idle', 'Sword attack']);
  await expect(page.getByTestId('ar-status')).toContainText('3 animations on');
  const sword = await clipNamed(page, character, 'Sword attack');
  expect((await exportedMeta(page, character, sword.id)).tags).toEqual(['ar-sword-attack', 'ar-mirror']);

  // mirrored: the left hand does what the right hand does in the plain clip (reflected across X), at three frames
  const { clip: plain } = await runOk<{ clip: string }>(page, 'library.useClip', { character, clip: 'sword-attack' });
  for (const frame of [Math.round(sword.end * 0.3), Math.round(sword.end * 0.5), Math.round(sword.end * 0.7)]) {
    await runOk(page, 'clip.setActive', { clip: plain });
    const right = await boneAt(page, character, 'rightHand', frame);
    await runOk(page, 'clip.setActive', { clip: sword.id });
    const left = await boneAt(page, character, 'leftHand', frame);
    expect(Math.abs((left[0] as number) + (right[0] as number))).toBeLessThan(0.03);
    expect(Math.abs((left[1] as number) - (right[1] as number))).toBeLessThan(0.03);
    expect(Math.abs((left[2] as number) - (right[2] as number))).toBeLessThan(0.03);
  }
  await runOk(page, 'edit.undo');
  expect((await history(page)).undo.length).toBe(before + 3);
});

test('✎ Update replaces a clip in one step (name and slot kept); the slot chip; ✕ deletes', async ({ page }) => {
  const character = await animationsWithCubeLad(page);
  await page.getByTestId('ar-clip-card-walk').click();
  await page.getByTestId('ar-param-speed').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.getByTestId('ar-clip-add').click();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Walk');
  const walk = await clipNamed(page, character, 'Walk');

  // the slot chip: the shipped clip settings operator
  await page.getByTestId(`ar-char-clip-slot-${walk.id}`).selectOption('run');
  await expect.poll(async () => (await exportedMeta(page, character, walk.id)).slot).toBe('run');

  // ✎: Walk's library clip and its parameters back in the editor (Speed 1.2); Update with Speed 0.8 and Mirror
  await page.getByTestId('ar-clip-card-idle').click();
  await page.getByTestId(`ar-char-clip-edit-${walk.id}`).click();
  await expect(page.getByTestId('ar-anim-preview')).toHaveAttribute('data-clip', 'walk');
  await expect(page.getByTestId('ar-param-speed')).toHaveValue('1.2');
  await expect(page.getByTestId('ar-clip-add')).toHaveText('Update');
  await page.getByTestId('ar-param-speed').focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
  await page.getByTestId('ar-param-mirror').check();
  const steps = (await history(page)).undo.length;
  await page.getByTestId('ar-clip-add').click();
  await expect(page.getByTestId('ar-status')).toContainText('Updated Walk');
  expect((await history(page)).undo.length).toBe(steps + 1);
  const clips = await clipsOf(page, character);
  expect(clips.some((c) => c.id === walk.id)).toBe(false);
  const updated = await clipNamed(page, character, 'Walk');
  const meta = await exportedMeta(page, character, updated.id);
  expect([meta.slot, meta.tags]).toEqual(['run', ['ar-walk', 'ar-speed-80', 'ar-mirror']]);
  await expect(page.getByTestId('ar-clip-add')).toHaveText('+ Add to character');

  // ✕ = the shipped Delete Clip (one step); undo brings it back
  await page.getByTestId(`ar-char-clip-delete-${updated.id}`).click();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Delete Clip');
  await expect(page.getByTestId(`ar-char-clip-${updated.id}`)).toHaveCount(0);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
  await expect(page.getByTestId(`ar-char-clip-${updated.id}`)).toBeVisible();
});

test('keys: / searches, Space plays and stops, A adds the focused card, Esc stops; synonyms and categories', async ({
  page,
}) => {
  const character = await animationsWithCubeLad(page);
  await page.getByTestId('ar-anim-panel').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Slash');
  await expect(page.getByTestId('ar-anim-search')).toBeFocused();
  await page.keyboard.type('attack');
  const cards = page.getByTestId('ar-anim-grid').locator('button');
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('ar-clip-card-sword-attack')).toBeVisible();
  await expect(page.getByTestId('ar-clip-card-punch')).toBeVisible();
  await page.getByTestId('ar-anim-search').fill('stand');
  await expect(page.getByTestId('ar-clip-card-idle')).toBeVisible();
  await page.getByTestId('ar-anim-search').fill('');
  await page.getByTestId('ar-anim-category-react').click();
  await expect(cards).toHaveCount(2);
  await page.getByTestId('ar-anim-category-all').click();

  // roving focus: arrows between the cards; Enter previews; Space stops and plays again; Esc stops
  await page.getByTestId('ar-clip-card-idle').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('ar-clip-card-walk')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await libraryPreview(page))?.clip).toBe('walk');
  // a neutral spot (a click in the viewport may select, which stops the preview as any document run does)
  await page.getByTestId('ar-status').click();
  await page.keyboard.press('Space');
  await expect.poll(async () => await libraryPreview(page)).toBeNull();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await libraryPreview(page))?.clip).toBe('walk');
  await page.keyboard.press('Escape');
  await expect.poll(async () => await libraryPreview(page)).toBeNull();
  expect((await autorig(page))?.step).toBe('animations');

  // A on a focused card adds it (one step)
  await page.getByTestId('ar-clip-card-dance').focus();
  await page.keyboard.press('KeyA');
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Dance');
  expect((await clipsOf(page, character)).some((c) => c.name === 'Dance')).toBe(true);
  // ④ is done with a clip; the footer counts it
  await expect.poll(async () => (await autorig(page))?.done['animations']).toBe(true);
  await expect(page.getByTestId('ar-status')).toContainText('1 animation on');
});
