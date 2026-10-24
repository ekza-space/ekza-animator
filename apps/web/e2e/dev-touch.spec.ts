import { expect, type Page, test } from '@playwright/test';

// The touch kit's gallery in the production build (/dev/touch; STUDIO-TOUCH-SPEC §21 T4, §18): 44 px targets and
// 16 px input text in every state, the roles and names a screen reader needs, and the primitives' input — distance
// scrub, numpad expressions, the Thumb key's tap / double-tap, the long-press ring, roving focus, the no-pan policy,
// reduced motion. The axe run of the gallery is recorded in docs/wp-notes/halo-t4.md (axe-core is not a dependency).

async function open(page: Page): Promise<void> {
  await page.goto('/dev/touch');
  await expect(page.getByTestId('touch-halo').getByRole('menuitem').first()).toBeVisible();
}

/** Every visible interactive element smaller than 44 × 44 px, and every input with text under 16 px. */
async function undersized(page: Page): Promise<{ small: string[]; inputs: string[] }> {
  return page.evaluate(() => {
    const sel =
      'button, [role="slider"], [role="spinbutton"], [role="menuitem"], [role="menuitemradio"], [role="radio"], [role="tab"], input, a[href]';
    const small: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (el.closest('[aria-hidden="true"], [inert]') !== null) continue;
      const style = getComputedStyle(el);
      if (el.getBoundingClientRect().width === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      // the layout box: an entry animation's scale (sheets, toasts) does not count
      const [w, h] = [el.offsetWidth, el.offsetHeight];
      if (w < 44 || h < 44) small.push(`${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${w}×${h}`);
    }
    const inputs = [...document.querySelectorAll<HTMLElement>('input, textarea, select')]
      .filter((el) => Number.parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => el.getAttribute('aria-label') ?? el.dataset.testid ?? el.tagName);
    return { small, inputs };
  });
}

test('every target is at least 44 × 44 px and every input has 16 px text, in every state and at 85 %', async ({
  page,
}) => {
  await open(page);
  expect(await undersized(page)).toEqual({ small: [], inputs: [] });

  await page.getByTestId('touch-halo').getByRole('menuitem', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: 'Everything for 1 face' })).toBeVisible();
  expect(await undersized(page)).toEqual({ small: [], inputs: [] });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Everything for 1 face' })).toBeHidden();

  await page.getByTestId('touch-chip-distance').click();
  await expect(page.getByTestId('touch-numpad')).toBeVisible();
  expect(await undersized(page)).toEqual({ small: [], inputs: [] });
  await page.keyboard.press('Escape');

  // Text & touch size 85 %: text shrinks, targets and inputs do not.
  await page.getByRole('radio', { name: '85%' }).click();
  expect(await undersized(page)).toEqual({ small: [], inputs: [] });
  await expect(page.getByTestId('touch-input')).toHaveCSS('font-size', '16px');
  await page.getByRole('radio', { name: '150%' }).click();
  await expect(page.getByTestId('touch-input')).toHaveCSS('font-size', '24px');
  const hit = await page.getByTestId('touch-chip-segments').boundingBox();
  expect(hit?.height).toBeGreaterThanOrEqual(65.5);
});

test('value chip: a sideways drag scrubs, a tap opens the numpad, and its expression sets the value', async ({
  page,
}) => {
  await open(page);
  const chip = page.getByTestId('touch-chip-distance');
  await expect(chip).toHaveAttribute('role', 'slider');
  await expect(chip).toHaveAttribute('aria-valuetext', '0.07 m, Extrude offset');
  const box = await chip.boundingBox();
  if (box === null) throw new Error('chip not visible');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  for (let dx = 4; dx <= 40; dx += 4) await page.mouse.move(box.x + 20 + dx, y);
  await page.mouse.up();
  // 40 px at 4 px a step of 0.01 m
  await expect(chip).toHaveAttribute('aria-valuenow', '0.17');

  await chip.click();
  const numpad = page.getByRole('dialog', { name: 'Distance · Extrude offset' });
  await expect(numpad).toBeVisible();
  await expect(numpad.getByLabel('Distance value')).toBeFocused();
  for (const key of ['times', '2']) await numpad.getByRole('button', { name: key, exact: true }).click();
  await expect(numpad.getByRole('status')).toHaveText('= 0.34');
  await numpad.getByRole('button', { name: 'Done' }).click();
  await expect(numpad).toBeHidden();
  await expect(chip).toHaveAttribute('aria-valuenow', '0.34');

  // keyboard: arrows step the slider
  await chip.focus();
  await page.keyboard.press('ArrowRight');
  await expect(chip).toHaveAttribute('aria-valuenow', '0.35');
});

test('the Halo is a named menu beside the selection; More opens the sheet; petals take roving focus', async ({
  page,
}) => {
  await open(page);
  const halo = page.getByRole('menu', { name: '1 face' });
  await expect(halo.getByRole('menuitem')).toHaveCount(6);
  await expect(halo.getByRole('menuitem', { name: 'Pull, Extrude' })).toBeVisible();
  // no petal overlaps the selection (§4.1, AS-ST-18)
  const selection = await page.getByTestId('touch-selection').boundingBox();
  for (const petal of await halo.getByRole('menuitem').all()) {
    const b = await petal.boundingBox();
    if (b === null || selection === null) throw new Error('not visible');
    expect(b.x + b.width <= selection.x || b.x >= selection.x + selection.width).toBe(true);
  }
  await halo.getByRole('menuitem', { name: 'Pull, Extrude' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(halo.getByRole('menuitem', { name: 'Inset, Inset Faces' })).toBeFocused();
  // the focus ring is drawn for keyboard focus
  await expect(halo.getByRole('menuitem', { name: 'Inset, Inset Faces' })).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Escape');
  await expect(halo).toBeHidden();
});

test('long-press (right-click with a mouse) opens the ring at the press, each verb on its own slot', async ({
  page,
}) => {
  await open(page);
  const canvas = await page.getByTestId('touch-canvas').boundingBox();
  if (canvas === null) throw new Error('canvas not visible');
  await page.mouse.click(canvas.x + 320, canvas.y + 520, { button: 'right' });
  const ring = page.getByRole('menu', { name: 'Empty space' });
  await expect(ring.getByRole('menuitem')).toHaveCount(5);
  const boxes = await Promise.all((await ring.getByRole('menuitem').all()).map((m) => m.boundingBox()));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a === null || a === undefined || b === null || b === undefined) throw new Error('not visible');
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart).toBe(true);
    }
  }
});

test('Thumb key: a tap is for the next action, a double-tap locks, its name says which', async ({ page }) => {
  await open(page);
  const key = page.getByTestId('touch-thumb');
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await key.click();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect(key).toHaveAccessibleName('Select more and fine, for the next tap or drag');

  // A double-tap (two quick presses, well inside the 450 ms window) locks it; one more tap unlocks.
  await open(page);
  await key.scrollIntoViewIfNeeded();
  const box = await key.boundingBox();
  if (box === null) throw new Error('Thumb key not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 2; i++) {
    await page.mouse.down();
    await page.mouse.up();
  }
  await expect(key).toHaveAccessibleName('Select more and fine, locked on');
  await key.click();
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await expect(key).toHaveAccessibleName('Select more and fine');
});

test('segmented controls and the stepper: arrows move the choice, − / + stop at the range', async ({ page }) => {
  await open(page);
  const pick = page.getByRole('radiogroup', { name: 'Pick' });
  await pick.getByRole('radio', { name: 'Faces' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(pick.getByRole('radio', { name: 'Edges' })).toHaveAttribute('aria-checked', 'true');
  await expect(pick.getByRole('radio', { name: 'Edges' })).toBeFocused();
  await expect(page.getByRole('tablist', { name: 'Stage' }).getByRole('tab', { name: 'Make' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const stepper = page.getByTestId('touch-stepper');
  const value = stepper.getByRole('spinbutton', { name: 'Cuts' });
  await expect(value).toHaveAttribute('aria-valuenow', '3');
  await stepper.getByRole('button', { name: 'Less cuts' }).click();
  await stepper.getByRole('button', { name: 'Less cuts' }).click();
  await expect(value).toHaveAttribute('aria-valuenow', '1');
  await expect(stepper.getByRole('button', { name: 'Less cuts' })).toBeDisabled();
  await value.focus();
  await page.keyboard.press('ArrowUp');
  await expect(value).toHaveAttribute('aria-valuenow', '2');
});

test('the shell policy turns off page pan and zoom while on, and leaves nothing behind', async ({ page }) => {
  await open(page);
  const html = page.locator('html');
  await page.getByTestId('touch-policy').click();
  await expect(html).toHaveClass(/ekza-touch-policy/);
  await expect(html).toHaveCSS('touch-action', 'none');
  await expect(html).toHaveCSS('overscroll-behavior-y', 'none');
  await page.getByTestId('touch-policy').click();
  await expect(html).not.toHaveClass(/ekza-touch-policy/);
  await expect(html).toHaveCSS('touch-action', 'auto');
});

test('reduced motion: petals and sheets appear without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(page.getByTestId('touch-halo').getByRole('menuitem').first()).toHaveCSS('transition-duration', '0s');
  await page.getByTestId('touch-halo').getByRole('menuitem', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: 'Everything for 1 face' })).toHaveCSS('animation-duration', '0s');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a tap on a value chip opens the numpad; a tap on a petal runs it', async ({ page }) => {
    await open(page);
    await page.getByTestId('touch-chip-segments').tap();
    await expect(page.getByRole('dialog', { name: 'Segments · Divisions' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Segments · Divisions' }).getByRole('button', { name: 'Cancel' }).tap();
    await page.getByRole('menuitem', { name: 'Bevel, Bevel' }).tap();
    await expect(page.getByTestId('touch-toasts')).toContainText('Ran bevel');
  });
});
