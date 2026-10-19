// MCP-SPEC §4.1 (D0): the headless editor (`createHeadlessEditorApp`) imports a bundled sample through
// `services.readSample` and exports a VRMA in Node; `file.loadSample` without samples poll-fails, a failing read is
// `asset-missing`; `activate: false` imports leave the active character and clip alone; `busy()` never writes the
// session during an agent run's `prepare`.
import { type CharacterId, type ClipId, type ControlId, seededIdSource } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import {
  createHeadlessEditorApp,
  type EditorApp,
  type ImportResult,
  type RunActor,
  type SampleDef,
} from '@ekza-animator/editor-core';
import { type ExportArtifact, parseGlb } from '@ekza-animator/io';
import { describe, expect, it } from 'vitest';
import { BLOCKED, runOk, runtimeOf, SIBLINGS_READY, setSceneFrame, validate } from './ops.support';

const DEG = Math.PI / 180;
const AGENT: RunActor = { kind: 'agent', id: 'agt_HeadlessTest01', name: 'Headless Test' };

const readSample = (sample: SampleDef): Promise<Uint8Array> => {
  if (sample.file !== 'polybot.vrm' && sample.file !== 'seed-san.vrm') {
    return Promise.reject(new Error(`no file ${sample.file}`));
  }
  return Promise.resolve(readFixture(sample.file));
};

function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

describe.skipIf(!SIBLINGS_READY)(`headless editor (MCP-SPEC §4.1) ${SIBLINGS_READY ? '' : BLOCKED}`, () => {
  it('loads a sample through readSample and exports a VRMA in Node', async () => {
    const downloads: { fileName: string; bytes: Uint8Array; mime: string }[] = [];
    const app = createHeadlessEditorApp({
      readSample,
      validate,
      idSource: seededIdSource(11),
      onDownload: (file) => downloads.push(file),
    });
    expect(app.services.models).toBeNull();
    expect(app.services.storage).toBeNull();
    const imported = (await runOk(app, 'file.loadSample', { sample: 'polybot' })) as ImportResult;
    await runtimeOf(app, imported.character);
    expect(app.store.get('characters', imported.character)?.name).toBeTruthy();

    const clip = (
      (await runOk(app, 'clip.new', { character: imported.character, name: 'wave', range: { start: 0, end: 30 } })) as {
        clip: ClipId;
      }
    ).clip;
    const control = controlOf(app, imported.character, 'fk.lowerArm.L');
    for (const [frame, degrees] of [
      [0, 30],
      [15, -30],
      [30, 30],
    ] as const) {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', {
        edits: [{ control, channel: 'rz', value: degrees * DEG }],
        key: 'force',
      });
    }
    const artifacts = (await runOk(app, 'file.export', {
      kind: 'vrma',
      character: imported.character,
      clips: [clip],
      fileNamePattern: '{clip}',
      closeLoop: true,
      includeConstantTracks: true,
      acknowledgeLicense: false,
      profile: null,
    })) as readonly ExportArtifact[];
    expect(artifacts).toHaveLength(1);
    expect(downloads.map((file) => file.fileName)).toEqual(['wave.vrma']);
    const vrma = downloads[0]?.bytes ?? new Uint8Array();
    expect((await validate(vrma)).errors).toBe(0);
    const container = await parseGlb(vrma);
    expect(container.json['extensionsUsed']).toContain('VRMC_vrm_animation');
    expect((container.json['animations'] as unknown[]).length).toBe(1);

    // A save goes to the host too.
    await runOk(app, 'file.save', { fileName: 'polybot' });
    expect(downloads.at(-1)?.fileName).toMatch(/\.ekzanim$/);
    app.dispose();
  });

  it('poll-fails file.loadSample without samples and reports a failing read as asset-missing', async () => {
    const none = createHeadlessEditorApp();
    expect(await none.runUntyped('file.loadSample', { sample: 'polybot' })).toEqual({
      status: 'cancelled',
      reason: 'samples are not available',
    });
    const failing = createHeadlessEditorApp({ readSample });
    const result = await failing.runUntyped('file.loadSample', { sample: 'quaternius-ual' });
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' ? result.error.code : null).toBe('asset-missing');
    none.dispose();
    failing.dispose();
  });

  it('imports with activate: false leave the active character and clip, and busy() leaves the session alone for agents', async () => {
    const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(12) });
    const first = (await runOk(app, 'file.loadSample', { sample: 'polybot' })) as ImportResult;
    await runtimeOf(app, first.character);
    const active = app.session.getState().activeCharacter;
    const activeClip = app.session.getState().activeClip;
    expect(active).toBe(first.character);

    let busySeen = false;
    const off = app.session.subscribe((state) => {
      if (state.busy !== null) busySeen = true;
    });
    const second = await app.runUntyped(
      'file.loadSample',
      { sample: 'seed-san', activate: false },
      { source: 'api', actor: AGENT, access: 'edit' },
    );
    off();
    expect(second.status).toBe('finished');
    expect(busySeen).toBe(false);
    expect(app.session.getState().activeCharacter).toBe(active);
    expect(app.session.getState().activeClip[first.character]).toBe(activeClip[first.character]);
    expect(app.history.peekUndo()?.label).toBe('AI: Import seed-san.vrm');
    expect(app.history.peekUndo()?.actor).toEqual(AGENT);

    // A user import still shows its busy state and activates the new character (shipped behaviour).
    let userBusy = false;
    const offUser = app.session.subscribe((state) => {
      if (state.busy !== null) userBusy = true;
    });
    const third = (await runOk(app, 'file.loadSample', { sample: 'polybot' })) as ImportResult;
    offUser();
    expect(userBusy).toBe(true);
    expect(app.session.getState().activeCharacter).toBe(third.character);
    app.dispose();
  });
});
