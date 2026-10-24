// AS-ST-5 for the Animate stage (STUDIO-TOUCH-SPEC §20.7 headless integration, §22; T7 exit test): the operator
// sequences Halo emits for J3 (pose and key a two-second wave) and J5 (a library animation with its speed and in place,
// then the left/right pair) produce exports byte-equal to Studio Pro's (and, for the library's parameters, Auto-Rig's
// ④) for the same steps, on the production kernel with Seed-san.
//
// Halo's side is built by Halo's own code: Rec is `installRec` (the `shell` override), + New is `newAnimationCall`,
// Loop it is `loopItCall` (the public wrapper `clip.loop`), the Library's Add is `addCall` (`library.useClip`) and
// + swap sides is `swapSidesCalls`. Pro's side is what its panels send: Auto Key on (mode *all*) from Preferences, the
// Clips panel's `clip.new {character}` and rename, Animation › Mirror Animation over the selected controls,
// `clip.makeLoop` (what the wrapper wraps), and Auto-Rig ④'s `autorig.clip.add` with the same parameters. The pose
// drags are the same viewport tool in both shells; here both write the same `channel.setValues` edits at the same
// frames.
import { existsSync, readFileSync } from 'node:fs';
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHaloStore, initialUi } from '../src/shell/store';
import { addCall, IDENTITY_PARAMS } from '../src/sheets/library/model';
import { loopItCall, newAnimationCall, sceneFps, swapSidesCalls } from '../src/stages/animate/model';
import { installRec } from '../src/stages/animate/rec';
import { everyOperator, runOk } from './support';

const ROOT = new URL('../../../', import.meta.url);

function staticFetch(url: string | URL): Promise<Response> {
  const path = String(url).startsWith('/library/') ? `apps/web/public/library/${String(url).slice(9)}` : null;
  const file = path === null ? null : new URL(path, ROOT);
  if (file === null || !existsSync(file)) return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(new Uint8Array(readFileSync(file)).buffer, { status: 200 }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', staticFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedSan(): Promise<{ readonly app: EditorApp; readonly character: CharacterId }> {
  const app = await everyOperator();
  const { character } = await runOk<{ character: CharacterId }>(app, 'file.loadSample', { sample: 'seed-san' });
  for (let i = 0; i < 200 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { app, character };
}

function controlOf(app: EditorApp, key: string): string {
  const control = app.store.list('controls').find((c) => c.key === key);
  if (control === undefined) throw new Error(`no ${key}`);
  return control.id;
}

/** The VRMA bytes of one animation of the character (the shipped bake path). */
async function vrma(app: EditorApp, character: CharacterId, clip: ClipId): Promise<string> {
  const artifacts = await runOk<readonly { readonly bytes: Uint8Array }[]>(app, 'file.export', {
    kind: 'vrma',
    character,
    clips: [clip],
    fileNamePattern: '{character}_{clip}',
    closeLoop: false,
    includeConstantTracks: true,
    acknowledgeLicense: true,
    profile: null,
  });
  const bytes = artifacts[0]?.bytes;
  if (bytes === undefined) throw new Error('no artifact');
  return Buffer.from(bytes).toString('base64');
}

const clipNamed = (app: EditorApp, character: CharacterId, name: string): ClipId => {
  const clip = app.store.query.clipsOfCharacter(character).find((c) => c.name === name);
  if (clip === undefined) throw new Error(`no clip ${name}`);
  return clip.id;
};

/** J3's poses: the right upper arm at 0 s, the forearm at 0.5, 1.0 and 1.5 s (Rec keys each, as the ring drags do). */
async function wavePoses(app: EditorApp): Promise<void> {
  const upper = controlOf(app, 'fk.upperArm.R');
  const forearm = controlOf(app, 'fk.lowerArm.R');
  const poses: readonly [number, string, number][] = [
    [0, upper, 1.1],
    [15, forearm, 0.9],
    [30, forearm, -0.4],
    [45, forearm, 0.9],
  ];
  for (const [frame, control, rz] of poses) {
    await runOk(app, 'time.setFrame', { frame, unit: 'clip' });
    await runOk(app, 'select.controls', { ids: [control], mode: 'replace' });
    await runOk(app, 'channel.setValues', { edits: [{ control, channel: 'rz', value: rz }] });
  }
}

describe('AS-ST-5: the Animate stage’s operator sequences export what Studio Pro’s do', () => {
  it('J3: + New “Wave” 2 s, Rec poses at 0 / 0.5 / 1 / 1.5 s, Loop it — the same VRMA as Pro', async () => {
    // Halo
    const halo = await seedSan();
    const store = createHaloStore({ ...initialUi('animate') });
    const offRec = installRec(halo.app, store);
    const call = newAnimationCall(halo.character, 'Wave', 2, sceneFps(halo.app));
    const { clip: haloClip } = await runOk<{ clip: ClipId }>(halo.app, call.op, call.args);
    expect(halo.app.prefs.getState()).toMatchObject({ autoKey: true, autoKeyMode: 'all' });
    await wavePoses(halo.app);
    // Rec keyed every pose at its playhead (new channels too: the override's mode is *all*)
    const times = (key: string): number[] =>
      halo.app.store.query
        .curvesOfClip(haloClip)
        .filter((curve) => curve.control === controlOf(halo.app, key) && curve.channel === 'rz')
        .flatMap((curve) => halo.app.store.query.keysOfCurve(curve.id).map((k) => k.t));
    expect(times('fk.upperArm.R')).toEqual([0]);
    expect(times('fk.lowerArm.R')).toEqual([15, 30, 45]);
    const loop = loopItCall(haloClip);
    await runOk(halo.app, loop.op, loop.args);
    const haloBytes = await vrma(halo.app, halo.character, haloClip);
    offRec();
    expect(halo.app.prefs.getState().autoKey).toBe(false);

    // Studio Pro
    const pro = await seedSan();
    pro.app.prefs.setState({ autoKey: true, autoKeyMode: 'all' });
    const { clip: proClip } = await runOk<{ clip: ClipId }>(pro.app, 'clip.new', { character: pro.character });
    await runOk(pro.app, 'clip.rename', { clip: proClip, name: 'Wave' });
    await wavePoses(pro.app);
    await runOk(pro.app, 'clip.makeLoop', { clip: proClip, method: 'matchEnds', rootTravel: 'cycleOffset' });
    const proBytes = await vrma(pro.app, pro.character, proClip);

    expect(haloBytes.length).toBeGreaterThan(1000);
    expect(haloBytes).toBe(proBytes);
    halo.app.dispose();
    pro.app.dispose();
  }, 120_000);

  it('J5: Walk ×1.2 in place, then + swap sides — the same VRMAs as Auto-Rig ④ and Pro’s Duplicate / Mirror', async () => {
    const params = { ...IDENTITY_PARAMS, speed: 1.2, inPlace: true };
    // Halo
    const halo = await seedSan();
    const add = addCall(halo.character, 'walk', params);
    const { clip: haloWalk } = await runOk<{ clip: ClipId }>(halo.app, add.op, add.args);
    const walkRecord = halo.app.store.get('clips', haloWalk);
    if (walkRecord === undefined) throw new Error('no walk');
    let haloPair: ClipId | null = null;
    for (const step of swapSidesCalls(halo.app, walkRecord)) {
      const value = await runOk<{ clip?: ClipId } | undefined>(halo.app, step.op, step.args);
      if (value?.clip !== undefined) haloPair = value.clip;
    }
    if (haloPair === null) throw new Error('no pair');
    const haloWalkBytes = await vrma(halo.app, halo.character, haloWalk);
    const haloPairBytes = await vrma(halo.app, halo.character, haloPair);

    // Auto-Rig ④ (the parameters) and Studio Pro (Duplicate, then Mirror Animation over every control)
    const pro = await seedSan();
    const { clip: proWalk } = await runOk<{ clip: ClipId }>(pro.app, 'autorig.clip.add', {
      character: pro.character,
      clip: 'walk',
      params,
    });
    const { clip: proPair } = await runOk<{ clip: ClipId }>(pro.app, 'clip.duplicate', { clip: proWalk });
    await runOk(pro.app, 'select.all');
    await runOk(pro.app, 'pose.mirrorAnimation', { mode: 'flip' });
    const proWalkBytes = await vrma(pro.app, pro.character, proWalk);
    const proPairBytes = await vrma(pro.app, pro.character, proPair);

    expect(haloWalkBytes).toBe(proWalkBytes);
    expect(haloPairBytes).toBe(proPairBytes);
    expect(haloPairBytes).not.toBe(haloWalkBytes);
    expect(clipNamed(halo.app, halo.character, walkRecord.name)).toBe(haloWalk);
    halo.app.dispose();
    pro.app.dispose();
  }, 120_000);
});
