// M2a acceptance (M2A-SPEC §1.4, §9.1 E2E-M2A-23 and -24, §10.2): a walk cycle and an attack clip with planted feet
// are authored with leg IK and without Plant Feet, through real input — viewport and Outliner picks, Channel Box
// typing with `S`, a time-slider band, the Pose menu, Dope Sheet drags, the status-line Tween bar and the Export
// dialog — and asserted through the test API (MVP-SPEC §6.1). Both scenarios start from a fresh page.
//
// Fixture amendments (docs/wp-notes/m2a-integration.md, M2A-INT-1/-2): the hips sit lower where a foot reaches
// furthest — Polybot's legs are 0.32 m long and straight at rest, Seed-san's are straight too — so the IK targets
// stay inside the legs' reach and the feet can be planted at all; every assertion of §9.1 is kept.
import { readFileSync } from 'node:fs';
import { DEFAULT_EXPORT_REDUCE, parseGlb, readAnimations, skeletonFromGltf, trackLeverArms } from '@ekza-animator/io';
import { expect, type Page, test } from '@playwright/test';
import { clickFrame, clickOutlinerRow, keysOf, pressOverPane } from './helpers/g3-input';
import {
  exportOne,
  newValidatorErrors,
  readGlb,
  sampleBytes,
  validationReport,
  validatorErrors,
} from './helpers/g4-export';
import {
  boneWorlds,
  clickControl,
  controlIdOf,
  expectLimbIk,
  quatAngle,
  type Quat,
  typeCb,
  type World,
} from './helpers/m2a-a2';
import { dragTween } from './helpers/m2a-a4';
import { dopeKey, dopeX, drag, showDopeSheet, sliderPoint } from './helpers/m2a-timing';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

const DEG = Math.PI / 180;

/** Humanoid bones compared between frames (the ones both fixtures have). */
const BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
] as const;

type Curve = Awaited<ReturnType<typeof clipCurves>>[number];

function clipCurves(page: Page, clip: string) {
  return call(page, 'curves', clip);
}

/** The selected controls, waited for after a pick. */
async function expectSelected(page: Page, ids: readonly string[]): Promise<void> {
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([...ids]);
}

/**
 * Keys the selected control at `frame` with Channel Box typing and `S` over the viewport (MVP-SPEC §4.10): the time
 * slider is clicked at the frame, each field typed in display units and committed with Enter, then `S` keys every
 * keyable channel of the control (`keyAll: false` attributes such as `@ikFk` excepted, §5.1 rule 4).
 */
async function keyWithChannelBox(
  page: Page,
  control: string,
  frame: number,
  fields: Readonly<Record<string, string>>,
): Promise<void> {
  await clickFrame(page, frame);
  for (const [channel, text] of Object.entries(fields)) await typeCb(page, `cb-field-${channel}`, text);
  await pressOverPane(page, 'KeyS');
  const channel = Object.keys(fields)[0] ?? 'rx';
  await expect
    .poll(async () => (await keysOf(page, control, channel)).some((key) => Math.abs(key.t - frame) < 1e-9))
    .toBe(true);
}

/** Every humanoid bone world of `BONES` at a clip frame. */
function poseAt(page: Page, character: string, frame: number): Promise<Record<string, World>> {
  return boneWorlds(page, character, BONES, frame);
}

function expectPoseClose(a: Record<string, World>, b: Record<string, World>, tolerance: number, what: string): void {
  for (const bone of BONES) {
    const x = a[bone];
    const y = b[bone];
    expect(x, `${what}: ${bone}`).toBeDefined();
    if (x === undefined || y === undefined) continue;
    const dt = Math.hypot(x.t[0] - y.t[0], x.t[1] - y.t[1], x.t[2] - y.t[2]);
    expect(dt, `${what}: ${bone} position`).toBeLessThanOrEqual(tolerance);
    expect(quatAngle(x.q as Quat, y.q as Quat), `${what}: ${bone} rotation`).toBeLessThanOrEqual(tolerance);
  }
}

/** Labels of every history step after `anchor` (newest first): undone one by one, then redone. */
async function historyLabelsSince(page: Page, anchor: string): Promise<string[]> {
  const labels: string[] = [];
  for (let step = 0; step < 400; step++) {
    const label = (await call(page, 'state')).history.undoLabel;
    if (label === null || label === anchor) break;
    labels.push(label);
    await runOk(page, 'edit.undo');
  }
  expect((await call(page, 'state')).history.undoLabel).toBe(anchor);
  for (let step = 0; step < labels.length; step++) await runOk(page, 'edit.redo');
  expect((await call(page, 'state')).history.canRedo).toBe(false);
  return labels;
}

interface Track {
  readonly bone: string;
  readonly path: string;
  readonly times: Float32Array;
  readonly values: Float32Array;
}

/** Every channel of a VRMA's first animation by humanoid node name (the E2E-M2A-21 reader). */
async function tracksOf(bytes: Uint8Array): Promise<Track[]> {
  const container = await parseGlb(bytes);
  const skeleton = skeletonFromGltf(container);
  const animation = readAnimations(container, skeleton)[0];
  if (animation === undefined) throw new Error('no animation in the file');
  return animation.channels.map((channel) => ({
    bone: skeleton.nodes[channel.node]?.name ?? String(channel.node),
    path: channel.path,
    times: channel.times,
    values: channel.values,
  }));
}

const totalSamples = (tracks: readonly Track[]) => tracks.reduce((sum, track) => sum + track.times.length, 0);

/** The value a player computes at time t (LINEAR: slerp / lerp between the neighbouring samples). */
function sampleTrack(track: Track, t: number): number[] {
  const width = track.path === 'rotation' ? 4 : 3;
  const n = track.times.length;
  let i = 0;
  while (i < n - 1 && (track.times[i + 1] as number) <= t) i++;
  const j = Math.min(i + 1, n - 1);
  const t0 = track.times[i] as number;
  const t1 = track.times[j] as number;
  const a = Array.from(track.values.subarray(i * width, i * width + width));
  const b = Array.from(track.values.subarray(j * width, j * width + width));
  const alpha = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  if (width === 3) return a.map((v, c) => v + ((b[c] as number) - v) * alpha);
  let dot = a.reduce((sum, v, c) => sum + v * (b[c] as number), 0);
  const sign = dot < 0 ? -1 : 1;
  dot = Math.abs(dot);
  const angle = Math.acos(Math.min(1, dot));
  const s = Math.sin(angle);
  const wa = s < 1e-9 ? 1 - alpha : Math.sin((1 - alpha) * angle) / s;
  const wb = s < 1e-9 ? alpha : Math.sin(alpha * angle) / s;
  const q = a.map((v, c) => wa * v + wb * sign * (b[c] as number));
  const len = Math.hypot(...q);
  return q.map((v) => v / len);
}

function trackError(path: string, a: readonly number[], b: readonly number[]): number {
  if (path === 'rotation') {
    return 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, v, c) => sum + v * (b[c] as number), 0))));
  }
  return Math.hypot(...a.map((v, c) => v - (b[c] as number)));
}

/**
 * The reduced file's tracks differ from the unreduced file's by no more than the §5.16 per-node tolerances at every
 * integer frame (the E2E-M2A-21 method, tolerances from the fixture's rest skeleton).
 */
async function expectWithinReduceTolerances(
  reduced: readonly Track[],
  plain: readonly Track[],
  fixture: 'polybot.vrm' | 'seed-san.vrm',
  frames: number,
): Promise<void> {
  const skeleton = skeletonFromGltf(await parseGlb(sampleBytes(fixture)));
  const levers = trackLeverArms(skeleton, 'raw');
  const humanoid = (skeleton.humanoid ?? {}) as Readonly<Record<string, number>>;
  const epsPos = DEFAULT_EXPORT_REDUCE.positionM * (skeleton.height / 1.7);
  for (const original of plain) {
    const track = reduced.find((candidate) => candidate.bone === original.bone && candidate.path === original.path);
    expect(track, `${original.bone} ${original.path}`).toBeDefined();
    if (track === undefined) continue;
    const node = humanoid[original.bone];
    const lever = node === undefined ? 0 : (levers.get(node) ?? 0);
    const tolerance =
      original.path === 'rotation'
        ? Math.min(DEFAULT_EXPORT_REDUCE.rotationCapRad, epsPos / Math.max(lever, DEFAULT_EXPORT_REDUCE.minLeverM))
        : epsPos;
    for (let frame = 0; frame <= frames; frame++) {
      const t = Math.fround(frame / 30);
      const e = trackError(original.path, sampleTrack(track, t), sampleTrack(original, t));
      expect(e, `${original.bone} ${original.path} at ${frame}`).toBeLessThanOrEqual(tolerance * (1 + 1e-6) + 1e-6);
    }
  }
}

/** Exports the active clip through the Export dialog as VRMA, "Reduce keys" as given (§5.16, E2E-M2A-21 method). */
async function exportVrmaThroughDialog(page: Page, reduce: boolean): Promise<Uint8Array> {
  await runOk(page, 'ui.open', { dialog: 'export' });
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-kind-vrma').click();
  const checkbox = page.getByTestId('export-reduce');
  await expect(checkbox).toBeChecked(); // on by default (M2A-D8)
  if (!reduce) await checkbox.uncheck();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('export-confirm').click();
  const file = await download;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  await expect(page.getByTestId('export-stats')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  return bytes;
}

/** Second differences of a sequence (a straight line has none). */
function secondDifferences(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i + 1 < values.length; i++) {
    out.push((values[i + 1] as number) - 2 * (values[i] as number) + (values[i - 1] as number));
  }
  return out;
}

/** A planted foot over [from, to]: world x and y vary ≤ 1e-6 m, z moves linearly (second differences ≤ 1e-6 m). */
async function expectPlanted(page: Page, character: string, bone: string, from: number, to: number): Promise<void> {
  const worlds: World[] = [];
  for (let frame = from; frame <= to; frame++) {
    worlds.push(((await boneWorlds(page, character, [bone], frame)) as Record<string, World>)[bone] as World);
  }
  for (const axis of [0, 1] as const) {
    const values = worlds.map((world) => world.t[axis]);
    expect(Math.max(...values) - Math.min(...values), `${bone} axis ${axis} over ${from}…${to}`).toBeLessThanOrEqual(
      1e-6,
    );
  }
  const z = worlds.map((world) => world.t[2]);
  for (const [i, d] of secondDifferences(z).entries()) {
    expect(Math.abs(d), `${bone} z second difference at ${from + i + 1}`).toBeLessThanOrEqual(1e-6);
  }
  // The planted foot does not turn either.
  for (const world of worlds) {
    expect(quatAngle(world.q as Quat, worlds[0]?.q as Quat), `${bone} rotation`).toBeLessThanOrEqual(1e-6);
  }
}

test('E2E-M2A-23: acceptance — walk cycle with leg IK', async ({ page }) => {
  test.setTimeout(300_000);
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  await expectLimbIk(page);
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'walk' });
  await runOk(page, 'clip.setSettings', {
    clip,
    range: { start: 0, end: 24 },
    loop: true,
    slot: 'walk',
    rootMotion: 'in-place',
  });
  const anchor = (await call(page, 'state')).history.undoLabel ?? '';
  expect(anchor).not.toBe('');
  const ikLeft = await controlIdOf(page, 'ik.leg.L');
  const ikRight = await controlIdOf(page, 'ik.leg.R');
  const cog = await controlIdOf(page, 'cog');

  // The left IK foot, picked in the viewport, keyed with Channel Box typing and S: contact at 0 and 12 (the planted
  // span slides back with the treadmill), lift at 18, contact again at 24.
  await clickControl(page, ikLeft);
  await expectSelected(page, [ikLeft]);
  for (const [frame, tz, ty] of [
    [0, '0.15', '0'],
    [12, '-0.15', '0'],
    [18, '0', '0.06'],
    [24, '0.15', '0'],
  ] as const) {
    await keyWithChannelBox(page, ikLeft, frame, { tz, ty });
  }
  expect((await keysOf(page, ikLeft, 'tz')).map((key) => [key.t, key.v])).toEqual([
    [0, 0.15],
    [12, -0.15],
    [18, 0],
    [24, 0.15],
  ]);

  // A time-slider band over 0…12 selects those keys; `4` over the slider makes them linear (§4.10 tangent digits).
  await page.keyboard.down('Shift');
  await drag(page, await sliderPoint(page, 0), await sliderPoint(page, 12));
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await call(page, 'state')).band).toEqual({ start: 0, end: 12 });
  await page.keyboard.press('Digit4');
  await expect
    .poll(async () =>
      (await keysOf(page, ikLeft, 'tz')).filter((key) => key.t <= 12).map((key) => [key.inType, key.outType]),
    )
    .toEqual([
      ['linear', 'linear'],
      ['linear', 'linear'],
    ]);

  // cog: Outliner pick, Channel Box typing and S at 0/6/12/18/24 (down at the contacts, up at the passing poses).
  await clickOutlinerRow(page, cog);
  await expectSelected(page, [cog]);
  for (const [frame, ty, tx] of [
    [0, '-0.05', '0'],
    [6, '-0.02', '0.02'],
    [12, '-0.05', '0'],
    [18, '-0.02', '-0.02'],
    [24, '-0.05', '0'],
  ] as const) {
    await keyWithChannelBox(page, cog, frame, { ty, tx });
  }

  // Pose › Mirror Animation › Left → Right (half cycle) with ik.leg.L selected (Outliner row).
  await clickOutlinerRow(page, ikLeft);
  await expectSelected(page, [ikLeft]);
  const leftBeforeMirror = await call(page, 'curves', clip, ikLeft);
  await page.getByTestId('menu-pose').click();
  await page.getByTestId('menu-sub-pose.mirror-animation').click();
  await page.getByTestId('menu-item-builtin.pose.mirror-animation.leftToRight-half').click();
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Mirror Animation');
  // The source side is unchanged; the right side is the half-cycle mirror (E2E-M2A-15 rule, 1e-9).
  expect(await call(page, 'curves', clip, ikLeft)).toEqual(leftBeforeMirror);
  for (let t = 0; t < 24; t++) {
    const l = await call(page, 'channelValues', ikLeft, t);
    const r = await call(page, 'channelValues', ikRight, (t + 12) % 24);
    expect([t, r['tx'], r['ty'], r['tz'], r['rx'], r['ry'], r['rz']]).toEqual([
      t,
      expect.closeTo(-(l['tx'] ?? 0), 9),
      expect.closeTo(l['ty'] ?? 0, 9),
      expect.closeTo(l['tz'] ?? 0, 9),
      expect.closeTo(l['rx'] ?? 0, 9),
      expect.closeTo(-(l['ry'] ?? 0), 9),
      expect.closeTo(-(l['rz'] ?? 0), 9),
    ]);
  }

  // Dope Sheet: with cog selected, Shift-select its row's glyphs at 6 and 18 and drag them to 5 and 17.
  await clickOutlinerRow(page, cog);
  await expectSelected(page, [cog]);
  await showDopeSheet(page);
  await expect.poll(async () => (await call(page, 'dopeSheet'))?.rows.some((row) => row.id === cog)).toBe(true);
  const glyph6 = await dopeKey(page, cog, 6);
  await page.mouse.click(glyph6.x, glyph6.y);
  const glyph18 = await dopeKey(page, cog, 18);
  await page.keyboard.down('Shift');
  await page.mouse.click(glyph18.x, glyph18.y);
  await page.keyboard.up('Shift');
  await expect
    .poll(async () => (await call(page, 'dopeSheet'))?.rows.find((row) => row.id === cog)?.selected)
    .toEqual([6, 18]);
  await drag(page, await dopeKey(page, cog, 6), { x: await dopeX(page, 5), y: glyph6.y });
  await expect.poll(async () => (await keysOf(page, cog, 'ty')).map((key) => key.t)).toEqual([0, 5, 12, 17, 24]);
  expect((await keysOf(page, cog, 'tx')).map((key) => key.t)).toEqual([0, 5, 12, 17, 24]);

  // A click on an empty area of the Dope Sheet canvas clears the key selection.
  const sheet = await call(page, 'dopeSheet');
  if (sheet === null) throw new Error('the Dope Sheet is hidden');
  await page.mouse.click(await dopeX(page, 9), sheet.canvasRect.y + sheet.canvasRect.h - 8);
  await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([]);

  // Tween a breakdown into the left foot's lift: ik.leg.L, its ty row in the Channel Box, frame 21, the status-line
  // Tween bar from 0 to 50 (target: the pose at the current frame, because no key is selected, M2A-D15).
  await clickOutlinerRow(page, ikLeft);
  await expectSelected(page, [ikLeft]);
  await page.getByTestId('cb-name-ty').click();
  await clickFrame(page, 21);
  expect(await call(page, 'tweenTarget', 'status')).toEqual({ kind: 'frame', label: 'Pose @ f21' });
  const beforeTween = await clipCurves(page, clip);
  await dragTween(page, 'status', 0, 50);
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Tween');
  const afterTween = await clipCurves(page, clip);
  const tyLeft = afterTween.find((curve) => curve.control === ikLeft && curve.channel === 'ty');
  const at21 = tyLeft?.keys.find((key) => key.t === 21);
  expect(at21?.v).toBeCloseTo(0.015, 9);
  expect(at21?.breakdown).toBe(true);
  // No other curve gained a key at 21.
  const gained = (curves: readonly Curve[]) =>
    curves
      .filter((curve) => curve.keys.some((key) => key.t === 21))
      .map((curve) => `${curve.control}:${curve.channel}`);
  expect(gained(beforeTween)).toEqual([]);
  expect(gained(afterTween)).toEqual([`${ikLeft}:ty`]);

  // The planted feet: left over 0…12, right over 12…24 (x, y fixed; z linear: they slide only with the treadmill).
  await expectPlanted(page, character, 'leftFoot', 0, 12);
  await expectPlanted(page, character, 'rightFoot', 12, 24);
  // The hips move meanwhile.
  const hips = await boneWorlds(page, character, ['hips'], 0);
  const hipsPassing = await boneWorlds(page, character, ['hips'], 5);
  expect(Math.abs((hips.hips?.t[1] ?? 0) - (hipsPassing.hips?.t[1] ?? 0))).toBeGreaterThan(0.02);

  // Loop clip curves cycle (§5.23) and cog tx is C¹ at the seam; the pose at 24 is the pose at 0.
  for (const curve of afterTween)
    expect([curve.control, curve.channel, curve.pre, curve.post]).toEqual([
      curve.control,
      curve.channel,
      'cycle',
      'cycle',
    ]);
  const cogTx = afterTween.find((curve) => curve.control === cog && curve.channel === 'tx');
  if (cogTx === undefined) throw new Error('no cog tx curve');
  const left = await call(page, 'curveSlope', cogTx.id, 24, 'left');
  const right = await call(page, 'curveSlope', cogTx.id, 0, 'right');
  expect(Math.abs(right)).toBeGreaterThan(1e-4); // the sway crosses the seam with velocity
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1e-9);
  expectPoseClose(await poseAt(page, character, 24), await poseAt(page, character, 0), 1e-6, 'pose 24 vs 0');
  for (const control of await call(page, 'controls')) {
    const a = await call(page, 'channelValues', control.id, 0);
    const b = await call(page, 'channelValues', control.id, 24);
    for (const [channel, value] of Object.entries(a)) {
      expect(Math.abs((b[channel] ?? Number.NaN) - value), `${control.key}.${channel} 24 vs 0`).toBeLessThanOrEqual(
        1e-6,
      );
    }
  }

  // Export VRMA through the dialog with "Reduce keys": valid, never more samples than the unreduced export and
  // within the §5.16 per-node tolerances of it. (A smooth 30 fps walk keeps every sample at R02's tolerances on
  // Polybot: dropping any one moves a track by 2.6e-4 m or 1e-3 rad and more against 9.4e-5 m / ≤ 9e-4 rad; the
  // ≥ 3× shrink is E2E-M2A-21b's, on linear blocking keys. M2A-INT-3 in docs/wp-notes/m2a-integration.md.)
  const reducedBytes = await exportVrmaThroughDialog(page, true);
  await expect(page.locator('[data-testid="toast"][data-kind="success"]').last()).toContainText(/\d+ → \d+ samples/);
  const plainBytes = await exportVrmaThroughDialog(page, false);
  expect((await validationReport(reducedBytes)).errors).toBe(0);
  expect((await validationReport(plainBytes)).errors).toBe(0);
  const [reduced, plain] = [await tracksOf(reducedBytes), await tracksOf(plainBytes)];
  test.info().annotations.push({
    type: 'reduction',
    description: `${totalSamples(plain)} → ${totalSamples(reduced)} samples`,
  });
  expect(totalSamples(reduced)).toBeLessThanOrEqual(totalSamples(plain));
  expect(reduced.map((track) => `${track.bone}.${track.path}`)).toEqual(
    plain.map((track) => `${track.bone}.${track.path}`),
  );
  await expectWithinReduceTolerances(reduced, plain, 'polybot.vrm', 24);

  // Authored without Plant Feet: no history step of the scenario is one (undo walk back to the clip setup, redo).
  const curvesBefore = await clipCurves(page, clip);
  const labels = await historyLabelsSince(page, anchor);
  expect(labels.filter((label) => /plant feet/i.test(label))).toEqual([]);
  // Newest first: the tween, the Dope Sheet move, the mirror, cog's five keys, the tangents and the foot's four keys.
  expect(labels.slice(0, 3)).toEqual(['Tween', 'Move Keys', 'Mirror Animation']);
  expect(labels.filter((label) => label === 'Set Key')).toHaveLength(9);
  expect(labels).toContain('Tangents: linear');
  expect(await clipCurves(page, clip)).toEqual(curvesBefore);
});

test('E2E-M2A-24: acceptance — attack clip with planted feet', async ({ page }) => {
  test.setTimeout(300_000);
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await expectLimbIk(page);
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'attack' });
  await runOk(page, 'clip.setSettings', { clip, range: { start: 0, end: 20 }, slot: 'attack', contact: 12 });
  const anchor = (await call(page, 'state')).history.undoLabel ?? '';
  expect(anchor).not.toBe('');
  const ikLeft = await controlIdOf(page, 'ik.leg.L');
  const ikRight = await controlIdOf(page, 'ik.leg.R');
  const cog = await controlIdOf(page, 'cog');
  const upperArm = await controlIdOf(page, 'fk.upperArm.R');
  const lowerArm = await controlIdOf(page, 'fk.lowerArm.R');

  // The stance: left foot forward, right foot back, each keyed once at 0 (Channel Box typing, S).
  await clickOutlinerRow(page, ikLeft);
  await expectSelected(page, [ikLeft]);
  await keyWithChannelBox(page, ikLeft, 0, { tz: '0.2' });
  await clickOutlinerRow(page, ikRight);
  await expectSelected(page, [ikRight]);
  await keyWithChannelBox(page, ikRight, 0, { tz: '-0.1' });

  // cog: the ready stance at 0 and 20 (hips 5 cm down), the lunge at 12 (down, forward and turned 25°).
  await clickOutlinerRow(page, cog);
  await expectSelected(page, [cog]);
  for (const [frame, fields] of [
    [0, { ty: '-0.05', tz: '0', ry: '0' }],
    [12, { ty: '-0.08', tz: '0.12', ry: '25' }],
    [20, { ty: '-0.05', tz: '0', ry: '0' }],
  ] as const) {
    await keyWithChannelBox(page, cog, frame, fields);
  }

  // The right arm: rest at 0 and 20, windup at 8, strike at 12 (degrees in the Channel Box).
  for (const [control, poses] of [
    [
      upperArm,
      [
        [0, { rx: '0', rz: '0' }],
        [8, { rx: '-50', rz: '40' }],
        [12, { rx: '60', rz: '10' }],
        [20, { rx: '0', rz: '0' }],
      ],
    ],
    [
      lowerArm,
      [
        [0, { ry: '0' }],
        [8, { ry: '70' }],
        [12, { ry: '5' }],
        [20, { ry: '0' }],
      ],
    ],
  ] as const) {
    await clickOutlinerRow(page, control);
    await expectSelected(page, [control]);
    for (const [frame, fields] of poses) await keyWithChannelBox(page, control, frame, fields);
  }

  // Dope Sheet: the windup keys of both arm controls move from 8 to 9 (summary glyph, one drag).
  await clickOutlinerRow(page, upperArm);
  await clickOutlinerRow(page, lowerArm, ['Shift']);
  await expectSelected(page, [upperArm, lowerArm]);
  await showDopeSheet(page);
  const summary8 = await dopeKey(page, 'summary', 8);
  await page.mouse.click(summary8.x, summary8.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys.length).toBeGreaterThan(0);
  await drag(page, summary8, { x: await dopeX(page, 9), y: summary8.y });
  for (const control of [upperArm, lowerArm]) {
    await expect.poll(async () => (await keysOf(page, control, 'rx')).map((key) => key.t)).toEqual([0, 9, 12, 20]);
  }

  // Planted feet: both foot bone worlds identical at every integer frame 0…20 while the hips move.
  const feet0 = await boneWorlds(page, character, ['leftFoot', 'rightFoot', 'hips'], 0);
  let hipsTravel = 0;
  for (let frame = 0; frame <= 20; frame++) {
    const worlds = await boneWorlds(page, character, ['leftFoot', 'rightFoot', 'hips'], frame);
    for (const bone of ['leftFoot', 'rightFoot'] as const) {
      const a = worlds[bone] as World;
      const b = feet0[bone] as World;
      expect(Math.hypot(a.t[0] - b.t[0], a.t[1] - b.t[1], a.t[2] - b.t[2]), `${bone} at ${frame}`).toBeLessThanOrEqual(
        1e-6,
      );
      expect(quatAngle(a.q, b.q), `${bone} rotation at ${frame}`).toBeLessThanOrEqual(1e-6);
    }
    const h = worlds.hips as World;
    const h0 = feet0.hips as World;
    hipsTravel = Math.max(hipsTravel, Math.hypot(h.t[0] - h0.t[0], h.t[1] - h0.t[1], h.t[2] - h0.t[2]));
  }
  expect(hipsTravel).toBeGreaterThan(0.1);
  // The IK targets are where they were keyed (the feet reach them).
  expect((await call(page, 'controlWorld', ikLeft, 12)).t[2]).toBeCloseTo(
    (await call(page, 'controlWorld', ikLeft, 0)).t[2],
    9,
  );

  // Export VRMA and bake into the model.
  const vrma = await exportOne(page, { kind: 'vrma', character, clips: [clip] });
  expect(await validatorErrors(vrma.bytes)).toEqual([]);
  const meta = readGlb(vrma.bytes).json.asset as { extras?: { ekza_animation_v1?: { clips?: unknown[] } } };
  const clipMeta = meta.extras?.ekza_animation_v1?.clips?.[0] as { contactSeconds?: number; slot?: string };
  expect(clipMeta.slot).toBe('attack');
  expect(clipMeta.contactSeconds).toBeCloseTo(12 / 30, 9);
  const bake = await exportOne(page, { kind: 'bake-into-model', character, clips: [clip] });
  expect(await newValidatorErrors(sampleBytes('seed-san.vrm'), bake.bytes)).toEqual([]);

  // Authored without Plant Feet (undo walk back to the clip setup, then redo).
  const curvesBefore = await clipCurves(page, clip);
  const labels = await historyLabelsSince(page, anchor);
  expect(labels.filter((label) => /plant feet/i.test(label))).toEqual([]);
  // Newest first: the Dope Sheet move, then the keys (2 feet, 3 cog, 4 + 4 arm) and the unkeyed first edits.
  expect(labels[0]).toBe('Move Keys');
  expect(labels.filter((label) => label === 'Set Key')).toHaveLength(13);
  expect(await clipCurves(page, clip)).toEqual(curvesBefore);
});
