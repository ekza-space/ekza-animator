// AUTORIG-SPEC §10 A0 (editor-core): the A-pose path through the real operators on A-posed Polybot — Import Static
// Model → Create Skeleton on the A-pose truth markers → Bind Skin → `skel.pose.applyAsRest {pose: 'tStance'}`
// ("Straighten to T-Pose"): one undo step; `skel.tpose` gone; every humanoid joint within 0.05 H of the T-pose truth;
// hand tails within 5° of ±X and equal to the pose delta × the old tail (1e-9 m); thighs bit-equal; template rotations
// identity; weights bit-equal; the baked points equal an independent LBS of the posed bind (1e-6 m); the control rig
// equal to a fresh `rig.autoRig.update`; the keys hash unchanged; undo restores rest, points and test pose bit-equal.
// The Studio menu path: T-Stance (a test pose, IK legs in FK) then Apply Pose as Rest gives the same rest. Refusals,
// the clips confirm (UI runs ask, headless runs never), the Validation Fix and the checklist ② hint.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CharacterId, HumanBoneName, JointRecord, MeshId, SkeletonId } from '@ekza-studio/doc';
import { readSkin, type SkinWeights } from '@ekza-studio/mesh-core';
import { DEFAULT_FLEXION, markersFromJoints, type QuickRigMarkers, tStancePose } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src';
import { A_POSE_NOTICE } from '../../src/operators/builtin/rig/quickRigSession';
import { BIND_FIRST, clipsShiftText, NO_TEST_POSE, STRAIGHTEN_LABEL } from '../../src/operators/builtin/rig/restPose';
import { rigChecklist } from '../../src/rig/validation/checklist';
import { type MeshTestApp, meshTestApp } from '../mesh/support';

type V3 = readonly [number, number, number];
const DEG = Math.PI / 180;

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${name}`, import.meta.url)));

interface Truth {
  readonly apose: { readonly humanoid: Readonly<Partial<Record<HumanBoneName, V3>>> };
  readonly tpose: { readonly humanoid: Readonly<Partial<Record<HumanBoneName, V3>>> };
}
const TRUTH = (JSON.parse(new TextDecoder().decode(fixture('polybot-truth.json'))) as { poses: Truth }).poses;

async function ok<T = unknown>(app: EditorApp, id: string, args?: unknown, source?: 'menu' | 'toolkit'): Promise<T> {
  const result = await app.runUntyped(id, args, source === undefined ? undefined : { source });
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}
async function refusal(app: EditorApp, id: string, args?: unknown): Promise<string> {
  const result = await app.runUntyped(id, args);
  return result.status === 'cancelled' ? result.reason : result.status === 'failed' ? result.error.message : 'finished';
}

const keysHash = (app: EditorApp): string =>
  createHash('sha256')
    .update(JSON.stringify([app.store.snapshot().tables['curves'], app.store.snapshot().tables['keys']]))
    .digest('hex');

interface Bound {
  readonly t: MeshTestApp;
  readonly app: EditorApp;
  readonly character: CharacterId;
  readonly skeleton: SkeletonId;
  readonly mesh: MeshId;
  readonly height: number;
}

/** A-posed Polybot imported, rigged on its A-pose truth markers (Standard 33) and bound, in Rig & Skin. */
async function boundPolybot(): Promise<Bound> {
  const t = await meshTestApp();
  const { app } = t;
  await app.rig.load();
  await ok(app, 'workspace.set', { workspace: 'rig' });
  const { meshes } = await ok<{ meshes: MeshId[] }>(app, 'mesh.importStatic', {
    bytes: fixture('polybot-unskinned.glb'),
    name: 'polybot-unskinned.glb',
  });
  const data = app.meshes.get(meshes[0] as MeshId)?.data();
  if (data === null || data === undefined) throw new Error('no mesh data');
  let lo = Infinity;
  let hi = -Infinity;
  for (let p = 0; p < data.counts.points; p++) {
    lo = Math.min(lo, data.position[3 * p + 1] as number);
    hi = Math.max(hi, data.position[3 * p + 1] as number);
  }
  const joints = TRUTH.apose.humanoid;
  const head = joints.head as V3;
  const markers = markersFromJoints((bone) => {
    const position = joints[bone];
    return position === undefined ? undefined : { position, tail: bone === 'head' ? ([0, hi, head[2]] as V3) : null };
  }, lo) as QuickRigMarkers;
  const made = await ok<{ character: CharacterId; skeleton: SkeletonId }>(app, 'skel.quickRig.commit', {
    preset: 'standard33',
    markers,
    meshes,
    flexion: DEFAULT_FLEXION,
  });
  await ok(app, 'skin.bind', {});
  const mesh = app.store.query.meshesOfOwner(made.character)[0]?.id as MeshId;
  return { t, app, character: made.character, skeleton: made.skeleton, mesh, height: hi - lo };
}

const joints = (b: Bound): readonly JointRecord[] => b.app.store.query.jointsOfSkeleton(b.skeleton);
const bone = (list: readonly JointRecord[], name: string): JointRecord => {
  const joint = list.find((j) => j.humanBone === name);
  if (joint === undefined) throw new Error(`no ${name}`);
  return joint;
};
const points = (b: Bound): Float32Array => Float32Array.from(b.app.meshes.get(b.mesh)?.data()?.position ?? []);
const skinOf = (b: Bound): SkinWeights => readSkin(b.app.meshes.get(b.mesh)?.data() as never) as SkinWeights;
const rowCodes = (b: Bound): string[] => b.app.rig.validation.rows(b.character, null).map((row) => row.code);
const rigTables = (app: EditorApp) => {
  const tables = app.store.snapshot().tables;
  return JSON.stringify([tables['controls'], tables['solvers'], tables['rigs']]);
};
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

describe('Straighten to T-Pose (skel.pose.applyAsRest {pose: tStance}) on A-posed Polybot', () => {
  it('one step; skel.tpose gone; T-pose joints; tails; thighs, weights bit-equal; LBS bake; fresh control rig; undo', async () => {
    const b = await boundPolybot();
    const { app } = b;
    expect(rowCodes(b)).toContain('skel.tpose');
    // The Validation Fix of the row is this operator (AUTORIG A0).
    const row = app.rig.validation.rows(b.character, null).find((r) => r.code === 'skel.tpose');
    expect(row?.fix).toEqual({
      label: STRAIGHTEN_LABEL,
      op: 'skel.pose.applyAsRest',
      args: { character: b.character, pose: 'tStance' },
    });
    // Checklist ②: the A-pose hint while skel.tpose is the only skel.* error.
    const two = rigChecklist(app, b.character, {
      rows: app.rig.validation.rows(b.character, null),
      previewed: false,
    })[1];
    expect(two?.detail).toBe('A-posed: Bind Skin, then Straighten to T-Pose');

    const before = joints(b);
    const pointsBefore = points(b);
    const skinBefore = skinOf(b);
    const keys = keysHash(app);
    const steps = app.history.peekUndo()?.id;
    const pose = tStancePose(before, b.skeleton);

    await ok(app, 'skel.pose.applyAsRest', { character: b.character, pose: 'tStance' });
    expect(app.history.peekUndo()?.label).toBe(STRAIGHTEN_LABEL);
    app.history.undo();
    expect(app.history.peekUndo()?.id).toBe(steps);
    app.history.redo();
    expect(app.history.peekUndo()?.label).toBe(STRAIGHTEN_LABEL);

    const after = joints(b);
    expect(rowCodes(b)).not.toContain('skel.tpose');
    // Joints within 0.05 H of the T-pose truth; template rotations identity; thighs bit-equal.
    const truth = TRUTH.tpose.humanoid as Readonly<Record<string, V3>>;
    const off = after
      .filter((j) => j.humanBone !== null && truth[j.humanBone] !== undefined)
      .map((j) => [j.humanBone, dist(j.restPosition, truth[j.humanBone as string] as V3) / b.height] as const)
      .filter(([, e]) => e > 0.05);
    expect(off).toEqual([]);
    expect(after.filter((j) => j.restRotation.join() !== '0,0,0,1').map((j) => j.key)).toEqual([]);
    for (const thigh of ['leftUpperLeg', 'rightUpperLeg']) expect(bone(after, thigh)).toEqual(bone(before, thigh));
    // Hands along ±X; every tail = the pose delta × the old tail.
    for (const [side, x] of [
      ['left', 1],
      ['right', -1],
    ] as const) {
      const hand = bone(after, `${side}Hand`);
      const v = (hand.tail as V3).map((c, k) => c - (hand.restPosition[k] as number));
      expect(Math.acos(Math.min(1, (x * (v[0] as number)) / Math.hypot(...v)))).toBeLessThan(5 * DEG);
    }
    const tailErrors = before.flatMap((joint) => {
      const delta = pose.deltas.get(joint.id);
      const t = joint.tail;
      if (delta === undefined || t === null) return [];
      const expected = [0, 1, 2].map(
        (r) =>
          (delta[r] as number) * t[0] +
          (delta[4 + r] as number) * t[1] +
          (delta[8 + r] as number) * t[2] +
          (delta[12 + r] as number),
      );
      return [dist(after.find((j) => j.id === joint.id)?.tail as V3, expected)];
    });
    expect(tailErrors.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...tailErrors)).toBeLessThan(1e-9);
    // Weights bit-equal; the baked points equal an independent LBS of the posed bind (1e-6 m).
    const skinAfter = skinOf(b);
    expect(Array.from(skinAfter.weights)).toEqual(Array.from(skinBefore.weights));
    expect(Array.from(skinAfter.joints)).toEqual(Array.from(skinBefore.joints));
    const baked = points(b);
    let maxError = 0;
    let moved = 0;
    for (let p = 0; p < skinBefore.points; p++) {
      const v = [0, 1, 2].map((c) => pointsBefore[3 * p + c] as number);
      const expected = [0, 0, 0];
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += skinBefore.weights[4 * p + k] as number;
      for (let k = 0; k < 4; k++) {
        const w = (skinBefore.weights[4 * p + k] as number) / sum;
        if (w === 0) continue;
        const key = skinBefore.palette[skinBefore.joints[4 * p + k] as number]?.key as never;
        const m = pose.deltas.get(key);
        for (let r = 0; r < 3; r++) {
          const value =
            m === undefined
              ? (v[r] as number)
              : (m[r] as number) * (v[0] as number) +
                (m[4 + r] as number) * (v[1] as number) +
                (m[8 + r] as number) * (v[2] as number) +
                (m[12 + r] as number);
          expected[r] = (expected[r] as number) + w * value;
        }
      }
      const e = dist(
        expected,
        [0, 1, 2].map((c) => baked[3 * p + c] as number),
      );
      maxError = Math.max(maxError, e);
      if (
        dist(
          v,
          [0, 1, 2].map((c) => baked[3 * p + c] as number),
        ) > 1e-4
      )
        moved++;
    }
    expect(maxError).toBeLessThan(1e-6);
    expect(moved).toBeGreaterThan(100);
    // The control rig equals a fresh rig.autoRig.update on the straightened skeleton; keys never change.
    const rig = rigTables(app);
    await ok(app, 'rig.autoRig.update', { character: b.character });
    expect(rigTables(app)).toBe(rig);
    expect(keysHash(app)).toBe(keys);
    app.history.undo(); // the Update Control Rig step (if it recorded one) or the straighten
    if (app.history.peekUndo()?.label === STRAIGHTEN_LABEL) app.history.undo();
    // Undo restores rest, points and the (empty) test pose bit-equal.
    expect(joints(b)).toEqual(before);
    expect(Array.from(points(b))).toEqual(Array.from(pointsBefore));
    expect(app.rig.testPose.values(b.character).size).toBe(0);
    expect(rowCodes(b)).toContain('skel.tpose');
  });

  it('the Studio menu path: T-Stance (a test pose, IK legs in FK) then Apply Pose as Rest; undo brings the pose back', async () => {
    const b = await boundPolybot();
    const { app } = b;
    expect(await refusal(app, 'skel.pose.applyAsRest', {})).toBe(NO_TEST_POSE);
    const before = joints(b);
    const keys = keysHash(app);
    const direct = tStancePose(before, b.skeleton);
    await ok(app, 'skel.pose.tStance', {}, 'menu');
    expect(app.history.peekUndo()?.label).toBe('Test Pose');
    expect(app.session.getState().rig.poseView).toBe('test');
    const testPose = app.rig.testPose.values(b.character);
    expect(testPose.size).toBeGreaterThan(0);
    // The IK legs are switched to FK for the test.
    expect([...testPose.values()].filter((values) => values['@ikFk'] === 0).length).toBe(2);
    // The joints are unchanged by a test pose.
    expect(joints(b)).toEqual(before);
    const pointsBefore = points(b);
    await ok(app, 'skel.pose.applyAsRest', {}, 'menu');
    expect(app.history.peekUndo()?.label).toBe('Apply Pose as Rest');
    expect(app.rig.testPose.values(b.character).size).toBe(0);
    expect(app.session.getState().rig.poseView).toBe('bind');
    // The same rest as the direct T-Stance (the solve through the controls, 1e-6 m).
    const after = joints(b);
    const byId = new Map(before.map((joint) => [joint.id, joint]));
    for (const joint of after) {
      const delta = direct.deltas.get(joint.id);
      const rest = byId.get(joint.id) as JointRecord;
      const expected =
        delta === undefined
          ? rest.restPosition
          : [0, 1, 2].map(
              (r) =>
                (delta[r] as number) * rest.restPosition[0] +
                (delta[4 + r] as number) * rest.restPosition[1] +
                (delta[8 + r] as number) * rest.restPosition[2] +
                (delta[12 + r] as number),
            );
      expect(dist(joint.restPosition, expected)).toBeLessThan(1e-6);
    }
    expect(rowCodes(b)).not.toContain('skel.tpose');
    expect(keysHash(app)).toBe(keys);
    // One step: undo restores the rest, the points and the T-Stance test pose; redo clears it again.
    app.history.undo();
    expect(joints(b)).toEqual(before);
    expect(Array.from(points(b))).toEqual(Array.from(pointsBefore));
    expect(app.rig.testPose.values(b.character)).toEqual(testPose);
    app.history.redo();
    expect(app.rig.testPose.values(b.character).size).toBe(0);
    expect(dist(bone(joints(b), 'rightHand').restPosition, bone(after, 'rightHand').restPosition)).toBe(0);
  });

  it('with clips a UI run asks first (no step) and the answer applies; headless runs never ask', async () => {
    const b = await boundPolybot();
    const { app } = b;
    await ok(app, 'clip.new', { character: b.character, name: 'Idle' });
    const steps = app.history.peekUndo()?.id;
    await ok(app, 'skel.pose.applyAsRest', { character: b.character, pose: 'tStance' }, 'toolkit');
    expect(app.session.getState().dialog).toBe('applyPoseAsRest');
    expect(app.history.peekUndo()?.id).toBe(steps);
    expect(rowCodes(b)).toContain('skel.tpose');
    expect(clipsShiftText(1)).toBe(
      'Clips authored on the old rest shift by the pose delta (1 clip). Do this before animating.',
    );
    app.session.setState({ dialog: null });
    // The dialog's answer: `confirm: true` re-runs the asking run (its character and pose).
    await ok(app, 'skel.pose.applyAsRest', { confirm: true }, 'menu');
    expect(app.history.peekUndo()?.label).toBe(STRAIGHTEN_LABEL);
    expect(rowCodes(b)).not.toContain('skel.tpose');
    app.history.undo();
    expect(rowCodes(b)).toContain('skel.tpose');
    // Headless (api): no question.
    await ok(app, 'skel.pose.applyAsRest', { pose: 'tStance' });
    expect(app.history.peekUndo()?.label).toBe(STRAIGHTEN_LABEL);
  });

  it('refusals: an unbound mesh, no skeleton; the A-pose notice names the fix', async () => {
    const b = await boundPolybot();
    const { app } = b;
    await ok(app, 'skin.unbind', { meshes: [b.mesh], confirm: true });
    expect(await refusal(app, 'skel.pose.applyAsRest', { pose: 'tStance' })).toBe(BIND_FIRST);
    const empty = await meshTestApp();
    await empty.app.rig.load();
    expect(await refusal(empty.app, 'skel.pose.applyAsRest', { pose: 'tStance' })).toBe(
      'Make a character from your model first',
    );
    expect(A_POSE_NOTICE).toBe(
      'A-posed arms: the skeleton follows them; after Bind Skin, Straighten to T-Pose makes the rest a VRM T-pose',
    );
  });
});
