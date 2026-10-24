import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { animate, centreOf, controlFree, dockedPetal, loadSample, ringPoint, rulerPoint } from './helpers/halo-animate';
import { halo, openHalo, openSheetFromShell, selectedControls } from './helpers/halo';
import { call, runOk } from './helpers/test-api';
import { cdp, fingerDrag, fingerHold, fingerTap, type Point, touchEvent, twoFingers } from './helpers/touch';

// ha-06 the Thread and Keys (STUDIO-TOUCH-SPEC §10.2–§10.4, §5.2.1, §4.8; T7), `chrome-touch` (real touch through CDP):
// - the ruler is a classic animation time slider (ST-T10-RULER): a tick on every frame, numbers every 5th or 10th frame
//   by the zoom (every frame zoomed in), the first and last frame numbered, numbers never overlapping, the playhead's
//   frame in a box;
// - the Thread at rest is ▶ · time · the ruler · Rec · the three-way layer switch, inside the visible-target budget;
//   tap the ruler to jump, drag it to scrub; the time readout opens the transport; ▶ plays and pauses, holding it
//   offers repeat, once, ping-pong;
// - Rec is the Simple layout's own setting, laid over Auto Key as a removable override (every channel keys);
// - key dots: tap one for its docked Halo (Ease ▾ › Linear), drag one to retime it (one undo step);
// - a long-press on the ruler then a drag draws a band: its Halo, its body drag moves the keys (one step), Delete;
// - the playhead's Halo: Insert frame;
// - Reach: with a foot's goal selected, dragging the goal itself moves it and the leg follows — one undo step;
// - Keys (layer 1): Pro's Dope Sheet behind the touch adapter — a marquee on empty rows selects keys, two fingers
//   zoom time, the header's Push later keys is Pro's ripple.
// `webkit-ipad` boots the Thread with single taps (compatibility only).

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

/** A clean 60-frame animation on the loaded character (setup through the test API, not counted). */
async function freshAnimation(page: Page, name: string): Promise<void> {
  const character = (await call(page, 'characters'))[0]?.id;
  await runOk(page, 'clip.new', { character, name, range: { start: 0, end: 60 } });
  await expect.poll(async () => (await animate(page)).active).toBe(name);
}

/** Keys the right forearm at `frames` by turning its ring (Rec on): the way J3 poses. */
async function keyForearm(page: Page, frames: readonly number[]): Promise<string> {
  const forearm = (await call(page, 'controls')).find((c) => c.name === 'R Lower Arm')?.id ?? '';
  await fingerTap(page, await controlFree(page, 'R Lower Arm'));
  await expect.poll(() => selectedControls(page)).toEqual([forearm]);
  for (const frame of frames) {
    await fingerTap(page, await rulerPoint(page, frame));
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(frame);
    const ring = await ringPoint(page);
    await fingerDrag(page, ring, { x: ring.x + 70, y: ring.y + 10 }, 10);
    await expect.poll(async () => (await animate(page)).thread.dots.some((d) => d.frame === frame)).toBe(true);
  }
  return forearm;
}

async function dotFrames(page: Page): Promise<number[]> {
  return (await animate(page)).thread.dots.map((d) => d.frame);
}

test.describe('ha-06: the Thread', () => {
  test('at rest: budget, jump, scrub, the transport and ▶', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    // §4.8: the Animate stage at rest stays within 22 visible targets — with one animation the Path's Next chip shows
    await expect(page.getByTestId('halo-clip-others')).toHaveCount(0);
    await expect(page.getByTestId('halo-next-chip')).toBeVisible();
    expect((await halo(page)).visibleTargets).toBeLessThanOrEqual(22);
    await expect(page.getByTestId('halo-thread-layer').getByRole('radio')).toHaveCount(3);
    await expect(page.getByTestId('halo-thread-ruler')).toHaveAttribute('role', 'slider');

    // tap to jump, drag to scrub
    await fingerTap(page, await rulerPoint(page, 20));
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(20);
    await fingerDrag(page, await rulerPoint(page, 20), await rulerPoint(page, 44), 10);
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(44);

    // the readout opens the transport: −1 frame, start, the speeds
    await fingerTap(page, await centreOf(page, 'halo-thread-readout'));
    await expect(page.getByTestId('halo-thread-transport')).toBeVisible();
    await fingerTap(page, await centreOf(page, 'halo-tp-prev'));
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(43);
    await fingerTap(page, await centreOf(page, 'halo-tp-start'));
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(0);
    await page.getByTestId('halo-tp-speed').getByRole('radio', { name: 'Half' }).tap();
    await expect(page.getByTestId('halo-tp-speed').getByRole('radio', { name: 'Half' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await fingerTap(page, await centreOf(page, 'halo-thread-readout'));
    await expect(page.getByTestId('halo-thread-transport')).toHaveCount(0);

    // ▶ plays and pauses; holding it offers the loop modes
    await fingerTap(page, await centreOf(page, 'halo-thread-play'));
    await expect.poll(async () => (await animate(page)).thread.playing).toBe(true);
    // playback never fades the chrome (§4.7): the readout still answers
    await expect(page.getByTestId('halo-thread-readout')).toBeEnabled();
    await fingerTap(page, await centreOf(page, 'halo-thread-play'));
    await expect.poll(async () => (await animate(page)).thread.playing).toBe(false);
    await fingerHold(page, await centreOf(page, 'halo-thread-play'), 600);
    await expect(page.getByTestId('halo-thread-play-menu')).toBeVisible();
    await page.getByTestId('halo-thread-play-menu').getByRole('menuitemradio', { name: 'Once' }).tap();
    await expect(page.getByTestId('halo-thread-play-menu')).toHaveCount(0);
  });

  test('Rec is a removable override of Auto Key; the layer switch', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    expect((await animate(page)).thread).toMatchObject({ rec: true, autoKey: true, autoKeyMode: 'all' });
    await fingerTap(page, await centreOf(page, 'halo-thread-rec'));
    await expect.poll(async () => (await animate(page)).thread.rec).toBe(false);
    expect((await animate(page)).thread.autoKey).toBe(false);
    expect((await call(page, 'state')).autoKey).toBe(false);
    await fingerTap(page, await centreOf(page, 'halo-thread-rec'));
    await expect.poll(async () => (await animate(page)).thread.autoKey).toBe(true);
    // Studio Pro's stored Auto Key was never written (the override layer persists the base only)
    const stored = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? '';
        if (!/prefs/i.test(key)) continue;
        const value = JSON.parse(localStorage.getItem(key) ?? '{}') as { autoKey?: unknown };
        if ('autoKey' in value) return value.autoKey;
      }
      return null;
    });
    expect(stored === null || stored === false).toBe(true);
    // the layer switch: Keys unfolds Pro's Dope Sheet, Timeline folds it
    await page.getByTestId('halo-thread-layer').getByRole('radio', { name: 'Keys' }).tap();
    await expect.poll(async () => (await halo(page)).threadLayer).toBe(1);
    await expect(page.getByTestId('halo-thread-keys')).toBeVisible();
    await page.getByTestId('halo-thread-layer').getByRole('radio', { name: 'Timeline' }).tap();
    await expect(page.getByTestId('halo-thread-keys')).toHaveCount(0);
  });

  test('key dots: the docked key Halo and a retime in one undo step', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(90_000);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    await freshAnimation(page, 'Dots');
    const forearm = await keyForearm(page, [10, 30]);
    expect(await dotFrames(page)).toEqual([10, 30]);

    // tap a dot: its keys are selected and its Halo docks above the Thread (never over the keys)
    await fingerTap(page, await rulerPoint(page, 10));
    await expect(page.getByTestId('halo-docked')).toHaveAttribute('data-noun', 'keyDot');
    await expect.poll(async () => (await call(page, 'state')).selection.keys.length).toBeGreaterThan(0);
    await fingerTap(page, await dockedPetal(page, 'Ease'));
    await expect(page.getByTestId('halo-docked-menu')).toBeVisible();
    const steps = (await call(page, 'history')).undo.length;
    await fingerTap(page, await centreOf(page, 'halo-docked-choice-Linear'));
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 1);
    const curves = await call(page, 'curves', (await call(page, 'state')).activeClip ?? '', forearm);
    const at10 = curves.flatMap((c) => c.keys.filter((k) => k.t === 10));
    expect(at10.length).toBeGreaterThan(0);

    // drag the dot at 30 to 40: one retime, one undo step
    const before = (await call(page, 'history')).undo.length;
    await fingerDrag(page, await rulerPoint(page, 30), await rulerPoint(page, 40), 10);
    await expect.poll(() => dotFrames(page)).toEqual([10, 40]);
    expect((await call(page, 'history')).undo.length).toBe(before + 1);
    await runOk(page, 'edit.undo');
    await expect.poll(() => dotFrames(page)).toEqual([10, 30]);
  });

  test('a band: long-press then drag; its Halo; a body drag moves its keys; Delete', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(90_000);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    await freshAnimation(page, 'Band');
    await keyForearm(page, [10, 20]);

    // long-press the ruler at 5, drag to 25: the band holds both keys
    const s = await cdp(page);
    const from = await rulerPoint(page, 5);
    const to = await rulerPoint(page, 25);
    await touchEvent(s, 'touchStart', [from]);
    await page.waitForTimeout(600);
    for (let i = 1; i <= 8; i++) await touchEvent(s, 'touchMove', [lerp(from, to, i / 8)]);
    await touchEvent(s, 'touchEnd', []);
    await s.detach();
    await expect.poll(async () => (await animate(page)).thread.band).toEqual({ start: 5, end: 25 });
    await expect(page.getByTestId('halo-docked')).toHaveAttribute('data-noun', 'band');

    // drag the band's body by 10 frames: the keys follow in one step
    const steps = (await call(page, 'history')).undo.length;
    await fingerDrag(page, await rulerPoint(page, 15), await rulerPoint(page, 25), 10);
    await expect.poll(() => dotFrames(page)).toEqual([20, 30]);
    expect((await call(page, 'history')).undo.length).toBe(steps + 1);
    await expect.poll(async () => (await animate(page)).thread.band).toEqual({ start: 15, end: 35 });

    // the band's Halo: Delete removes its keys
    await fingerTap(page, await rulerPoint(page, 25));
    await expect(page.getByTestId('halo-docked')).toHaveAttribute('data-noun', 'band');
    await fingerTap(page, await dockedPetal(page, 'Delete'));
    await expect.poll(() => dotFrames(page)).toEqual([]);
  });

  test("the playhead's Halo: Insert frame", async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(90_000);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    await freshAnimation(page, 'Frames');
    await keyForearm(page, [10, 20]);
    await fingerTap(page, await rulerPoint(page, 15));
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(15);
    await fingerHold(page, await rulerPoint(page, 15), 650);
    await expect(page.getByTestId('halo-docked')).toHaveAttribute('data-noun', 'playhead');
    await fingerTap(page, await dockedPetal(page, 'Insert frame'));
    await expect.poll(() => dotFrames(page)).toEqual([10, 21]);
  });

  test('Reach: drag the foot goal itself — the leg follows, one undo step', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(90_000);
    await openHalo(page);
    await loadSample(page, 'polybot');
    const goal = (await call(page, 'controls')).find((c) => c.name === 'L Leg IK')?.id ?? '';
    await fingerTap(page, await controlFree(page, 'L Leg IK'));
    await expect.poll(() => selectedControls(page)).toEqual([goal]);
    await expect.poll(async () => (await call(page, 'state')).tool).toBe('move');
    const before = await call(page, 'controlWorld', goal);
    const steps = (await call(page, 'history')).undo.length;
    // a point on the goal's own shape, clear of its move arrows (the arrows move it as Pro's Move tool does)
    await expect.poll(async () => (await animate(page)).reachPoint).not.toBeNull();
    const at = (await animate(page)).reachPoint as Point;
    await fingerDrag(page, at, { x: at.x + 40, y: at.y - 50 }, 12);
    await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toMatch(/^Reach/);
    expect((await call(page, 'history')).undo.length).toBe(steps + 1);
    const after = await call(page, 'controlWorld', goal);
    expect(Math.hypot(...after.t.map((v, i) => v - (before.t[i] ?? 0)))).toBeGreaterThan(0.01);
    // undo takes the whole Reach back
    await runOk(page, 'edit.undo');
    await expect
      .poll(async () => {
        const back = await call(page, 'controlWorld', goal);
        return Math.hypot(...back.t.map((v, i) => v - (before.t[i] ?? 0)));
      })
      .toBeLessThan(1e-4);
  });

  test('Keys: a marquee on the rows selects keys; two fingers zoom; Push later keys', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(90_000);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    await freshAnimation(page, 'Rows');
    await keyForearm(page, [10, 30]);
    await runOk(page, 'select.keys', { items: [], mode: 'replace' });
    await page.getByTestId('halo-thread-layer').getByRole('radio', { name: 'Keys' }).tap();
    await expect(page.getByTestId('halo-thread-keys')).toBeVisible();
    const canvas = await page.getByTestId('halo-keys-canvas').boundingBox();
    if (canvas === null) throw new Error('no Keys canvas');
    // a marquee from the top-left of the rows to the bottom-right selects every key under it
    await fingerDrag(
      page,
      { x: canvas.x + 4, y: canvas.y + 64 },
      { x: canvas.x + canvas.width - 6, y: canvas.y + canvas.height - 6 },
      12,
    );
    await expect.poll(async () => (await call(page, 'state')).selection.keys.length).toBeGreaterThan(0);
    // two fingers spread: time zooms (the view changes; nothing is selected or moved)
    const keysBefore = await call(page, 'history');
    const mid = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    await twoFingers(
      page,
      [
        { x: mid.x - 40, y: mid.y },
        { x: mid.x + 40, y: mid.y },
      ],
      [
        { x: mid.x - 120, y: mid.y },
        { x: mid.x + 120, y: mid.y },
      ],
    );
    expect(await call(page, 'history')).toEqual(keysBefore);
    // Push later keys is Pro's ripple
    await fingerTap(page, await centreOf(page, 'halo-keys-push'));
    await expect.poll(async () => (await call(page, 'state')).ripple).toBe(true);
    await fingerTap(page, await centreOf(page, 'halo-keys-push'));
    await expect.poll(async () => (await call(page, 'state')).ripple).toBe(false);
    void ringPoint;
  });

  test('the Animations row: several animations, one tap each; the active one drives the Thread; its Settings', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(90_000);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    const character = (await call(page, 'characters'))[0]?.id;
    await runOk(page, 'clip.new', { character, name: 'Idle', range: { start: 0, end: 30 } });
    await runOk(page, 'clip.new', { character, name: 'Walk', range: { start: 0, end: 45 } });
    // three animations: three chips; the Next chip gives way (ST-T7-18) and the stage stays within 22 at rest
    await expect(page.getByTestId('halo-clip-chip-Walk')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('halo-clip-chip-clip1')).toBeVisible();
    await expect(page.getByTestId('halo-clip-chip-Idle')).toBeVisible();
    await expect(page.getByTestId('halo-next-chip')).toHaveCount(0);
    expect((await halo(page)).visibleTargets).toBeLessThanOrEqual(22);
    await runOk(page, 'clip.new', { character, name: 'Wave', range: { start: 0, end: 60 } });
    // four: the active one, the most recent other and +2 — still within 22
    await expect(page.getByTestId('halo-clip-chip-Wave')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('halo-clip-chip-Walk')).toBeVisible();
    await expect(page.getByTestId('halo-clip-chip-Idle')).toHaveCount(0);
    await expect(page.getByTestId('halo-clip-others')).toHaveText('+2');
    await expect(page.getByTestId('halo-next-chip')).toHaveCount(0);
    expect((await halo(page)).visibleTargets).toBeLessThanOrEqual(22);
    // one tap switches: the Thread shows the animation's own length, in frames (ST-T7-UNIT)
    await fingerTap(page, await centreOf(page, 'halo-clip-chip-Walk'));
    await expect.poll(async () => (await animate(page)).active).toBe('Walk');
    expect((await animate(page)).thread.range).toEqual({ start: 0, end: 45 });
    await expect(page.getByTestId('halo-thread-readout')).toHaveText('0 f');
    await fingerTap(page, await centreOf(page, 'halo-clip-chip-Wave'));
    await expect.poll(async () => (await animate(page)).active).toBe('Wave');
    expect((await animate(page)).thread.range).toEqual({ start: 0, end: 60 });
    // the folded ones through +n
    const pick = async (name: string): Promise<void> => {
      await fingerTap(page, await centreOf(page, 'halo-clip-others'));
      const listed = await page.getByTestId('halo-all-clips').getByTestId(`halo-clip-chip-${name}`).boundingBox();
      if (listed === null) throw new Error(`${name} is not listed`);
      await fingerTap(page, { x: listed.x + listed.width / 2, y: listed.y + listed.height / 2 });
      await expect.poll(async () => (await animate(page)).active).toBe(name);
    };
    await pick('Idle');
    expect((await animate(page)).thread.range).toEqual({ start: 0, end: 30 });
    await pick('clip1');

    // the animation's Halo holds its Settings: loop, travel, the range in frames (one undo step each)
    await fingerTap(page, await centreOf(page, 'halo-clip-chip-Wave'));
    await expect(page.getByTestId('halo-docked')).toHaveAttribute('data-noun', 'clip');
    await fingerTap(page, await dockedPetal(page, 'Settings'));
    await expect(page.getByTestId('halo-clip-settings')).toBeVisible();
    // open Settings take the verbs' row: the Halo stays within 36 visible targets (§4.8)
    await expect(page.getByTestId('halo-docked-verbs')).toHaveCount(0);
    expect((await halo(page)).visibleTargets).toBeLessThanOrEqual(36);
    const steps = (await call(page, 'history')).undo.length;
    await fingerTap(page, await centreOf(page, 'halo-clip-loop'));
    await expect.poll(async () => (await call(page, 'clips')).find((c) => c.name === 'Wave')?.loop).toBe(true);
    expect((await call(page, 'history')).undo.length).toBe(steps + 1);
    await page.getByTestId('halo-clip-travel').getByRole('radio', { name: 'In place' }).tap();
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 2);
    await fingerTap(page, await rulerPoint(page, 20));
    await fingerTap(page, await centreOf(page, 'halo-clip-contact-here'));
    await expect(page.getByTestId('halo-clip-contact')).toHaveText('20 f');
    await expect(page.getByTestId('halo-clip-length')).toHaveAttribute('aria-valuenow', '60');
    // back to the animation's verbs
    await fingerTap(page, await centreOf(page, 'halo-clip-settings-back'));
    await expect(page.getByTestId('halo-clip-settings')).toHaveCount(0);
    await expect(page.getByTestId('halo-docked-verbs')).toBeVisible();
  });

  test('the ruler: a tick on every frame, numbered majors that never overlap, the playhead’s frame in a box', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    type Ruler = NonNullable<Awaited<ReturnType<typeof animate>>['thread']['ruler']>;
    const ruler = async (): Promise<Ruler> => {
      const r = (await animate(page)).thread.ruler;
      if (r === null) throw new Error('no ruler');
      return r;
    };
    const apart = (r: Ruler): boolean =>
      r.labels.every(
        (label, i) => i === 0 || (r.labels[i - 1]?.left ?? 0) + (r.labels[i - 1]?.width ?? 0) <= label.left,
      );
    // 60 f on an iPad: a tick on every frame, a number every 5th frame, 0 and 60 numbered
    await freshAnimation(page, 'Sixty');
    await expect.poll(async () => (await ruler()).ticks).toBe(61);
    // at frame 0 the playhead's box shows the 0 itself; away from the ends both end numbers show
    expect((await ruler()).playhead?.text).toBe('0');
    await fingerTap(page, await rulerPoint(page, 30));
    await expect.poll(async () => (await ruler()).playhead?.text).toBe('30');
    let r = await ruler();
    expect(r.tickStep).toBe(1);
    expect(r.labelStep).toBe(5);
    expect(r.labels[0]?.text).toBe('0');
    expect(r.labels.at(-1)?.text).toBe('60');
    expect(apart(r)).toBe(true);
    // the playhead sits on a whole frame with its number in a box; the numbers under the box give way
    await fingerTap(page, await rulerPoint(page, 22));
    await expect.poll(async () => (await ruler()).playhead?.text).toBe('22');
    r = await ruler();
    expect(r.labels.some((label) => label.frame === 20)).toBe(false);
    // 100 f: still a tick on every frame; numbers every 10th
    const character = (await call(page, 'characters'))[0]?.id;
    await runOk(page, 'clip.new', { character, name: 'Hundred', range: { start: 0, end: 100 } });
    await expect.poll(async () => (await ruler()).ticks).toBe(101);
    await fingerTap(page, await rulerPoint(page, 50));
    await expect.poll(async () => (await ruler()).playhead?.text).toBe('50');
    r = await ruler();
    expect(r.tickStep).toBe(1);
    expect(r.labelStep).toBe(10);
    expect(r.labels[0]?.text).toBe('0');
    expect(r.labels.at(-1)?.text).toBe('100');
    expect(apart(r)).toBe(true);
    // zoomed in: every frame numbered
    const y = r.rect.y + r.rect.h / 2;
    const mid = r.rect.x + r.rect.w / 2;
    await twoFingers(
      page,
      [
        { x: mid - 20, y },
        { x: mid + 20, y },
      ],
      [
        { x: mid - 260, y },
        { x: mid + 260, y },
      ],
    );
    await expect.poll(async () => (await ruler()).labelStep).toBe(1);
    expect((await ruler()).tickStep).toBe(1);
    expect(apart(await ruler())).toBe(true);
  });

  test('time in frames by default; Settings › Time switches to seconds and the device keeps it; + New › Other…', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(90_000);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    // ST-T7-UNIT: frames by default — the readout, the ruler and + New's lengths
    await expect(page.getByTestId('halo-thread-readout')).toHaveText('0 f');
    await expect(page.getByTestId('halo-thread-ruler')).toHaveAttribute('aria-valuetext', '0 f');
    await fingerTap(page, await centreOf(page, 'halo-new'));
    for (const frames of [30, 60, 100]) {
      await expect(page.getByTestId(`halo-new-length-${frames}`)).toHaveText(`${frames} f`);
    }
    // Other…: any whole number of frames on the numpad
    await fingerTap(page, await centreOf(page, 'halo-new-length-other'));
    const numpad = page.getByTestId('halo-new-length-numpad');
    await expect(numpad).toBeVisible();
    const field = numpad.locator('input');
    await field.fill('75');
    await field.press('Enter');
    await expect.poll(async () => (await animate(page)).thread.range).toEqual({ start: 0, end: 75 });

    // Settings › Time: Seconds — the Thread speaks seconds at once
    await openSheetFromShell(page, 'settings', true);
    const time = page.getByTestId('halo-settings-time');
    await time.scrollIntoViewIfNeeded();
    await expect(time.getByRole('radio', { name: 'Frames' })).toHaveAttribute('aria-checked', 'true');
    await time.getByRole('radio', { name: 'Seconds' }).tap();
    await expect(time.getByRole('radio', { name: 'Seconds' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await halo(page)).sheet).toBeNull();
    await expect(page.getByTestId('halo-thread-readout')).toHaveText('0.00 s');
    // the ruler keeps a tick on every frame and numbers seconds (ST-T10-RULER)
    await fingerTap(page, await rulerPoint(page, 30));
    await expect.poll(async () => (await animate(page)).thread.ruler?.labels.at(-1)?.text).toBe('2.5 s');
    expect((await animate(page)).thread.ruler?.tickStep).toBe(1);
    expect((await animate(page)).thread.ruler?.ticks).toBe(76);
    // the device keeps a choice someone made
    expect(await page.evaluate(() => window.localStorage.getItem('ekza-studio:halo:time:v1'))).toBe('seconds');
    await openHalo(page);
    await loadSample(page, 'seed-san');
    await expect(page.getByTestId('halo-thread-readout')).toHaveText('0.00 s');
  });

  test('two fingers on the ruler zoom time; a double-tap shows the whole animation again', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadSample(page, 'seed-san');
    const before = (await animate(page)).thread.ruler;
    if (before === null) throw new Error('no ruler');
    const y = before.rect.y + before.rect.h / 2;
    const mid = before.rect.x + before.rect.w / 2;
    await twoFingers(
      page,
      [
        { x: mid - 30, y },
        { x: mid + 30, y },
      ],
      [
        { x: mid - 140, y },
        { x: mid + 140, y },
      ],
    );
    await expect
      .poll(async () => {
        const r = (await animate(page)).thread.ruler;
        return r === null ? 0 : r.end - r.start;
      })
      .toBeLessThan(before.end - before.start - 10);
    const at = await rulerPoint(page, 30);
    await fingerTap(page, at);
    await fingerTap(page, at);
    await expect
      .poll(async () => {
        const r = (await animate(page)).thread.ruler;
        return r === null ? 0 : r.end - r.start;
      })
      .toBe(before.end - before.start);
  });

  test('webkit-ipad boots the Thread and taps it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'webkit-ipad', 'webkit-ipad only');
    await openHalo(page);
    await loadSample(page, 'seed-san');
    await expect(page.getByTestId('halo-thread')).toBeVisible();
    const at = await rulerPoint(page, 30);
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(30);
    await page.touchscreen.tap(...(Object.values(await centreOf(page, 'halo-new')) as [number, number]));
    await expect(page.getByTestId('halo-new-animation')).toBeVisible();
  });
});

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
