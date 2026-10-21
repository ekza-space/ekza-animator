// A1 (M2A-SPEC §5.7, §8 A1 tests): an M1 rig upgraded with limb IK at ikFk 0 (the records `rig.addLimbIk` writes)
// exports byte-identical files until a limb is switched — bake into the model, VRMA and animation GLB, through the
// production kernel (`file.export`), with smooth and stepped curves on the legs, arms, fingers and cog.
import type { CharacterId, ClipId, ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ExportArtifact, ExportKind, ExportRequest } from '@ekza-studio/io';
import { type LimbId, limbIkRecords, readRigDefinition } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { BLOCKED, importFixture, realApp, runOk, SIBLINGS_READY, setSceneFrame } from './ops.support';

const DEG = Math.PI / 180;
const LIMBS: readonly LimbId[] = ['leg.L', 'leg.R', 'arm.L', 'arm.R'];

function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

async function exportBytes(
  app: EditorApp,
  character: CharacterId,
  clip: ClipId,
  kind: ExportKind,
): Promise<Uint8Array> {
  const request: ExportRequest = {
    kind,
    character,
    clips: [clip],
    fileNamePattern: '{character}_{clip}',
    closeLoop: true,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
  };
  const [artifact] = (await runOk(app, 'file.export', request)) as readonly ExportArtifact[];
  if (artifact === undefined) throw new Error(`no ${kind} artifact`);
  return artifact.bytes;
}

/** Keys `values` (template key → channel → value) at `frame`, forced, with the current default tangents. */
async function keyAt(
  app: EditorApp,
  character: CharacterId,
  frame: number,
  values: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Promise<void> {
  setSceneFrame(app, frame);
  const edits = Object.entries(values).flatMap(([key, channels]) =>
    Object.entries(channels).map(([channel, value]) => ({ control: controlOf(app, character, key), channel, value })),
  );
  await runOk(app, 'channel.setValues', { edits, key: 'force' });
}

describe.skipIf(!SIBLINGS_READY)(`upgraded M1 rig exports ${BLOCKED}`, { timeout: 180_000 }, () => {
  it('exports byte-identical files after limb IK is added at ikFk 0 (§5.7)', async () => {
    const { app } = realApp();
    // An M1 rig: the import rigs FK limbs only (A2's import passes prefs.autoRigIk, §5.7, M2A-D1).
    app.prefs.setState({ autoRigIk: { legs: false, arms: false } });
    const seed = await importFixture(app, 'seed-san.vrm');
    const character = seed.character;
    const { clip } = (await runOk(app, 'clip.new', { character, name: 'steps', range: { start: 0, end: 20 } })) as {
      clip: ClipId;
    };
    // Smooth keys (auto tangents) on the legs and arms.
    for (const [frame, t] of [
      [0, 0],
      [10, 1],
      [20, 0],
    ] as const) {
      await keyAt(app, character, frame, {
        'fk.upperLeg.L': { rx: (30 - 50 * t) * DEG },
        'fk.lowerLeg.L': { rx: 40 * t * DEG },
        'fk.foot.R': { rx: 15 * t * DEG },
        'fk.upperArm.R': { rz: (20 + 30 * t) * DEG },
        'fk.lowerArm.L': { ry: -40 * t * DEG },
      });
    }
    // Stepped keys: a cog drop and finger curls (all-stepped tracks bake as STEP).
    app.prefs.setState({ defaultTangents: { in: 'flat', out: 'step' } });
    for (const [frame, t] of [
      [0, 0],
      [6, 1],
      [14, 0],
    ] as const) {
      await keyAt(app, character, frame, {
        cog: { ty: -0.05 * t },
        'fk.indexProximal.L': { rz: 50 * t * DEG },
        'fk.lowerLeg.R': { rx: 25 * t * DEG },
      });
    }
    app.prefs.setState({ defaultTangents: { in: 'auto', out: 'auto' } });

    const kinds: readonly ExportKind[] = ['bake-into-model', 'vrma', 'animation-glb'];
    const before = new Map<ExportKind, Uint8Array>();
    for (const kind of kinds) before.set(kind, await exportBytes(app, character, clip, kind));
    // The writers are deterministic: a second export is identical.
    expect(await exportBytes(app, character, clip, 'vrma')).toEqual(before.get('vrma'));

    // Add the four limbs' IK records at ikFk 0 (what rig.addLimbIk writes).
    const rig = app.store.query.rigOfCharacter(character);
    const def = rig === undefined ? undefined : readRigDefinition(app.store, rig.id);
    if (def === undefined) throw new Error('no rig');
    expect(def.solvers).toEqual([]);
    const records = limbIkRecords(def, seed.runtime.skeleton, { limbs: LIMBS, ikFkDefault: 0 });
    expect(records.warnings).toEqual([]);
    app.store.transact({ label: 'Add Limb IK' }, (tx) => {
      for (const control of records.controls) tx.put('controls', control);
      for (const solver of records.solvers) tx.put('solvers', solver);
    });
    const runtime = app.characters.get(character);
    expect(runtime?.program.limbs.map((l) => l.id).sort()).toEqual([...LIMBS].sort());

    for (const kind of kinds) {
      const after = await exportBytes(app, character, clip, kind);
      expect([kind, after.length]).toEqual([kind, before.get(kind)?.length]);
      expect([kind, Buffer.compare(Buffer.from(after), Buffer.from(before.get(kind) as Uint8Array))]).toEqual([
        kind,
        0,
      ]);
    }

    // Switching a limb changes the bake: the right arm's ikFk default raised to 1 (the IK hand stays at rest).
    const armIk = controlOf(app, character, 'ik.arm.R');
    const attrs = app.store.get('controls', armIk)?.attrs ?? {};
    const ikFk = attrs['ikFk'];
    if (ikFk === undefined) throw new Error('no ikFk attribute');
    app.store.transact({ label: 'Switch R Arm' }, (tx) => {
      tx.patch('controls', armIk, { attrs: { ...attrs, ikFk: { ...ikFk, default: 1 } } });
    });
    expect(app.characters.get(character)?.program.limbs.length).toBe(4);
    const switched = await exportBytes(app, character, clip, 'vrma');
    expect(Buffer.compare(Buffer.from(switched), Buffer.from(before.get('vrma') as Uint8Array))).not.toBe(0);
  });
});
