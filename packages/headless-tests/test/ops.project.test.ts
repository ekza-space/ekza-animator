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

  it('refuses a file that is not a project', async () => {
    const { app } = realApp();
    const result = await app.runUntyped('file.openProject', { name: 'x.ekzanim', bytes: new Uint8Array([1, 2, 3]) });
    expect(result.status).toBe('failed');
    expect(app.store.list('characters')).toEqual([]);
  });
});
