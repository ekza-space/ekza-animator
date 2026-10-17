// ops.* (WP-7b): projects through the operators (ADR 0011, MVP-SPEC §4.9 `file.*`): `.ekzanim` save → open round
// trip (E2E-19), the JSON debug variant, `file.open` dispatch by file type, `file.new`, dirty tracking, and opening
// that replaces (never merges).
import type { ClipId, ControlId } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import type { EditorApp } from '@ekza-animator/editor-core';
import { describe, expect, it } from 'vitest';
import { BLOCKED, importFixture, realApp, runOk, runtimeOf, SIBLINGS_READY, setSceneFrame } from './ops.support';

const DEG = Math.PI / 180;

function counts(app: EditorApp): Record<string, number> {
  const tables = [
    'project',
    'assets',
    'characters',
    'rigs',
    'controls',
    'cameras',
    'clips',
    'layers',
    'curves',
    'keys',
  ] as const;
  return Object.fromEntries(tables.map((table) => [table, app.store.list(table).length]));
}

async function waveScene(app: EditorApp): Promise<{ readonly control: ControlId; readonly clip: ClipId }> {
  const bot = await importFixture(app, 'polybot.vrm');
  const clip = ((await runOk(app, 'clip.new', { name: 'wave', range: { start: 0, end: 30 } })) as { clip: ClipId })
    .clip;
  const rig = app.store.query.rigOfCharacter(bot.character);
  const control = app.store.query.controlByKey(rig?.id as never, 'fk.lowerArm.L')?.id as ControlId;
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
    [30, 30],
  ] as const) {
    setSceneFrame(app, frame);
    await runOk(app, 'channel.setValues', { edits: [{ control, channel: 'rz', value: degrees * DEG }], key: 'force' });
  }
  await runOk(app, 'graph.infinity.set', { post: 'cycle' });
  return { control, clip };
}

function curvesJson(app: EditorApp, clip: ClipId): unknown {
  return app.store.query.curvesOfClip(clip).map((curve) => ({
    curve,
    keys: app.store.query.keysOfCurve(curve.id),
  }));
}

describe.skipIf(!SIBLINGS_READY)(`projects ${BLOCKED}`, { timeout: 120_000 }, () => {
  it('saves an .ekzanim and opens it into an identical document (E2E-19)', async () => {
    const { app, services } = realApp();
    const { control, clip } = await waveScene(app);
    expect(app.session.getState().dirty).toBe(true);
    const saved = (await runOk(app, 'file.save')) as { fileName: string; bytes: number };
    expect(saved.fileName).toBe('polybot.ekzanim');
    expect(app.session.getState().dirty).toBe(false);
    const download = services.downloads.at(-1);
    expect(download).toMatchObject({ fileName: 'polybot.ekzanim', mime: 'application/zip' });
    expect(download?.bytes.byteLength).toBe(saved.bytes);

    const other = realApp({ seed: 99 }).app;
    const opened = (await runOk(other, 'file.openProject', { name: saved.fileName, bytes: download?.bytes })) as {
      readOnly: boolean;
      migratedFrom: number;
    };
    expect(opened.readOnly).toBe(false);
    expect(counts(other)).toEqual(counts(app));
    expect(curvesJson(other, clip)).toEqual(curvesJson(app, clip));
    expect(other.history.canUndo()).toBe(false);
    expect(other.session.getState().projectName).toBe('polybot');
    const character = other.store.list('characters')[0];
    if (character === undefined) throw new Error('no character');
    await runtimeOf(other, character.id);
    // The archived model is byte-identical: its asset id (SHA-256) is the fixture's.
    expect(new Uint8Array(await other.services.assets.get(character.asset))).toEqual(readFixture('polybot.vrm'));
    other.session.setState({ activeClip: { [character.id]: clip } });
    app.session.setState({ activeClip: { [character.id]: clip } });
    for (const frame of [0, 7, 15, 22, 30]) {
      setSceneFrame(app, frame);
      setSceneFrame(other, frame);
      expect(other.evaluation.channelValues(control)).toEqual(app.evaluation.channelValues(control));
    }
  });

  it('saves the JSON debug variant and opens it when the models are at hand', async () => {
    const { app, services } = realApp();
    await waveScene(app);
    const saved = (await runOk(app, 'file.saveJson')) as { fileName: string };
    expect(saved.fileName).toBe('polybot.ekzanim.json');
    const download = services.downloads.at(-1);
    expect(download?.mime).toBe('application/json');
    const text = new TextDecoder().decode(download?.bytes);
    expect(JSON.parse(text)).toMatchObject({ format: 'ekza-animator-doc' });

    // Without the model: opens with a warning.
    const bare = realApp({ seed: 5 });
    await runOk(bare.app, 'file.open', { name: saved.fileName, bytes: download?.bytes });
    expect(counts(bare.app)).toEqual(counts(app));
    expect(bare.services.toasts.some((t) => t.kind === 'warning' && t.text.includes('polybot.vrm'))).toBe(true);
    // With the model already in the asset store: no warning.
    const ready = realApp({ seed: 6 });
    await ready.app.services.assets.put(readFixture('polybot.vrm'), { name: 'polybot.vrm', ext: 'vrm', role: 'model' });
    await runOk(ready.app, 'file.openProject', { name: saved.fileName, bytes: download?.bytes });
    expect(ready.services.toasts.some((t) => t.kind === 'warning')).toBe(false);
  });

  it('dispatches file.open by file type', async () => {
    const { app } = realApp();
    await runOk(app, 'file.open', { name: 'polybot.vrm', bytes: readFixture('polybot.vrm') });
    expect(app.store.list('characters')).toHaveLength(1);
    expect(app.history.peekUndo()?.label).toBe('Import polybot.vrm');
    const unknown = await app.runUntyped('file.open', { name: 'notes.txt', bytes: new Uint8Array(1) });
    expect(unknown).toMatchObject({ status: 'cancelled', reason: "No importer reads 'notes.txt'" });
    const broken = await app.runUntyped('file.open', { name: 'broken.vrm', bytes: new Uint8Array(4) });
    expect(broken).toMatchObject({ status: 'failed', error: { code: 'not-glb' } });
  });

  it('opening a project replaces the document; file.new empties it', async () => {
    const source = realApp();
    await waveScene(source.app);
    await runOk(source.app, 'file.save');
    const bytes = source.services.downloads.at(-1)?.bytes;

    const { app } = realApp({ seed: 11 });
    await importFixture(app, 'seed-san.vrm');
    app.session.setState({ overrides: new Map(), selection: { ...app.session.getState().selection } });
    await runOk(app, 'file.openProject', { name: 'polybot.ekzanim', bytes });
    expect(app.store.list('characters').map((c) => c.name)).toEqual(['Polybot']);
    expect(app.history.canUndo()).toBe(false);
    expect(app.session.getState().dirty).toBe(false);

    await runOk(app, 'file.new');
    expect(counts(app)).toMatchObject({ characters: 0, clips: 0, keys: 0, cameras: 0 });
    expect(app.session.getState()).toMatchObject({ activeCharacter: null, dirty: false, feetPins: null });
    expect(app.session.getState().selection.controls).toEqual([]);
    expect(app.history.canUndo()).toBe(false);
    expect(app.history.canRedo()).toBe(false);
  });

  it('saves and edits clips whose partition is closed (§4.11.21)', async () => {
    const { app, services } = realApp();
    const { clip } = await waveScene(app);
    const keys = app.store.query.curvesOfClip(clip).flatMap((c) => app.store.query.keysOfCurve(c.id)).length;
    const other = (await runOk(app, 'clip.new', { name: 'idle' })) as { clip: ClipId };
    expect(app.session.getState().activeClip[app.store.list('characters')[0]?.id as never]).toBe(other.clip);
    app.store.close(`clip:${clip}`);
    expect(app.store.query.curvesOfClip(clip)).toEqual([]);
    await runOk(app, 'file.saveJson');
    const json = JSON.parse(new TextDecoder().decode(services.downloads.at(-1)?.bytes)) as {
      tables: { keys: Record<string, { clip: string }> };
    };
    expect(Object.values(json.tables.keys).filter((k) => k.clip === clip)).toHaveLength(keys);
    app.store.close(`clip:${clip}`);
    await runOk(app, 'clip.setSettings', { clip, fps: { num: 60, den: 1 } });
    const times = app.store.query
      .curvesOfClip(clip)
      .flatMap((c) => app.store.query.keysOfCurve(c.id))
      .map((k) => k.t)
      .sort((x, y) => x - y);
    expect(times).toEqual([0, 30, 60]);
  });

  it('keeps the project dirty when it changes while the file is written', async () => {
    let gate: Promise<void> | null = null;
    let entered: () => void = () => {};
    const { app } = realApp({
      assets: (store) => ({
        put: (bytes, meta) => store.put(bytes, meta),
        has: (id) => store.has(id),
        peek: (id) => store.peek(id),
        ids: () => store.ids(),
        async get(id) {
          if (gate !== null) {
            entered();
            await gate;
          }
          return store.get(id);
        },
      }),
    });
    const { control } = await waveScene(app);
    let release: () => void = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const saving = app.runUntyped('file.save');
    // The save has taken its snapshot and waits for the model bytes: an edit now is not in the file.
    await inside;
    await runOk(app, 'channel.setValues', { edits: [{ control, channel: 'rx', value: 0.3 }], key: 'force' });
    gate = null;
    release();
    expect((await saving).status).toBe('finished');
    expect(app.session.getState().dirty).toBe(true);
    // A save without changes in between marks the project clean.
    await runOk(app, 'file.save');
    expect(app.session.getState().dirty).toBe(false);
  });

  it('saves a project whose model is missing (opened from the JSON variant), without the model', async () => {
    const source = realApp();
    await waveScene(source.app);
    await runOk(source.app, 'file.saveJson');
    const json = source.services.downloads.at(-1)?.bytes;
    const { app, services } = realApp({ seed: 21 });
    await runOk(app, 'file.openProject', { name: 'polybot.ekzanim.json', bytes: json });
    const saved = (await runOk(app, 'file.save')) as { fileName: string };
    expect(saved.fileName).toBe('polybot.ekzanim');
    expect(services.toasts.at(-1)).toMatchObject({ kind: 'warning' });
    expect(services.toasts.at(-1)?.text).toMatch(/polybot\.vrm is not available/);
    const reopened = realApp({ seed: 22 }).app;
    await runOk(reopened, 'file.openProject', { name: saved.fileName, bytes: services.downloads.at(-1)?.bytes });
    expect(counts(reopened)).toEqual(counts(app));
  });

  it('refuses a file that is not a project', async () => {
    const { app } = realApp();
    const result = await app.runUntyped('file.openProject', { name: 'x.ekzanim', bytes: new Uint8Array([1, 2, 3]) });
    expect(result.status).toBe('failed');
    expect(app.store.list('characters')).toEqual([]);
  });
});
