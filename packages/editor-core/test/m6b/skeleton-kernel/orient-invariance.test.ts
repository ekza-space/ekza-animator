// P-J2 orient invariance (M6B-SPEC §10.2, §5.5; C2) through the shipped rig path: the joint records → `skeletonFromDoc`
// (io) → `autoRig` → `compileRig` → `evaluate` (rig). On Seed-san as records (its joints copied into JointRecords,
// non-identity rests and secondary chains included) and on the generated body's CR-2 pre-fit skeleton
// (`skel.template.create`), every Orient preset with children on, applied one after the other, leaves every skinned
// point at every ROM frame within 1e-9 m and every `humanLocal` within 1e-9. In the editor, Orient Joint (Maya) on a
// keyed bone-aligned chain converts its keys so the bones' skinning matrices (world rotation over the rest, and
// position) at the key times stay within 1e-9 (the conjugate rule, M6B-C2-21).
import {
  type Mat4,
  mat4Compose,
  mat4Decompose,
  mat4Invert,
  mat4Multiply,
  mat4TransformPoint,
  type Quat,
  type Vec3,
} from '@ekza-studio/anim-core';
import {
  type ControlRecord,
  type HumanBoneName,
  type JointId,
  type JointRecord,
  makeClip,
  makeCurve,
  makeKey,
  makeLayer,
  type SkeletonId,
  type SkeletonRecord,
} from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { parseGlb, skeletonFromDoc, skeletonFromGltf } from '@ekza-studio/io';
import { humanoidBody } from '@ekza-studio/mesh-core';
import {
  autoRig,
  compileRig,
  type OrientJointArgs,
  orientJoints,
  readRigDefinition,
  type RigDefinition,
  type RigProgram,
  type SkeletonDesc,
} from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { updateControlRig } from '../../../src/operators/builtin/rig/skeleton';
import { rigTestApp, truthMarkers } from './support';

type Preset = 'maya' | 'blender' | 'world';
const PRESETS: Readonly<Record<Preset, Omit<OrientJointArgs, 'joints'>>> = {
  maya: { mode: 'aim', primary: '+x', secondary: '+y', secondaryWorld: '+y', children: true, symmetry: true },
  blender: { mode: 'aim', primary: '+y', secondary: '+z', secondaryWorld: '+y', children: true, symmetry: true },
  world: { mode: 'world', primary: '+x', secondary: '+y', secondaryWorld: '+y', children: true, symmetry: true },
};
const ORDER: readonly Preset[] = ['maya', 'blender', 'world'];
const ROM_FRAMES = 10;
const IDS = { character: 'chr_pj2' as never, rig: 'rig_pj2' as never };

/** A stable per-key phase (the controls keep their ids across the rig update, so the channels match by key). */
const phase = (key: string): number => {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 9973;
  return h / 997;
};

interface Rigged {
  readonly program: RigProgram;
  /** Node index of each joint key. */
  readonly node: ReadonlyMap<string, number>;
  /** Inverse rest world (bind) of each node. */
  readonly bind: readonly Mat4[];
}

function compile(skeleton: SkeletonRecord, joints: readonly JointRecord[], def?: RigDefinition): Rigged {
  const desc: SkeletonDesc = skeletonFromDoc({ skeleton, joints, meshes: [] });
  const program = compileRig(def ?? autoRig(desc, IDS), desc);
  const node = new Map<string, number>((desc.jointKeys ?? []).map((key, i) => [key, i]));
  const ch = program.allocChannels();
  program.resetChannels(ch);
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  const bind = Array.from({ length: program.nodeCount }, (_, i) => {
    const inv = mat4Invert(pose.boneWorld.slice(16 * i, 16 * i + 16));
    if (inv === null) throw new Error(`singular rest of node ${i}`);
    return inv;
  });
  return { program, node, bind };
}

/** The ROM frame `f`: every humanoid control rotates on all three axes (world-aligned frames); the translatable ones
 *  (cog, hips, IK targets) also move by a few centimetres. Bone-aligned (secondary) controls stay at rest. */
function romChannels(program: RigProgram, f: number) {
  const ch = program.allocChannels();
  program.resetChannels(ch);
  program.controls.forEach((control, i) => {
    if (control.key.startsWith('sec.')) return;
    const p = phase(control.key);
    const v = ch.values;
    v[9 * i + 3] = 0.6 * Math.sin(1.3 * f + 5 * p);
    v[9 * i + 4] = 0.5 * Math.sin(0.9 * f + 3 * p + 1);
    v[9 * i + 5] = 0.4 * Math.cos(1.7 * f + 7 * p);
    if (control.keyable.t.some((axis) => axis)) {
      v[9 * i] = 0.03 * Math.sin(f + p);
      v[9 * i + 1] = 0.02 * Math.cos(2 * f + p);
      v[9 * i + 2] = 0.03 * Math.sin(3 * f + 2 * p);
    }
  });
  return ch;
}

/** Skinned points of every ROM frame (Σ w · W · B⁻¹ · p) and the frames' humanLocal. */
function deform(
  r: Rigged,
  points: readonly Vec3[],
  weights: readonly (readonly (readonly [string, number])[])[],
): { readonly points: number[]; readonly humanLocal: number[] } {
  const out: number[] = [];
  const human: number[] = [];
  const pose = r.program.allocPose();
  const skin: Mat4[] = [];
  for (let f = 0; f < ROM_FRAMES; f++) {
    r.program.evaluate(romChannels(r.program, f), pose);
    for (let i = 0; i < r.program.nodeCount; i++) {
      skin[i] = mat4Multiply(pose.boneWorld.slice(16 * i, 16 * i + 16), r.bind[i] as Mat4);
    }
    points.forEach((p, k) => {
      const acc = [0, 0, 0];
      for (const [key, w] of weights[k] as (readonly [string, number])[]) {
        const q = mat4TransformPoint(skin[r.node.get(key) as number] as Mat4, p);
        for (let c = 0; c < 3; c++) acc[c] = (acc[c] as number) + w * (q[c] as number);
      }
      out.push(...acc);
    });
    human.push(...pose.humanLocal);
  }
  return { points: out, humanLocal: human };
}

/** Each point weighted to its two nearest joints (inverse distance, normalized). */
function nearestTwo(joints: readonly JointRecord[], points: readonly Vec3[]) {
  const live = joints.filter((joint) => joint.role !== 'helper');
  return points.map((p) => {
    const d = live
      .map(
        (joint) =>
          [
            joint.key,
            Math.hypot(...[0, 1, 2].map((c) => (p[c] as number) - (joint.restPosition[c] as number))),
          ] as const,
      )
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 2);
    const inv = d.map(([, x]) => 1 / Math.max(x, 1e-6));
    const sum = (inv[0] as number) + (inv[1] as number);
    return d.map(([key], i) => [key, (inv[i] as number) / sum] as const);
  });
}

const worst = (a: readonly number[], b: readonly number[]): number => {
  let w = 0;
  for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs((a[i] as number) - (b[i] as number)));
  return a.length === b.length ? w : Infinity;
};

/** Orient presets in turn on the subtree of `rootKey`; every stage against the original deformation. */
function expectInvariant(
  skeleton: SkeletonRecord,
  original: readonly JointRecord[],
  points: readonly Vec3[],
  rootKey: string,
) {
  const weights = nearestTwo(original, points);
  const base = deform(compile(skeleton, original), points, weights);
  let joints = [...original];
  const root = original.find((joint) => joint.key === rootKey)?.id as JointId;
  const changed: Record<string, number> = {};
  for (const preset of ORDER) {
    const edit = orientJoints(joints, { ...PRESETS[preset], joints: [root] });
    const upserts = new Map(edit.upserts.map((joint) => [joint.id, joint]));
    joints = joints.map((joint) => upserts.get(joint.id) ?? joint);
    changed[preset] = edit.upserts.length;
    const next = deform(compile(skeleton, joints), points, weights);
    expect({
      preset,
      points: worst(base.points, next.points) < 1e-9,
      humanLocal: worst(base.humanLocal, next.humanLocal) < 1e-9,
    }).toEqual({
      preset,
      points: true,
      humanLocal: true,
    });
  }
  // The aim presets really re-oriented the joints (the test is not vacuous).
  expect(changed['maya']).toBeGreaterThan(10);
  expect(changed['blender']).toBeGreaterThan(10);
}

// ---------- Seed-san as records ----------
async function seedSanRecords(): Promise<{ skeleton: SkeletonRecord; joints: JointRecord[] }> {
  const desc = skeletonFromGltf(await parseGlb(readFixture('seed-san.vrm')));
  const SKEL = 'skl_seed' as SkeletonId;
  const world: Mat4[] = [];
  const facing = mat4Compose({ t: [0, 0, 0], q: [...desc.facing] as Quat, s: [1, 1, 1] });
  desc.nodes.forEach((node, i) => {
    const local = mat4Compose(node.restLocal);
    world[i] = node.parent === -1 ? mat4Multiply(facing, local) : mat4Multiply(world[node.parent] as Mat4, local);
  });
  const human = new Map<number, HumanBoneName>();
  for (const [bone, index] of Object.entries(desc.humanoid ?? {})) human.set(index, bone as HumanBoneName);
  const jointOf = (i: number): number => {
    let p = desc.nodes[i]?.parent ?? -1;
    while (p !== -1 && desc.nodes[p]?.isJoint !== true) p = desc.nodes[p]?.parent ?? -1;
    return p;
  };
  const idOf = (i: number) => `${SKEL}:n${i}` as JointId;
  const joints: JointRecord[] = [];
  for (const node of desc.nodes) {
    if (!node.isJoint) continue;
    const xf = mat4Decompose(world[node.index] as Mat4);
    const bone = human.get(node.index) ?? null;
    const parent = jointOf(node.index);
    joints.push({
      id: idOf(node.index),
      skeleton: SKEL,
      parent: parent === -1 ? null : idOf(parent),
      order: `a${String(node.index).padStart(3, '0')}`,
      name: node.name,
      humanBone: bone,
      restPosition: [...xf.t] as [number, number, number],
      restRotation: [...xf.q] as [number, number, number, number],
      tail: null,
      side: bone?.startsWith('left') ? 'L' : bone?.startsWith('right') ? 'R' : 'C',
      mirror: null,
      deleted: null,
      role: 'bone',
      key: bone ?? `n${node.index}`,
    });
  }
  const skeleton: SkeletonRecord = {
    id: SKEL,
    character: IDS.character,
    template: 'vrm-humanoid',
    templateVersion: '1.0.0',
    preset: 'custom',
    symmetry: false,
    deleted: null,
  };
  return { skeleton, joints };
}

describe('P-J2: Orient Joint is invisible to deformation through the shipped rig path (1e-9)', () => {
  it('Seed-san as records: every preset (children on) keeps the skinned points of every ROM frame and humanLocal', async () => {
    const { skeleton, joints } = await seedSanRecords();
    expect(joints.filter((joint) => joint.humanBone !== null).length).toBeGreaterThanOrEqual(15);
    // Points around every joint (±2 cm on each axis), weighted to their two nearest joints.
    const points: Vec3[] = joints.flatMap((joint) =>
      [
        [0.02, 0, 0],
        [0, 0.02, 0],
        [0, 0, -0.02],
      ].map((d) => [0, 1, 2].map((c) => (joint.restPosition[c] as number) + (d[c] as number)) as unknown as Vec3),
    );
    expectInvariant(skeleton, joints, points, 'hips');
  });

  it('the generated body (CR-2 pre-fit, Skeleton Template): every preset keeps its mesh points and humanLocal', async () => {
    const t = await rigTestApp();
    const created = await t.app.runUntyped('mesh.create.template', { template: 'humanoidBody' });
    const root = (created as { value: { root: string } }).value.root;
    const result = await t.app.runUntyped('skel.template.create', { preset: 'standard33', objects: [root] });
    expect(result.status).toBe('finished');
    const id = (result as { value: { skeleton: SkeletonId } }).value.skeleton;
    const skeleton = t.app.store.get('skeletons', id) as SkeletonRecord;
    const joints = t.app.store.query.jointsOfSkeleton(id);
    // The points of both generator styles (smooth and segmented) at the template's 1.6 m.
    const points: Vec3[] = [];
    for (const body of [
      humanoidBody({ style: 'smooth', height: 1.6 }),
      humanoidBody({ style: 'segmented', height: 1.6 }),
    ])
      for (let i = 0; i < body.counts.points; i++) {
        points.push([
          body.position[3 * i] as number,
          body.position[3 * i + 1] as number,
          body.position[3 * i + 2] as number,
        ]);
      }
    expectInvariant(skeleton, joints, points, 'hips');
  });
});

// ---------- editor path: keys of bone-aligned controls ----------
describe('P-J2: Orient Joint converts the keys of a keyed bone-aligned chain (editor path)', () => {
  it('Maya on a hair chain under the head: the bones’ skinning matrices at every key time within 1e-9', async () => {
    const t = await rigTestApp();
    const result = await t.app.runUntyped('skel.quickRig.commit', {
      preset: 'standard33',
      markers: truthMarkers(),
      meshes: [t.lad],
      flexion: 2 * (Math.PI / 180),
    });
    const { skeleton, character } = (result as { value: { skeleton: SkeletonId; character: string } }).value;
    const head = `${skeleton}:head` as JointId;
    const chain = [0, 1, 2].map((i) => `${skeleton}:hair_0${i + 1}` as JointId);
    const rigId = t.app.store.query.rigOfCharacter(character as never)?.id as never;
    // A three-joint hair chain (World-oriented, like a fresh Add Chain), then the control rig update.
    t.app.store.transact({ label: 'hair (test)' }, (tx) => {
      chain.forEach((jid, i) => {
        tx.put('joints', {
          id: jid,
          skeleton,
          parent: i === 0 ? head : (chain[i - 1] as JointId),
          order: `z${i}`,
          name: `hair_0${i + 1}`,
          humanBone: null,
          restPosition: [0.01 * i, 1.6 - 0.06 * i, -0.12 - 0.04 * i * i],
          restRotation: [0, 0, 0, 1],
          tail: i === 2 ? [0.03, 1.42, -0.32] : null,
          side: 'C',
          mirror: null,
          deleted: null,
          role: 'bone',
          key: `hair_0${i + 1}`,
        });
      });
      updateControlRig(t.app, tx, character as never);
    });
    const secondary = t.app.store.query.controlsOfRig(rigId).filter((c: ControlRecord) => c.key.startsWith('sec.'));
    expect(secondary.map((c) => c.key).sort()).toEqual(['sec.hair_01', 'sec.hair_02', 'sec.hair_03']);
    // Key every hair control's rx/ry/rz at frames 0, 12 and 24 (the S-key layout).
    const TIMES = [0, 12, 24];
    const clipRecord = makeClip({ character: character as never, name: 'sway', fps: { num: 24, den: 1 } });
    const clip = clipRecord.id;
    const layer = makeLayer({ clip });
    t.app.store.transact({ label: 'keys (test)' }, (tx) => {
      tx.put('clips', clipRecord);
      tx.put('layers', layer);
      for (const control of secondary) {
        (['rx', 'ry', 'rz'] as const).forEach((channel, c) => {
          const curve = makeCurve({ clip, layer: layer.id, control: control.id, channel });
          tx.put('curves', curve);
          TIMES.forEach((time, k) =>
            tx.put(
              'keys',
              makeKey({ clip, curve: curve.id, t: time, v: 0.4 * Math.sin(1 + k + 2 * c + phase(control.key)) }),
            ),
          );
        });
      }
    });
    const keysAt = (): Map<string, number[][]> => {
      const out = new Map<string, number[][]>();
      for (const control of secondary) {
        const curves = t.app.store.list('curves').filter((c) => c.control === control.id && c.clip === clip);
        const v = (['rx', 'ry', 'rz'] as const).map((ch) =>
          t.app.store.query.keysOfCurve(curves.find((c) => c.channel === ch)?.id as never).map((k) => k.v),
        );
        out.set(
          control.key,
          TIMES.map((_, k) => v.map((axis) => axis[k] as number)),
        );
      }
      return out;
    };
    const worlds = (): number[] => {
      const sk = t.app.store.get('skeletons', skeleton) as SkeletonRecord;
      const r = compile(sk, t.app.store.query.jointsOfSkeleton(skeleton), readRigDefinition(t.app.store, rigId));
      const keys = keysAt();
      const pose = r.program.allocPose();
      const out: number[] = [];
      TIMES.forEach((_, k) => {
        const ch = r.program.allocChannels();
        r.program.resetChannels(ch);
        r.program.controls.forEach((control, i) => {
          const values = keys.get(control.key)?.[k];
          if (values !== undefined) ch.values.set(values, 9 * i + 3);
        });
        r.program.evaluate(ch, pose);
        for (const key of ['hair_01', 'hair_02', 'hair_03']) {
          // The skinning matrix W·B⁻¹ (what the mesh sees; B the joint's current rest world).
          const i = r.node.get(key) as number;
          out.push(...mat4Multiply(pose.boneWorld.slice(16 * i, 16 * i + 16), r.bind[i] as Mat4));
        }
      });
      return out;
    };
    const before = worlds();
    const keysBefore = keysAt();
    expect((await t.app.runUntyped('skel.joint.orient', { joints: [chain[0]], preset: 'maya' })).status).toBe(
      'finished',
    );
    expect(t.app.store.get('joints', chain[0] as JointId)?.restRotation).not.toEqual([0, 0, 0, 1]);
    expect(keysAt()).not.toEqual(keysBefore);
    expect(worst(before, worlds())).toBeLessThan(1e-9);
    // Undo restores the keys and the rests in one step.
    t.app.history.undo();
    expect(keysAt()).toEqual(keysBefore);
    // The keys pose the chain (the comparison is not of rest poses): hair_01's skinning matrix is not the identity.
    expect(Math.abs((before[0] as number) - 1)).toBeGreaterThan(1e-6);
  });
});
