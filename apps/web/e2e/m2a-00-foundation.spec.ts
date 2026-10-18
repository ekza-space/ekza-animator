import { expect, test } from '@playwright/test';
import { controlId, seedSample, seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run, runOk, waitForTestApi } from './helpers/test-api';

// M2A-SPEC §8 A0 in the production editor: the M2a kernel-level test API, the operator stubs, layout v2 with the
// Dope Sheet tab (and the v1 → v2 migration of a stored M1 layout), the schema rule on save, loop-clip curves (§5.23)
// and the `ns` / `storage=blocked` URL switches. No E2E-M2A scenario belongs to A0; this file guards its foundation.

test('the M2a test API answers on an M1 rig; the M2a operators refuse cleanly without keys', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  // An M1 rig: the import rigs FK limbs only (with A1 the default rig gives the legs IK, §5.7, M2A-D1).
  await runOk(page, 'prefs.set', { patch: { autoRigIk: { legs: false, arms: false } } });
  const { character } = await seedSample(page, 'polybot');
  const hand = await controlId(page, 'fk.hand.L', character);

  expect(await call(page, 'state')).toMatchObject({ keyTarget: 'selected', ripple: false, recovery: [] });
  // Visibility rule 1: no secondary control is visible by default; every FK control is.
  const controls = await call(page, 'controls');
  expect(controls.find((control) => control.id === hand)?.visible).toBe(true);
  // Limbs appear with A1's ik2 op; an M1 rig has none.
  expect(await call(page, 'limbs')).toEqual([]);
  expect(await call(page, 'limbPivots', character, 'leg.L')).toBeNull();
  expect(await call(page, 'attrs', hand)).toEqual({});
  const world = await call(page, 'controlWorld', hand);
  const bone = await call(page, 'boneWorld', character, 'leftHand');
  expect(Math.hypot(world.t[0] - bone.t[0], world.t[1] - bone.t[1], world.t[2] - bone.t[2])).toBeLessThan(1e-6);
  // Autosave (A5, §5.20): every e2e page load has a fresh storage namespace and claims a slot in it.
  await expect
    .poll(() => call(page, 'autosave'))
    .toMatchObject({ enabled: true, slot: expect.stringMatching(/^as_[0-9A-Za-z]{16}$/) as unknown as string });
  expect(await call(page, 'timelineTicks')).toEqual([]);
  expect(await call(page, 'dopeSheet')).toBeNull();
  // A4 mounted the status-line Tween bar (literal update, M2A-SPEC §3 rule 8): its probe answers.
  expect(await call(page, 'screenOfTween', 'status', 0)).not.toBeNull();

  // Every M2a operator landed (A2: m2a-18, m2a-19, m2a-25; A4: m2a-13…17; A5: m2a-20; A3: m2a-08…12), so no stub is
  // left to poll-fail. A3's operators refuse with their own reasons on a rig without keys.
  expect(await run(page, 'time.insertTime', { at: 0, frames: 1 })).toEqual({
    status: 'cancelled',
    reason: 'No animated controls',
  });
  expect(await run(page, 'time.deleteTime')).toEqual({ status: 'cancelled', reason: 'No animated controls' });
  expect(await run(page, 'graph.keys.copyTo', { dFrames: 1 })).toEqual({
    status: 'cancelled',
    reason: 'No keys are selected',
  });
  expect(await run(page, 'key.toggleRipple', { ripple: false })).toMatchObject({ status: 'finished' });
  // The mounted Graph Editor registers its tools; A4 landed the M2a Scale tool (literal update, M2A-SPEC §3 rule 8).
  await expect(page.getByTestId('panel-graph')).toBeVisible();
  await expect
    .poll(() => run(page, 'view.tool', { panel: 'graph', tool: 'scale' }))
    .toMatchObject({ status: 'finished' });
  expect(await run(page, 'view.tool', { panel: 'graph', tool: 'insert' })).toMatchObject({ status: 'finished' });
  expect(await run(page, 'view.tool', { panel: 'graph', tool: 'select' })).toMatchObject({ status: 'finished' });
  // The status line's key-target toggle and the Tween bar slot are in place.
  for (const target of ['selected', 'bodyPart', 'character']) {
    await expect(page.getByTestId(`status-keytarget-${target}`)).toBeVisible();
  }
  await expect(page.getByTestId('status-tween-slot')).toHaveCount(1);
});

test('the Dope Sheet is a tab beside the Graph Editor (layout v2); a hidden tab’s probe reads null', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const { clip, control, rz } = await seedWaveClip(page);
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  const key15 = (await call(page, 'curves', clip, control)).find((curve) => curve.id === rz)?.keys[1]?.id ?? '';
  expect(key15).not.toBe('');
  await expect(page.getByTestId('panel-graph')).toBeVisible();
  await expect.poll(async () => (await call(page, 'graph'))?.canvasRect.w ?? 0).toBeGreaterThan(0);
  await expect.poll(() => call(page, 'screenOfKey', key15)).not.toBeNull();
  await runOk(page, 'workspace.showPanel', { panel: 'dopeSheet' });
  await expect(page.getByTestId('ds-canvas')).toBeVisible(); // A3's panel replaced the A0 placeholder
  await expect(page.getByTestId('panel-graph')).toBeHidden();
  // §4.8: the Graph Editor is an inactive dock tab, so its probe reads answer null.
  expect(await call(page, 'graph')).toBeNull();
  expect(await call(page, 'screenOfKey', key15)).toBeNull();
  expect(await call(page, 'screenOfCurve', rz, 15)).toBeNull();
  expect(await call(page, 'screenOfTween', 'graph', 0)).toBeNull();
  await runOk(page, 'workspace.showPanel', { panel: 'graph' });
  await expect(page.getByTestId('panel-graph')).toBeVisible();
  await expect.poll(async () => (await call(page, 'graph'))?.canvasRect.w ?? 0).toBeGreaterThan(0);
  await expect.poll(() => call(page, 'screenOfKey', key15)).not.toBeNull();
});

test('a stored M1 layout migrates to v2 with the Dope Sheet tab; the v1 key is kept', async ({ page }) => {
  const prefix = 'ekza-animator:ns:m2a-layout:';
  // An M1 layout without the Graph Editor's Dope Sheet tab: the v2 default with the tab removed.
  await openEditor(page, '&ns=m2a-layout');
  await expectKernelStarted(page);
  const v2Key = `${prefix}ekza-animator:layout:v2:animate`;
  const v1Key = `${prefix}ekza-animator:layout:v1:animate`;
  // Reset Workspace stores the default layout at once.
  await runOk(page, 'workspace.reset');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '', v2Key)).toContain('dopeSheet');
  const v1 = await page.evaluate(
    ([from, to]) => {
      const stored = JSON.parse(localStorage.getItem(from) ?? '{}') as {
        dockview: { panels: Record<string, unknown>; grid: unknown };
      };
      // Drop the Dope Sheet panel and its group membership: an M1 layout.
      const strip = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const item of node) strip(item);
          return;
        }
        if (typeof node !== 'object' || node === null) return;
        const record = node as Record<string, unknown>;
        if (Array.isArray(record['views'])) record['views'] = record['views'].filter((view) => view !== 'dopeSheet');
        if (record['activeView'] === 'dopeSheet') record['activeView'] = 'graph';
        for (const value of Object.values(record)) strip(value);
      };
      const dockview = stored.dockview;
      delete dockview.panels['dopeSheet'];
      strip(dockview.grid);
      const layout = JSON.stringify({ schemaVersion: 1, workspace: 'animate', dockview });
      localStorage.setItem(to, layout);
      localStorage.removeItem(from);
      return layout;
    },
    [v2Key, v1Key] as const,
  );
  expect(v1).not.toContain('dopeSheet');
  await page.reload();
  await waitForTestApi(page);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '', v2Key)).toContain('dopeSheet');
  expect(await page.evaluate((key) => localStorage.getItem(key), v1Key)).toBe(v1);
  await expect(page.getByTestId('panel-graph')).toBeVisible();
  await runOk(page, 'workspace.showPanel', { panel: 'dopeSheet' });
  await expect(page.getByTestId('ds-canvas')).toBeVisible(); // A3's panel replaced the A0 placeholder
  await page.evaluate((p) => {
    for (const key of Object.keys(localStorage)) if (key.startsWith(p)) localStorage.removeItem(key);
  }, prefix);
});

test('saving writes schema 2 / minWriterVersion 1; keying a loop clip creates cycling curves (§5.23)', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  // An FK-only rig (no enabled ik2 solver), so minWriterVersion stays 1 (§4.2 snapshot rule, §5.7).
  await runOk(page, 'prefs.set', { patch: { autoRigIk: { legs: false, arms: false } } });
  const { character } = await seedSample(page, 'polybot');
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'walk' });
  await runOk(page, 'clip.setSettings', { clip, range: { start: 0, end: 24 }, loop: true });
  const cog = await controlId(page, 'cog', character);
  await runOk(page, 'select.controls', { ids: [cog], mode: 'replace' });
  for (const [frame, tx] of [
    [0, 0],
    [6, 0.02],
    [12, 0],
    [18, -0.02],
    [24, 0],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', { edits: [{ control: cog, channel: 'tx', value: tx }] });
    await runOk(page, 'key.set', { channels: 'translate' });
  }
  const curves = await call(page, 'curves', clip, cog);
  expect(curves.length).toBe(3);
  for (const curve of curves) expect([curve.channel, curve.pre, curve.post]).toEqual([curve.channel, 'cycle', 'cycle']);
  const tx = curves.find((curve) => curve.channel === 'tx');
  if (tx === undefined) throw new Error('no tx curve');
  const left = await call(page, 'curveSlope', tx.id, 24, 'left');
  const right = await call(page, 'curveSlope', tx.id, 0, 'right');
  expect(Math.abs(left - right)).toBeLessThan(1e-9);
  expect(Math.abs(right)).toBeGreaterThan(1e-5);

  const saved = await runOk<{ fileName: string }>(page, 'file.saveJson');
  expect(saved.fileName).toMatch(/\.ekzanim\.json$/);
  const last = await call(page, 'lastExport');
  // Uint8Array arrives through page.evaluate as an index → byte object.
  const bytes: Record<string, number> = (last?.bytes ?? {}) as unknown as Record<string, number>;
  const text = new TextDecoder().decode(Uint8Array.from(Object.values(bytes)));
  const doc = JSON.parse(text) as { schemaVersion: number; minWriterVersion: number };
  expect(doc).toMatchObject({ schemaVersion: 2, minWriterVersion: 1 });
});

test('ns keeps storage across a reload; storage=blocked keeps the editor working', async ({ page }) => {
  await openEditor(page, '&ns=m2a-prefs');
  await expectKernelStarted(page);
  await runOk(page, 'prefs.set', { patch: { tweenOvershoot: true, autoKey: true } });
  await page.reload();
  await waitForTestApi(page);
  expect((await call(page, 'state')).autoKey).toBe(true);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('ekza-animator:ns:m2a-prefs:')) localStorage.removeItem(key);
  });

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page, '&storage=blocked');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  await runOk(page, 'prefs.set', { patch: { autoKey: true } });
  expect((await call(page, 'state')).autoKey).toBe(true);
  expect((await call(page, 'counts')).characters).toBe(1);
  expect(errors).toEqual([]);
  // The ghost IK/FK display is M2a-stretch.
  expect(await run(page, 'prefs.set', { patch: { ikFkVisibility: 'ghost' } })).toEqual({
    status: 'cancelled',
    reason: 'not available yet',
  });
});
