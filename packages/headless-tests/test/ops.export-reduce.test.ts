// M2A-SPEC §5.16 (FR-EXP-12) through `file.export` on the fixtures: `reduce` absent or null gives the M1 bytes, a
// reduced export validates, reads back against the reduced clip, reports its stats and stays within the per-node
// tolerances of the unreduced bake at every integer frame; re-exports are byte-identical.
import { quatSlerp, type Quat } from '@ekza-animator/anim-core';
import type { CharacterId, ClipId } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import {
  DEFAULT_EXPORT_REDUCE,
  type ExportArtifact,
  type ExportRequest,
  parseGlb,
  readAnimations,
  sha256Hex,
  skeletonFromGltf,
  trackLeverArms,
} from '@ekza-animator/io';
import { EkzaError } from '@ekza-animator/anim-core';
import { computeInfluenceKeyTimes, HUMAN_BONE_NAMES } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { BLOCKED, importFixture, realApp, runOk, SIBLINGS_READY, setSceneFrame } from './ops.support';

const DEG = Math.PI / 180;

/** rig A1 implements `computeInfluenceKeyTimes` (the §5.16 keep set's influence term; M2A-SPEC §8 `READY.a1`). */
const READY_A1 = (() => {
  try {
    computeInfluenceKeyTimes(undefined as never, undefined as never, { start: 0, end: 0 }, 'raw');
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
})();

function request(character: CharacterId, clips: readonly ClipId[], fields?: Partial<ExportRequest>): ExportRequest {
  return {
    kind: 'vrma',
    character,
    clips,
    fileNamePattern: '{character}_{clip}',
    closeLoop: true,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
    ...fields,
  };
}

function controlOf(app: EditorApp, character: CharacterId, key: string) {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

/** `name` with rotation keys on `keys[control]` at the given frames (degrees). */
async function keyedClip(
  app: EditorApp,
  character: CharacterId,
  name: string,
  end: number,
  keys: readonly (readonly [control: string, channel: 'rx' | 'ry' | 'rz', frame: number, degrees: number])[],
): Promise<ClipId> {
  const { clip } = (await runOk(app, 'clip.new', { character, name, range: { start: 0, end } })) as { clip: ClipId };
  for (const [control, channel, frame, degrees] of keys) {
    setSceneFrame(app, frame);
    await runOk(app, 'channel.setValues', {
      edits: [{ control: controlOf(app, character, control), channel, value: degrees * DEG }],
      key: 'force',
    });
  }
  return clip;
}

/** E2E-16's wave: `fk.lowerArm.L` rz 30/−30/30° at 0/15/30. */
const WAVE = [
  ['fk.lowerArm.L', 'rz', 0, 30],
  ['fk.lowerArm.L', 'rz', 15, -30],
  ['fk.lowerArm.L', 'rz', 30, 30],
] as const;

/** A slow hand-keyed sway over 4 s: arms, spine and head keyed every 30 frames (auto tangents). */
const SWAY = (['fk.upperArm.L', 'fk.upperArm.R', 'fk.spine', 'fk.head'] as const).flatMap((control, c) =>
  [0, 30, 60, 90, 120].map((frame, i) => [control, 'rz', frame, (i % 2 === 0 ? 1 : -1) * (6 + c)] as const),
);

/** Blocking with linear tangents: every arm, leg, spine and neck control swings rz between two poses. */
const BLOCK_CONTROLS = [
  'fk.spine',
  'fk.chest',
  'fk.neck',
  'fk.head',
  'fk.shoulder.L',
  'fk.upperArm.L',
  'fk.lowerArm.L',
  'fk.hand.L',
  'fk.shoulder.R',
  'fk.upperArm.R',
  'fk.lowerArm.R',
  'fk.hand.R',
  'fk.upperLeg.L',
  'fk.lowerLeg.L',
  'fk.foot.L',
  'fk.upperLeg.R',
  'fk.lowerLeg.R',
  'fk.foot.R',
] as const;
const BLOCK = BLOCK_CONTROLS.flatMap((control, c) =>
  [0, 15, 30].map((frame, i) => [control, 'rz', frame, (i === 1 ? -1 : 1) * (5 + (c % 7))] as const),
);

async function exportOne(app: EditorApp, req: ExportRequest): Promise<ExportArtifact> {
  const artifacts = (await runOk(app, 'file.export', req)) as readonly ExportArtifact[];
  const [artifact] = artifacts;
  if (artifact === undefined) throw new Error('no artifact');
  return artifact;
}

interface ReadTrack {
  readonly bone: string;
  readonly path: string;
  readonly times: Float32Array;
  readonly values: Float32Array;
}

/** Every channel of the first animation, by humanoid bone name. */
async function tracksOf(bytes: Uint8Array): Promise<ReadTrack[]> {
  const container = await parseGlb(bytes);
  const skeleton = skeletonFromGltf(container);
  const [animation] = readAnimations(container, skeleton);
  if (animation === undefined) throw new Error('no animation');
  return animation.channels.map((channel) => ({
    bone: skeleton.nodes[channel.node]?.name ?? String(channel.node),
    path: channel.path,
    times: channel.times,
    values: channel.values,
  }));
}

function sampleAt(track: ReadTrack, t: number): number[] {
  const width = track.path === 'rotation' ? 4 : 3;
  const n = track.times.length;
  let i = 0;
  while (i < n - 1 && (track.times[i + 1] as number) <= t) i++;
  const j = Math.min(i + 1, n - 1);
  const t0 = track.times[i] as number;
  const t1 = track.times[j] as number;
  const alpha = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const a = Array.from(track.values.subarray(i * width, i * width + width));
  const b = Array.from(track.values.subarray(j * width, j * width + width));
  if (width === 4) return quatSlerp(a as unknown as Quat, b as unknown as Quat, alpha);
  return a.map((v, c) => v + ((b[c] as number) - v) * alpha);
}

const totalSamples = (tracks: readonly ReadTrack[]) => tracks.reduce((sum, t) => sum + t.times.length, 0);

describe.skipIf(!SIBLINGS_READY)(`file.export with reduce ${BLOCKED}`, { timeout: 120_000 }, () => {
  it('reduce absent and null write the same bytes on every exporter (the M1 output)', async () => {
    const { app } = realApp({ validator: false });
    const seed = await importFixture(app, 'seed-san.vrm');
    const wave = await keyedClip(app, seed.character, 'wave', 30, WAVE);
    for (const kind of ['vrma', 'animation-glb', 'bake-into-model'] as const) {
      const absent = await exportOne(app, request(seed.character, [wave], { kind }));
      const none = await exportOne(app, request(seed.character, [wave], { kind, reduce: null }));
      expect(none.sha256).toBe(absent.sha256);
      expect('reduction' in absent.stats).toBe(false);
    }
  });

  it('Seed-san wave VRMA: validates, reads back, reports N → M and stays within the node tolerances', async () => {
    const { app, services } = realApp();
    const seed = await importFixture(app, 'seed-san.vrm');
    const wave = await keyedClip(app, seed.character, 'wave', 30, WAVE);
    const plain = await exportOne(app, request(seed.character, [wave]));
    const reduced = await exportOne(app, request(seed.character, [wave], { reduce: DEFAULT_EXPORT_REDUCE }));
    for (const artifact of [plain, reduced]) {
      expect(artifact.validation?.errors).toBe(0);
      expect(artifact.readBack?.ok).toBe(true);
      expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    }
    const before = await tracksOf(plain.bytes);
    const after = await tracksOf(reduced.bytes);
    const stats = reduced.stats.reduction;
    expect(stats?.samplesBefore).toBe(totalSamples(before));
    expect(stats?.samplesAfter).toBe(totalSamples(after));
    expect(stats?.samplesAfter).toBeLessThanOrEqual(stats?.samplesBefore ?? 0);
    expect(services.toasts.at(-1)?.text).toContain(`${stats?.samplesBefore} → ${stats?.samplesAfter} samples`);
    // Every integer frame of every written track within its node tolerance of the unreduced bake.
    const skeleton = seed.runtime.skeleton;
    const lever = trackLeverArms(skeleton, 'humanoid');
    const epsPos = DEFAULT_EXPORT_REDUCE.positionM * (skeleton.height / 1.7);
    for (const original of before) {
      const track = after.find((t) => t.bone === original.bone && t.path === original.path);
      expect(track, `${original.bone}/${original.path}`).toBeDefined();
      if (track === undefined) continue;
      const bone = HUMAN_BONE_NAMES.indexOf(original.bone as never);
      const tol =
        original.path === 'rotation'
          ? Math.min(DEFAULT_EXPORT_REDUCE.rotationCapRad, epsPos / Math.max(lever.get(bone) ?? 0, 0.01))
          : epsPos;
      for (let frame = 0; frame <= 30; frame++) {
        const t = Math.fround(frame / 30);
        const want = sampleAt(original, t);
        const got = sampleAt(track, t);
        const error =
          original.path === 'rotation'
            ? 2 * Math.acos(Math.min(1, Math.abs(want.reduce((s, v, c) => s + v * (got[c] as number), 0))))
            : Math.hypot(...want.map((v, c) => v - (got[c] as number)));
        expect(error, `${original.bone}/${original.path} at ${frame}`).toBeLessThanOrEqual(tol * (1 + 1e-6) + 1e-6);
      }
    }
  });

  it('re-exports are byte-identical; a slow auto-tangent sway stays within tolerance and never grows', async () => {
    const { app } = realApp({ validator: false });
    const seed = await importFixture(app, 'seed-san.vrm');
    const sway = await keyedClip(app, seed.character, 'sway', 120, SWAY);
    const plain = await exportOne(app, request(seed.character, [sway]));
    const a = await exportOne(app, request(seed.character, [sway], { reduce: DEFAULT_EXPORT_REDUCE }));
    const b = await exportOne(app, request(seed.character, [sway], { reduce: DEFAULT_EXPORT_REDUCE }));
    expect(b.sha256).toBe(a.sha256);
    expect(await sha256Hex(b.bytes)).toBe(a.sha256);
    const before = totalSamples(await tracksOf(plain.bytes));
    const after = totalSamples(await tracksOf(a.bytes));
    // Recorded in docs/wp-notes/m2a-platform-perf.md (M2A-A5-3): R02's 0.2 mm tolerances keep most samples of a
    // curved LINEAR track; the shrink comes from linear and held spans.
    expect(after).toBeLessThan(before);
    expect(a.stats.reduction?.samplesAfter).toBe(after);
    expect(a.readBack?.ok).toBe(true);
  });

  it('linear blocking on 18 controls shrinks ≥ 3× (held and linear spans keep only their ends)', async () => {
    const { app } = realApp({ validator: false });
    app.prefs.setState({ defaultTangents: { in: 'linear', out: 'linear' } });
    const seed = await importFixture(app, 'seed-san.vrm');
    const block = await keyedClip(app, seed.character, 'block', 30, BLOCK);
    const plain = await exportOne(app, request(seed.character, [block]));
    const reduced = await exportOne(app, request(seed.character, [block], { reduce: DEFAULT_EXPORT_REDUCE }));
    const before = totalSamples(await tracksOf(plain.bytes));
    const after = totalSamples(await tracksOf(reduced.bytes));
    expect(after * 3).toBeLessThanOrEqual(before);
    expect(reduced.stats.reduction).toMatchObject({ samplesBefore: before, samplesAfter: after });
    expect(reduced.readBack?.ok).toBe(true);
  });

  it('refuses a malformed reduce spec in the poll', async () => {
    const { app } = realApp({ validator: false });
    const seed = await importFixture(app, 'polybot.vrm');
    const wave = await keyedClip(app, seed.character, 'wave', 30, WAVE);
    for (const reduce of [{ ...DEFAULT_EXPORT_REDUCE, positionM: -1 }, { positionM: 1 }, 'yes']) {
      const result = await app.runUntyped('file.export', request(seed.character, [wave], { reduce: reduce as never }));
      expect(result.status).toBe('cancelled');
    }
  });

  it.skipIf(!READY_A1)('keeps the key times of the influencing curves (READY.a1)', async () => {
    const { app } = realApp({ validator: false });
    const seed = await importFixture(app, 'seed-san.vrm');
    // a key at 7 that changes the pose by far less than the tolerance: only the keep set can hold its sample
    const clip = await keyedClip(app, seed.character, 'nudge', 30, [
      ['fk.lowerArm.L', 'rz', 0, 0],
      ['fk.lowerArm.L', 'rz', 7, 0.001],
      ['fk.lowerArm.L', 'rz', 30, 0],
    ]);
    const reduced = await exportOne(app, request(seed.character, [clip], { reduce: DEFAULT_EXPORT_REDUCE }));
    const arm = (await tracksOf(reduced.bytes)).find((t) => t.bone === 'leftLowerArm' && t.path === 'rotation');
    expect(Array.from(arm?.times ?? []).map((t) => Math.round(t * 30))).toContain(7);
  });
});
