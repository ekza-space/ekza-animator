// M6B-SPEC §5.1, §5.16, §9 C1 (editor-core): `char.fromModel` (one step, frozen adoption, `generator: null`, undo
// restores the scene meshes bit-equal, refusals), groups flattened, `char.adopt`, `mesh.importStatic`, CR-7; the model
// character runtime from the lazy chunk (SkeletonDesc from the records, the program compiled from it, rebuilt only on
// joint/skin/rig changes — a weight edit neither rebuilds nor recompiles — and the debounced container rebuild);
// `rig.autoRig.update` (one step, ids kept when a knee moves); P-J6 (renaming joints keeps every control id and the
// keys hash); the container rebuild bench (report-only).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mat4Compose, mat4TransformPoint } from '@ekza-studio/anim-core';
import {
  type CharacterId,
  type HumanBoneName,
  type JointId,
  type JointRecord,
  type MeshId,
  type MeshRecord,
  type SkeletonId,
  fractionalIndex,
} from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { type SkinWeights, withSkin } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src';
import { ModelRuntime } from '../../src/characters/modelRuntime';
import type { KernelCharacters } from '../../src/characters/registry';
import { PRIMITIVE_SKINNED } from '../../src/operators/builtin/templates';
import { meshTestApp, type MeshTestApp } from '../mesh/support';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${name}`, import.meta.url)));
const TRUTH = JSON.parse(new TextDecoder().decode(fixture('cube-lad-truth.json'))) as {
  readonly joints: Readonly<
    Record<string, { readonly position: readonly [number, number, number]; readonly parent: string | null }>
  >;
};

async function ok<T = unknown>(app: EditorApp, id: string, args?: unknown): Promise<T> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

async function cube(t: MeshTestApp, placement?: MeshRecord['placement']): Promise<MeshId> {
  const { mesh } = await ok<{ mesh: MeshId }>(t.app, 'mesh.create.cube', {});
  if (placement !== undefined) await ok(t.app, 'scene.object.transform', { ids: [mesh], placements: [placement] });
  return mesh;
}

/** World positions of a mesh's points (placement chain applied). */
function worldPoints(t: MeshTestApp, id: MeshId, placement: MeshRecord['placement']): number[][] {
  const data = t.app.meshes.get(id)?.data();
  if (data === null || data === undefined) throw new Error(`no data for ${id}`);
  const m = mat4Compose(placement);
  const out: number[][] = [];
  for (let p = 0; p < data.counts.points; p++) {
    out.push([
      ...mat4TransformPoint(m, [
        data.position[3 * p] as number,
        data.position[3 * p + 1] as number,
        data.position[3 * p + 2] as number,
      ]),
    ]);
  }
  return out;
}

const chars = (app: EditorApp) => app.characters as KernelCharacters;
const meshesTable = (app: EditorApp) => JSON.stringify(app.store.snapshot().tables['meshes']);
const keysHash = (app: EditorApp) => {
  const tables = app.store.snapshot().tables;
  return createHash('sha256')
    .update(JSON.stringify([tables['curves'], tables['keys']]))
    .digest('hex');
};

describe('char.fromModel (§5.1)', () => {
  it('makes a model character in one step: frozen adoption, sources soft-deleted; undo restores them bit-equal', async () => {
    const t = await meshTestApp();
    const a = await cube(t, { t: [0.5, 1, 0], q: [0, Math.sin(0.3), 0, Math.cos(0.3)], s: [2, 2, 2] });
    const b = await cube(t, { t: [-0.5, 0.2, 0.1], q: [0, 0, 0, 1], s: [1, 1, 1] });
    const worldA = worldPoints(t, a, (t.app.store.get('meshes', a) as MeshRecord).placement);
    const before = meshesTable(t.app);
    const top = t.app.history.peekUndo()?.id;
    const made = await ok<{ character: CharacterId; skeleton: SkeletonId }>(t.app, 'char.fromModel', {
      objects: [a, b],
      name: 'Lad',
    });
    expect(t.app.history.peekUndo()?.label).toBe('Character from Selection');
    const character = t.app.store.get('characters', made.character);
    expect(character).toMatchObject({
      name: 'Lad',
      asset: null,
      source: { kind: 'model', skeleton: made.skeleton },
      format: 'vrm1',
      vrm: null,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    expect(t.app.store.get('skeletons', made.skeleton)).toMatchObject({
      character: made.character,
      template: 'vrm-humanoid',
      templateVersion: '1.0.0',
      symmetry: true,
    });
    expect(t.app.store.get('rigs', character?.rig as never)?.generator.name).toBe('ekza-autorig-humanoid');
    const adopted = t.app.store.query.meshesOfOwner(made.character);
    expect(adopted.map((mesh) => mesh.name)).toEqual(['Cube', 'Cube 2']);
    expect(adopted.every((mesh) => mesh.generator === null && mesh.skin === null && mesh.parent === null)).toBe(true);
    expect(
      adopted.every((mesh) => mesh.placement.t.every((v) => v === 0) && mesh.placement.s.every((v) => v === 1)),
    ).toBe(true);
    expect([t.app.store.get('meshes', a), t.app.store.get('meshes', b)]).toEqual([undefined, undefined]);
    // The first revision is the source's at its world placement.
    const frozen = worldPoints(t, adopted[0]?.id as MeshId, adopted[0]?.placement as MeshRecord['placement']);
    const far = Math.max(...frozen.flatMap((p, i) => p.map((v, k) => Math.abs(v - (worldA[i]?.[k] ?? Number.NaN)))));
    expect(far).toBeLessThan(1e-6);
    await ok(t.app, 'edit.undo');
    expect(t.app.history.peekUndo()?.id).toBe(top);
    expect(meshesTable(t.app)).toBe(before);
    expect(t.app.store.get('characters', made.character)).toBeUndefined();
    await ok(t.app, 'edit.redo');
    expect(t.app.store.query.meshesOfOwner(made.character)).toHaveLength(2);
  });

  it('flattens a selected group (left empty, it is soft-deleted) and names the character after it', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    const { group } = await ok<{ group: string }>(t.app, 'scene.group', { ids: [a, b] });
    await ok(t.app, 'mesh.setAttributes', { mesh: a, patch: { name: 'Torso' } });
    const groupName = t.app.store.get('groups', group as never)?.name;
    const made = await ok<{ character: CharacterId }>(t.app, 'char.fromModel', { objects: [group] });
    expect(t.app.store.get('characters', made.character)?.name).toBe(groupName);
    expect(
      t.app.store.query
        .meshesOfOwner(made.character)
        .map((mesh) => mesh.name)
        .sort(),
    ).toEqual(['Cube 2', 'Torso']);
    expect(t.app.store.get('groups', group as never)).toBeUndefined();
  });

  it('refuses a non-uniformly scaled source with Freeze Transformations as the way out, and a skinned one', async () => {
    const t = await meshTestApp();
    const squashed = await cube(t, { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 2, 1] });
    const result = await t.app.runUntyped('char.fromModel', { objects: [squashed] });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'char.scale', message: 'Freeze Transformations first', action: { op: 'mesh.freezeTransforms' } },
    });
    const skinned = await cube(t);
    t.app.store.transact({ label: 'bind (test)' }, (tx) =>
      tx.patch('meshes', skinned, { skin: { skeleton: 'skl_x' as SkeletonId, bind: null } }),
    );
    expect(await t.app.runUntyped('char.fromModel', { objects: [skinned] })).toMatchObject({
      status: 'failed',
      error: { code: 'char.skinned-source', message: 'Make the imported character editable instead' },
    });
    t.app.session.setState({ selection: { ...t.app.session.getState().selection, objects: [] } });
    expect(await t.app.runUntyped('char.fromModel', {})).toEqual({
      status: 'cancelled',
      reason: 'Select the meshes of the character first',
    });
  });

  it('char.adopt adds scene meshes to a model character (unbound), one step', async () => {
    const t = await meshTestApp();
    const made = await ok<{ character: CharacterId }>(t.app, 'char.fromModel', { objects: [await cube(t)] });
    const hat = await cube(t, { t: [0, 1.7, 0], q: [0, 0, 0, 1], s: [0.5, 0.5, 0.5] });
    const { meshes } = await ok<{ meshes: MeshId[] }>(t.app, 'char.adopt', {
      character: made.character,
      objects: [hat],
    });
    expect(meshes).toHaveLength(1);
    expect(t.app.store.get('meshes', meshes[0] as MeshId)).toMatchObject({
      owner: { character: made.character },
      skin: null,
    });
    expect(await t.app.runUntyped('char.adopt', { character: 'chr_nope', objects: [hat] })).toMatchObject({
      status: 'cancelled',
    });
  });
});

describe('mesh.importStatic (§5.1)', () => {
  it('imports an unskinned GLB as scene meshes backed by a model asset; refuses skinned files', async () => {
    const t = await meshTestApp();
    const { meshes } = await ok<{ meshes: MeshId[] }>(t.app, 'mesh.importStatic', {
      bytes: fixture('cube-lad.glb'),
      name: 'cube-lad.glb',
    });
    expect(meshes.length).toBeGreaterThan(0);
    const record = t.app.store.get('meshes', meshes[0] as MeshId);
    expect(record).toMatchObject({ owner: { scene: true }, faceted: false, generator: null, skin: null });
    expect(record?.source?.asset).toBeDefined();
    expect(t.app.store.get('assets', record?.source?.asset as never)).toMatchObject({ role: 'model', ext: 'glb' });
    expect(
      await t.app.runUntyped('mesh.importStatic', { bytes: readFixture('polybot.vrm'), name: 'polybot.vrm' }),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'import.skinned', message: 'Open skinned models as characters (File › Open)' },
    });
    // The imported Cube Lad becomes a character like any scene mesh.
    const made = await ok<{ character: CharacterId }>(t.app, 'char.fromModel', { objects: meshes });
    expect(t.app.store.query.meshesOfOwner(made.character)[0]?.source).toEqual(record?.source);
  });
});

describe('CR-7: mesh.primitive.set refuses skinned meshes', () => {
  it('poll-fails with primitive.skinned on a mesh with MeshRecord.skin', async () => {
    const t = await meshTestApp();
    const mesh = await cube(t);
    expect(t.app.operators.poll('mesh.primitive.set', undefined, { mesh, params: { width: 2 } })).toBe(true);
    t.app.store.transact({ label: 'bind (test)' }, (tx) =>
      tx.patch('meshes', mesh, { skin: { skeleton: 'skl_x' as SkeletonId, bind: null } }),
    );
    expect(t.app.operators.poll('mesh.primitive.set', undefined, { mesh, params: { width: 2 } })).toEqual({
      ok: false,
      reason: PRIMITIVE_SKINNED,
    });
  });
});

// ---------- the runtime ----------

/** Writes the Cube Lad's Standard 33 joints into a skeleton (root helper + 33 bones). */
function writeTruthJoints(app: EditorApp, skeleton: SkeletonId): Map<string, JointId> {
  const ids = new Map<string, JointId>();
  app.store.transact({ label: 'joints (test)' }, (tx) => {
    let order: string | null = null;
    for (const [key, joint] of Object.entries(TRUTH.joints)) {
      const id = `jnt_${key}` as JointId;
      ids.set(key, id);
      order = fractionalIndex(order, null);
      const record: JointRecord = {
        id,
        skeleton,
        parent: joint.parent === null ? null : (`jnt_${joint.parent}` as JointId),
        order,
        name: key,
        humanBone: key === 'root' ? null : (key as HumanBoneName),
        restPosition: [...joint.position],
        restRotation: [0, 0, 0, 1],
        tail: null,
        side: key.startsWith('left') ? 'L' : key.startsWith('right') ? 'R' : 'C',
        mirror: null,
        deleted: null,
        role: key === 'root' ? 'helper' : 'bone',
        key,
      };
      tx.put('joints', record);
    }
  });
  return ids;
}

/** A Cube Lad character with the truth skeleton, bound rigidly to its nearest joints, and its control rig. */
async function riggedLad(): Promise<{ t: MeshTestApp; character: CharacterId; skeleton: SkeletonId; mesh: MeshId }> {
  const t = await meshTestApp();
  const { meshes } = await ok<{ meshes: MeshId[] }>(t.app, 'mesh.importStatic', {
    bytes: fixture('cube-lad.glb'),
    name: 'lad.glb',
  });
  const made = await ok<{ character: CharacterId; skeleton: SkeletonId }>(t.app, 'char.fromModel', { objects: meshes });
  writeTruthJoints(t.app, made.skeleton);
  const mesh = t.app.store.query.meshesOfOwner(made.character)[0]?.id as MeshId;
  bindNearest(t, mesh, made.skeleton);
  await ok(t.app, 'rig.autoRig.update', { character: made.character });
  await chars(t.app).settled();
  return { t, character: made.character, skeleton: made.skeleton, mesh };
}

/** Binds a mesh to its nearest joint per point (weight 1): the skin layers in a new revision and MeshRecord.skin. */
function bindNearest(t: MeshTestApp, mesh: MeshId, skeleton: SkeletonId, nudge = 0): void {
  const data = t.app.meshes.get(mesh)?.data();
  if (data === null || data === undefined) throw new Error('mesh not ready');
  const joints = t.app.store.query.jointsOfSkeleton(skeleton).filter((joint) => joint.role === 'bone');
  const P = data.counts.points;
  const ji = new Uint16Array(4 * P);
  const w = new Float32Array(4 * P);
  for (let p = 0; p < P; p++) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    joints.forEach((joint, j) => {
      const d = Math.hypot(...joint.restPosition.map((v, k) => v - (data.position[3 * p + k] as number)));
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    ji[4 * p] = best;
    w[4 * p] = 1 - nudge;
    if (nudge > 0) {
      ji[4 * p + 1] = (best + 1) % joints.length;
      w[4 * p + 1] = nudge;
    }
  }
  const skin: SkinWeights = {
    points: P,
    palette: joints.map((joint) => ({ key: joint.id, parent: joint.parent, mirror: null })),
    joints: ji,
    weights: w,
  };
  t.app.store.transact({ label: 'bind (test)' }, (tx) => {
    t.meshes.writeData(tx, mesh, withSkin(data, skin));
    if (tx.get('meshes', mesh)?.skin === null) tx.patch('meshes', mesh, { skin: { skeleton, bind: null } });
  });
}

describe('the model character runtime (§5.1)', () => {
  it('loads the character-runtime chunk and builds the runtime from the records (34 joints, a compiled rig)', async () => {
    const { t, character } = await riggedLad();
    expect(t.app.session.getState().workspace).toBe('animate');
    const runtime = t.app.characters.get(character);
    expect(runtime).toBeInstanceOf(ModelRuntime);
    if (!(runtime instanceof ModelRuntime)) return;
    expect(runtime.skeleton.nodes).toHaveLength(34);
    expect(runtime.skeleton.heightSource).toBe('mesh');
    expect(runtime.skeleton.height).toBeCloseTo(1.7, 3);
    expect(runtime.program.controls.length).toBeGreaterThan(30);
    expect(runtime.program.limbs.map((limb) => limb.id).sort()).toEqual(['leg.L', 'leg.R']);
    expect(runtime.container.json['skins']).toHaveLength(1);
    expect(runtime.asset).toBe(runtime.container.sha256);
    expect(t.app.store.get('assets', runtime.asset)).toBeUndefined();
    expect(t.app.characters.list().map((r) => r.id)).toContain(character);
  });

  it('a weight edit neither rebuilds the SkeletonDesc nor recompiles; the container rebuild bumps its version', async () => {
    const { t, character, skeleton, mesh } = await riggedLad();
    const runtime = t.app.characters.get(character) as ModelRuntime;
    const { skeletonBuilds, compiles, containerVersion } = runtime;
    const desc = runtime.skeleton;
    const program = runtime.program;
    bindNearest(t, mesh, skeleton, 0.25);
    await chars(t.app).settled();
    expect([runtime.skeletonBuilds, runtime.compiles]).toEqual([skeletonBuilds, compiles]);
    expect(runtime.skeleton).toBe(desc);
    expect(runtime.program).toBe(program);
    await chars(t.app).redisplay(character);
    expect(runtime.containerVersion).toBe(containerVersion + 1);
  });

  it('a knee move rebuilds the SkeletonDesc and recompiles; rig.autoRig.update keeps every control id (one step)', async () => {
    const { t, character } = await riggedLad();
    const runtime = t.app.characters.get(character) as ModelRuntime;
    const builds = runtime.skeletonBuilds;
    const controls = t.app.store.list('controls').map((control) => control.id);
    t.app.store.transact({ label: 'move knee (test)' }, (tx) =>
      tx.patch('joints', 'jnt_rightLowerLeg' as JointId, { restPosition: [-0.1, 0.46, 0.02] }),
    );
    expect(runtime.skeletonBuilds).toBe(builds + 1);
    const top = t.app.history.peekUndo()?.id;
    await ok(t.app, 'rig.autoRig.update', { character });
    expect(t.app.history.peekUndo()?.label).toBe('Update Control Rig');
    await ok(t.app, 'edit.undo');
    expect(t.app.history.peekUndo()?.id).toBe(top);
    await ok(t.app, 'edit.redo');
    expect(t.app.store.list('controls').map((control) => control.id)).toEqual(controls);
    const knee = t.app.store.list('controls').find((control) => control.key === 'fk.lowerLeg.R');
    expect(knee?.restWorld.t[2]).toBeCloseTo(0.02, 12);
    expect(runtime.program.skeleton).toBe(runtime.skeleton);
  });

  it('P-J6: renaming joints keeps every control id and the keys hash', async () => {
    const { t, character } = await riggedLad();
    const controls = t.app.store.list('controls').map((control) => control.id);
    const hash = keysHash(t.app);
    t.app.store.transact({ label: 'rename (test)' }, (tx) => {
      for (const joint of tx.list('joints')) tx.patch('joints', joint.id, { name: `${joint.name}_renamed` });
    });
    await ok(t.app, 'rig.autoRig.update', { character });
    expect(t.app.store.list('controls').map((control) => control.id)).toEqual(controls);
    expect(keysHash(t.app)).toBe(hash);
    const runtime = t.app.characters.get(character) as ModelRuntime;
    expect(runtime.skeleton.nodes[1]?.name).toBe('hips_renamed');
  });

  it('rebuilds the display container within the budget (≤ 300 ms with ModelLoader; report-only)', async ({
    annotate,
  }) => {
    const { t, character } = await riggedLad();
    const runtime = t.app.characters.get(character) as ModelRuntime;
    const runs = 5;
    const start = performance.now();
    for (let i = 0; i < runs; i++) await chars(t.app).redisplay(character);
    const ms = (performance.now() - start) / runs;
    const tris = (runtime.container.json['meshes'] as unknown[]).length;
    await annotate(
      `container rebuild (Cube Lad, 34 joints, ${tris} mesh): ${ms.toFixed(1)} ms without ModelLoader (budget 300 ms)`,
    );
    expect(runtime.containerVersion).toBe(1 + runs);
  });
});
