// AUTORIG-SPEC §4.5, §5.5.3, §5.5.4, §5.4.1 (D5): the ④ composition and C12's operators with clip parameters
// (CR-AR-2 a/c), on the production kernel with Seed-san. `autorig.clip.add` with identity parameters is C12's Use Clip
// exactly; with parameters it stores the derived VRMA as its asset, puts the library clip first in `derivedFrom`
// (`sourceSha256` = the library asset's), records the parameters as `ar-*` tags, sets `rootMotion: 'in-place'` and
// drops `loop` for a short trim — one undo step; a parametrized clip plays back as it previewed (bone worlds within
// 1e-5 at 10 frames); Mirror equals the shipped `pose.mirrorAnimation` on the added clip within 1e-4 rad (Walk and
// Sword attack); `replace` swaps a clip in one step keeping its name, slot and place; `library.preview {bytes}`
// previews a VRMA that is no manifest entry (the range test) without touching the document.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Quat, quatAngle, sha256Hex } from '@ekza-studio/anim-core';
import { type CharacterId, type ClipId, type ClipRecord, seededIdSource } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import {
  CLIP_ARM_SPACE_RANGE,
  CLIP_SPEED_RANGE,
  clipParamsProblem as ioClipParamsProblem,
  romFrameOf,
  romVrma,
} from '@ekza-studio/io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ClipParams, createEditorApp, type EditorApp, type ImportResult } from '../../src';
import { attachClipLibrary, type ClipLibrary } from '../../src/library';
import {
  CLIP_PARAM_LIMITS,
  clipParamsFromTags,
  clipParamsProblem,
  clipParamTags,
  IDENTITY_CLIP_PARAMS,
} from '../../src/library/params';
import { createFakeServices, type FakeServices } from '../../src/testing';
import { meshTestApp } from '../mesh/support';

const LIBRARY = new URL('../../../../apps/web/public/library/', import.meta.url);
const libraryFile = (file: string): Uint8Array => new Uint8Array(readFileSync(new URL(file, LIBRARY)));

function servedFetch(requests: string[]) {
  return (url: string) => {
    requests.push(url);
    const bytes = libraryFile(url.replace(/^\/library\//, ''));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)) as unknown),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  };
}

const params = (fields: Partial<ClipParams>): ClipParams => ({ ...IDENTITY_CLIP_PARAMS, ...fields });

async function runOk(app: EditorApp, id: string, args?: unknown): Promise<unknown> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id} did not finish: ${JSON.stringify(result)}`);
  return result.value;
}

async function importCharacter(app: EditorApp, name: 'seed-san.vrm' | 'polybot.vrm'): Promise<CharacterId> {
  const { character } = (await runOk(app, 'file.importModel', { name, bytes: readFixture(name) })) as ImportResult;
  for (let i = 0; i < 600 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (app.characters.get(character) === undefined) throw new Error(`no runtime for ${name}`);
  return character;
}

/** A comparable view of a clip without ids: its record fields and its curves with their keys. */
function clipView(app: EditorApp, clip: ClipId) {
  const { id: _id, order: _order, source, ...record } = app.store.get('clips', clip) as ClipRecord;
  const curves = app.store.query
    .curvesOfClip(clip)
    .map(({ id, clip: _k, layer: _l, ...curve }) => ({
      ...curve,
      keys: app.store.query.keysOfCurve(id).map(({ id: _i, curve: _cu, clip: _cl, ...key }) => key),
    }))
    .sort((a, b) => (`${a.control}${a.channel}` < `${b.control}${b.channel}` ? -1 : 1));
  return { record, source: { ...source, asset: undefined }, curves };
}

function keysHash(app: EditorApp): string {
  const tables = app.store.snapshot().tables;
  return createHash('sha256')
    .update(JSON.stringify([tables['curves'], tables['keys'], tables['clips']]))
    .digest('hex');
}

let services: FakeServices;
let app: EditorApp;
let library: ClipLibrary;
let requests: string[];
let character: CharacterId;
let clock = 0;

beforeEach(async () => {
  services = createFakeServices();
  app = createEditorApp({ services, idSource: seededIdSource(11) });
  requests = [];
  library = attachClipLibrary(app, { fetch: servedFetch(requests), now: () => clock, frames: null })
    .service as ClipLibrary;
  character = await importCharacter(app, 'seed-san.vrm');
  clock = 0;
});
afterEach(() => app.dispose());

/** World rotation of every humanoid bone of the evaluated pose. */
function boneRotations(): Quat[] {
  app.evaluation.tick();
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const out: Quat[] = [];
  for (const node of Object.values(runtime.skeleton.humanoid ?? {})) {
    const m = runtime.pose.boneWorld.subarray(node * 16, node * 16 + 16);
    // rotation of a rigid world matrix (columns normalized)
    const col = (c: number) => {
      const v = [m[c * 4] as number, m[c * 4 + 1] as number, m[c * 4 + 2] as number];
      const len = Math.hypot(...v);
      return v.map((x) => x / len);
    };
    const [x, y, z] = [col(0), col(1), col(2)] as [number[], number[], number[]];
    const trace = (x[0] as number) + (y[1] as number) + (z[2] as number);
    let q: Quat;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      q = [
        ((y[2] as number) - (z[1] as number)) * s,
        ((z[0] as number) - (x[2] as number)) * s,
        ((x[1] as number) - (y[0] as number)) * s,
        0.25 / s,
      ];
    } else if ((x[0] as number) > (y[1] as number) && (x[0] as number) > (z[2] as number)) {
      const s = 2 * Math.sqrt(1 + (x[0] as number) - (y[1] as number) - (z[2] as number));
      q = [
        0.25 * s,
        ((y[0] as number) + (x[1] as number)) / s,
        ((z[0] as number) + (x[2] as number)) / s,
        ((y[2] as number) - (z[1] as number)) / s,
      ];
    } else if ((y[1] as number) > (z[2] as number)) {
      const s = 2 * Math.sqrt(1 + (y[1] as number) - (x[0] as number) - (z[2] as number));
      q = [
        ((y[0] as number) + (x[1] as number)) / s,
        0.25 * s,
        ((z[1] as number) + (y[2] as number)) / s,
        ((z[0] as number) - (x[2] as number)) / s,
      ];
    } else {
      const s = 2 * Math.sqrt(1 + (z[2] as number) - (x[0] as number) - (y[1] as number));
      q = [
        ((z[0] as number) + (x[2] as number)) / s,
        ((z[1] as number) + (y[2] as number)) / s,
        0.25 * s,
        ((x[1] as number) - (y[0] as number)) / s,
      ];
    }
    out.push(q);
  }
  return out;
}

/** World positions of every humanoid bone of the evaluated pose. */
function bonePositions(): number[] {
  app.evaluation.tick();
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  return Object.values(runtime.skeleton.humanoid ?? {}).flatMap((node) =>
    Array.from(runtime.pose.boneWorld.subarray(node * 16 + 12, node * 16 + 15)),
  );
}

/** Plays `clip` at clip frame `frame` through the shipped path (the active clip, the clip time). */
async function playAt(clip: ClipId, frame: number): Promise<void> {
  await runOk(app, 'clip.setActive', { character, clip });
  await runOk(app, 'time.setFrame', { frame, unit: 'clip' });
}

describe('autorig.clip.add (§4.5, §5.5.4)', () => {
  it('with identity parameters equals C12 Use Clip: same record, same curves and keys, one step', async () => {
    const before = app.history.peekUndo()?.id ?? null;
    const { clip: added } = (await runOk(app, 'autorig.clip.add', {
      character,
      clip: 'walk',
      params: IDENTITY_CLIP_PARAMS,
    })) as { clip: ClipId };
    expect(app.history.peekUndo()?.label).toBe('Use Clip Walk');
    await runOk(app, 'edit.undo');
    expect(app.history.peekUndo()?.id ?? null).toBe(before);
    await runOk(app, 'edit.redo');
    const { clip: plain } = (await runOk(app, 'library.useClip', { character, clip: 'walk' })) as { clip: ClipId };
    const a = clipView(app, added);
    const b = clipView(app, plain);
    expect(a.curves).toEqual(b.curves);
    expect({ ...a.record, name: 'x', slot: null }).toEqual({ ...b.record, name: 'x', slot: null });
    expect(a.record.tags).toEqual([]);
    expect(a.record.slot).toBe('walk');
    expect(b.record.name).toBe('Walk 2');
    // one asset: the library bytes themselves
    const asset = (app.store.get('clips', added) as ClipRecord).source;
    expect(asset).toEqual((app.store.get('clips', plain) as ClipRecord).source);
    expect(app.store.list('assets').filter((record) => record.ext === 'vrma').length).toBe(1);
  });

  it('with parameters: the derived asset, the library clip first in derivedFrom, ar-* tags, in place; one step', async () => {
    const steps = app.history.peekUndo()?.id ?? null;
    const p = params({ speed: 1.2, inPlace: true });
    const { clip } = (await runOk(app, 'autorig.clip.add', { character, clip: 'walk', params: p })) as {
      clip: ClipId;
    };
    expect(app.history.peekUndo()?.label).toBe('Use Clip Walk');
    await runOk(app, 'edit.undo');
    expect(app.history.peekUndo()?.id ?? null).toBe(steps);
    expect(app.store.get('clips', clip)).toBeUndefined();
    await runOk(app, 'edit.redo');
    const record = app.store.get('clips', clip) as ClipRecord;
    expect([record.name, record.loop, record.slot, record.rootMotion]).toEqual(['Walk', true, 'walk', 'in-place']);
    expect(record.tags).toEqual(['ar-walk', 'ar-speed-120', 'ar-inplace']);
    expect(clipParamsFromTags(record.tags)).toEqual({ clip: 'walk', params: p });
    const walk = libraryFile('animations/walk.vrma');
    const manifest = await library.manifest();
    const entry = manifest.clips.find((c) => c.id === 'walk');
    expect(record.provenance.derivedFrom[0]).toEqual({
      title: 'Walk_Loop',
      author: 'Quaternius',
      license: 'CC0-1.0',
      sourceSha256: entry?.sha256,
    });
    expect(entry?.sha256).toBe(sha256Hex(walk));
    expect(record.provenance.derivedFrom[1]).toMatchObject({ title: 'Walk_Loop', author: 'Quaternius' });
    expect(record.provenance.redistributable).toBe('yes');
    // the stored asset is the derived bytes (content-addressed; not the library file)
    const assetId = (record.source as { asset: string }).asset;
    expect(assetId).not.toBe(entry?.sha256);
    const asset = app.store.get('assets', assetId as never) as { ext: string } | undefined;
    expect(asset?.ext).toBe('vrma');
    // speed 1.2: the clip is shorter (within a frame: 36 keys per second are resampled to whole 30 fps frames)
    const plain = (await runOk(app, 'library.useClip', { character, clip: 'walk' })) as { clip: ClipId };
    const plainRecord = app.store.get('clips', plain.clip) as ClipRecord;
    const seconds = (c: ClipRecord) => (c.range.end - c.range.start) / (c.fps.num / c.fps.den);
    expect(Math.abs(seconds(record) - seconds(plainRecord) / 1.2)).toBeLessThanOrEqual(1 / 30 + 1e-9);
  });

  it('a short trim drops loop; mirror and arm space are tagged; refuses bad parameters', async () => {
    const p = params({ trim: { start: 0.2, end: 1 }, mirror: true, armSpace: -5 });
    const { clip } = (await runOk(app, 'autorig.clip.add', { character, clip: 'walk', params: p })) as {
      clip: ClipId;
    };
    const record = app.store.get('clips', clip) as ClipRecord;
    expect(record.loop).toBe(false);
    expect(record.rootMotion).toBe('hips');
    expect(record.tags).toEqual(['ar-walk', 'ar-trim-200-1000', 'ar-mirror', 'ar-arms-m5']);
    expect(clipParamsFromTags(record.tags)).toEqual({ clip: 'walk', params: p });
    expect(await app.runUntyped('autorig.clip.add', { character, clip: 'walk', params: params({ speed: 9 }) })).toEqual(
      {
        status: 'cancelled',
        reason: 'speed must be 0.25 … 3',
      },
    );
    expect(await app.runUntyped('autorig.clip.add', { character, clip: 'walk' })).toMatchObject({
      status: 'cancelled',
    });
    const past = await app.runUntyped('autorig.clip.add', {
      character,
      clip: 'walk',
      params: params({ trim: { start: 0, end: 9 } }),
    });
    expect(past).toMatchObject({ status: 'failed', error: { code: 'invalid-input' } });
  });

  it('replace swaps the clip in one step, keeping its name, slot and place', async () => {
    const { clip: first } = (await runOk(app, 'autorig.clip.add', {
      character,
      clip: 'walk',
      params: params({ speed: 1.2 }),
    })) as { clip: ClipId };
    await runOk(app, 'library.useClip', { character, clip: 'idle' });
    const firstRecord = app.store.get('clips', first) as ClipRecord;
    const steps = app.history.peekUndo()?.id;
    const { clip: second } = (await runOk(app, 'autorig.clip.add', {
      character,
      clip: 'walk',
      params: params({ speed: 0.8, mirror: true }),
      replace: first,
    })) as { clip: ClipId };
    expect(app.store.get('clips', first)).toBeUndefined();
    const record = app.store.get('clips', second) as ClipRecord;
    expect([record.name, record.slot, record.order]).toEqual([firstRecord.name, firstRecord.slot, firstRecord.order]);
    expect(record.tags).toEqual(['ar-walk', 'ar-speed-80', 'ar-mirror']);
    // the Walk keeps its place before the Idle (Seed-san's own empty clip stays first)
    expect(app.store.query.clipsOfCharacter(character).map((c) => c.name)).toEqual(['clip1', 'Walk', 'Idle']);
    await runOk(app, 'edit.undo');
    expect(app.history.peekUndo()?.id).toBe(steps);
    expect(app.store.get('clips', first)).toBeDefined();
    expect(app.store.get('clips', second)).toBeUndefined();
  });

  it('a parametrized clip plays back as it previewed: bone worlds within 1e-5 at 10 frames', async () => {
    const p = params({ speed: 1.25, armSpace: 15, trim: { start: 0.1, end: 1.2 } });
    const hash = keysHash(app);
    const history = app.history.peekUndo()?.id ?? null;
    await runOk(app, 'library.preview', { character, clip: 'walk', params: p });
    expect([keysHash(app), app.history.peekUndo()?.id ?? null]).toEqual([hash, history]);
    const fps = library.source.clip?.fps ?? 30;
    const end = library.source.clip?.end ?? 0;
    // the preview loops over [start, end): its last frame shows as frame 0 again, so sample before it
    const frames = Array.from({ length: 10 }, (_, i) => Math.round((i * (end - 1)) / 9));
    const previewed: { rotations: Quat[]; positions: number[] }[] = [];
    for (const frame of frames) {
      clock = (frame / fps) * 1000 + 1e-6;
      library.stepPreview();
      previewed.push({ rotations: boneRotations(), positions: bonePositions() });
    }
    await runOk(app, 'library.stop');
    const { clip } = (await runOk(app, 'autorig.clip.add', { character, clip: 'walk', params: p })) as {
      clip: ClipId;
    };
    for (const [i, frame] of frames.entries()) {
      await playAt(clip, frame);
      const rotations = boneRotations();
      const positions = bonePositions();
      rotations.forEach((q, b) => expect(quatAngle(q, previewed[i]?.rotations[b] as Quat)).toBeLessThan(1e-5));
      positions.forEach((v, c) => expect(Math.abs(v - (previewed[i]?.positions[c] as number))).toBeLessThan(1e-5));
    }
  });

  it.each(['walk', 'sword-attack'])(
    'Mirror equals pose.mirrorAnimation of the added %s within 1e-4 rad',
    async (id) => {
      app.prefs.setState({ reduceOnImport: 'never' });
      const { clip: mirrored } = (await runOk(app, 'autorig.clip.add', {
        character,
        clip: id,
        params: params({ mirror: true }),
      })) as { clip: ClipId };
      const { clip: plain } = (await runOk(app, 'library.useClip', { character, clip: id })) as { clip: ClipId };
      await runOk(app, 'clip.setActive', { character, clip: plain });
      app.session.setState({ selection: { ...app.session.getState().selection, controls: [] } });
      await runOk(app, 'pose.mirrorAnimation', { mode: 'flip' });
      const record = app.store.get('clips', plain) as ClipRecord;
      const end = record.range.end;
      for (let i = 0; i < 10; i++) {
        const frame = Math.round((i * end) / 9);
        await playAt(plain, frame);
        const want = boneRotations();
        await playAt(mirrored, frame);
        const got = boneRotations();
        want.forEach((q, b) =>
          expect(quatAngle(got[b] as Quat, q), `${id} frame ${frame} bone ${b}`).toBeLessThan(1e-4),
        );
      }
    },
  );
});

describe('library.preview {bytes} (CR-AR-2 c, §5.4.1)', () => {
  it('previews the range-of-motion clip by its label without touching the document or the manifest', async () => {
    const hash = keysHash(app);
    const history = app.history.peekUndo()?.id ?? null;
    const rest = boneRotations();
    await runOk(app, 'library.preview', { character, clip: 'rom', bytes: await romVrma(), label: 'Range test' });
    expect(requests).toEqual([]);
    expect(library.preview).toMatchObject({ character, clip: 'Range test', loop: true });
    const atFrame = (frame: number): Quat[] => {
      clock = (frame / 30) * 1000 + 1e-6;
      library.stepPreview();
      return boneRotations();
    };
    const runtime = app.characters.get(character);
    const humanoid = runtime?.skeleton.humanoid ?? {};
    const index = (bone: string): number => Object.keys(humanoid).indexOf(bone);
    // arms down: the upper arms turned ≈ 80° from the rest; legs side: the thighs ≈ 45°; knees 130: the shins ≈ 130°
    const down = atFrame(romFrameOf('arms down'));
    expect(quatAngle(down[index('leftUpperArm')] as Quat, rest[index('leftUpperArm')] as Quat)).toBeGreaterThan(1.2);
    const legs = atFrame(romFrameOf('legs side'));
    expect(quatAngle(legs[index('leftUpperLeg')] as Quat, rest[index('leftUpperLeg')] as Quat)).toBeGreaterThan(0.6);
    expect(quatAngle(legs[index('leftUpperArm')] as Quat, rest[index('leftUpperArm')] as Quat)).toBeLessThan(0.02);
    const knees = atFrame(romFrameOf('knees 130'));
    expect(quatAngle(knees[index('leftLowerLeg')] as Quat, rest[index('leftLowerLeg')] as Quat)).toBeGreaterThan(2);
    expect([keysHash(app), app.history.peekUndo()?.id ?? null]).toEqual([hash, history]);
    await runOk(app, 'library.stop');
  });

  it('refuses bytes that are not bytes and a label that is not text', async () => {
    expect(await app.runUntyped('library.preview', { character, clip: 'rom', bytes: [1, 2] })).toEqual({
      status: 'cancelled',
      reason: 'bytes must be a Uint8Array',
    });
    expect(
      await app.runUntyped('library.preview', { character, clip: 'rom', bytes: new Uint8Array(4), label: 3 }),
    ).toEqual({ status: 'cancelled', reason: 'label must be a string' });
  });
});

describe('ar-* tags (§5.5.4)', () => {
  // The same examples pin the Auto-Rig shell's reader (`autorig/test/steps/animations/animations.test.ts`).
  const EXAMPLES: readonly [string, ClipParams, readonly string[]][] = [
    ['walk', IDENTITY_CLIP_PARAMS, []],
    ['walk', params({ speed: 1.2, inPlace: true }), ['ar-walk', 'ar-speed-120', 'ar-inplace']],
    [
      'sword-attack',
      params({ trim: { start: 0.25, end: 1.2 }, mirror: true, armSpace: -10 }),
      ['ar-sword-attack', 'ar-trim-250-1200', 'ar-mirror', 'ar-arms-m10'],
    ],
    ['jump-start', params({ speed: 0.25, armSpace: 30 }), ['ar-jump-start', 'ar-speed-25', 'ar-arms-30']],
  ];
  it.each(EXAMPLES)('%s %j ↔ %j', (clip, p, tags) => {
    expect(clipParamTags(clip, p)).toEqual(tags);
    expect(clipParamsFromTags(tags)).toEqual(tags.length === 0 ? null : { clip, params: p });
  });
  it('keeps other tags out and fits the tag vocabulary', () => {
    expect(clipParamsFromTags(['hero', 'ar-idle', 'ar-mirror'])).toEqual({
      clip: 'idle',
      params: params({ mirror: true }),
    });
    for (const [clip, p] of EXAMPLES) {
      for (const tag of clipParamTags(clip, p)) expect(tag).toMatch(/^[a-z0-9_-]{1,32}$/);
    }
  });
});

describe('the clip parameters check (§5.5.3)', () => {
  // editor-core's operator-side check is its own copy (AR-D5-11); these examples pin it to io's (without a duration:
  // the trim against the clip's length is io's alone).
  it('agrees with io on the limits and on every verdict', () => {
    expect(CLIP_PARAM_LIMITS).toEqual({ speed: CLIP_SPEED_RANGE, armSpace: CLIP_ARM_SPACE_RANGE });
    const examples: unknown[] = [
      IDENTITY_CLIP_PARAMS,
      params({ speed: 0.25 }),
      params({ speed: 3 }),
      params({ speed: 0.2 }),
      params({ speed: 3.01 }),
      params({ speed: Number.NaN }),
      params({ armSpace: -10 }),
      params({ armSpace: 30 }),
      params({ armSpace: -11 }),
      params({ armSpace: 31 }),
      params({ mirror: true, inPlace: true }),
      { ...IDENTITY_CLIP_PARAMS, mirror: 'yes' },
      { ...IDENTITY_CLIP_PARAMS, inPlace: 1 },
      params({ trim: { start: 0, end: 0.5 } }),
      params({ trim: { start: 0.5, end: 0.5 } }),
      params({ trim: { start: -0.1, end: 0.5 } }),
      { ...IDENTITY_CLIP_PARAMS, trim: { start: 0 } },
      { ...IDENTITY_CLIP_PARAMS, trim: [0, 1] },
      { ...IDENTITY_CLIP_PARAMS, speed: '1' },
      null,
      [],
      'walk',
    ];
    expect(examples.map((example) => clipParamsProblem(example))).toEqual(
      examples.map((example) => ioClipParamsProblem(example)),
    );
    expect(examples.filter((example) => clipParamsProblem(example) === null)).toHaveLength(7);
  });
});

describe('the range-of-motion clip on the Cube Lad (§5.4.1)', () => {
  it('previews by the byte route and turns the joints as the pose table says at three sample frames', async () => {
    const { app: lad } = await meshTestApp();
    try {
      const truth = JSON.parse(
        readFileSync(new URL('../../../../fixtures/models/cube-lad-truth.json', import.meta.url), 'utf8'),
      ) as { markers: Record<string, number[]> };
      await runOk(lad, 'workspace.set', { workspace: 'rig' });
      const { meshes } = (await runOk(lad, 'mesh.importStatic', {
        bytes: new Uint8Array(readFileSync(new URL('../../../../fixtures/models/cube-lad.glb', import.meta.url))),
        name: 'cube-lad.glb',
      })) as { meshes: string[] };
      const { character: ladCharacter } = (await runOk(lad, 'skel.quickRig.commit', {
        preset: 'standard33',
        markers: truth.markers,
        meshes,
        flexion: (2 * Math.PI) / 180,
      })) as { character: CharacterId };
      for (let i = 0; i < 600 && lad.characters.get(ladCharacter) === undefined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      let ladClock = 0;
      const ladLibrary = attachClipLibrary(lad, { fetch: servedFetch([]), now: () => ladClock, frames: null })
        .service as ClipLibrary;
      const hash = keysHash(lad);
      await runOk(lad, 'workspace.set', { workspace: 'animate' });
      await runOk(lad, 'library.preview', {
        character: ladCharacter,
        clip: 'rom',
        bytes: await romVrma({ fingers: false }),
        label: 'Range test',
      });
      /** Direction (unit) from a bone to its child bone in the evaluated pose. */
      const direction = (frame: number, from: string, to: string): number[] => {
        ladClock = (frame / 30) * 1000 + 1e-6;
        ladLibrary.stepPreview();
        lad.evaluation.tick();
        const runtime = lad.characters.get(ladCharacter);
        const humanoid = runtime?.skeleton.humanoid as Record<string, number>;
        const at = (bone: string): number[] =>
          Array.from(
            runtime?.pose.boneWorld.subarray(
              (humanoid[bone] as number) * 16 + 12,
              (humanoid[bone] as number) * 16 + 15,
            ) ?? [],
          );
        const a = at(from);
        const b = at(to);
        const d = b.map((v, i) => v - (a[i] as number));
        const len = Math.hypot(...d);
        return d.map((v) => v / len);
      };
      // the rest (frame 0): the T-pose arm along +X, the thigh straight down
      expect(direction(0, 'leftUpperArm', 'leftLowerArm')[0] as number).toBeGreaterThan(0.95);
      expect(direction(0, 'leftUpperLeg', 'leftLowerLeg')[1] as number).toBeLessThan(-0.95);
      // arms down: the left upper arm points down (the table: 80° below the T-pose line)
      const arm = direction(romFrameOf('arms down'), 'leftUpperArm', 'leftLowerArm');
      expect(arm[1] as number).toBeLessThan(-0.9);
      // legs side: the left thigh swings out to +X by 45°
      const thigh = direction(romFrameOf('legs side'), 'leftUpperLeg', 'leftLowerLeg');
      expect(Math.abs((thigh[0] as number) - Math.sin(Math.PI / 4))).toBeLessThan(0.1);
      // knees 130: the shin points backwards (−Z) and up
      const shin = direction(romFrameOf('knees 130'), 'leftLowerLeg', 'leftFoot');
      expect(shin[2] as number).toBeLessThan(-0.6);
      expect(shin[1] as number).toBeGreaterThan(0.3);
      expect(ladLibrary.preview?.clip).toBe('Range test');
      expect(keysHash(lad)).toBe(hash);
    } finally {
      lad.dispose();
    }
  });
});
