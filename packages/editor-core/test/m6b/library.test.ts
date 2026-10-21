// C12 (M6B-SPEC §0.4.7, §9.0 C12 DoD) on the production kernel: the library preview plays through the 'preview' channel
// source and leaves the store version, the history and the keys hash unchanged; its stop rules (a key run, a workspace
// switch, an override edit, Esc); a key during a preview keys the Animate value; Use Clip equals a
// `file.importAnimation` of the same bytes in curves, keys, fps and range, with name, loop, slot and provenance as the
// manifest gives them; one undo step; one content-addressed asset; a checksum failure disables the clip.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type CharacterId, type ClipId, type ClipRecord, seededIdSource } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEditorApp, type EditorApp, type ImportResult } from '../../src';
import { attachClipLibrary, type ClipLibrary } from '../../src/library';
import { createFakeServices, type FakeServices } from '../../src/testing';

const LIBRARY = new URL('../../../../apps/web/public/library/', import.meta.url);

interface Served {
  /** Bytes served instead of the committed file (a tampered download). */
  readonly tamper: Set<string>;
  readonly requests: string[];
}

function servedFetch(served: Served) {
  return (url: string) => {
    served.requests.push(url);
    const path = url.replace(/^\/library\//, '');
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(new URL(path, LIBRARY)));
    } catch {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('404')),
        arrayBuffer: () => Promise.reject(new Error('404')),
      });
    }
    const file = path.split('/').pop() ?? '';
    if (served.tamper.has(file)) bytes = Uint8Array.from(bytes, (b, i) => (i === 100 ? b ^ 0xff : b));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)) as unknown),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  };
}

function keysHash(app: EditorApp): string {
  const tables = app.store.snapshot().tables;
  return createHash('sha256')
    .update(JSON.stringify([tables['curves'], tables['keys']]))
    .digest('hex');
}

/** A comparable view of a clip: its curves (control, channel, flags) with their keys (no ids), fps and range. */
function clipShape(app: EditorApp, clip: ClipId) {
  const record = app.store.get('clips', clip) as ClipRecord;
  const curves = app.store.query
    .curvesOfClip(clip)
    .map((curve) => ({
      control: curve.control,
      channel: curve.channel,
      weighted: curve.weighted,
      pre: curve.pre,
      post: curve.post,
      staticValue: curve.staticValue,
      keys: app.store.query.keysOfCurve(curve.id).map(({ id: _id, curve: _curve, clip: _clip, ...key }) => key),
    }))
    .sort((a, b) => (`${a.control}${a.channel}` < `${b.control}${b.channel}` ? -1 : 1));
  return { fps: record.fps, range: record.range, curves };
}

async function runOk(app: EditorApp, id: string, args?: unknown): Promise<unknown> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id} did not finish: ${JSON.stringify(result)}`);
  return result.value;
}

/** Imports a licensed VRM and waits for its runtime (built asynchronously after the import). */
async function importCharacter(app: EditorApp, name: 'seed-san.vrm' | 'polybot.vrm'): Promise<CharacterId> {
  const { character } = (await runOk(app, 'file.importModel', { name, bytes: readFixture(name) })) as ImportResult;
  for (let i = 0; i < 600 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (app.characters.get(character) === undefined) throw new Error(`no runtime for ${name}`);
  return character;
}

/** The top undo step's label (null when there is none). */
function topLabel(app: EditorApp): string | null {
  return app.history.peekUndo()?.label ?? null;
}

/** The history's top step (id and label) and whether it can redo: equal before and after = no step recorded. */
function historyMark(app: EditorApp): {
  readonly id: number | null;
  readonly label: string | null;
  readonly redo: boolean;
} {
  const top = app.history.peekUndo();
  return { id: top?.id ?? null, label: top?.label ?? null, redo: app.history.canRedo() };
}

let services: FakeServices;
let app: EditorApp;
let library: ClipLibrary;
let served: Served;
let character: CharacterId;
let clock = 0;

beforeEach(async () => {
  services = createFakeServices();
  app = createEditorApp({ services, idSource: seededIdSource(7) });
  served = { tamper: new Set(), requests: [] };
  library = attachClipLibrary(app, { fetch: servedFetch(served), now: () => clock, frames: null })
    .service as ClipLibrary;
  character = await importCharacter(app, 'seed-san.vrm');
  clock = 0;
});
afterEach(() => app.dispose());

/** Hips world translation of the character's evaluated pose. */
function hipsWorld(): number[] {
  app.evaluation.tick();
  const runtime = app.characters.get(character);
  const hips = runtime?.skeleton.humanoid?.hips;
  if (runtime === undefined || hips === undefined) throw new Error('no hips');
  return Array.from(runtime.pose.boneWorld.subarray(hips * 16 + 12, hips * 16 + 15));
}

/** World rotation part (3×3) of the left upper arm. */
function armWorld(): number[] {
  app.evaluation.tick();
  const runtime = app.characters.get(character);
  const bone = runtime?.skeleton.humanoid?.leftUpperArm;
  if (runtime === undefined || bone === undefined) throw new Error('no arm');
  return Array.from(runtime.pose.boneWorld.subarray(bone * 16, bone * 16 + 11));
}

describe('library preview (§0.4.7)', () => {
  it('plays a clip without touching the store, the history or the keys; stop returns the Animate pose', async () => {
    const restArm = armWorld();
    const before = { version: app.store.version, history: historyMark(app), keys: keysHash(app) };
    expect(served.requests).toEqual([]);
    await runOk(app, 'library.preview', { character, clip: 'walk' });
    // Manifest and the one clip file only (opening never downloads all 14).
    expect(served.requests).toEqual(['/library/animations/starter-pack.json', '/library/animations/walk.vrma']);
    expect(library.preview).toMatchObject({ character, clip: 'walk', seconds: 0, loop: true });
    const first = armWorld();
    expect(first).not.toEqual(restArm);
    clock = 400;
    expect(library.stepPreview()).toBe(true);
    expect(library.preview?.seconds).toBeCloseTo(0.4, 9);
    expect(armWorld()).not.toEqual(first);
    // Loops at its own clock.
    clock = 1000 * (4 / 3) + 400;
    library.stepPreview();
    expect(library.preview?.seconds).toBeCloseTo(0.4, 6);
    expect({ version: app.store.version, history: historyMark(app), keys: keysHash(app) }).toEqual(before);
    expect(app.session.getState().overrides.size).toBe(0);

    await runOk(app, 'library.stop');
    expect(library.preview).toBeNull();
    expect(armWorld()).toEqual(restArm);
    expect(await app.runUntyped('library.stop')).toEqual({ status: 'cancelled', reason: 'No clip preview is playing' });
    expect({ version: app.store.version, history: historyMark(app), keys: keysHash(app) }).toEqual(before);
  });

  it('switches clips; Death lowers the hips; the preview stops on a workspace switch, an override edit and Esc', async () => {
    const restHips = hipsWorld();
    await runOk(app, 'library.preview', { character, clip: 'death' });
    clock = 2300;
    library.stepPreview();
    expect((hipsWorld()[1] as number) < (restHips[1] as number) - 0.2).toBe(true);
    await runOk(app, 'library.preview', { character, clip: 'walk' });
    expect(library.preview?.clip).toBe('walk');

    app.session.setState({ workspace: 'model' });
    expect(library.preview).toBeNull();
    app.session.setState({ workspace: 'animate' });

    await runOk(app, 'library.preview', { character, clip: 'idle' });
    const control = app.store.list('controls')[0];
    if (control === undefined) throw new Error('no control');
    app.session.setState({ overrides: new Map([[control.id, { rx: 0.1 }]]) });
    expect(library.preview).toBeNull();
    app.session.setState({ overrides: new Map() });

    await runOk(app, 'library.preview', { character, clip: 'idle' });
    const esc = { code: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false };
    expect(app.keymap.resolve(esc, ['global'], 'press')?.op).toBe('library.stop');
    await runOk(app, 'library.stop');
    expect(app.keymap.resolve(esc, ['global'], 'press')?.op).toBe('edit.escape');
  });

  it('a key run during a preview stops it first and keys the Animate value', async () => {
    const control = app.store.list('controls').find((record) => record.name.toLowerCase().includes('arm'));
    if (control === undefined) throw new Error('no arm control');
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [control.id] } });
    const animate = { ...app.evaluation.channelValues(control.id) };
    await runOk(app, 'library.preview', { character, clip: 'walk' });
    clock = 500;
    library.stepPreview();
    const result = await app.runUntyped('key.set', { target: 'selected' });
    expect(library.preview).toBeNull();
    expect(result).toMatchObject({ status: 'finished', value: { count: 3 } });
    // The keys hold the Animate values (the document's pose), not the preview's.
    expect(app.evaluation.channelValues(control.id)).toEqual(animate);
  });

  it('refuses a generic target and an unknown clip', async () => {
    expect(await app.runUntyped('library.preview', { character: 'chr_missing', clip: 'walk' })).toMatchObject({
      status: 'cancelled',
      reason: 'The character does not exist',
    });
    expect(await app.runUntyped('library.preview', { character, clip: 'nope' })).toMatchObject({
      status: 'failed',
      error: { code: 'invalid-input' },
    });
  });
});

describe('Use Clip (§0.4.7)', () => {
  it('equals file.importAnimation of the same bytes; name, loop, slot, provenance as given; one step', async () => {
    const before = topLabel(app);
    const { clip } = (await runOk(app, 'library.useClip', { character, clip: 'sword-attack' })) as { clip: ClipId };
    expect(before).not.toBe('Use Clip Sword attack');
    expect(topLabel(app)).toBe('Use Clip Sword attack');
    const record = app.store.get('clips', clip) as ClipRecord;
    expect([record.name, record.loop, record.slot]).toEqual(['Sword attack', false, 'attack']);
    expect(record.provenance.redistributable).toBe('yes');
    expect(record.provenance.derivedFrom[0]).toMatchObject({
      title: 'Sword_Attack',
      author: 'Quaternius',
      license: 'CC0-1.0',
    });
    expect(app.session.getState().activeClip[character]).toBe(clip);

    const bytes = new Uint8Array(readFileSync(new URL('animations/sword-attack.vrma', LIBRARY)));
    const imported = (await runOk(app, 'file.importAnimation', { name: 'sword-attack.vrma', bytes, character })) as {
      clips: ClipId[];
    };
    const plain = imported.clips[0] as ClipId;
    expect(clipShape(app, clip)).toEqual(clipShape(app, plain));
    // The VRMA's animation name is the UAL source, so the plain import gets the same loop flag.
    expect((app.store.get('clips', plain) as ClipRecord).loop).toBe(false);
    // One content-addressed asset for both.
    expect(app.store.list('assets').filter((asset) => asset.ext === 'vrma').length).toBe(1);

    const walk = (await runOk(app, 'library.useClip', { character, clip: 'walk' })) as { clip: ClipId };
    const walkRecord = app.store.get('clips', walk.clip) as ClipRecord;
    expect([walkRecord.name, walkRecord.loop, walkRecord.slot]).toEqual(['Walk', true, 'walk']);

    // A second Use Clip of one clip: a unique name, the slot taken (null), no new asset.
    const assets = app.store.list('assets').length;
    const again = (await runOk(app, 'library.useClip', { character, clip: 'walk' })) as { clip: ClipId };
    const againRecord = app.store.get('clips', again.clip) as ClipRecord;
    expect([againRecord.name, againRecord.slot]).toEqual(['Walk 2', null]);
    expect(app.store.list('assets').length).toBe(assets);

    await runOk(app, 'edit.undo');
    expect(app.store.get('clips', again.clip)).toBeUndefined();
  });

  it('a tampered download fails its checksum: the action fails with the toast, the clip is marked failed', async () => {
    served.tamper.add('walk.vrma');
    const result = await app.runUntyped('library.useClip', { character, clip: 'walk' });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'checksum', message: 'The file failed its checksum' },
    });
    expect(library.failed('walk')).toBe(true);
    expect(await app.runUntyped('library.preview', { character, clip: 'walk' })).toMatchObject({
      status: 'failed',
      error: { message: 'The file failed its checksum' },
    });
    expect(services.toasts).toContainEqual({ kind: 'error', text: 'The file failed its checksum' });
    expect(app.store.list('clips').some((clip) => clip.name === 'Walk')).toBe(false);
  });
});
