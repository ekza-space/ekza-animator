// C4 (M6B-SPEC §5.9, §6.2, §0.4.4, §9.0 C4): `skin.bind` and `skin.unbind` over the real doc store and kernel — one
// undo step, the bind record without points, the bound manifest equal to a direct `bindSkin` run (P-S5 through the
// operator), resolved args recorded for Adjust Last, the Rebind and Unbind questions, the masked re-solve ("Bind
// Unweighted Points") leaving the record and every other point unchanged, the same weights whatever the user's Model
// symmetry, the first-bind control rig, refusals, keys untouched (P-C6) — and the skin service: `SkinSkeleton` from
// records, the worker protocol (copies, transfer lists, superseding) and the inline path.
import { createHash } from 'node:crypto';
import type { CharacterId, JointId, MeshId, RigId, SkeletonId } from '@ekza-studio/doc';
import { makeTestJoint, makeTestRig, makeTestSkeleton } from '@ekza-studio/doc/testing';
import { readSkin, skinGeometryOf, withSkin, writeRevision } from '@ekza-studio/mesh-core';
import { readRigDefinition } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import type { EditorApp, LastRun } from '../../src';
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
