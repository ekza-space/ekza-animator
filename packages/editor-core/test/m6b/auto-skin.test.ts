// C4 (M6B-SPEC §5.9, §6.2, §0.4.4, §9.0 C4): `skin.bind` and `skin.unbind` over the real doc store and kernel — one
// undo step, the bind record without points, the bound manifest equal to a direct `bindSkin` run (P-S5 through the
// operator), resolved args recorded for Adjust Last, the Rebind and Unbind questions, the masked re-solve ("Bind
// Unweighted Points") leaving the record and every other point unchanged, the same weights whatever the user's Model
// symmetry, the first-bind control rig, refusals, keys untouched (P-C6) — and the skin service: `SkinSkeleton` from
// records, the worker protocol (copies, transfer lists, superseding), the inline path and the inline fallback when the
// worker fails; the joint-mask poll, a masked run on the stored bind arguments and P-S7's split-vertex crack check.
import { createHash } from 'node:crypto';
import type { CharacterId, JointId, MeshId, RigId, SkeletonId } from '@ekza-studio/doc';
import { makeTestJoint, makeTestRig, makeTestSkeleton } from '@ekza-studio/doc/testing';
import { bindSkin, readSkin, skinGeometryOf, withSkin, writeRevision } from '@ekza-studio/mesh-core';
import { readRigDefinition } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { type EditorApp, type LastRun, loadWritePath } from '../../src';
import { answerRebind, answerUnbind, rebindRequest, unbindRequest } from '../../src/operators/builtin/rig/bind';
import {
  createSkinService,
  type SkinBindJob,
  type SkinWorkerPort,
  type SkinWorkerRequest,
  type SkinWorkerResponse,
  skinBindInputs,
  skinSkeletonOf,
} from '../../src/rig/skinService';
import { type MeshTestApp, meshTestApp, runValue } from '../m6a/content/support';

type V3 = readonly [number, number, number];

/** A Core-21-like humanoid on the generated body's proportions (1.6 m), right side; left = the mirror. */
const RIGHT: readonly (readonly [string, string | null, V3, V3 | null])[] = [
  ['root', null, [0, 0, 0], null],
  ['hips', 'root', [0, 0.82, 0], null],
  ['spine', 'hips', [0, 0.97, 0], null],
  ['chest', 'spine', [0, 1.13, 0], null],
  ['neck', 'chest', [0, 1.38, 0], null],
  ['head', 'neck', [0, 1.45, 0], [0, 1.6, 0]],
  ['rightShoulder', 'chest', [-0.06, 1.3, 0], null],
  ['rightUpperArm', 'rightShoulder', [-0.2, 1.25, 0], null],
  ['rightLowerArm', 'rightUpperArm', [-0.475, 1.25, -0.002], null],
  ['rightHand', 'rightLowerArm', [-0.7, 1.25, 0], [-0.8, 1.25, 0]],
  ['rightUpperLeg', 'hips', [-0.09, 0.78, 0], null],
  ['rightLowerLeg', 'rightUpperLeg', [-0.09, 0.47, 0.002], null],
  ['rightFoot', 'rightLowerLeg', [-0.09, 0.08, 0], null],
  ['rightToes', 'rightFoot', [-0.09, 0.02, 0.09], [-0.09, 0.02, 0.13]],
];

interface Fixture {
  readonly t: MeshTestApp;
  readonly app: EditorApp;
  readonly mesh: MeshId;
  readonly character: CharacterId;
  readonly skeleton: SkeletonId;
  readonly rig: RigId;
}

/** The generated body made into a model-sourced character with a template skeleton (and an empty control rig). */
async function bodyCharacter(style: 'smooth' | 'segmented' = 'smooth'): Promise<Fixture> {
  const t = await meshTestApp();
  const { app } = t;
  const created = await runValue<{ root: string }>(t, 'mesh.create.template', { template: 'humanoidBody', style });
  const mesh = created.root as MeshId;
  const character = 'chr_test' as CharacterId;
  const skeleton = 'skl_test' as SkeletonId;
  const rig = 'rig_test' as RigId;
  const rows = RIGHT.flatMap((row) => {
    if (!row[0].startsWith('right')) return [row];
    const flip = (v: V3): V3 => [-v[0], v[1], v[2]];
    const left = (key: string | null): string | null => (key?.startsWith('right') ? `left${key.slice(5)}` : key);
    return [row, [left(row[0]) as string, left(row[1]), flip(row[2]), row[3] === null ? null : flip(row[3])] as const];
  });
  app.store.transact({ label: 'Test character' }, (tx) => {
    tx.put('rigs', makeTestRig(rig, character));
    tx.put('characters', {
      id: character,
      name: 'Body',
      asset: null,
      source: { kind: 'model', skeleton },
      format: 'vrm1',
      rig,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      order: 'a0',
      deleted: null,
      vrm: null,
    });
    tx.put('skeletons', makeTestSkeleton(skeleton, character, { preset: 'core21' }));
    rows.forEach(([key, parent, head, tail], i) => {
      const side = head[0] > 0 ? 'L' : head[0] < 0 ? 'R' : 'C';
      tx.put(
        'joints',
        makeTestJoint(`${skeleton}:${key}`, skeleton, {
          parent: parent === null ? null : (`${skeleton}:${parent}` as JointId),
          order: `a${String(i).padStart(2, '0')}`,
          name: key,
          humanBone: key === 'root' ? null : (key as never),
          restPosition: head,
          tail,
          side,
          role: key === 'root' ? 'helper' : 'bone',
          key,
        }),
      );
    });
    tx.patch('meshes', mesh, { owner: { character }, parent: null });
  });
  await app.rig.load();
  app.session.setState({ rig: { ...app.session.getState().rig, character } });
  return { t, app, mesh, character, skeleton, rig };
}

/** The top undo step's id and label (null on an empty history). */
const top = (app: EditorApp): { readonly id: number; readonly label: string } | null => {
  const step = app.history.peekUndo();
  return step === null ? null : { id: step.id, label: step.label };
};

function keysHash(app: EditorApp): string {
  const tables = app.store.snapshot().tables;
  return createHash('sha256')
    .update(JSON.stringify([tables['curves'], tables['keys']]))
    .digest('hex');
}

const dataOf = (app: EditorApp, mesh: MeshId) => {
  const data = app.meshes.get(mesh)?.data();
  if (data === null || data === undefined) throw new Error('no data');
  return data;
};

describe('skin.bind (§5.9)', () => {
  it('one click: one undo step, ≤ 4 influences, sums within 1e-6, no root weight, the bind record without points', async () => {
    const f = await bodyCharacter();
    const hash = keysHash(f.app);
    const before = top(f.app);
    const result = await f.app.runUntyped('skin.bind', {});
    expect(result).toEqual({ status: 'finished', value: { meshes: [f.mesh] } });
    expect(top(f.app)?.label).toBe('Bind Skin');
    expect(top(f.app)?.id).not.toBe(before?.id);
    const skin = readSkin(dataOf(f.app, f.mesh));
    if (skin === null) throw new Error('not bound');
    for (let v = 0; v < skin.points; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += skin.weights[4 * v + k] as number;
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
    }
    expect(skin.palette.some((entry) => entry.key.endsWith(':root'))).toBe(false);
    expect(f.app.store.get('meshes', f.mesh)?.skin).toEqual({
      skeleton: f.skeleton,
      bind: {
        v: 1,
        method: 'auto-lowpoly',
        hierarchy: true,
        dropoff: 4,
        stiffness: 1,
        pruneBelow: 0.025,
        rigidifyAbove: null,
        symmetrize: true,
      },
    });
    expect(keysHash(f.app)).toBe(hash);
    // The resolved symmetrize and holds are recorded for Adjust Last; the confirmation never replays.
    const last = f.app.session.getState().lastRun as LastRun;
    expect(last.args).toMatchObject({ symmetrize: true, holds: [], confirm: false, method: 'auto-lowpoly' });
    expect(last.targets).toEqual([f.mesh]);
  });

  it('§0.2 step 7: Bind Skin opens Skin mode; a masked run keeps the mode; undo falls back to Object', async () => {
    const f = await bodyCharacter();
    await f.app.runUntyped('workspace.set', { workspace: 'rig' });
    expect(f.app.session.getState().workspace).toBe('rig');
    const mode = (): string => f.app.session.getState().rig.mode;
    expect(mode()).toBe('object');
    await f.app.runUntyped('skin.bind', {});
    expect(mode()).toBe('skin');
    expect(f.app.session.getState().tools.viewport).toBe(
      f.app.tools.get('viewport', 'paintSkinWeights') === undefined ? 'select' : 'paintSkinWeights',
    );
    // The Last-op card of Bind Skin stays open (Bind Skin belongs to Skin mode, §5.24).
    expect(f.app.session.getState().lastRun?.closed ?? null).toBeNull();
    await f.app.runUntyped('rig.mode', { mode: 'skeleton' });
    expect((await f.app.runUntyped('skin.bind', { points: [0, 1, 2] })).status).toBe('finished');
    expect(mode()).toBe('skeleton');
    // Undo past the binds: Skin mode has nothing to show, so a later Skin mode falls back to Object.
    await f.app.runUntyped('rig.mode', { mode: 'skin' });
    await f.app.runUntyped('edit.undo');
    expect(mode()).toBe('skin');
    await f.app.runUntyped('edit.undo');
    expect(f.app.store.get('meshes', f.mesh)?.skin).toBeNull();
    expect(mode()).toBe('object');
  });

  it('P-S5 through the operator: the bound manifest equals a direct bindSkin run on the same input', async () => {
    const f = await bodyCharacter('segmented');
    const before = dataOf(f.app, f.mesh);
    const skeleton = skinSkeletonOf(f.app.store, f.skeleton);
    const { bindSkin } = await import('@ekza-studio/mesh-core');
    const direct = bindSkin(
      skinGeometryOf(before, skeleton.height),
      skeleton,
      {
        method: 'auto-lowpoly',
        joints: null,
        points: null,
        hierarchy: true,
        dropoff: 4,
        stiffness: 1,
        pruneBelow: 0.025,
        rigidifyAbove: null,
        symmetrize: true,
      },
      null,
    );
    await f.app.runUntyped('skin.bind', {});
    expect(f.app.store.get('meshes', f.mesh)?.data?.manifest).toBe(
      writeRevision(withSkin(before, direct.skin)).manifestId,
    );
  });

  it('the same weights with the user’s Model symmetry on or off (the fixed partner map)', async () => {
    const manifests: string[] = [];
    for (const on of [true, false]) {
      const f = await bodyCharacter();
      const symmetry = new Map(f.app.session.getState().model.symmetry);
      if (on) symmetry.set(f.mesh, { mode: 'object-x', tolerance: 0.001, topological: false } as never);
      else symmetry.delete(f.mesh);
      f.app.session.setState({ model: { ...f.app.session.getState().model, symmetry } });
      await f.app.runUntyped('skin.bind', {});
      manifests.push(f.app.store.get('meshes', f.mesh)?.data?.manifest as string);
    }
    expect(manifests[0]).toBe(manifests[1]);
  });

  it('undo removes the skin and the bind record; redo restores them', async () => {
    const f = await bodyCharacter();
    const manifest = f.app.store.get('meshes', f.mesh)?.data?.manifest;
    await f.app.runUntyped('skin.bind', {});
    const bound = f.app.store.get('meshes', f.mesh)?.data?.manifest;
    expect(bound).not.toBe(manifest);
    await f.app.runUntyped('edit.undo');
    expect(f.app.store.get('meshes', f.mesh)?.data?.manifest).toBe(manifest);
    expect(f.app.store.get('meshes', f.mesh)?.skin).toBeNull();
    await f.app.runUntyped('edit.redo');
    expect(f.app.store.get('meshes', f.mesh)?.data?.manifest).toBe(bound);
  });

  it('first bind generates the control rig in the same step (§5.16); a rig with controls is left alone', async () => {
    const f = await bodyCharacter();
    expect(readRigDefinition(f.app.store, f.rig)?.controls ?? []).toEqual([]);
    await f.app.runUntyped('skin.bind', {});
    const controls = readRigDefinition(f.app.store, f.rig)?.controls ?? [];
    expect(controls.length).toBeGreaterThan(0);
    await f.app.runUntyped('skin.bind', { method: 'closest', confirm: true });
    expect(readRigDefinition(f.app.store, f.rig)?.controls).toEqual(controls);
    await f.app.runUntyped('edit.undo');
    await f.app.runUntyped('edit.undo');
    expect(readRigDefinition(f.app.store, f.rig)?.controls ?? []).toEqual([]);
  });

  it('rebinding a bound mesh asks first; Rebind binds, Cancel leaves the weights; a masked run never asks', async () => {
    const f = await bodyCharacter();
    await f.app.runUntyped('skin.bind', {});
    const bound = f.app.store.get('meshes', f.mesh)?.data?.manifest;
    const steps = top(f.app);
    const asked = await f.app.runUntyped('skin.bind', { method: 'closest' });
    expect(asked.status).toBe('cancelled');
    expect(f.app.session.getState().dialog).toBe('rebindSkin');
    expect(rebindRequest(f.app)?.text).toMatch(/^Rebind replaces painted weights on \d+ points of /);
    expect(top(f.app)).toEqual(steps);
    await answerRebind(f.app, 'cancel');
    expect(f.app.session.getState().dialog).toBeNull();
    expect(f.app.store.get('meshes', f.mesh)?.data?.manifest).toBe(bound);
    await f.app.runUntyped('skin.bind', { method: 'closest' });
    await answerRebind(f.app, 'rebind');
    expect(top(f.app)?.label).toBe('Bind Skin');
    expect(top(f.app)?.id).not.toBe(steps?.id);
    expect(f.app.store.get('meshes', f.mesh)?.skin).toMatchObject({ bind: { method: 'closest' } });
    // A masked run (Bind Unweighted Points) does not ask.
    const masked = await f.app.runUntyped('skin.bind', { points: [0, 1, 2] });
    expect(masked.status).toBe('finished');
  });

  it('Bind Unweighted Points (§0.4.4): a masked re-solve keeps every other point and the stored bind record', async () => {
    const f = await bodyCharacter();
    await f.app.runUntyped('skin.bind', {});
    const record = f.app.store.get('meshes', f.mesh)?.skin;
    const before = readSkin(dataOf(f.app, f.mesh));
    if (before === null) throw new Error('not bound');
    const points = [5, 6, 7, 50];
    const result = await f.app.runUntyped('skin.bind', { method: 'closest', points });
    expect(result.status).toBe('finished');
    const after = readSkin(dataOf(f.app, f.mesh));
    if (after === null) throw new Error('not bound');
    expect(after.palette.slice(0, before.palette.length)).toEqual(before.palette);
    for (let v = 0; v < after.points; v++) {
      if (points.includes(v)) continue;
      expect(Array.from(after.joints.subarray(4 * v, 4 * v + 4))).toEqual(
        Array.from(before.joints.subarray(4 * v, 4 * v + 4)),
      );
      expect(Array.from(after.weights.subarray(4 * v, 4 * v + 4))).toEqual(
        Array.from(before.weights.subarray(4 * v, 4 * v + 4)),
      );
    }
    expect(f.app.store.get('meshes', f.mesh)?.skin).toEqual(record);
  });

  it('a point mask on an unbound mesh is a poll refusal, not an internal error', async () => {
    const f = await bodyCharacter();
    const poll = f.app.operators.poll('skin.bind', {}, { points: [0, 1, 2] });
    expect(poll === true ? null : poll.reason).toMatch(/first: only a bound mesh re-binds selected points$/);
    const result = await f.app.runUntyped('skin.bind', { points: [0, 1, 2] });
    expect(result.status).not.toBe('failed');
    expect(readSkin(dataOf(f.app, f.mesh))).toBeNull();
  });

  it('"Only selected points" skips an unbound mesh of the request and re-binds the bound one', async () => {
    const f = await bodyCharacter();
    const extra = await runValue<{ root: string }>(f.t, 'mesh.create.template', { template: 'humanoidBody' });
    const second = extra.root as MeshId;
    f.app.store.transact({ label: 'own' }, (tx) =>
      tx.patch('meshes', second, { owner: { character: f.character }, parent: null }),
    );
    expect((await f.app.runUntyped('skin.bind', { meshes: [f.mesh] })).status).toBe('finished');
    const before = readSkin(dataOf(f.app, f.mesh));
    const model = f.app.session.getState().model;
    f.app.session.setState({
      model: { ...model, componentMode: 'vertex', lastComponentMode: 'vertex', hilite: [f.mesh, second] },
    });
    f.app.components.apply(f.mesh, 'vertex', [0, 1, 2], 'replace');
    f.app.components.apply(second, 'vertex', [0, 1, 2], 'replace');
    const asked = await f.app.runUntyped('skin.bind', { method: 'closest' });
    expect(asked.status).toBe('cancelled');
    expect([...(rebindRequest(f.app)?.meshes ?? [])].sort()).toEqual([f.mesh, second].sort());
    await answerRebind(f.app, 'selected');
    expect(top(f.app)?.label).toBe('Bind Skin');
    expect(readSkin(dataOf(f.app, second))).toBeNull();
    const after = readSkin(dataOf(f.app, f.mesh));
    expect(after?.palette.slice(0, before?.palette.length)).toEqual(before?.palette);
  });

  it('a masked bind keeps the held joints’ weights bit-equal (§5.10) and records the holds', async () => {
    const f = await bodyCharacter();
    await f.app.runUntyped('skin.bind', { method: 'heat' });
    const before = readSkin(dataOf(f.app, f.mesh));
    if (before === null) throw new Error('not bound');
    const weightOf = (skin: typeof before, v: number, key: string): number => {
      for (let k = 0; k < 4; k++) {
        const w = skin.weights[4 * v + k] as number;
        if (w > 0 && skin.palette[skin.joints[4 * v + k] as number]?.key === key) return w;
      }
      return 0;
    };
    // The joint that most often blends as a second influence; hold it and re-solve its blended points rigidly.
    const counts = new Map<string, number>();
    for (let v = 0; v < before.points; v++) {
      if (!((before.weights[4 * v + 1] as number) > 0)) continue;
      const key = before.palette[before.joints[4 * v + 1] as number]?.key as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const held = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] as string;
    const points = [...Array(before.points).keys()].filter((v) => {
      const w = weightOf(before, v, held);
      return w > 0 && w < 1;
    });
    expect(points.length).toBeGreaterThan(0);
    const rig = f.app.session.getState().rig;
    f.app.session.setState({ rig: { ...rig, holds: new Map([[f.character, new Set([held])]]) } });
    const result = await f.app.runUntyped('skin.bind', { method: 'rigid-islands', points });
    expect(result.status).toBe('finished');
    const after = readSkin(dataOf(f.app, f.mesh));
    if (after === null) throw new Error('not bound');
    for (const v of points) {
      expect(Object.is(weightOf(after, v, held), weightOf(before, v, held))).toBe(true);
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += after.weights[4 * v + k] as number;
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
    }
    expect((f.app.session.getState().lastRun as LastRun).args).toMatchObject({ holds: [held] });
  });

  it('a joint mask naming no joint of the skeleton is the empty-mask poll refusal, not a failed run', async () => {
    const f = await bodyCharacter();
    const reason = (args: unknown): string | null => {
      const poll = f.app.operators.poll('skin.bind', {}, args);
      return poll === true ? null : poll.reason;
    };
    expect(reason({ joints: ['nope'] })).toBe('Bind Skin needs at least one joint to bind to');
    expect(reason({ joints: ['nope', `${f.skeleton}:head`] })).toBeNull();
    const refused = await f.app.runUntyped('skin.bind', { joints: ['nope'] });
    expect(refused.status).not.toBe('failed');
    expect(readSkin(dataOf(f.app, f.mesh))).toBeNull();
    // With no mask, a skeleton whose joints are all helpers has nothing to bind to either.
    f.app.store.transact({ label: 'helpers' }, (tx) => {
      for (const joint of tx.list('joints'))
        if (joint.skeleton === f.skeleton) tx.patch('joints', joint.id, { role: 'helper' });
    });
    expect(reason({})).toBe('Bind Skin needs at least one joint to bind to');
  });

  it('a masked run with only {points} re-solves with the stored bind arguments (§0.4.4) and records them', async () => {
    const f = await bodyCharacter();
    expect((await f.app.runUntyped('skin.bind', { method: 'closest', pruneBelow: 0.1 })).status).toBe('finished');
    const points = [5, 6, 7, 50, 120];
    expect((await f.app.runUntyped('skin.bind', { points })).status).toBe('finished');
    const inherited = readSkin(dataOf(f.app, f.mesh));
    expect((f.app.session.getState().lastRun as LastRun).args).toMatchObject({
      method: 'closest',
      pruneBelow: 0.1,
      points,
    });
    await f.app.runUntyped('edit.undo');
    expect((await f.app.runUntyped('skin.bind', { method: 'closest', pruneBelow: 0.1, points })).status).toBe(
      'finished',
    );
    const explicit = readSkin(dataOf(f.app, f.mesh));
    expect(inherited?.palette).toEqual(explicit?.palette);
    expect(Array.from(inherited?.joints ?? [])).toEqual(Array.from(explicit?.joints ?? []));
    expect(Array.from(inherited?.weights ?? [])).toEqual(Array.from(explicit?.weights ?? []));
    await f.app.runUntyped('edit.undo');
    // The run's own values still win over the stored record.
    expect((await f.app.runUntyped('skin.bind', { method: 'rigid-islands', points })).status).toBe('finished');
    expect((f.app.session.getState().lastRun as LastRun).args).toMatchObject({ method: 'rigid-islands' });
    expect(f.app.store.get('meshes', f.mesh)?.skin).toMatchObject({ bind: { method: 'closest', pruneBelow: 0.1 } });
  });

  it('P-S7 cracks: every GPU corner of a welded point carries its row, ≤ 1e-6 m apart under random poses', async () => {
    const f = await bodyCharacter('segmented');
    expect((await f.app.runUntyped('skin.bind', {})).status).toBe('finished');
    const data = dataOf(f.app, f.mesh);
    const skin = readSkin(data);
    if (skin === null) throw new Error('not bound');
    const io = await (await loadWritePath()).loadMeshIo();
    const out = io.meshToPrimitivesDetailed(data, {
      colourOutput: 'asset',
      palette: null,
      paint: null,
      morphNormals: new Set(),
      hadTangents: false,
      dropTangents: false,
    });
    if ('refused' in out) throw new Error(out.reason);
    // Points of the mesh by their exact position (a position shared by two points is left out: not one welded point).
    const pointAt = new Map<string, number>();
    const shared = new Set<string>();
    for (let p = 0; p < data.counts.points; p++) {
      const key = Array.from(data.position.subarray(3 * p, 3 * p + 3)).join(',');
      if (pointAt.has(key)) shared.add(key);
      pointAt.set(key, p);
    }
    const groups = new Map<string, { joints: number[]; weights: number[] }[]>();
    for (const primitive of out.primitives) {
      const position = primitive.attributes['POSITION'] as Float32Array;
      const joints = primitive.attributes['JOINTS_0'] as Uint8Array | Uint16Array;
      const weights = primitive.attributes['WEIGHTS_0'] as Float32Array;
      for (let v = 0; v < position.length / 3; v++) {
        const key = Array.from(position.subarray(3 * v, 3 * v + 3)).join(',');
        if (shared.has(key) || !pointAt.has(key)) continue;
        const list = groups.get(key) ?? [];
        list.push({
          joints: Array.from(joints.subarray(4 * v, 4 * v + 4)),
          weights: Array.from(weights.subarray(4 * v, 4 * v + 4)),
        });
        groups.set(key, list);
      }
    }
    const split = [...groups.entries()].filter(([, list]) => list.length > 1);
    expect(split.length).toBeGreaterThan(0);
    // A ROM stand-in: random rigid transforms per palette joint, 8 poses.
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    let worst = 0;
    for (let pose = 0; pose < 8; pose++) {
      const mats = skin.palette.map(() => {
        const [a, b, c] = [rand() * 2 * Math.PI, rand() * 2 * Math.PI, rand() * 2 * Math.PI];
        const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
        // Rz(c)·Ry(b)·Rx(a) and a translation
        return [
          cc * cb,
          cc * sb * sa - sc * ca,
          cc * sb * ca + sc * sa,
          rand() - 0.5,
          sc * cb,
          sc * sb * sa + cc * ca,
          sc * sb * ca - cc * sa,
          rand() - 0.5,
          -sb,
          cb * sa,
          cb * ca,
          rand() - 0.5,
        ];
      });
      for (const [key, list] of split) {
        const [x, y, z] = key.split(',').map(Number) as [number, number, number];
        const skinned = list.map(({ joints, weights }) => {
          const o = [0, 0, 0];
          for (let k = 0; k < 4; k++) {
            const m = mats[joints[k] as number] as number[];
            const w = weights[k] as number;
            for (let r = 0; r < 3; r++)
              o[r] =
                (o[r] as number) +
                w *
                  ((m[4 * r] as number) * x +
                    (m[4 * r + 1] as number) * y +
                    (m[4 * r + 2] as number) * z +
                    (m[4 * r + 3] as number));
          }
          return o;
        });
        const first = skinned[0] as number[];
        for (const o of skinned)
          worst = Math.max(worst, Math.hypot(o[0]! - first[0]!, o[1]! - first[1]!, o[2]! - first[2]!));
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-6);
  });

  it('refuses scene meshes, placed meshes, an empty joint mask and asset-sourced characters', async () => {
    const f = await bodyCharacter();
    const scene = await runValue<{ created: string[] }>(f.t, 'mesh.create.template', { template: 'prop' });
    const reason = (args: unknown): string | null => {
      const poll = f.app.operators.poll('skin.bind', {}, args);
      return poll === true ? null : poll.reason;
    };
    expect(reason({ meshes: [scene.created[1]] })).toMatch(/belongs to no character/);
    expect(reason({ joints: [] })).toBe('Bind Skin needs at least one joint to bind to');
    f.app.store.transact({ label: 'move' }, (tx) =>
      tx.patch('meshes', f.mesh, { placement: { t: [0.1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } }),
    );
    expect(reason({})).toMatch(/has a placement/);
    f.app.store.transact({ label: 'asset' }, (tx) =>
      tx.patch('characters', f.character, {
        source: { kind: 'asset', asset: 'ast_x' as never },
        asset: 'ast_x' as never,
      }),
    );
    f.app.session.setState({ rig: { ...f.app.session.getState().rig, character: null } });
    expect(reason({ meshes: [f.mesh] })).toBe('Rig and skin edits on imported avatars arrive after the MVP');
  });
});

describe('skin.unbind (§5.9)', () => {
  it('asks, then removes the skin layers and the record in one step; undo restores them', async () => {
    const f = await bodyCharacter();
    await f.app.runUntyped('skin.bind', {});
    const bound = f.app.store.get('meshes', f.mesh)?.data?.manifest;
    const asked = await f.app.runUntyped('skin.unbind', {});
    expect(asked.status).toBe('cancelled');
    expect(f.app.session.getState().dialog).toBe('unbindSkin');
    expect(unbindRequest(f.app)).toEqual([f.mesh]);
    await answerUnbind(f.app, 'unbind');
    expect(readSkin(dataOf(f.app, f.mesh))).toBeNull();
    expect(f.app.store.get('meshes', f.mesh)?.skin).toBeNull();
    expect(top(f.app)?.label).toBe('Unbind Skin');
    await f.app.runUntyped('edit.undo');
    expect(f.app.store.get('meshes', f.mesh)?.data?.manifest).toBe(bound);
    expect(f.app.operators.poll('skin.unbind', {}, {})).toBe(true);
  });

  it('polls "No bound mesh to unbind" before a bind', async () => {
    const f = await bodyCharacter();
    expect(f.app.operators.poll('skin.unbind', {}, {})).toEqual({ ok: false, reason: 'No bound mesh to unbind' });
  });
});

describe('the skin service', () => {
  it('skinSkeletonOf: topological JointIds, the humanoid-chain tails, mirrors and roles', async () => {
    const f = await bodyCharacter();
    const s = skinSkeletonOf(f.app.store, f.skeleton);
    expect(s.keys[0]).toBe(`${f.skeleton}:root`);
    for (let j = 0; j < s.keys.length; j++) expect(s.parent[j] as number).toBeLessThan(j);
    const at = (key: string) => s.keys.indexOf(`${f.skeleton}:${key}`);
    expect(Array.from(s.tail.subarray(3 * at('hips'), 3 * at('hips') + 3))).toEqual([0, 0.97, 0]); // spine, not a leg
    expect(Array.from(s.tail.subarray(3 * at('head'), 3 * at('head') + 3))).toEqual([0, 1.6, 0]); // the record's tail
    expect(s.mirror[at('leftUpperArm')]).toBe(at('rightUpperArm'));
    expect(s.mirror[at('spine')]).toBe(-1);
    expect(s.deform[at('root')]).toBe(0);
    expect(s.side[at('leftHand')]).toBe(1);
    expect(s.height).toBeCloseTo(1.6, 12);
  });

  it('runs in a worker when the host installed one: copies, transfer lists, the same result, superseding', async () => {
    const f = await bodyCharacter();
    const { bindSkin } = await import('@ekza-studio/mesh-core');
    const posted: { request: SkinWorkerRequest; transfer: ArrayBuffer[] }[] = [];
    const port: SkinWorkerPort = {
      onmessage: null,
      onerror: null,
      terminate: () => {},
      postMessage(request, transfer) {
        posted.push({ request, transfer });
        const { job } = request;
        queueMicrotask(() => {
          const result = bindSkin(job.geometry, job.skeleton, job.args, job.previous);
          const response: SkinWorkerResponse = { id: request.id, ...result };
          port.onmessage?.({ data: response });
        });
      },
    };
    (f.app.rig as unknown as { skinWorker: () => SkinWorkerPort }).skinWorker = () => port;
    const service = createSkinService({ app: () => f.app });
    const inputs = await skinBindInputs(f.app, f.mesh);
    const job: SkinBindJob = {
      geometry: inputs.geometry,
      skeleton: inputs.skeleton,
      args: {
        method: 'auto-lowpoly',
        joints: null,
        points: null,
        hierarchy: true,
        dropoff: 4,
        stiffness: 1,
        pruneBelow: 0.025,
        rigidifyAbove: null,
        symmetrize: true,
      },
      previous: null,
    };
    const first = service.run(f.mesh, job);
    const second = service.run(f.mesh, job);
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    const result = await second;
    expect(service.usedWorker).toBe(true);
    expect(service.busy).toBe(false);
    const inline = bindSkin(job.geometry, job.skeleton, job.args, null);
    expect(Array.from(result.skin.weights)).toEqual(Array.from(inline.skin.weights));
    // The job's arrays were copies: the cached geometry is intact after the transfer.
    expect(posted[0]?.request.job.geometry.positions).not.toBe(inputs.geometry.positions);
    expect(posted[0]?.transfer).toContain(posted[0]?.request.job.geometry.positions.buffer);
    expect(inputs.geometry.positions.length).toBeGreaterThan(0);
  });

  it('a worker that fails to load falls back to the inline path for pending and later binds', async () => {
    const f = await bodyCharacter();
    let created = 0;
    const port: SkinWorkerPort = {
      onmessage: null,
      onerror: null,
      terminate: () => {},
      postMessage() {
        // The chunk did not load: the worker reports an error event and never answers.
        queueMicrotask(() => port.onerror?.({ message: 'Failed to fetch dynamically imported module' }));
      },
    };
    (f.app.rig as unknown as { skinWorker: () => SkinWorkerPort }).skinWorker = () => {
      created++;
      return port;
    };
    const service = createSkinService({ app: () => f.app });
    const inputs = await skinBindInputs(f.app, f.mesh);
    const job: SkinBindJob = {
      geometry: inputs.geometry,
      skeleton: inputs.skeleton,
      args: {
        method: 'auto-lowpoly',
        joints: null,
        points: null,
        hierarchy: true,
        dropoff: 4,
        stiffness: 1,
        pruneBelow: 0.025,
        rigidifyAbove: null,
        symmetrize: true,
      },
      previous: null,
    };
    const expected = bindSkin(job.geometry, job.skeleton, job.args, null);
    const result = await service.run(f.mesh, job);
    expect(Array.from(result.skin.weights)).toEqual(Array.from(expected.skin.weights));
    expect(service.usedWorker).toBe(false);
    expect(service.busy).toBe(false);
    const again = await service.run(f.mesh, job);
    expect(Array.from(again.skin.joints)).toEqual(Array.from(expected.skin.joints));
    expect(created).toBe(1);
  });

  it('binds inline without a worker; cancel rejects what is pending', async () => {
    const f = await bodyCharacter();
    const service = createSkinService({ app: () => f.app });
    const pending = service.bind(f.mesh, {
      method: 'rigid-islands',
      joints: null,
      points: null,
      hierarchy: true,
      dropoff: 4,
      stiffness: 1,
      pruneBelow: 0.025,
      rigidifyAbove: null,
      symmetrize: null,
    });
    const done = await pending;
    expect(service.usedWorker).toBe(false);
    expect(done.skin.points).toBe(dataOf(f.app, f.mesh).counts.points);
    const again = service.run(f.mesh, {
      geometry: skinGeometryOf(dataOf(f.app, f.mesh), 1.6),
      skeleton: skinSkeletonOf(f.app.store, f.skeleton),
      args: {
        method: 'closest',
        joints: null,
        points: null,
        hierarchy: true,
        dropoff: 4,
        stiffness: 1,
        pruneBelow: 0,
        rigidifyAbove: null,
        symmetrize: false,
      },
      previous: null,
    });
    service.cancel();
    await expect(again).rejects.toMatchObject({ code: 'cancelled' });
  });
});
