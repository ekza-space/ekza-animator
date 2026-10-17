// ops.* (WP-7b): model import through `file.importModel` / `file.loadSample` on the three licensed fixtures
// (MVP-SPEC §4.11.6): records and counts, the auto-rig, the shot camera, frame rate and key reduction of embedded
// clips, accuracy against the source samplers, provenance, undo/redo, and the rejections (not a GLB, no skin).
import { quatAngle } from '@ekza-animator/anim-core';
import type { ClipId, ClipRecord, KeyRecord } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import type { CharacterRuntime, ImportResult } from '@ekza-animator/editor-core';
import { parseGlb, readAnimations, skeletonFromGltf } from '@ekza-animator/io';
import type { RawClip } from '@ekza-animator/rig';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCKED, docJson, importFixture, realApp, runOk, runtimeOf, SIBLINGS_READY } from './ops.support';

const IDLE_LOOP = 9;

function clipOf(app: ReturnType<typeof realApp>['app'], id: ClipId | undefined): ClipRecord {
  const clip = id === undefined ? undefined : app.store.get('clips', id);
  if (clip === undefined) throw new Error('no clip');
  return clip;
}

function keysOfClip(app: ReturnType<typeof realApp>['app'], clip: ClipId): KeyRecord[] {
  return app.store.query.curvesOfClip(clip).flatMap((curve) => [...app.store.query.keysOfCurve(curve.id)]);
}

async function idleLoopRaw(): Promise<RawClip> {
  const container = await parseGlb(readFixture('quaternius-ual.glb'));
  const raw = readAnimations(container, skeletonFromGltf(container)).find((clip) => clip.index === IDLE_LOOP);
  if (raw === undefined) throw new Error('no Idle_Loop');
  return raw;
}

/** Largest pose error of the imported clip at the source key times (raw node locals; driven nodes only). */
function sourceError(
  app: ReturnType<typeof realApp>['app'],
  result: ImportResult & { readonly runtime: CharacterRuntime },
  raw: RawClip,
  clip: ClipRecord,
): { readonly rotation: number; readonly translation: number } {
  const pose = result.runtime.program.allocPose();
  const driven = new Set(result.runtime.program.drivenNodes);
  const fps = clip.fps.num / clip.fps.den;
  let rotation = 0;
  let translation = 0;
  for (const channel of raw.channels) {
    if (!driven.has(channel.node) || (channel.path !== 'rotation' && channel.path !== 'translation')) continue;
    const width = channel.path === 'rotation' ? 4 : 3;
    for (let i = 0; i < channel.times.length; i++) {
      const frame = (channel.times[i] as number) * fps;
      app.evaluation.evaluateAt(result.character, clip.id, frame, pose, { withOverrides: false });
      const local = pose.boneLocal.subarray(channel.node * 10, channel.node * 10 + 10);
      const v = channel.values.subarray(i * width, i * width + width);
      if (channel.path === 'rotation') {
        const angle = quatAngle(
          [v[0] as number, v[1] as number, v[2] as number, v[3] as number],
          [local[3] as number, local[4] as number, local[5] as number, local[6] as number],
        );
        rotation = Math.max(rotation, angle);
      } else {
        translation = Math.max(
          translation,
          Math.hypot(
            (v[0] as number) - (local[0] as number),
            (v[1] as number) - (local[1] as number),
            (v[2] as number) - (local[2] as number),
          ),
        );
      }
    }
  }
  return { rotation, translation };
}

describe.skipIf(!SIBLINGS_READY)(`file.importModel on the fixtures ${BLOCKED}`, { timeout: 60_000 }, () => {
  it('imports Seed-san (VRM 1.0): humanoid rig, hidden secondaries, locked shot camera, empty clip1', async () => {
    const { app, services } = realApp();
    const result = await importFixture(app, 'seed-san.vrm');
    // Technical skeleton notes (near-uniform joint scales) go to the summary, not to a toast.
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(services.toasts.filter((toast) => toast.kind === 'warning')).toEqual([]);
    const character = app.store.get('characters', result.character);
    expect(character).toMatchObject({ name: 'Seed-san', format: 'vrm1', placement: { t: [0, 0, 0] } });
    const rig = app.store.query.rigOfCharacter(result.character);
    expect(rig?.generator.name).toBe('ekza-autorig-humanoid');
    const controls = app.store.query.controlsOfRig(rig?.id as never);
    const keys = new Set(controls.map((c) => c.key));
    for (const key of ['root', 'cog', 'fk.hips', 'fk.head', 'fk.upperArm.L', 'fk.upperArm.R', 'fk.indexProximal.L']) {
      expect(keys.has(key)).toBe(true);
    }
    expect(controls.filter((c) => !c.hiddenByDefault).length).toBeGreaterThanOrEqual(50);
    expect(controls.filter((c) => c.group === 'secondary').every((c) => c.hiddenByDefault)).toBe(true);
    const cameras = app.store.list('cameras');
    expect(cameras.map((c) => [c.name, c.locked, c.projection])).toEqual([['shotCam', true, 'perspective']]);
    expect(result.clips).toHaveLength(1);
    expect(clipOf(app, result.clips[0])).toMatchObject({
      name: 'clip1',
      fps: { num: 30, den: 1 },
      range: { start: 0, end: 60 },
    });
    expect(app.store.get('assets', character?.asset as never)).toMatchObject({
      ext: 'vrm',
      role: 'model',
      name: 'seed-san.vrm',
    });
    const state = app.session.getState();
    expect(state.activeCharacter).toBe(result.character);
    expect(state.activeClip[result.character]).toBe(result.clips[0]);
    expect(state.projectName).toBe('seed-san');
    // Zero pose = rest.
    expect(Object.values(app.evaluation.channelValues(controls[5]?.id as never)).every((v) => v === 0 || v === 1)).toBe(
      true,
    );
    expect(app.history.peekUndo()?.label).toBe('Import seed-san.vrm');
  });

  it('imports Polybot (VRM 0.x) facing +Z, next to an existing character, keeping the one shot camera', async () => {
    const { app } = realApp();
    const first = await importFixture(app, 'seed-san.vrm');
    const second = await importFixture(app, 'polybot.vrm');
    expect(app.store.get('characters', second.character)).toMatchObject({ format: 'vrm0' });
    expect(app.store.get('characters', second.character)?.placement.t[0]).toBeGreaterThan(1);
    expect(app.store.list('cameras')).toHaveLength(1);
    expect(app.store.query.rigOfCharacter(second.character)?.skeleton.facing).toEqual([0, 1, 0, 0]);
    expect(app.session.getState().activeCharacter).toBe(second.character);
    expect(first.character).not.toBe(second.character);
    // Unpaired toes: fk.toes.R exists without a mirror.
    const rig = app.store.query.rigOfCharacter(second.character);
    expect(app.store.query.controlByKey(rig?.id as never, 'fk.toes.R')?.mirror).toBeNull();
  });

  it('imports UAL Idle_Loop at 24 fps with whole-frame keys, reduced, matching the source samplers', async () => {
    const { app } = realApp();
    const raw = await idleLoopRaw();
    const exact = await importFixture(app, 'quaternius-ual.glb', { clips: [IDLE_LOOP], reduce: null });
    const clip = clipOf(app, exact.clips[0]);
    expect(clip).toMatchObject({
      name: 'Idle_Loop',
      fps: { num: 24, den: 1 },
      range: { start: 0, end: 60 },
      loop: true,
      source: { kind: 'embedded', animationIndex: IDLE_LOOP, animationName: 'Idle_Loop' },
      provenance: { redistributable: 'unknown' },
    });
    expect(app.store.get('project', 'project')?.sceneFps).toEqual({ num: 24, den: 1 });
    const keys = keysOfClip(app, clip.id);
    expect(keys.every((k) => Number.isInteger(k.t))).toBe(true);
    const error = sourceError(app, exact, raw, clip);
    expect(error.rotation).toBeLessThan(1e-4);
    expect(error.translation).toBeLessThan(1e-5);

    // Default reduction: curves with ≥ 20 source keys shrink ≥ 3× in total, within the tolerance.
    const reduced = await importFixture(app, 'quaternius-ual.glb', { clips: [IDLE_LOOP] });
    const reducedClip = clipOf(app, reduced.clips[0]);
    const counts = (id: ClipId): Map<string, number> =>
      new Map(
        app.store.query
          .curvesOfClip(id)
          .map((c) => [`${c.control.split(':')[1]}/${c.channel}`, app.store.query.keysOfCurve(c.id).length]),
      );
    const full = counts(clip.id);
    const small = counts(reducedClip.id);
    let dense = 0;
    let kept = 0;
    for (const [curve, n] of full) {
      if (n < 20) continue;
      dense += n;
      kept += small.get(curve) ?? 0;
    }
    expect(dense).toBeGreaterThan(0);
    expect(kept * 3).toBeLessThanOrEqual(dense);
    const reducedError = sourceError(app, reduced, raw, reducedClip);
    // Three Euler channels each within 0.1° bound the rotation error by 0.3°.
    expect(reducedError.rotation).toBeLessThan(0.3 * (Math.PI / 180) + 1e-6);
  });

  it('imports all clips of a small file by default and none of a large one; picks by index', async () => {
    const { app } = realApp();
    const none = await importFixture(app, 'quaternius-ual.glb');
    expect(none.clips.map((id) => clipOf(app, id).name)).toEqual(['clip1']);
    const two = await importFixture(app, 'quaternius-ual.glb', { clips: [45, 9] });
    expect(two.clips.map((id) => clipOf(app, id).name)).toEqual(['Idle_Loop', 'Walk_Loop']);
    expect(two.warnings.some((w) => w.includes('already in the project'))).toBe(true);
  });

  it('places a new character beside the right-most one, also after a deletion', async () => {
    const { app } = realApp();
    const a = await importFixture(app, 'polybot.vrm');
    const b = await importFixture(app, 'polybot.vrm');
    const bx = app.store.get('characters', b.character)?.placement.t[0] ?? 0;
    expect(bx).toBeGreaterThan(1);
    app.store.transact({ label: 'delete' }, (tx) => tx.softDelete('characters', a.character));
    const c = await importFixture(app, 'polybot.vrm');
    expect(app.store.get('characters', c.character)?.placement.t[0]).toBeGreaterThan(bx + 1);
  });

  it('undoes and redoes an import exactly', async () => {
    const { app } = realApp();
    const before = docJson(app);
    const result = (await runOk(app, 'file.importModel', {
      name: 'polybot.vrm',
      bytes: readFixture('polybot.vrm'),
    })) as ImportResult;
    const after = docJson(app);
    await runOk(app, 'edit.undo');
    expect(docJson(app)).toEqual(before);
    expect(app.session.getState().activeCharacter).toBeNull();
    await runOk(app, 'edit.redo');
    expect(docJson(app)).toEqual(after);
    await runtimeOf(app, result.character);
  });

  it('rejects files that are not GLB and models without a skin', async () => {
    const { app } = realApp();
    const notGlb = await app.runUntyped('file.importModel', {
      name: 'x.glb',
      bytes: new TextEncoder().encode('hello'),
    });
    expect(notGlb).toMatchObject({ status: 'failed', error: { code: 'not-glb' } });
    const json = new TextEncoder().encode(
      JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ name: 'box' }] }).padEnd(80, ' '),
    );
    const glb = new Uint8Array(12 + 8 + json.length);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.length, true);
    view.setUint32(12, json.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    glb.set(json, 20);
    const noSkin = await app.runUntyped('file.importModel', { name: 'box.glb', bytes: glb });
    expect(noSkin).toMatchObject({ status: 'failed', error: { code: 'no-skin' } });
    expect(app.store.list('characters')).toEqual([]);
    expect(app.history.canUndo()).toBe(false);
  });
});

describe.skipIf(!SIBLINGS_READY)(`file.loadSample ${BLOCKED}`, { timeout: 60_000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serveSamples(): string[] {
    const requested: string[] = [];
    const files: Record<string, Parameters<typeof readFixture>[0]> = {
      '/samples/seed-san.vrm': 'seed-san.vrm',
      '/samples/polybot.vrm': 'polybot.vrm',
      '/samples/quaternius-ual.glb': 'quaternius-ual.glb',
    };
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      const name = files[url];
      if (name === undefined) return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(new Response(readFixture(name)));
    });
    return requested;
  }

  it('loads the UAL sample with its Idle_Loop clip and CC0 provenance', async () => {
    const requested = serveSamples();
    const { app } = realApp();
    const result = (await runOk(app, 'file.loadSample', { sample: 'quaternius-ual' })) as ImportResult;
    expect(requested).toEqual(['/samples/quaternius-ual.glb']);
    const clip = clipOf(app, result.clips[0]);
    expect(clip.name).toBe('Idle_Loop');
    expect(clip.provenance).toEqual({
      derivedFrom: [
        {
          title: 'Universal Animation Library',
          author: 'Quaternius',
          license: 'CC0-1.0',
          sourceSha256: app.store.get('characters', result.character)?.asset,
        },
      ],
      redistributable: 'yes',
    });
    expect(app.history.peekUndo()?.label).toBe('Import quaternius-ual.glb');
  });

  it('loads Polybot and reports a missing sample', async () => {
    serveSamples();
    const { app } = realApp();
    const result = (await runOk(app, 'file.loadSample', { sample: 'polybot' })) as ImportResult;
    expect(app.store.get('characters', result.character)?.name).toBe('Polybot');
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 404 })));
    expect(await app.runUntyped('file.loadSample', { sample: 'seed-san' })).toMatchObject({
      status: 'failed',
      error: { code: 'asset-missing' },
    });
  });
});
