// M2A-SPEC §8 A0 on the licensed fixtures through the production kernel: body parts (the complete §5.19 table) on
// Seed-san and Polybot, the body-part key target, visibility rule 1 on M1 rigs, the schema rule end to end (an M1
// project opens writable and saves schemaVersion 2 / minWriterVersion 1; an enabled ik2 solver saves 2), and the
// rotate-order change on a loop clip, whose cyclic curves the editor evaluates cycle-aware (§5.23).
import { mat4Decompose, type Quat, quatAngle } from '@ekza-animator/anim-core';
import {
  type ClipId,
  type ControlId,
  type ControlRecord,
  type DocSnapshot,
  SCHEMA_VERSION,
  solverId,
} from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import {
  type BodyPart,
  bodyPartOf,
  controlVisibility,
  type EditorApp,
  keyTargetControls,
} from '@ekza-animator/editor-core';
import { readProjectArchive, writeProjectArchive } from '@ekza-animator/io';
import { describe, expect, it } from 'vitest';
import { BLOCKED, importFixture, realApp, runOk, SIBLINGS_READY, setSceneFrame } from './ops.support';

/** The §5.19 table for a template key, written out independently of the implementation's table. */
function expectedPart(key: string): BodyPart | null {
  if (key === 'root') return 'root';
  if (['cog', 'fk.hips', 'fk.spine', 'fk.chest', 'fk.upperChest'].includes(key)) return 'torso';
  if (['fk.neck', 'fk.head', 'fk.jaw'].includes(key)) return 'head';
  const side = key.endsWith('.L') ? 'L' : key.endsWith('.R') ? 'R' : null;
  if (side === null) return null;
  const stem = key.slice(0, -2);
  if (['fk.shoulder', 'fk.upperArm', 'fk.lowerArm', 'fk.hand', 'ik.arm', 'pole.arm'].includes(stem)) {
    return `arm.${side}`;
  }
  if (['fk.upperLeg', 'fk.lowerLeg', 'fk.foot', 'fk.toes', 'ik.leg', 'pole.leg'].includes(stem)) {
    return `leg.${side}`;
  }
  if (/^fk\.(thumb|index|middle|ring|little)/.test(stem)) return `fingers.${side}`;
  return null;
}

function controlsOf(app: EditorApp): readonly ControlRecord[] {
  const character = app.session.getState().activeCharacter;
  const rig = character === null ? undefined : app.store.query.rigOfCharacter(character);
  return rig === undefined ? [] : app.store.query.controlsOfRig(rig.id);
}

describe.skipIf(!SIBLINGS_READY)(`M2a foundation on the fixtures ${BLOCKED}`, { timeout: 120_000 }, () => {
  for (const fixture of ['seed-san.vrm', 'polybot.vrm'] as const) {
    it(`bodyPartOf: the §5.19 table on ${fixture}, secondary controls by their nearest grouped ancestor`, async () => {
      const { app } = realApp();
      await importFixture(app, fixture);
      const controls = controlsOf(app);
      const byId = new Map(controls.map((control) => [control.id, control]));
      expect(controls.length).toBeGreaterThan(20);
      const seen = new Set<BodyPart>();
      for (const control of controls) {
        const part = bodyPartOf(app, control.id);
        let expected = expectedPart(control.key);
        // Not in the table (eyes, secondary controls): the nearest ancestor that is.
        for (let at = control; expected === null && at.parent !== null; ) {
          const parent = byId.get(at.parent);
          if (parent === undefined) break;
          expected = expectedPart(parent.key);
          at = parent;
        }
        expect([control.key, part]).toEqual([control.key, expected]);
        expect([control.key, part === null]).toEqual([control.key, false]);
        if (part !== null) seen.add(part);
      }
      for (const part of ['root', 'torso', 'head', 'arm.L', 'arm.R', 'leg.L', 'leg.R'] as const) {
        expect([fixture, part, seen.has(part)]).toEqual([fixture, part, true]);
      }
    });
  }

  it('the body-part key target of fk.hand.L is exactly the visible arm.L controls (Seed-san)', async () => {
    const { app } = realApp();
    await importFixture(app, 'seed-san.vrm');
    const controls = controlsOf(app);
    const id = (key: string): ControlId => {
      const control = controls.find((candidate) => candidate.key === key);
      if (control === undefined) throw new Error(`no control ${key}`);
      return control.id;
    };
    await runOk(app, 'select.controls', { ids: [id('fk.hand.L')], mode: 'replace' });
    const target = new Set(keyTargetControls(app, 'bodyPart'));
    const expected = controls
      .filter((control) => bodyPartOf(app, control.id) === 'arm.L' && controlVisibility(app, control.id) === 'visible')
      .map((control) => control.id);
    expect(target).toEqual(new Set(expected));
    expect(target).toEqual(new Set(['fk.shoulder.L', 'fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L'].map(id)));
    // Secondary controls follow rule 1: shown, they join their part.
    app.session.setState({ showSecondary: true });
    const withSecondary = keyTargetControls(app, 'bodyPart');
    expect(withSecondary.length).toBeGreaterThanOrEqual(target.size);
    for (const control of withSecondary) expect(bodyPartOf(app, control)).toBe('arm.L');
  });

  it('visibility rule 1 on an M1 rig: secondary controls hidden until shown, user-hidden controls hidden', async () => {
    const { app } = realApp();
    await importFixture(app, 'seed-san.vrm');
    const controls = controlsOf(app);
    for (const control of controls) {
      expect([control.key, controlVisibility(app, control.id)]).toEqual([
        control.key,
        control.hiddenByDefault ? 'hidden' : 'visible',
      ]);
    }
    const head = controls.find((control) => control.key === 'fk.head');
    if (head === undefined) throw new Error('no head');
    app.session.setState({ hiddenControls: new Set([head.id]) });
    expect(controlVisibility(app, head.id)).toBe('hidden');
  });

  it('rig.setRotateOrder on a loop clip keeps the bone world at every key (Polybot, cyclic curves, 1e-9)', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const clip = (
      (await runOk(app, 'clip.new', { character: bot.character, name: 'cycle', range: { start: 0, end: 24 } })) as {
        clip: ClipId;
      }
    ).clip;
    await runOk(app, 'clip.setSettings', { clip, loop: true });
    expect(app.session.getState().activeClip[bot.character]).toBe(clip);
    const rig = app.store.query.rigOfCharacter(bot.character);
    const arm = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, 'fk.lowerArm.L');
    if (arm === undefined) throw new Error('no fk.lowerArm.L');
    const key = async (frame: number, channel: 'rx' | 'rz', value: number) => {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', { edits: [{ control: arm.id, channel, value }], key: 'force' });
    };
    for (const [frame, value] of [
      [0, 0],
      [6, 0.6],
      [12, 0],
      [18, -0.6],
      [24, 0],
    ] as const) {
      await key(frame, 'rx', value);
    }
    await key(3, 'rz', 0.8);
    await key(21, 'rz', 0.8);
    const base = app.store.query.baseLayer(clip)?.id;
    if (base === undefined) throw new Error('no base layer');
    const rx = app.store.query.curveFor(clip, base, arm.id, 'rx');
    expect([rx?.pre, rx?.post]).toEqual(['cycle', 'cycle']);
    const node = bot.runtime.skeleton.humanoid?.leftLowerArm as number;
    const boneRotation = (frame: number): Quat => {
      const pose = bot.runtime.program.allocPose();
      app.evaluation.evaluateAt(bot.character, clip, frame, pose, { withOverrides: false });
      return mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16)).q;
    };
    const union = [0, 3, 6, 12, 18, 21, 24];
    const before = union.map(boneRotation);
    const to = arm.rotateOrder === 'zyx' ? 'xyz' : 'zyx';
    await runOk(app, 'rig.setRotateOrder', { control: arm.id, order: to });
    expect(app.store.get('controls', arm.id)?.rotateOrder).toBe(to);
    union.forEach((frame, i) => {
      const error = quatAngle(boneRotation(frame), before[i] as Quat);
      expect([frame, error < 1e-9]).toEqual([frame, true]);
    });
  });

  it('an M1 project opens writable and saves schemaVersion 2 / minWriterVersion 1; an enabled ik2 solver saves 2', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    // The same document as an M1 app wrote it: schema 1 everywhere.
    const current = app.store.snapshot();
    const project = current.tables.project.project;
    if (project === undefined) throw new Error('no project record');
    const m1: DocSnapshot = {
      ...current,
      schemaVersion: 1,
      minWriterVersion: 1,
      tables: { ...current.tables, project: { project: { ...project, schemaVersion: 1, minWriterVersion: 1 } } },
    };
    const asset = app.store.list('assets')[0];
    if (asset === undefined) throw new Error('no asset');
    const bytes = writeProjectArchive(m1, new Map([[asset.id, { record: asset, bytes: readFixture('polybot.vrm') }]]), {
      version: '0.1.0',
    });

    const { app: m2a, services } = realApp({ seed: 41 });
    const opened = (await runOk(m2a, 'file.openProject', { name: 'm1.ekzanim', bytes })) as {
      readOnly: boolean;
      migratedFrom: number;
    };
    expect(opened).toEqual({ readOnly: false, migratedFrom: 1 });
    expect(m2a.store.readOnly).toBe(false);
    await runOk(m2a, 'file.save', { fileName: 'm2a.ekzanim' });
    const saved = await readProjectArchive(services.downloads.at(-1)?.bytes ?? new Uint8Array(0));
    expect(saved.snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(saved.snapshot.schemaVersion).toBe(2);
    expect(saved.snapshot.minWriterVersion).toBe(1);
    expect(saved.readOnly).toBe(false);

    // An enabled ik2 solver (what rig.addLimbIk writes, A1/A2) makes the saved project need schema 2.
    m2a.store.transact({ label: 'Add Limb IK' }, (tx) =>
      tx.put('solvers', {
        id: solverId(bot.runtime.program.rigId, 'ik2.leg.L'),
        rig: bot.runtime.program.rigId,
        type: 'ik2',
        params: { v: 1 },
        enabled: true,
        deleted: null,
      }),
    );
    await runOk(m2a, 'file.save', { fileName: 'm2a-ik.ekzanim' });
    const withIk = await readProjectArchive(services.downloads.at(-1)?.bytes ?? new Uint8Array(0));
    expect(withIk.snapshot.minWriterVersion).toBe(2);
    expect(withIk.readOnly).toBe(false);
    expect(withIk.snapshot.tables.project.project?.minWriterVersion).toBe(1);
  });
});
