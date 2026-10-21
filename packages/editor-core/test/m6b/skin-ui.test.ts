// C6 (M6B-SPEC §5.10–§5.13, §6.2, §9.0 C6 DoD): the weight operators over the real doc store and kernel — one undo step
// per stroke/edit, the commit equal to the kernel run on the same input (preview = commit), holds recorded in the args
// and applied on every bound mesh of the character (a hold toggled with two meshes holds on both), held joints
// refused, no keys and no rig recompile per stroke, the utilities, Remove Unused Influences, and the U-state operators
// (active influence, walk, dominant pick, sample, brush settings, mirror toggle, test rotate, Paint Select deferred).
import { createHash } from 'node:crypto';
import type { CharacterId, JointId, MeshId, RigId, SkeletonId } from '@ekza-studio/doc';
import { makeTestJoint, makeTestRig, makeTestSkeleton } from '@ekza-studio/doc/testing';
import { editWeights, readSkin, type SkinWeights } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import type { EditorApp, LastRun } from '../../src';
import { setBrush, skinTestRotate } from '../../src/operators/builtin/rig/influence';
import { skinTargets, weightContext, weightInputs } from '../../src/operators/builtin/rig/weights';
import { type MeshTestApp, meshTestApp, runValue } from '../m6a/content/support';

type V3 = readonly [number, number, number];

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
  readonly key: (name: string) => string;
}

/** The generated body as a model character with a template skeleton, bound with the defaults (and a second mesh). */
async function boundBody(
  opts: { readonly second?: boolean } = {},
): Promise<Fixture & { readonly second: MeshId | null }> {
  const t = await meshTestApp();
  const { app } = t;
  const created = await runValue<{ root: string }>(t, 'mesh.create.template', {
    template: 'humanoidBody',
    style: 'smooth',
  });
  const mesh = created.root as MeshId;
  let second: MeshId | null = null;
  if (opts.second === true) {
    const cube = await runValue<{ mesh: string }>(t, 'mesh.create.cube', {});
    second = cube.mesh as MeshId;
  }
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
    if (second !== null) {
      tx.patch('meshes', second, {
        owner: { character },
        parent: null,
        placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        generator: null,
      });
    }
  });
  await app.rig.load();
  app.session.setState({ workspace: 'rig', rig: { ...app.session.getState().rig, character } });
  const bound = await app.runUntyped('skin.bind', {});
  if (bound.status !== 'finished') throw new Error(`bind: ${JSON.stringify(bound)}`);
  return { t, app, mesh, character, skeleton, second, key: (name) => `${skeleton}:${name}` };
}

const skinOf = (app: EditorApp, mesh: MeshId): SkinWeights => {
  const data = app.meshes.get(mesh)?.data();
  const skin = data === null || data === undefined ? null : readSkin(data);
  if (skin === null) throw new Error('not bound');
  return skin;
};

function keysHash(app: EditorApp): string {
  const tables = app.store.snapshot().tables;
  return createHash('sha256')
    .update(JSON.stringify([tables['curves'], tables['keys']]))
    .digest('hex');
}

/** joint key → weight of a point. */
function weightsAt(skin: SkinWeights, v: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let k = 0; k < 4; k++) {
    const w = skin.weights[4 * v + k] as number;
    if (w > 0) out[skin.palette[skin.joints[4 * v + k] as number]?.key as string] = w;
  }
  return out;
}

const topLabel = (app: EditorApp): string | null => app.history.peekUndo()?.label ?? null;

/** Points of the body within r of a position. */
function near(app: EditorApp, mesh: MeshId, at: V3, r: number): number[] {
  const data = app.meshes.get(mesh)?.data();
  if (data === null || data === undefined) return [];
  const out: number[] = [];
  for (let v = 0; v < data.counts.points; v++) {
    const d = Math.hypot(
      (data.position[3 * v] as number) - at[0],
      (data.position[3 * v + 1] as number) - at[1],
      (data.position[3 * v + 2] as number) - at[2],
    );
    if (d <= r) out.push(v);
  }
  return out;
}

describe('skin.weights.paint (§5.11)', () => {
  it('one stroke = one undo step; the commit equals the kernel stroke on the same input; no key, no recompile', async () => {
    const f = await boundBody();
    const { app } = f;
    const points = near(app, f.mesh, [0.475, 1.25, 0], 0.1);
    const stamps = [
      { points: points.slice(0, 20), strength: points.slice(0, 20).map(() => 0.7) },
      { points: points.slice(10), strength: points.slice(10).map(() => 0.4) },
    ];
    const inputs = await weightInputs(app, f.mesh);
    const expected = editWeights(
      inputs.skin,
      {
        kind: 'stroke',
        joint: f.key('leftLowerArm'),
        op: 'replace',
        value: 1,
        mirror: true,
        stamps: stamps.map((s) => ({ points: Uint32Array.from(s.points), strength: Float32Array.from(s.strength) })),
      },
      weightContext(inputs, []),
    );
    const hash = keysHash(app);
    let recompiles = 0;
    const off = app.characters.subscribe((event) => {
      if (event.type === 'recompiled') recompiles++;
    });
    const before = app.history.peekUndo()?.id;
    const result = await app.runUntyped(
      'skin.weights.paint',
      { mesh: f.mesh, joint: f.key('leftLowerArm'), op: 'replace', value: 1, stamps, mirror: true },
      { source: 'tool' },
    );
    off();
    expect(result.status).toBe('finished');
    expect(topLabel(app)).toBe('Paint Skin Weights');
    expect(app.history.peekUndo()?.id).not.toBe(before);
    const after = skinOf(app, f.mesh);
    expect(Array.from(after.weights)).toEqual(Array.from(expected.skin.weights));
    expect(Array.from(after.joints)).toEqual(Array.from(expected.skin.joints));
    expect(keysHash(app)).toBe(hash);
    expect(recompiles).toBe(0);
    // One undo restores the weights bit-equal.
    await app.runUntyped('edit.undo');
    expect(Array.from(skinOf(app, f.mesh).weights)).toEqual(Array.from(inputs.skin.weights));
  });

  it('a held joint is refused with its name; holds are recorded in the args', async () => {
    const f = await boundBody();
    const { app } = f;
    await app.runUntyped('skin.influence.setActive', { mesh: f.mesh, joint: f.key('leftUpperArm') });
    await app.runUntyped('skin.influence.hold', { on: true });
    const refused = await app.runUntyped('skin.weights.paint', {
      mesh: f.mesh,
      joint: f.key('leftUpperArm'),
      op: 'replace',
      value: 1,
      stamps: [{ points: [0], strength: [1] }],
      mirror: false,
    });
    expect(refused).toEqual({ status: 'cancelled', reason: 'leftUpperArm is held' });
    const flood = await app.runUntyped('skin.weights.flood', { joint: f.key('leftLowerArm'), opacity: 0.5 });
    expect(flood.status).toBe('finished');
    const last = app.session.getState().lastRun as LastRun;
    expect(last.args).toMatchObject({ holds: [f.key('leftUpperArm')], op: 'replace', value: 1, opacity: 0.5 });
  });
});

describe('Flood is one-sided by default (M6B-C6-16)', () => {
  it('the panel path (no args) with the brush X-mirror on floods only the active joint', async () => {
    const f = await boundBody();
    const { app } = f;
    await app.runUntyped('skin.influence.setActive', { mesh: f.mesh, joint: f.key('leftUpperArm') });
    setBrush(app, { op: 'replace', value: 1, opacity: 1, mirror: true });
    const result = await app.runUntyped('skin.weights.flood', {});
    expect(result.status).toBe('finished');
    expect((app.session.getState().lastRun as LastRun).args).toMatchObject({ mirror: false });
    const skin = skinOf(app, f.mesh);
    for (let v = 0; v < skin.points; v++) {
      expect(weightsAt(skin, v)).toEqual({ [f.key('leftUpperArm')]: 1 });
    }
    // An explicit mirror reaches only the partners outside the mask: over every point it is the same flood.
    await app.runUntyped('edit.undo');
    const mirrored = await app.runUntyped('skin.weights.flood', { mirror: true });
    expect(mirrored.status).toBe('finished');
    const again = skinOf(app, f.mesh);
    expect(Array.from(again.weights)).toEqual(Array.from(skin.weights));
  });
});

describe('holds on every bound mesh (§5.10)', () => {
  it('a hold toggled with two meshes hilited holds the joint on both; prefs remember it', async () => {
    const f = await boundBody({ second: true });
    const { app } = f;
    const second = f.second as MeshId;
    app.session.setState({ model: { ...app.session.getState().model, hilite: [f.mesh, second] } });
    expect(skinTargets(app).sort()).toEqual([f.mesh, second].sort());
    const held = f.key('spine');
    await app.runUntyped('skin.influence.hold', { joint: held, on: true });
    expect(app.prefs.getState().rigging.holds[`${app.session.getState().projectName}/${f.character}`]).toEqual([held]);
    const before = [skinOf(app, f.mesh), skinOf(app, second)];
    const result = await app.runUntyped('skin.weights.flood', {
      joint: f.key('chest'),
      op: 'replace',
      value: 1,
      opacity: 1,
    });
    expect(result.status).toBe('finished');
    expect(topLabel(app)).toBe('Flood Skin Weights');
    const after = [skinOf(app, f.mesh), skinOf(app, second)];
    let changed = 0;
    for (const [i, skin] of after.entries()) {
      const was = before[i] as SkinWeights;
      for (let v = 0; v < skin.points; v++) {
        expect(weightsAt(skin, v)[held]).toBe(weightsAt(was, v)[held]);
        if (weightsAt(skin, v)[f.key('chest')] !== weightsAt(was, v)[f.key('chest')]) changed++;
      }
    }
    expect(changed).toBeGreaterThan(0);
    // One step for both meshes.
    await app.runUntyped('edit.undo');
    expect(Array.from(skinOf(app, second).weights)).toEqual(Array.from((before[1] as SkinWeights).weights));
    await app.runUntyped('skin.influence.releaseAll');
    expect(app.session.getState().rig.holds.get(f.character)?.size).toBe(0);
    await app.runUntyped('skin.influence.holdAll');
    expect(app.session.getState().rig.holds.get(f.character)?.size).toBeGreaterThan(5);
  });
});

describe('table edits and utilities (§5.12, §5.13)', () => {
  it('set, mirror (involution), smooth, prune, normalize, compact: one step each, valid weights', async () => {
    const f = await boundBody();
    const { app } = f;
    const left = near(app, f.mesh, [0.3, 1.25, 0], 0.08);
    expect(left.length).toBeGreaterThan(0);
    const set = await app.runUntyped('skin.weights.set', {
      mesh: f.mesh,
      joint: f.key('leftUpperArm'),
      value: 0.6,
      points: left,
    });
    expect(set.status).toBe('finished');
    expect(topLabel(app)).toBe('Set Skin Weights');
    for (const v of left) expect(weightsAt(skinOf(app, f.mesh), v)[f.key('leftUpperArm')]).toBeCloseTo(0.6, 6);
    await app.runUntyped('skin.weights.mirror', {});
    expect(topLabel(app)).toBe('Mirror Skin Weights');
    const mirrored = skinOf(app, f.mesh);
    const again = await app.runUntyped('skin.weights.mirror', { direction: 'negative-to-positive' });
    expect(again.status).toBe('finished');
    expect(Array.from(skinOf(app, f.mesh).weights)).toEqual(Array.from(mirrored.weights));
    for (const [id, label] of [
      ['skin.weights.smooth', 'Smooth Skin Weights'],
      ['skin.weights.prune', 'Prune Small Weights'],
    ] as const) {
      const result = await app.runUntyped(id, {});
      expect([id, result.status, topLabel(app)]).toEqual([id, 'finished', label]);
    }
    // Normalize finds nothing to repair after the edits above (each one keeps Σ = 1): no step.
    const stepBefore = app.history.peekUndo()?.id;
    expect((await app.runUntyped('skin.weights.normalize', {})).status).toBe('finished');
    expect(app.history.peekUndo()?.id).toBe(stepBefore);
    const skin = skinOf(app, f.mesh);
    for (let v = 0; v < skin.points; v++) {
      const sum = Object.values(weightsAt(skin, v)).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
    }
    const compact = await app.runUntyped('skin.palette.compact', {});
    expect(compact.status).toBe('finished');
  });

  it('nothing to edit: the weight operators poll-fail without a bound mesh', async () => {
    const t = await meshTestApp();
    await t.app.rig.load();
    expect(t.app.operators.poll('skin.weights.mirror')).toEqual({
      ok: false,
      reason: 'No bound mesh (Skin › Bind Skin first)',
    });
    expect(t.app.history.peekUndo()).toBeNull();
  });
});

describe('Skin-mode U state (§6.2)', () => {
  it('active influence, walk, dominant pick, sample, brush, mirror toggle, test rotate, Paint Select deferred', async () => {
    const f = await boundBody();
    const { app } = f;
    const steps = app.history.peekUndo()?.id;
    await app.runUntyped('skin.influence.setActive', { mesh: f.mesh, joint: f.key('leftLowerArm') });
    await app.runUntyped('skin.influence.walk', { direction: 'up' });
    expect(app.session.getState().rig.activeInfluence?.joint).toBe(f.key('leftUpperArm'));
    await app.runUntyped('skin.influence.walk', { direction: 'down' });
    expect(app.session.getState().rig.activeInfluence?.joint).toBe(f.key('leftLowerArm'));
    const point = near(app, f.mesh, [0.6, 1.25, 0], 0.06)[0] as number;
    await app.runUntyped('skin.influence.pickDominant', { mesh: f.mesh, point });
    const dominant = Object.entries(weightsAt(skinOf(app, f.mesh), point)).sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(app.session.getState().rig.activeInfluence?.joint).toBe(dominant);
    await app.runUntyped('skin.paint.sample', { mesh: f.mesh, point });
    expect(app.session.getState().rig.paint.brush.value).toBe(
      weightsAt(skinOf(app, f.mesh), point)[dominant as string],
    );
    await app.runUntyped('skin.paint.set', { patch: { op: 'smooth', radiusPx: 60, opacity: 2 } });
    expect(app.session.getState().rig.paint.brush).toMatchObject({ op: 'smooth', radiusPx: 60, opacity: 1 });
    expect(app.prefs.getState().rigging.brush).toMatchObject({ op: 'smooth', radiusPx: 60 });
    const mirror = app.session.getState().rig.paint.brush.mirror;
    await app.runUntyped('skin.paint.mirrorToggle');
    expect(app.session.getState().rig.paint.brush.mirror).toBe(!mirror);
    expect((await app.runUntyped('skin.paint.mode', { mode: 'select' })).status).toBe('cancelled');
    app.session.setState({ rig: { ...app.session.getState().rig, mode: 'skin' } });
    expect(skinTestRotate(app)).toBe(false);
    await app.runUntyped('skin.testRotate.toggle');
    expect(skinTestRotate(app)).toBe(true);
    await app.runUntyped('skin.testRotate.toggle');
    expect(skinTestRotate(app)).toBe(false);
    // U state: no history step.
    expect(app.history.peekUndo()?.id).toBe(steps);
  });
});
