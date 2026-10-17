// Clip operators (MVP-SPEC §4.9 `clip.*`): defaults of new clips, naming rules, deep duplication, soft delete with
// a replacement active clip, switching, and clip settings incl. the keep-seconds frame-rate change; undo/redo.
import type { ClipId, ClipRecord, KeyRecord } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { expectUndoRedoExact, opsApp, READY, runOk, runResult, setSceneFrame, WAVE } from './support';

type App = ReturnType<typeof opsApp>;

function clip(app: App, id: ClipId): ClipRecord {
  const record = app.store.get('clips', id);
  if (record === undefined) throw new Error(`no clip ${id}`);
  return record;
}

function clipKeys(app: App, id: ClipId): readonly KeyRecord[] {
  return app.store.query.curvesOfClip(id).flatMap((curve) => app.store.query.keysOfCurve(curve.id));
}

describe.skipIf(!READY.wp2)('clip.new / clip.rename [needs WP-2 fractionalIndex]', () => {
  it('adds an empty clip with the documented defaults and makes it active', async () => {
    const app = opsApp();
    const probe = opsApp();
    await expectUndoRedoExact(probe, 'clip.new');
    const id = ((await runOk(app, 'clip.new')) as { clip: ClipId }).clip;
    expect(app.session.getState().activeClip[WAVE.character]).toBe(id);
    expect(clip(app, id)).toMatchObject({
      character: WAVE.character,
      name: 'clip1',
      slot: null,
      fps: { num: 30, den: 1 },
      range: { start: 0, end: 60 },
      sceneStart: 0,
      loop: false,
      rootMotion: 'hips',
      contact: null,
      tags: [],
      provenance: { derivedFrom: [], redistributable: 'yes' },
      source: { kind: 'new' },
    });
    expect(clip(app, id).order > clip(app, WAVE.clip).order).toBe(true);
    expect(app.store.query.baseLayer(id)).toMatchObject({ name: 'Base', mode: 'override', weight: 1 });
    expect(app.history.peekUndo()?.label).toBe('New Clip');
  });

  it('takes a name, fps and range; refuses invalid or taken names', async () => {
    const app = opsApp();
    const id = (
      (await runOk(app, 'clip.new', { name: 'idle 2', fps: { num: 24, den: 1 }, range: { start: 0, end: 48 } })) as {
        clip: ClipId;
      }
    ).clip;
    expect(clip(app, id)).toMatchObject({ name: 'idle 2', fps: { num: 24, den: 1 }, range: { start: 0, end: 48 } });
    for (const args of [
      { name: 'Wave' },
      { name: 'bad/name' },
      { name: '' },
      { name: 'x'.repeat(65) },
      { fps: { num: 0, den: 1 } },
      { range: { start: 10, end: 10 } },
      { character: 'chr_missing00000000' },
    ]) {
      expect([JSON.stringify(args), (await runResult(app, 'clip.new', args)).status]).toEqual([
        JSON.stringify(args),
        'cancelled',
      ]);
    }
  });

  it('renames a clip within the naming rules', async () => {
    const app = opsApp();
    await expectUndoRedoExact(app, 'clip.rename', { clip: WAVE.clip, name: 'wave_01' });
    expect(clip(app, WAVE.clip).name).toBe('wave_01');
    await runOk(app, 'clip.new', { name: 'idle' });
    expect((await runResult(app, 'clip.rename', { clip: WAVE.clip, name: 'IDLE' })).status).toBe('cancelled');
    expect((await runResult(app, 'clip.rename', { clip: WAVE.clip, name: ' padded' })).status).toBe('cancelled');
    expect((await runResult(app, 'clip.rename', { clip: 'clp_missing0000000', name: 'x' })).status).toBe('cancelled');
  });
});

describe.skipIf(!READY.wp2)('clip.duplicate / clip.delete / clip.setActive [needs WP-2 fractionalIndex]', () => {
  it('deep-copies a clip with new ids, right after the original', async () => {
    const app = opsApp();
    const { value } = await expectUndoRedoExact(app, 'clip.duplicate', { clip: WAVE.clip });
    const id = (value as { clip: ClipId }).clip;
    const copy = clip(app, id);
    const source = clip(app, WAVE.clip);
    expect(copy.name).toBe('wave copy');
    expect(copy.provenance).toEqual(source.provenance);
    expect(copy.order > source.order).toBe(true);
    const sourceKeys = clipKeys(app, WAVE.clip);
    const copyKeys = clipKeys(app, id);
    expect(copyKeys.map((k) => [k.t, k.v, k.inType, k.outType])).toEqual(
      sourceKeys.map((k) => [k.t, k.v, k.inType, k.outType]),
    );
    expect(copyKeys.every((k) => k.clip === id && !sourceKeys.some((s) => s.id === k.id))).toBe(true);
    expect(app.store.query.curvesOfClip(id).every((c) => c.layer === app.store.query.baseLayer(id)?.id)).toBe(true);
    // Edits of the copy leave the original alone.
    app.session.setState({ activeClip: { [WAVE.character]: id } });
    await runOk(app, 'select.keys', { items: copyKeys.map((k) => ({ key: k.id })), mode: 'replace' });
    await runOk(app, 'graph.keys.delete');
    expect(clipKeys(app, id)).toEqual([]);
    expect(clipKeys(app, WAVE.clip)).toHaveLength(3);
    // A second copy gets a unique name.
    const second = (await runOk(app, 'clip.duplicate', { clip: WAVE.clip })) as { clip: ClipId };
    expect(clip(app, second.clip).name).toBe('wave copy 2');
  });

  it('soft-deletes a clip; another clip becomes active, or a new empty one is made', async () => {
    const app = opsApp();
    const other = ((await runOk(app, 'clip.new', { name: 'idle' })) as { clip: ClipId }).clip;
    await runOk(app, 'clip.setActive', { clip: WAVE.clip });
    await expectUndoRedoExact(app, 'clip.delete', { clip: WAVE.clip });
    expect(app.store.get('clips', WAVE.clip)).toBeUndefined();
    expect(app.session.getState().activeClip[WAVE.character]).toBe(other);
    await runOk(app, 'clip.delete', { clip: other });
    const remaining = app.store.query.clipsOfCharacter(WAVE.character);
    expect(remaining.map((c) => c.name)).toEqual(['clip1']);
    expect(app.session.getState().activeClip[WAVE.character]).toBe(remaining[0]?.id);
    await runOk(app, 'edit.undo');
    expect(app.store.query.clipsOfCharacter(WAVE.character).map((c) => c.id)).toEqual([other]);
  });

  it('switches the active clip, clamping the frame into its range and dropping overrides', async () => {
    const app = opsApp();
    const short = ((await runOk(app, 'clip.new', { name: 'short', range: { start: 0, end: 10 } })) as { clip: ClipId })
      .clip;
    await runOk(app, 'clip.setActive', { clip: WAVE.clip });
    setSceneFrame(app, 25);
    app.session.setState({ overrides: new Map([[WAVE.lowerArmL, { rz: 1 }]]) });
    const steps = app.history.peekUndo()?.id;
    await runOk(app, 'clip.setActive', { clip: short });
    expect(app.session.getState().activeClip[WAVE.character]).toBe(short);
    expect(app.session.getState().time.sceneFrame).toBe(10);
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.history.peekUndo()?.id).toBe(steps);
  });
});

describe.skipIf(!READY.wp2)('clip.setSettings [needs WP-2 fractionalIndex]', () => {
  it('keep-seconds rescales keys, handles, range and contact by newFps/oldFps', async () => {
    const app = opsApp();
    app.store.transact({ label: 'setup' }, (tx) => {
      const k = tx.get('keys', WAVE.keys[1]);
      if (k !== undefined) tx.put('keys', { ...k, outType: 'fixed', outHandle: { dt: 5, dv: 0.1 } });
      tx.patch('clips', WAVE.clip, { contact: 15 });
    });
    await expectUndoRedoExact(app, 'clip.setSettings', { clip: WAVE.clip, fps: { num: 24, den: 1 } });
    expect(clip(app, WAVE.clip)).toMatchObject({ fps: { num: 24, den: 1 }, range: { start: 0, end: 24 }, contact: 12 });
    const keys = app.store.query.keysOfCurve(WAVE.curve);
    expect(keys.map((k) => k.t)).toEqual([0, 12, 24]);
    expect(keys[1]?.outHandle).toEqual({ dt: 4, dv: 0.1 });
    expect(app.history.peekUndo()?.label).toBe('Clip Settings');
  });

  it('checks a contact frame against the rescaled range', async () => {
    const app = opsApp();
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, fps: { num: 60, den: 1 }, contact: 50 });
    expect(clip(app, WAVE.clip)).toMatchObject({ range: { start: 0, end: 60 }, contact: 50 });
    const result = await runResult(app, 'clip.setSettings', { clip: WAVE.clip, fps: { num: 30, den: 1 }, contact: 50 });
    expect(result.status).toBe('cancelled');
  });

  it('keep-frames changes only the rate', async () => {
    const app = opsApp();
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, fps: { num: 60, den: 1 }, fpsMode: 'keep-frames' });
    expect(clip(app, WAVE.clip)).toMatchObject({ fps: { num: 60, den: 1 }, range: { start: 0, end: 30 } });
    expect(app.store.query.keysOfCurve(WAVE.curve).map((k) => k.t)).toEqual([0, 15, 30]);
  });

  it('edits metadata: loop, root motion, slot, contact, tags, scene start and provenance', async () => {
    const app = opsApp();
    await expectUndoRedoExact(app, 'clip.setSettings', {
      clip: WAVE.clip,
      loop: false,
      rootMotion: 'in-place',
      slot: 'wave',
      contact: 10,
      tags: ['emote', 'hand'],
      sceneStart: 6,
      provenance: {
        derivedFrom: [{ title: 'Mocap', author: 'Studio', license: 'CC0-1.0', sourceSha256: null }],
        redistributable: 'unknown',
      },
    });
    expect(clip(app, WAVE.clip)).toMatchObject({
      loop: false,
      rootMotion: 'in-place',
      slot: 'wave',
      contact: 10,
      tags: ['emote', 'hand'],
      sceneStart: 6,
      provenance: { redistributable: 'unknown' },
    });
  });

  it('refuses invalid settings', async () => {
    const app = opsApp();
    for (const settings of [
      { slot: 'tpose' },
      { slot: 'moonwalk' },
      { tags: ['Upper'] },
      { tags: Array.from({ length: 9 }, (_, i) => `t${i}`) },
      { contact: 31 },
      { range: { start: 5, end: 2 } },
      { range: { start: 0.5, end: 2 } },
      { fps: { num: 30, den: 0 } },
      { fpsMode: 'stretch' },
      { rootMotion: 'root' },
      { provenance: { redistributable: 'maybe' } },
      { provenance: { derivedFrom: [{ title: 'x', author: 'y', license: 'z', sourceSha256: 'ABC' }] } },
    ]) {
      const result = await runResult(app, 'clip.setSettings', { clip: WAVE.clip, ...settings });
      expect([JSON.stringify(settings), result.status]).toEqual([JSON.stringify(settings), 'cancelled']);
    }
  });
});
