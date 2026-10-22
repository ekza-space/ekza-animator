// AUTORIG-SPEC §4.5, §5.2, §6.1, §6.2 (D3): the ① Model compositions. `autorig.intake` sniffs by content and runs one
// import (one undo step) — static GLB, VRM, skinned GLB (`rigged-other` imports nothing; `dropSkin` re-rigs from
// scratch), project — and refuses animations, unsupported formats and models over 200,000 triangles before importing;
// `autorig.inspect` reports C2's start checks plus the upright, size and pose rows without a step; every
// `autorig.fix` is exactly one undo step (AS-AR-5: a Z-up, ×100, off-centre Cube Lad is fixed by three steps and then
// guesses within 0.05 H); `autorig.sample` fetches the static fixtures from `<samplesPath>`.
import { readFileSync } from 'node:fs';
import type { MeshId } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { guessMarkers, type QuickRigMarker } from '@ekza-studio/rig';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EditorApp, type IntakeReport, QUICK_RIG_MARKERS } from '../../src';
import {
  ANIMATION_FILE,
  gltfTriangles,
  glbJson,
  scaleOf,
  sniffFile,
  tooHeavyMessage,
  UNSUPPORTED_FILE,
  weightOf,
} from '../../src/operators/builtin/rig/wizard/intake';
import { rigGeometry } from '../../src/operators/builtin/rig/skeleton';
import { meshTestApp } from '../mesh/support';
import { glbWith, heavyGlb, rootTransformed, skinnedCopy } from './glb';

const DEG = Math.PI / 180;
const fixture = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${file}`, import.meta.url)));

interface PolybotTruth {
  readonly poses: Readonly<
    Record<'apose' | 'tpose', { readonly height: number; readonly markers: Record<QuickRigMarker, readonly number[]> }>
  >;
}
const polybotTruth = (): PolybotTruth =>
  <PolybotTruth>(
    JSON.parse(readFileSync(new URL('../../../../fixtures/models/polybot-truth.json', import.meta.url), 'utf8'))
  );
interface LadTruth {
  readonly height: number;
  readonly markers: Record<QuickRigMarker, readonly number[]>;
}
const cubeLadTruth = (): LadTruth =>
  <LadTruth>(
    JSON.parse(readFileSync(new URL('../../../../fixtures/models/cube-lad-truth.json', import.meta.url), 'utf8'))
  );

async function run<T>(app: EditorApp, id: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

/** Undo labels from the top down (each undo returns the label it undid), then redone back in order. */
function undoLabels(app: EditorApp): string[] {
  const labels: string[] = [];
  while (app.history.canUndo()) labels.push(app.history.undo()?.label ?? '?');
  while (app.history.canRedo()) app.history.redo();
  return labels.reverse();
}

const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sniffing and tiers (§5.2, §6.2)', () => {
  it('reads files by content first, then by name', () => {
    expect(sniffFile('anything.bin', fixture('cube-lad.glb'))).toBe('static');
    expect(sniffFile('avatar.glb', readFixture('polybot.vrm'))).toBe('vrm');
    expect(sniffFile('model.glb', skinnedCopy(fixture('cube-lad.glb')))).toBe('skinned');
    expect(sniffFile('walk.vrma', fixture('cube-lad.glb'))).toBe('vrma');
    expect(sniffFile('scene.ekzanim', new Uint8Array([1, 2, 3]))).toBe('project');
    expect(sniffFile('model.fbx', new TextEncoder().encode('Kaydara FBX Binary'))).toBe('unsupported');
    expect(sniffFile('model.glb', new Uint8Array(10))).toBe('unsupported');
    expect(sniffFile('clip.glb', glbWith({ extensionsUsed: ['VRMC_vrm_animation'] }))).toBe('vrma');
  });

  it('counts triangles from the accessors and sorts them into the §6.2 tiers', () => {
    expect(gltfTriangles(glbJson(fixture('cube-lad.glb')) ?? {})).toBe(192);
    expect(gltfTriangles(glbJson(heavyGlb(250_000)) ?? {})).toBe(250_000);
    expect([20_000, 20_001, 60_000, 60_001, 200_000, 200_001].map(weightOf)).toEqual([
      'light',
      'medium',
      'medium',
      'heavy',
      'heavy',
      'too-heavy',
    ]);
    expect([0.29, 0.3, 1.7, 3, 3.01, 170].map(scaleOf)).toEqual(['tiny', 'ok', 'ok', 'ok', 'huge', 'huge']);
  });
});

describe('autorig.intake (§5.2)', () => {
  it('imports a static GLB as scene meshes in one undo step and reports every check', async () => {
    const { app } = await meshTestApp();
    const bytes = fixture('cube-lad.glb');
    const report = await run<IntakeReport>(app, 'autorig.intake', { bytes, name: 'cube-lad.glb' });
    expect(report).toMatchObject({
      kind: 'static',
      fileName: 'cube-lad.glb',
      bytes: bytes.byteLength,
      triangles: 192,
      textured: false,
      checks: { centred: true, grounded: true, facing: true, upright: true, scale: 'ok' },
      weight: 'light',
    });
    expect(report.height).toBeCloseTo(cubeLadTruth().height, 3);
    expect(report.pose?.kind).toBe('t');
    expect(report.meshes).toHaveLength(1);
    expect(app.store.get('meshes', report.meshes[0] as MeshId)?.owner).toEqual({ scene: true });
    expect(undoLabels(app)).toEqual(['Import Static Model']);
  });

  it('reports the A-posed Polybot as an A-pose within 5° of its truth, textured', async () => {
    const { app } = await meshTestApp();
    const report = await run<IntakeReport>(app, 'autorig.intake', {
      bytes: fixture('polybot-unskinned.glb'),
      name: 'polybot-unskinned.glb',
    });
    expect(report.kind).toBe('static');
    expect(report.textured).toBe(true);
    expect(report.checks).toEqual({ centred: true, grounded: true, facing: true, upright: true, scale: 'ok' });
    expect(report.pose?.kind).toBe('a');
    // the truth's arm line (shoulder → wrist markers) below horizontal
    const m = polybotTruth().poses.apose.markers;
    const [s, w] = [m.shoulder, m.wrist];
    const truth = Math.atan2((s[1] ?? 0) - (w[1] ?? 0), Math.abs((s[0] ?? 0) - (w[0] ?? 0)));
    expect(Math.abs((report.pose?.armAngle ?? 0) - truth)).toBeLessThan(5 * DEG);

    const { app: tApp } = await meshTestApp();
    const tpose = await run<IntakeReport>(tApp, 'autorig.intake', {
      bytes: fixture('polybot-unskinned-tpose.glb'),
      name: 'polybot-unskinned-tpose.glb',
    });
    expect(tpose.pose?.kind).toBe('t');
  });

  it('routes a VRM to the shipped importer (one step) and reports a vrm character', async () => {
    const { app } = await meshTestApp();
    const report = await run<IntakeReport>(app, 'autorig.intake', { bytes: readFixture('polybot.vrm'), name: 'p.vrm' });
    expect(report).toMatchObject({ kind: 'vrm', fileName: 'p.vrm', meshes: [], textured: true, pose: null });
    expect(report.height).toBeGreaterThan(0.5);
    expect(app.store.list('characters')).toHaveLength(1);
    expect(app.store.list('characters')[0]?.source.kind).toBe('asset');
    expect(undoLabels(app)).toEqual(['Import p.vrm']);
  });

  it('a skinned GLB without a humanoid map imports nothing (rigged-other); dropSkin re-rigs it from scratch', async () => {
    const { app } = await meshTestApp();
    const skinned = skinnedCopy(fixture('cube-lad.glb'));
    const other = await run<IntakeReport>(app, 'autorig.intake', { bytes: skinned, name: 'lad-rigged.glb' });
    expect(other).toMatchObject({ kind: 'rigged-other', meshes: [], triangles: 192 });
    expect(app.store.list('meshes')).toHaveLength(0);
    expect(undoLabels(app)).toEqual([]);
    const again = await run<IntakeReport>(app, 'autorig.intake', {
      bytes: skinned,
      name: 'lad-rigged.glb',
      dropSkin: true,
    });
    expect(again.kind).toBe('static');
    expect(again.meshes).toHaveLength(1);
    expect(again.checks).toMatchObject({ centred: true, grounded: true, facing: true });
    expect(undoLabels(app)).toEqual(['Import Static Model']);
  });

  it('refuses animations, unsupported formats and too-heavy models before importing anything', async () => {
    const { app } = await meshTestApp();
    const refused = async (bytes: Uint8Array, name: string) => app.runUntyped('autorig.intake', { bytes, name });
    expect(await refused(fixture('cube-lad.glb'), 'walk.vrma')).toMatchObject({
      status: 'failed',
      error: { message: ANIMATION_FILE },
    });
    expect(await refused(new TextEncoder().encode('Kaydara FBX Binary  '), 'model.fbx')).toMatchObject({
      status: 'failed',
      error: { message: UNSUPPORTED_FILE },
    });
    expect(await refused(heavyGlb(250_000), 'heavy.glb')).toMatchObject({
      status: 'failed',
      error: { message: tooHeavyMessage(250_000) },
    });
    expect(tooHeavyMessage(250_000)).toContain('Reduce it to under 200,000 triangles (Blender: Decimate modifier)');
    expect(app.store.list('meshes')).toHaveLength(0);
    expect(undoLabels(app)).toEqual([]);
    expect(app.operators.poll('autorig.intake', undefined, { name: 'x.glb' })).toEqual({
      ok: false,
      reason: 'expects { bytes, name }',
    });
  });
});

describe('autorig.fix and autorig.inspect (§5.2; AS-AR-5)', () => {
  it('a Z-up, ×100, off-centre Cube Lad: three fixes are three undo steps, then the guess is within 0.05 H', async () => {
    const { app } = await meshTestApp();
    const bytes = rootTransformed(fixture('cube-lad.glb'), {
      rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], // +90° about X: +Y up becomes +Z up
      scale: [100, 100, 100],
      translation: [37, 5, -12],
    });
    const report = await run<IntakeReport>(app, 'autorig.intake', { bytes, name: 'lad-zup.glb' });
    expect(report.checks).toMatchObject({ upright: false, scale: 'huge', centred: false });
    expect(report.pose).toBeNull();
    const meshes = report.meshes;
    const version = app.store.version;
    const top = app.history.peekUndo()?.id;
    // inspect is U state: no step, no document change
    const same = await run<IntakeReport>(app, 'autorig.inspect', { meshes });
    expect(same.checks).toEqual(report.checks);
    expect(app.store.version).toBe(version);
    expect(app.history.peekUndo()?.id).toBe(top);

    await run(app, 'autorig.fix', { fix: 'standUp', meshes });
    let now = await run<IntakeReport>(app, 'autorig.inspect', { meshes });
    expect(now.checks.upright).toBe(true);
    expect(now.checks.scale).toBe('huge');
    await run(app, 'autorig.fix', { fix: 'scale', meshes });
    now = await run<IntakeReport>(app, 'autorig.inspect', { meshes });
    expect(now.checks.scale).toBe('ok');
    expect(now.height).toBeCloseTo(1.7, 6);
    await run(app, 'autorig.fix', { fix: 'center', meshes });
    now = await run<IntakeReport>(app, 'autorig.inspect', { meshes });
    expect(now.checks).toEqual({ centred: true, grounded: true, facing: true, upright: true, scale: 'ok' });
    expect(now.pose?.kind).toBe('t');
    expect(undoLabels(app)).toHaveLength(4); // the import and three fixes, one step each

    // ② would guess within 0.05 H of the truth markers scaled to 1.70 m (C2's guess on the fixed meshes). Center and
    // Ground (C2's) centres the bounds in x and z and grounds them (AR-D7-14): the truth needs no shift.
    const geometry = rigGeometry(app, app.store, meshes);
    const guess = guessMarkers(geometry.bvh, geometry.bounds);
    const truth = cubeLadTruth();
    const k = 1.7 / truth.height;
    expect(Math.abs((geometry.bounds[0][2] + geometry.bounds[1][2]) / 2)).toBeLessThan(1e-9);
    const off = QUICK_RIG_MARKERS.filter((name) => {
      const t = truth.markers[name].map((v) => v * k);
      const g = guess?.markers[name];
      return g === undefined || dist(g, t) / 1.7 > 0.05;
    });
    expect(off).toEqual([]);

    // each fix is one step: undo the centring alone
    app.history.undo();
    expect((await run<IntakeReport>(app, 'autorig.inspect', { meshes })).checks.centred).toBe(false);
  });

  it('turns a model facing −Z to +Z in one step, and refuses bad arguments', async () => {
    const { app } = await meshTestApp();
    const bytes = rootTransformed(fixture('cube-lad.glb'), { rotation: [0, 1, 0, 0] }); // 180° about Y
    const report = await run<IntakeReport>(app, 'autorig.intake', { bytes, name: 'lad-back.glb' });
    expect(report.checks.facing).toBe(false);
    await run(app, 'autorig.fix', { fix: 'face', meshes: report.meshes });
    expect((await run<IntakeReport>(app, 'autorig.inspect', { meshes: report.meshes })).checks.facing).toBe(true);
    expect(undoLabels(app)).toEqual(['Import Static Model', 'Rotate to Face +Z']);
    const poll = (args: unknown) => app.operators.poll('autorig.fix', undefined, args);
    expect(poll({ fix: 'melt', meshes: report.meshes })).toMatchObject({ ok: false });
    expect(poll({ fix: 'scale', meshes: report.meshes, height: -1 })).toEqual({
      ok: false,
      reason: 'height must be a positive number of metres',
    });
    expect(poll({ fix: 'center', meshes: [] })).toEqual({ ok: false, reason: 'Choose the scene meshes to check' });
    expect(app.operators.poll('autorig.inspect', undefined, { meshes: ['msh_nothing'] })).toEqual({
      ok: false,
      reason: 'Unknown mesh msh_nothing',
    });
  });

  it('freeze bakes a non-uniform scale in one step', async () => {
    const { app } = await meshTestApp();
    const bytes = rootTransformed(fixture('cube-lad.glb'), { scale: [1, 1.2, 1] });
    const report = await run<IntakeReport>(app, 'autorig.intake', { bytes, name: 'lad-stretched.glb' });
    const mesh = report.meshes[0] as MeshId;
    expect(app.store.get('meshes', mesh)?.placement.s).toEqual([1, 1.2, 1]);
    await run(app, 'autorig.fix', { fix: 'freeze', meshes: report.meshes });
    expect(app.store.get('meshes', mesh)?.placement.s).toEqual([1, 1, 1]);
    expect(undoLabels(app)).toHaveLength(2);
  });
});

describe('autorig.sample (§4.5, AR-D15)', () => {
  it('fetches the static fixtures from <samplesPath> and runs the intake', async () => {
    const { app } = await meshTestApp();
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      const file = url.split('/').at(-1) ?? '';
      return new Response(fixture(file));
    });
    const report = await run<IntakeReport>(app, 'autorig.sample', { sample: 'polybot-apose' });
    expect(urls).toEqual([`${app.services.samplesPath ?? '/samples/'}polybot-unskinned.glb`]);
    expect(report).toMatchObject({ kind: 'static', fileName: 'polybot-unskinned.glb' });
    expect(report.pose?.kind).toBe('a');
    expect(undoLabels(app)).toEqual(['Import Static Model']);
    expect(app.operators.poll('autorig.sample', undefined, { sample: 'teapot' })).toMatchObject({ ok: false });
  });

  it('reports a failed download plainly', async () => {
    const { app } = await meshTestApp();
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await app.runUntyped('autorig.sample', { sample: 'cube-lad' })).toMatchObject({
      status: 'failed',
      error: { message: 'The sample cube-lad.glb could not be downloaded (HTTP 404)' },
    });
  });
});
