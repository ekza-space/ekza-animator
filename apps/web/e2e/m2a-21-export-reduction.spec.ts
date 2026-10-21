// E2E-M2A-21 (FR-EXP-12, M2A-SPEC §5.16): export-side key reduction through the Export dialog. Seed-san with the wave
// clip (E2E-16's keys) is exported as VRMA with "Reduce keys" checked and then unchecked: both files validate, the
// reduced one never has more samples or bytes, and sampling both files' tracks in Node at every integer frame differs by no
// more than the per-node tolerances. The ≥ 3× shrink is asserted on linear blocking keys (M2A-A5-3 in
// docs/wp-notes/m2a-platform-perf.md: at R02's 0.2 mm tolerances the wave's 60° swing in 15 frames keeps its samples).
import { readFileSync } from 'node:fs';
import { DEFAULT_EXPORT_REDUCE, parseGlb, readAnimations, skeletonFromGltf, trackLeverArms } from '@ekza-studio/io';
import { expect, type Page, test } from '@playwright/test';
import { exportOne, sampleBytes, validationReport } from './helpers/g4-export';
import { controlId, seedSample, seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

const DEG = Math.PI / 180;

interface Track {
  readonly bone: string;
  readonly path: string;
  readonly times: Float32Array;
  readonly values: Float32Array;
}

/** Every channel of a VRMA's animation by humanoid node name. */
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

const total = (tracks: readonly Track[]) => tracks.reduce((sum, track) => sum + track.times.length, 0);

/** The value a player computes at time t (LINEAR: slerp / lerp between the neighbouring samples). */
function sample(track: Track, t: number): number[] {
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

function error(path: string, a: readonly number[], b: readonly number[]): number {
  if (path === 'rotation') {
    return 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, v, c) => sum + v * (b[c] as number), 0))));
  }
  return Math.hypot(...a.map((v, c) => v - (b[c] as number)));
}

/** Exports the active clip through the Export dialog (VRMA) with "Reduce keys" set as given; returns the file. */
async function exportThroughDialog(page: Page, reduce: boolean): Promise<Uint8Array> {
  await runOk(page, 'ui.open', { dialog: 'export' });
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-kind-vrma').click();
  const checkbox = page.getByTestId('export-reduce');
  await expect(checkbox).toBeChecked(); // prefs.exportReduce.enabled: on by default
  if (!reduce) await checkbox.uncheck();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('export-confirm').click();
  const file = await download;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  await expect(page.getByTestId('export-stats')).toBeVisible();
  if (reduce) await expect(page.getByTestId('export-stats')).toContainText('samples');
  else await expect(page.getByTestId('export-stats')).not.toContainText('samples');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  return bytes;
}

test('E2E-M2A-21: export key reduction', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await expectKernelStarted(page);
  await seedWaveClip(page, 'seed-san');

  const reducedBytes = await exportThroughDialog(page, true);
  await expect(page.locator('[data-testid="toast"][data-kind="success"]').last()).toContainText(/\d+ → \d+ samples/);
  const plainBytes = await exportThroughDialog(page, false);
  for (const bytes of [reducedBytes, plainBytes]) {
    expect((await validationReport(bytes)).errors).toBe(0);
  }
  const reduced = await tracksOf(reducedBytes);
  const plain = await tracksOf(plainBytes);
  expect(total(reduced)).toBeLessThanOrEqual(total(plain));
  // Never larger in bytes either (fix round 1, bug 3: per-track time accessors made reduced files larger).
  expect(reducedBytes.byteLength).toBeLessThanOrEqual(plainBytes.byteLength);
  test.info().annotations.push({ type: 'reduction', description: `${total(plain)} → ${total(reduced)} samples` });

  // Per-node tolerances of §5.16 from Seed-san's rest skeleton (H, L_j).
  const skeleton = skeletonFromGltf(await parseGlb(sampleBytes('seed-san.vrm')));
  // L_j of the bone's node in the source model (the VRMA's nodes are named after the humanoid bones).
  const levers = trackLeverArms(skeleton, 'raw');
  const humanoid = (skeleton.humanoid ?? {}) as Readonly<Record<string, number>>;
  const epsPos = DEFAULT_EXPORT_REDUCE.positionM * (skeleton.height / 1.7);
  // The clip's whole range (the wave keys span 0…30 of the new clip's default range).
  const frames = Math.round((plain[0]?.times.at(-1) ?? 0) * 30);
  expect(frames).toBeGreaterThanOrEqual(30);
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
      const e = error(original.path, sample(track, t), sample(original, t));
      expect(e, `${original.bone} ${original.path} at ${frame}`).toBeLessThanOrEqual(tolerance * (1 + 1e-6) + 1e-6);
    }
  }
});

test('E2E-M2A-21b: linear blocking keys shrink ≥ 3× within the tolerances', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await expectKernelStarted(page);
  await runOk(page, 'prefs.set', { patch: { defaultTangents: { in: 'linear', out: 'linear' } } });
  const { character } = await seedSample(page, 'seed-san');
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'block' });
  const keys = ['fk.spine', 'fk.chest', 'fk.neck', 'fk.head', 'fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L'];
  keys.push('fk.upperArm.R', 'fk.lowerArm.R', 'fk.hand.R', 'fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.upperLeg.R');
  keys.push('fk.lowerLeg.R');
  const ids: string[] = [];
  for (const key of keys) ids.push(await controlId(page, key, character));
  await runOk(page, 'select.controls', { ids, mode: 'replace' });
  for (const [i, frame] of [0, 15, 30].entries()) {
    await runOk(page, 'time.setFrame', { frame });
    const edits = ids.map((control, c) => ({
      control,
      channel: 'rz',
      value: (i === 1 ? -1 : 1) * (5 + (c % 7)) * DEG,
    }));
    await runOk(page, 'channel.setValues', { edits });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  const request = { kind: 'vrma', character, clips: [clip] } as const;
  const plain = await exportOne(page, request);
  const reduced = await exportOne(page, { ...request, reduce: DEFAULT_EXPORT_REDUCE });
  expect((await validationReport(reduced.bytes)).errors).toBe(0);
  const before = total(await tracksOf(plain.bytes));
  const after = total(await tracksOf(reduced.bytes));
  test.info().annotations.push({ type: 'reduction', description: `${before} → ${after} samples` });
  expect(after * 3).toBeLessThanOrEqual(before);
  expect(reduced.bytes.byteLength).toBeLessThan(plain.bytes.byteLength);
  expect((await call(page, 'counts'))['characters']).toBe(1);
});
