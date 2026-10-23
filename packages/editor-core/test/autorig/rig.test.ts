// AUTORIG-SPEC §4.5, §5.4, §6.1 (D4): the ③ Rig compositions. `autorig.rig` on an open Quick Rig session makes exactly
// two undo steps for a T-posed input ("Create Skeleton", "Bind Skin") — the committed joints equal the last preview,
// the points stay bit-equal to the import — and three for an A-posed one with `straighten` (+ "Straighten to T-Pose":
// no `skel.tpose` row, the joints on the T-pose truth). It never straightens on its own: a T-posed Cube Lad with the
// elbow marker 8° off the arm line makes two steps, bit-equal points and the `skel.tpose` row. A failure keeps the
// earlier steps; an undo between the inner runs stops it ("Rigging was interrupted…"); `autorig.cancel` during the
// bind leaves exactly the skeleton step; the M6b re-run asks before it rebinds (`confirm-required`) and then refits
// in one step.
import { readFileSync } from 'node:fs';
import type { CharacterId, HumanBoneName, MeshId, SkeletonId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import {
  ARMS_NOT_FOUND,
  autoRigBindMeshes,
  autoRigRefitBound,
  type EditorApp,
  type SkinWorkerPort,
  quickRigOf,
} from '../../src';
import { COMPOSITION_INTERRUPTED } from '../../src/operators/builtin/rig/wizard';
import { NO_MARKERS, NOTHING_TO_CANCEL } from '../../src/operators/builtin/rig/wizard/rig';
import { REBIND_CONFIRM } from '../../src/operators/builtin/rig/quickRig';
import { meshTestApp } from '../mesh/support';

type V3 = readonly [number, number, number];
const DEG = Math.PI / 180;
const fixture = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${file}`, import.meta.url)));
const TRUTH = (
  JSON.parse(new TextDecoder().decode(fixture('polybot-truth.json'))) as {
    poses: Record<'apose' | 'tpose', { readonly height: number; readonly humanoid: Record<string, V3> }>;
  }
).poses;

async function ok<T = unknown>(app: EditorApp, id: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}
async function refusal(app: EditorApp, id: string, args?: unknown): Promise<{ code: string; message: string }> {
  const result = await app.runUntyped(id, args);
  if (result.status === 'cancelled') return { code: 'poll', message: result.reason };
  if (result.status === 'failed') return { code: result.error.code, message: result.error.message };
  return { code: 'finished', message: '' };
}
const labels = (app: EditorApp): string[] => {
  const out: string[] = [];
  while (app.history.canUndo()) out.push(app.history.undo()?.label ?? '?');
  while (app.history.canRedo()) app.history.redo();
  return out.reverse();
};
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

interface Opened {
  readonly app: EditorApp;
  readonly meshes: MeshId[];
  readonly points: Float32Array;
}

/** A fixture imported static, in Rig & Skin, with Quick Rig open on it (the One-Click guess placed the markers). */
async function opened(file: string): Promise<Opened> {
  const { app } = await meshTestApp();
  await app.rig.load();
  await ok(app, 'workspace.set', { workspace: 'rig' });
  const { meshes } = await ok<{ meshes: MeshId[] }>(app, 'mesh.importStatic', { bytes: fixture(file), name: file });
  const points = Float32Array.from(app.meshes.get(meshes[0] as MeshId)?.data()?.position ?? []);
  await ok(app, 'skel.quickRig.start', { meshes });
  expect(quickRigOf(app)?.preview).not.toBeNull();
  return { app, meshes, points };
}

const meshOf = (app: EditorApp, character: CharacterId): MeshId =>
  app.store.query.meshesOfOwner(character).find((mesh) => mesh.deleted === null)?.id as MeshId;
const pointsOf = (app: EditorApp, mesh: MeshId): Float32Array =>
  Float32Array.from(app.meshes.get(mesh)?.data()?.position ?? []);
const rowCodes = (app: EditorApp, character: CharacterId): string[] =>
  app.rig.validation.rows(character, 'ekza/space-avatar-v1').map((row) => row.code);

describe('autorig.rig (§4.5)', () => {
  it('a T-posed Cube Lad: two steps, the joints of the last preview, points bit-equal, no busy', async () => {
    const { app, points } = await opened('cube-lad.glb');
    const preview = quickRigOf(app)?.preview ?? [];
    const before = app.history.peekUndo()?.id;
    const result = await ok<{ character: CharacterId; skeleton: SkeletonId; straightened: boolean }>(
      app,
      'autorig.rig',
      { straighten: false },
    );
    expect(result.straightened).toBe(false);
    expect(labels(app)).toEqual(['Import Static Model', 'Create Skeleton', 'Bind Skin']);
    expect(app.history.peekUndo()?.id).not.toBe(before);
    // C2's rule observed through the composition: the committed joints are the last preview, bit for bit.
    const joints = app.store.query.jointsOfSkeleton(result.skeleton);
    for (const joint of preview) {
      const committed = joints.find((record) => record.key === joint.key);
      expect([joint.key, committed?.restPosition]).toEqual([joint.key, [...joint.position]]);
    }
    const mesh = meshOf(app, result.character);
    expect(Array.from(pointsOf(app, mesh))).toEqual(Array.from(points));
    expect(app.store.get('meshes', mesh)?.skin).toMatchObject({ skeleton: result.skeleton });
    expect(quickRigOf(app)).toBeNull();
    expect(app.session.getState().busy).toBeNull();
    const errors = app.rig.validation
      .rows(result.character, 'ekza/space-avatar-v1')
      .filter((row) => row.severity === 'error' && /^(skel|skin|xform)\./.test(row.code));
    expect(errors).toEqual([]);
    // the second poll after `prepare` passed although Quick Rig closed; a new run polls again
    expect(await refusal(app, 'autorig.rig')).toEqual({ code: 'poll', message: NO_MARKERS });
  });

  it('an A-posed Polybot with straighten: three steps, no skel.tpose, the T-pose truth, identity rotations', async () => {
    const { app } = await opened('polybot-unskinned.glb');
    expect(quickRigOf(app)?.guess?.aPose).toBe(true);
    const result = await ok<{ character: CharacterId; skeleton: SkeletonId; straightened: boolean }>(
      app,
      'autorig.rig',
      { straighten: true },
    );
    expect(result.straightened).toBe(true);
    expect(labels(app)).toEqual(['Import Static Model', 'Create Skeleton', 'Bind Skin', 'Straighten to T-Pose']);
    expect(rowCodes(app, result.character)).not.toContain('skel.tpose');
    const joints = app.store.query.jointsOfSkeleton(result.skeleton);
    const truth = TRUTH.tpose;
    const off = joints
      .filter((joint) => joint.humanBone !== null && truth.humanoid[joint.humanBone] !== undefined)
      .map(
        (joint) =>
          [
            joint.humanBone,
            dist(joint.restPosition, truth.humanoid[joint.humanBone as HumanBoneName] as V3) / truth.height,
          ] as const,
      )
      .filter(([, e]) => e > 0.05);
    expect(off).toEqual([]);
    expect(joints.filter((joint) => joint.restRotation.join() !== '0,0,0,1').map((joint) => joint.key)).toEqual([]);
    // undo returns the A-posed rest and the skel.tpose row; redo restores the T-pose
    app.history.undo();
    expect(rowCodes(app, result.character)).toContain('skel.tpose');
    app.history.redo();
    expect(rowCodes(app, result.character)).not.toContain('skel.tpose');
  });

  it('never straightens on its own: the elbow 8° off the arm line in FRONT keeps two steps and the points', async () => {
    const { app, points } = await opened('cube-lad.glb');
    const state = quickRigOf(app);
    const shoulder = state?.markers.shoulder as V3;
    const elbow = state?.markers.elbow as V3;
    const length = Math.hypot(elbow[0] - shoulder[0], elbow[1] - shoulder[1]);
    const nudged = [shoulder[0] - length * Math.cos(8 * DEG), shoulder[1] - length * Math.sin(8 * DEG), elbow[2]];
    await ok(app, 'skel.quickRig.setMarker', { name: 'elbow', point: nudged });
    const result = await ok<{ character: CharacterId; straightened: boolean }>(app, 'autorig.rig', {});
    expect(result.straightened).toBe(false);
    expect(labels(app)).toEqual(['Import Static Model', 'Create Skeleton', 'Bind Skin']);
    expect(Array.from(pointsOf(app, meshOf(app, result.character)))).toEqual(Array.from(points));
    const row = app.rig.validation
      .rows(result.character, 'ekza/space-avatar-v1')
      .find((candidate) => candidate.code === 'skel.tpose');
    expect(row?.severity).toBe('error');
    expect(row?.fix).toMatchObject({ op: 'skel.pose.applyAsRest', args: { pose: 'tStance' } });
  });

  it('polls: no Quick Rig, the commit block, bad arguments', async () => {
    const { app } = await meshTestApp();
    await app.rig.load();
    expect(await refusal(app, 'autorig.rig')).toEqual({ code: 'poll', message: NO_MARKERS });
    expect((await refusal(app, 'autorig.rig', { straighten: 'yes' })).message).toBe('straighten must be true or false');
    const { app: other } = await opened('cube-lad.glb');
    const state = quickRigOf(other);
    if (state === null) throw new Error('no Quick Rig');
    other.session.setState({
      rig: { ...other.session.getState().rig, quickRig: { ...state, checks: { ...state.checks, grounded: false } } },
    });
    expect((await refusal(other, 'autorig.rig')).code).toBe('poll');
    expect(labels(other)).toEqual(['Import Static Model']);
  });

  it('AR-D10-3: a failed guess (arms down) waits for the arm markers placed by hand', async () => {
    const { app } = await opened('cube-lad.glb');
    const state = quickRigOf(app);
    if (state === null) throw new Error('no Quick Rig');
    const failed = {
      armAngle: 0,
      aPose: false,
      failed: 'No leg split or arm run found: the markers follow the template',
    };
    app.session.setState({ rig: { ...app.session.getState().rig, quickRig: { ...state, guess: failed } } });
    expect(await refusal(app, 'autorig.rig')).toEqual({ code: 'poll', message: ARMS_NOT_FOUND });
    // two of the three arm markers moved: still waiting
    for (const name of ['shoulder', 'elbow'] as const) {
      await ok(app, 'skel.quickRig.setMarker', { name, point: [...(state.markers[name] ?? [0, 0, 0])] });
    }
    expect(app.operators.poll('autorig.rig')).toEqual({ ok: false, reason: ARMS_NOT_FOUND });
    await ok(app, 'skel.quickRig.setMarker', { name: 'wrist', point: [...(state.markers.wrist ?? [0, 0, 0])] });
    expect(app.operators.poll('autorig.rig')).toBe(true);
  });

  it('AR-R5-1: a character outside 0.3–3 m waits for Set height (a centimetre export is not rigged as a giant)', async () => {
    const { app } = await opened('cube-lad.glb');
    const state = quickRigOf(app);
    if (state === null) throw new Error('no Quick Rig');
    const head = state.markers.headTop ?? [0, 1.7, 0];
    app.session.setState({
      rig: {
        ...app.session.getState().rig,
        quickRig: { ...state, markers: { ...state.markers, headTop: [head[0], 5.84, head[2]] } },
      },
    });
    const refused = await refusal(app, 'autorig.rig');
    expect(refused.code).toBe('poll');
    expect(refused.message).toMatch(/5\.84 m tall: press Set height/);
    expect(labels(app)).toEqual(['Import Static Model']);
    app.session.setState({ rig: { ...app.session.getState().rig, quickRig: state } });
    expect(app.operators.poll('autorig.rig')).toBe(true);
  });

  it('AR-D10-3: arm bones beside the body move nothing — the error row skin.limb-unweighted', async () => {
    const { app } = await opened('cube-lad.glb');
    // the arm markers on a line above the head (the template's guess on an arms-down model put them through it)
    const markers: Record<'shoulder' | 'elbow' | 'wrist', [number, number, number]> = {
      shoulder: [-0.2, 2.3, 0],
      elbow: [-0.5, 2.3, 0],
      wrist: [-0.8, 2.3, 0],
    };
    for (const [name, point] of Object.entries(markers)) await ok(app, 'skel.quickRig.setMarker', { name, point });
    const result = await ok<{ character: CharacterId }>(app, 'autorig.rig', { straighten: false });
    const row = app.rig.validation
      .rows(result.character, 'ekza/space-avatar-v1')
      .find((candidate) => candidate.code === 'skin.limb-unweighted');
    expect(row?.severity).toBe('error');
    const bones = (row?.ids ?? []).map((id) => app.store.get('joints', id as never)?.humanBone);
    expect(bones).toEqual(expect.arrayContaining(['leftLowerArm', 'rightLowerArm']));
    expect(bones.some((bone) => (bone ?? '').endsWith('Leg'))).toBe(false);
    expect(row?.message).toMatch(/move no part of the model/);
    // a plain export only warns
    expect(
      app.rig.validation.rows(result.character, 'local/generic').find((r) => r.code === 'skin.limb-unweighted')
        ?.severity,
    ).toBe('warning');
  });

  it('stops when an undo runs between the inner runs; the steps already made stay undoable', async () => {
    const { app } = await opened('cube-lad.glb');
    let undone = false;
    const off = app.history.subscribe(() => {
      if (undone || app.history.peekUndo()?.label !== 'Create Skeleton') return;
      undone = true;
      void app.runUntyped('edit.undo');
    });
    const outcome = await refusal(app, 'autorig.rig');
    off();
    expect(outcome.message).toBe(COMPOSITION_INTERRUPTED);
    expect(app.history.peekUndo()?.label).toBe('Import Static Model');
    expect(app.history.peekRedo()?.label).toBe('Create Skeleton');
    expect(app.session.getState().busy).toBeNull();
  });

  it('autorig.cancel during the bind leaves exactly the skeleton step', async () => {
    const { app } = await opened('cube-lad.glb');
    expect(await refusal(app, 'autorig.cancel')).toEqual({ code: 'poll', message: NOTHING_TO_CANCEL });
    // a skin worker that never answers: the bind waits until it is cancelled
    const port: SkinWorkerPort = { onmessage: null, onerror: null, terminate: () => {}, postMessage: () => {} };
    (app.rig as unknown as { skinWorker: () => SkinWorkerPort }).skinWorker = () => port;
    const running = app.runUntyped('autorig.rig');
    const service = app.rig.skin as unknown as { readonly pending: number };
    for (let i = 0; i < 400 && service.pending === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(service.pending).toBe(1);
    expect(app.session.getState().busy?.label).toBe('Binding skin…');
    await ok(app, 'autorig.cancel');
    const result = await running;
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' ? result.error.code : '').toBe('cancelled');
    expect(labels(app)).toEqual(['Import Static Model', 'Create Skeleton']);
    expect(app.session.getState().busy).toBeNull();
    expect(service.pending).toBe(0);
  });

  it('autorig.cancel pressed before the bind reached the skin service still stops it', async () => {
    const { app } = await opened('cube-lad.glb');
    const port: SkinWorkerPort = { onmessage: null, onerror: null, terminate: () => {}, postMessage: () => {} };
    (app.rig as unknown as { skinWorker: () => SkinWorkerPort }).skinWorker = () => port;
    const service = app.rig.skin as unknown as { readonly pending: number };
    const running = app.runUntyped('autorig.rig');
    // the composition is busy (Create Skeleton running), no bind job yet
    for (let i = 0; i < 400 && app.session.getState().busy === null; i++) await new Promise((r) => setTimeout(r, 1));
    expect(app.session.getState().busy).not.toBeNull();
    expect(service.pending).toBe(0);
    await ok(app, 'autorig.cancel');
    const result = await running;
    expect(result.status === 'failed' ? result.error.code : result.status).toBe('cancelled');
    expect(labels(app)).toEqual(['Import Static Model', 'Create Skeleton']);
    expect(app.session.getState().busy).toBeNull();
    expect(service.pending).toBe(0);
    // disarmed: a later bind runs to its end
    (app.rig as unknown as { skinWorker: null }).skinWorker = null;
    await ok(app, 'skin.bind', {});
    expect(labels(app)).toEqual(['Import Static Model', 'Create Skeleton', 'Bind Skin']);
  });

  it('the M6b re-run: a bound skeleton asks first, then refits and rebinds in one step', async () => {
    const { app } = await opened('cube-lad.glb');
    const { character } = await ok<{ character: CharacterId }>(app, 'autorig.rig');
    const meshes = app.store.query.meshesOfOwner(character).map((mesh) => mesh.id);
    // the shared bind targets (the operator and the wizard's sheet plan read the same helpers)
    expect(autoRigBindMeshes(app, character)).toEqual(meshes);
    await ok(app, 'skel.quickRig.start', { meshes });
    expect(quickRigOf(app)?.refit).not.toBeNull();
    expect(autoRigRefitBound(app, quickRigOf(app)?.refit ?? null)).toBe(true);
    expect(autoRigRefitBound(app, null)).toBe(false);
    const asked = await refusal(app, 'autorig.rig');
    expect(asked).toEqual({ code: 'confirm-required', message: REBIND_CONFIRM });
    expect(quickRigOf(app)).not.toBeNull();
    const again = await ok<{ character: CharacterId }>(app, 'autorig.rig', { confirm: true });
    expect(again.character).toBe(character);
    expect(labels(app)).toEqual(['Import Static Model', 'Create Skeleton', 'Bind Skin', 'Refit Skeleton']);
  });
});
