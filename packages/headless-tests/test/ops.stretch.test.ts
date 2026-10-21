// ops.* (WP-7b): M1-stretch operators on the real packages — pose-preserving rotate-order change (§4.11.5: with
// unsynchronized rx/ry keys the bone worlds are equal at every union time, 1e-6) and animation-only GLB import onto a
// character by node name (FR-IO-10), dispatched by content sniffing through `file.open`.
import { mat4Decompose, type Quat, quatAngle } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ExportArtifact } from '@ekza-studio/io';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  docJson,
  expectUndoRedoExact,
  importFixture,
  realApp,
  runOk,
  SIBLINGS_READY,
  setSceneFrame,
} from './ops.support';

const DEG = Math.PI / 180;

function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

function boneRotation(app: EditorApp, character: CharacterId, clip: ClipId, node: number, frame: number): Quat {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const pose = runtime.program.allocPose();
  app.evaluation.evaluateAt(character, clip, frame, pose, { withOverrides: false });
  return mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16)).q;
}

describe.skipIf(!SIBLINGS_READY)(`M1-stretch operators ${BLOCKED}`, { timeout: 120_000 }, () => {
  it('changes a rotate order keeping the bone worlds at every union key time (1e-6)', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const clip = app.session.getState().activeClip[bot.character] as ClipId;
    const arm = controlOf(app, bot.character, 'fk.upperArm.L');
    const key = async (frame: number, channel: 'rx' | 'ry' | 'rz', degrees: number) => {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', { edits: [{ control: arm, channel, value: degrees * DEG }], key: 'force' });
    };
    await key(0, 'rx', 10);
    await key(12, 'rx', 80);
    await key(30, 'rx', -20);
    await key(5, 'ry', 40);
    await key(20, 'ry', -60);
    await key(8, 'rz', 25);
    const node = bot.runtime.skeleton.humanoid?.leftUpperArm as number;
    const union = [0, 5, 8, 12, 20, 30];
    const before = union.map((frame) => boneRotation(app, bot.character, clip, node, frame));
    expect(app.store.get('controls', arm)?.rotateOrder).toBe('yxz');
    await expectUndoRedoExact(app, 'rig.setRotateOrder', { control: arm, order: 'xyz' });
    expect(app.store.get('controls', arm)?.rotateOrder).toBe('xyz');
    union.forEach((frame, i) => {
      expect(quatAngle(boneRotation(app, bot.character, clip, node, frame), before[i] as Quat)).toBeLessThan(1e-6);
    });
    // The three curves are synchronized on the union.
    const base = app.store.query.baseLayer(clip);
    for (const channel of ['rx', 'ry', 'rz'] as const) {
      const curve = app.store.query.curveFor(clip, base?.id as never, arm, channel);
      expect(app.store.query.keysOfCurve(curve?.id as never).map((k) => k.t)).toEqual(union);
    }
  });

  it('imports an animation-only GLB onto a character by node name, through file.open', async () => {
    const { app } = realApp();
    const ual = await importFixture(app, 'quaternius-ual.glb', { clips: [9], reduce: null });
    const source = ual.clips[0] as ClipId;
    const [glb] = (await runOk(app, 'file.export', {
      kind: 'animation-glb',
      character: ual.character,
      clips: [source],
      fileNamePattern: 'idle_only',
      closeLoop: false,
      includeConstantTracks: true,
      acknowledgeLicense: false,
      profile: null,
    })) as ExportArtifact[];
    if (glb === undefined) throw new Error('no export');
    const before = docJson(app);
    await runOk(app, 'file.open', { name: glb.fileName, bytes: glb.bytes });
    expect(app.history.peekUndo()?.label).toBe('Import idle_only.glb');
    const imported = app.session.getState().activeClip[ual.character] as ClipId;
    expect(imported).not.toBe(source);
    expect(app.store.get('clips', imported)).toMatchObject({
      name: 'Idle_Loop 2',
      fps: { num: 24, den: 1 },
      source: { kind: 'imported', fileName: 'idle_only.glb' },
    });
    const runtime = ual.runtime;
    let worst = 0;
    for (let frame = 0; frame <= 60; frame += 6) {
      for (const node of runtime.program.drivenNodes) {
        worst = Math.max(
          worst,
          quatAngle(
            boneRotation(app, ual.character, imported, node, frame),
            boneRotation(app, ual.character, source, node, frame),
          ),
        );
      }
    }
    // Default reduction is on for the re-import: within the 0.1° per channel tolerance, composed over the chain.
    expect(worst).toBeLessThan(0.01);
    await runOk(app, 'edit.undo');
    expect(docJson(app)).toEqual(before);

    // Without reduction the same file reproduces the clip within 1e-4 rad.
    const exact = (await runOk(app, 'file.importAnimation', {
      name: glb.fileName,
      bytes: glb.bytes,
      options: { reduce: null },
    })) as { clips: ClipId[] };
    let exactWorst = 0;
    for (let frame = 0; frame <= 60; frame += 6) {
      for (const node of runtime.program.drivenNodes) {
        exactWorst = Math.max(
          exactWorst,
          quatAngle(
            boneRotation(app, ual.character, exact.clips[0] as ClipId, node, frame),
            boneRotation(app, ual.character, source, node, frame),
          ),
        );
      }
    }
    expect(exactWorst).toBeLessThan(1e-4);

    // A character without matching node names gets nothing.
    const bot = await importFixture(app, 'polybot.vrm');
    const refused = await app.runUntyped('file.importAnimation', {
      name: glb.fileName,
      bytes: glb.bytes,
      character: bot.character,
    });
    expect(refused).toMatchObject({ status: 'failed', error: { code: 'unsupported' } });
  });

  it('keeps each clip’s own provenance when an animation-only GLB of several clips comes back', async () => {
    const { app } = realApp();
    const ual = await importFixture(app, 'quaternius-ual.glb', { clips: [9, 45] });
    const [idle, walk] = ual.clips as [ClipId, ClipId];
    const cc0 = { title: 'Mocap', author: 'Studio', license: 'CC0-1.0', sourceSha256: null };
    await runOk(app, 'clip.setSettings', { clip: idle, provenance: { derivedFrom: [cc0], redistributable: 'yes' } });
    await runOk(app, 'clip.setSettings', { clip: walk, provenance: { redistributable: 'no' } });
    const [glb] = (await runOk(app, 'file.export', {
      kind: 'animation-glb',
      character: ual.character,
      clips: [idle, walk],
      fileNamePattern: 'pair',
      closeLoop: false,
      includeConstantTracks: true,
      acknowledgeLicense: false,
      profile: null,
    })) as ExportArtifact[];
    const back = (await runOk(app, 'file.importAnimation', { name: 'pair.glb', bytes: glb?.bytes })) as {
      clips: ClipId[];
    };
    const records = back.clips.map((id) => app.store.get('clips', id));
    expect(records.map((clip) => [clip?.name, clip?.provenance.redistributable])).toEqual([
      ['Idle_Loop 2', 'yes'],
      ['Walk_Loop 2', 'no'],
    ]);
    expect(records[0]?.provenance.derivedFrom).toEqual([cc0]);
  });
});
