// WP-3 fixture gates (MVP-SPEC §6.3 rig row, §7 WP-3 tests): zero pose on the three licensed fixtures, three-vrm
// parity with the VRM 0.x mapping, secondary-control filtering on Seed-san, the generic rig on UAL, UAL `Idle_Loop`
// import vs three's GLTFLoader, Plant Feet on Polybot and an evaluation bench. They need WP-4's `parseGlb`,
// `skeletonFromGltf` and `readAnimations` and turn on by themselves once those stop being stubs (MVP-SPEC §8.1 step 4).
import {
  type AnimCurve,
  EkzaError,
  type Fps,
  mat4Decompose,
  type Quat,
  quatAngle,
  reduceKeys,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, HumanBoneName } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import { naiveCurveEngine } from '@ekza-animator/editor-core/testing';
import { type GlbContainer, parseGlb, readAnimations, skeletonFromGltf } from '@ekza-animator/io';
import { loadGltfInNode } from '@ekza-animator/io/testing';
import {
  autoRig,
  CHANNELS_PER_CONTROL,
  compileRig,
  DEFAULT_REDUCE,
  detectClipFps,
  flipYawHumanLocal,
  HUMAN_BONE_NAMES,
  type ImportedClipKeys,
  importRawClip,
  plantFeetChannels,
  type RawClip,
  readControlChannels,
  type RigProgram,
  type SkeletonDesc,
  writeControlChannels,
} from '@ekza-animator/rig';
import { AnimationMixer, LoopOnce } from 'three';
import { describe, expect, it } from 'vitest';

function pendingStub(probe: () => unknown): boolean {
  try {
    probe();
    return false;
  } catch (error) {
    return error instanceof EkzaError && error.code === 'not-implemented';
  }
}

/** Blocked by WP-4 (io readers) until they land. */
const WP4_PENDING =
  pendingStub(() => skeletonFromGltf({} as GlbContainer)) || pendingStub(() => readAnimations({} as GlbContainer, {} as SkeletonDesc));
/** Blocked by WP-1 (anim-core reduceKeys) until it lands. */
const WP1_PENDING = pendingStub(() => reduceKeys({ keys: [], weighted: false, pre: 'constant', post: 'constant' }, { tolerance: 1 }));

const IDS = { character: 'chr_FixtureGates0001' as never, rig: 'rig_FixtureGates0001' as never };

async function loadSkeleton(name: LicensedFixture): Promise<{ readonly bytes: Uint8Array; readonly skeleton: SkeletonDesc; readonly container: GlbContainer }> {
  const bytes = readFixture(name);
  const container = await parseGlb(bytes);
  return { bytes, container, skeleton: skeletonFromGltf(container) };
}

async function loadClip(name: LicensedFixture, clip: string): Promise<{ readonly skeleton: SkeletonDesc; readonly raw: RawClip; readonly bytes: Uint8Array }> {
  const { bytes, container, skeleton } = await loadSkeleton(name);
  const raw = readAnimations(container, skeleton).find((c) => c.name === clip);
  if (raw === undefined) throw new Error(`clip ${clip} missing`);
  return { bytes, skeleton, raw };
}

function rig(skeleton: SkeletonDesc): RigProgram {
  return compileRig(autoRig(skeleton, IDS), skeleton);
}

function quatAt(buffer: Float64Array, offset: number): Quat {
  return [buffer[offset] as number, buffer[offset + 1] as number, buffer[offset + 2] as number, buffer[offset + 3] as number];
}

/** Imported curves at a frame, evaluated with the test kit engine (exact for the LINEAR/STEP keys used here). */
function channelsAt(program: RigProgram, clip: ImportedClipKeys, frame: number): ReturnType<RigProgram['allocChannels']> {
  const ch = program.allocChannels();
  const slots = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];
  for (const curve of clip.curves) {
    const anim: AnimCurve = { keys: curve.keys, weighted: false, pre: 'constant', post: 'constant' };
    const slot = program.controlIndex.get(curve.control) as number;
    ch.values[slot * CHANNELS_PER_CONTROL + slots.indexOf(curve.channel)] = naiveCurveEngine.evaluate(naiveCurveEngine.compile(anim), frame);
  }
  return ch;
}

describe.skipIf(WP4_PENDING)('rig fixture gates (blocked by WP-4 io readers until merged)', () => {
  it.each(['seed-san.vrm', 'polybot.vrm', 'quaternius-ual.glb'] as const)('zero pose = rest on %s (1e-9)', async (name) => {
    const { skeleton } = await loadSkeleton(name);
    const program = rig(skeleton);
    const pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    let error = 0;
    skeleton.nodes.forEach((node, i) => {
      const q = node.restLocal.q;
      const n = Math.hypot(q[0], q[1], q[2], q[3]);
      for (let k = 0; k < 3; k++) {
        error = Math.max(error, Math.abs((pose.boneLocal[i * 10 + k] as number) - (node.restLocal.t[k] as number)));
        error = Math.max(error, Math.abs((pose.boneLocal[i * 10 + 7 + k] as number) - (node.restLocal.s[k] as number)));
      }
      for (let k = 0; k < 4; k++) error = Math.max(error, Math.abs((pose.boneLocal[i * 10 + 3 + k] as number) - (q[k] as number) / n));
    });
    expect(error).toBeLessThan(1e-9);
  });

  it.each(['seed-san.vrm', 'polybot.vrm'] as const)(
    'matches three-vrm raw bones from the same normalized pose on %s (1e-6, vrm0 → flipYaw)',
    async (name) => {
      const { bytes, skeleton } = await loadSkeleton(name);
      const program = rig(skeleton);
      const ch = program.allocChannels();
      let state = 7;
      const next = (): number => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647 - 0.5;
      };
      for (const control of program.controls) {
        if (control.group === 'secondary') continue;
        const values: ChannelValues = {};
        if (control.keyable.r[0]) values.rx = next();
        if (control.keyable.r[1]) values.ry = next();
        if (control.keyable.r[2]) values.rz = next();
        if (control.keyable.t[0]) values.tx = next() * 0.2;
        if (control.keyable.t[1]) values.ty = next() * 0.2;
        if (control.keyable.t[2]) values.tz = next() * 0.2;
        writeControlChannels(program, ch, control.id, values);
      }
      const pose = program.allocPose();
      program.evaluate(ch, pose);
      const gltf = await loadGltfInNode(bytes);
      const vrm = gltf.vrm;
      if (vrm === null) throw new Error('not a VRM');
      const vrm0 = skeleton.format === 'vrm0';
      const normalized = new Float64Array(pose.humanLocal.length);
      if (vrm0) flipYawHumanLocal(pose.humanLocal, normalized);
      else normalized.set(pose.humanLocal);
      HUMAN_BONE_NAMES.forEach((bone, h) => {
        const node = vrm.humanoid.getNormalizedBoneNode(bone);
        if (node === null) return;
        node.quaternion.set(normalized[h * 4] as number, normalized[h * 4 + 1] as number, normalized[h * 4 + 2] as number, normalized[h * 4 + 3] as number);
        if (bone === 'hips') {
          const p = pose.hipsPosition;
          if (vrm0) node.position.set(-(p[0] as number), p[1] as number, -(p[2] as number));
          else node.position.set(p[0] as number, p[1] as number, p[2] as number);
        }
      });
      vrm.humanoid.update();
      let rotation = 0;
      let translation = 0;
      gltf.nodeByIndex.forEach((object, i) => {
        if (object === null) return;
        const q = object.quaternion;
        rotation = Math.max(rotation, quatAngle(quatAt(pose.boneLocal, i * 10 + 3), [q.x, q.y, q.z, q.w]));
        translation = Math.max(
          translation,
          Math.abs((pose.boneLocal[i * 10] as number) - object.position.x),
          Math.abs((pose.boneLocal[i * 10 + 1] as number) - object.position.y),
          Math.abs((pose.boneLocal[i * 10 + 2] as number) - object.position.z),
        );
      });
      expect(rotation).toBeLessThan(1e-6);
      expect(translation).toBeLessThan(1e-6);
    },
  );

  it('filters secondary controls on Seed-san (no spring joints, no node-constraint destinations)', async () => {
    const { skeleton } = await loadSkeleton('seed-san.vrm');
    const def = autoRig(skeleton, IDS);
    const humanoidNodes = new Set(Object.values(skeleton.humanoid ?? {}));
    const springs = new Set(skeleton.springJoints);
    const constrained = new Set(skeleton.constrainedNodes);
    const program = compileRig(def, skeleton);
    const driven = new Set(program.drivenNodes);
    const secondary = def.controls.filter((c) => c.group === 'secondary');
    expect(secondary.length).toBeGreaterThan(0);
    expect(springs.size).toBeGreaterThan(0);
    expect(constrained.size).toBeGreaterThan(0);
    for (const control of secondary) {
      expect(control.hiddenByDefault).toBe(true);
      expect(control.drives?.mode).toBe('rotate');
    }
    for (const node of driven) {
      expect(springs.has(node)).toBe(false);
      expect(constrained.has(node)).toBe(false);
    }
    // Every non-humanoid, non-spring, non-constrained skin joint below the hips has a control.
    const hips = skeleton.humanoid?.hips as number;
    const belowHips = (node: number): boolean => {
      for (let n = skeleton.nodes[node]?.parent ?? -1; n !== -1; n = skeleton.nodes[n]?.parent ?? -1) if (n === hips) return true;
      return false;
    };
    skeleton.nodes.forEach((node, i) => {
      if (!node.isJoint || humanoidNodes.has(i) || springs.has(i) || constrained.has(i) || !belowHips(i)) return;
      expect({ node: node.name, driven: driven.has(i) }).toEqual({ node: node.name, driven: true });
    });
    // Eyes are not rigged.
    expect(def.controls.some((c) => c.key.startsWith('fk.eye'))).toBe(false);
  });

  it('builds a 1:1 generic rig on UAL', async () => {
    const { skeleton } = await loadSkeleton('quaternius-ual.glb');
    const def = autoRig(skeleton, IDS);
    expect(def.rig.generator.name).toBe('ekza-autorig-generic');
    const joints = skeleton.nodes.filter((n) => n.isJoint).length;
    expect(def.controls).toHaveLength(joints);
    expect(def.controls.every((c) => c.drives?.mode === 'full')).toBe(true);
    expect(compileRig(def, skeleton).drivenNodes).toHaveLength(joints);
  });

  it('imports UAL Idle_Loop at 24 fps matching three GLTFLoader at every source key time', async () => {
    const { bytes, skeleton, raw } = await loadClip('quaternius-ual.glb', 'Idle_Loop');
    const fps = detectClipFps(raw) as Fps;
    expect(fps).toEqual({ num: 24, den: 1 });
    const program = rig(skeleton);
    const imported = importRawClip(raw, program, { fps, keyMode: 'source-times', eulerFilter: true, reduce: null });
    expect(imported.range).toEqual({ start: 0, end: 60 });
    const frames = [...new Set(imported.curves.flatMap((c) => c.keys.map((k) => k.t)))].sort((a, b) => a - b);
    expect(frames.every((f) => Number.isInteger(f) && f >= 0 && f <= 60)).toBe(true);

    const gltf = await loadGltfInNode(bytes);
    const clip = gltf.animations.find((a) => a.name === 'Idle_Loop');
    if (clip === undefined) throw new Error('three clip missing');
    const mixer = new AnimationMixer(gltf.scene);
    // Play once and hold the end: with the default LoopRepeat, t = duration wraps to the first frame.
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const pose = program.allocPose();
    let rotation = 0;
    let translation = 0;
    for (const frame of frames) {
      mixer.setTime(frame / 24);
      program.evaluate(channelsAt(program, imported, frame), pose);
      gltf.nodeByIndex.forEach((object, i) => {
        if (object === null || !skeleton.nodes[i]?.isJoint) return;
        const q = object.quaternion;
        rotation = Math.max(rotation, quatAngle(quatAt(pose.boneLocal, i * 10 + 3), [q.x, q.y, q.z, q.w]));
        translation = Math.max(
          translation,
          Math.abs((pose.boneLocal[i * 10] as number) - object.position.x),
          Math.abs((pose.boneLocal[i * 10 + 1] as number) - object.position.y),
          Math.abs((pose.boneLocal[i * 10 + 2] as number) - object.position.z),
        );
      });
    }
    expect(rotation).toBeLessThan(1e-5);
    expect(translation).toBeLessThan(1e-5);
  });

  it.skipIf(WP1_PENDING)('reduces UAL Idle_Loop ≥ 3× within tolerance (also needs WP-1 reduceKeys)', async () => {
    const { skeleton, raw } = await loadClip('quaternius-ual.glb', 'Idle_Loop');
    const program = rig(skeleton);
    const fps = detectClipFps(raw) as Fps;
    const dense = importRawClip(raw, program, { fps, keyMode: 'source-times', eulerFilter: true, reduce: null });
    const reduced = importRawClip(raw, program, { fps, keyMode: 'source-times', eulerFilter: true, reduce: DEFAULT_REDUCE });
    const big = reduced.curves.filter((c) => c.stats.sourceKeys >= 20);
    const before = big.reduce((sum, c) => sum + c.stats.sourceKeys, 0);
    const after = big.reduce((sum, c) => sum + c.keys.length, 0);
    expect(after * 3).toBeLessThanOrEqual(before);
    for (const curve of reduced.curves) {
      const original = dense.curves.find((c) => c.control === curve.control && c.channel === curve.channel);
      expect(original).toBeDefined();
      expect(curve.stats.maxReduceError).toBeLessThanOrEqual(
        curve.channel.startsWith('r') ? DEFAULT_REDUCE.rotationRad : curve.channel.startsWith('t') ? DEFAULT_REDUCE.translationM : DEFAULT_REDUCE.scale,
      );
    }
  });

  it('plants Polybot feet back on their pins after lowering the cog (1e-4)', async () => {
    const { skeleton } = await loadSkeleton('polybot.vrm');
    const program = rig(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    const footNode = (side: 'L' | 'R'): number => skeleton.humanoid?.[side === 'L' ? 'leftFoot' : 'rightFoot'] as number;
    const pins = (['L', 'R'] as const).map((side) => ({
      side,
      footWorld: pose.boneWorld.slice(footNode(side) * 16, footNode(side) * 16 + 16),
    }));
    const cog = program.controls.find((c) => c.key === 'cog')?.id as ControlId;
    writeControlChannels(program, ch, cog, { ty: -0.05 });
    program.evaluate(ch, pose);
    const reference = new Map(program.controlIds.map((control) => [control, readControlChannels(program, ch, control)]));
    const result = plantFeetChannels(program, pose, pins, reference);
    expect(result.reached).toBe(true);
    for (const [control, values] of result.values) writeControlChannels(program, ch, control, values);
    program.evaluate(ch, pose);
    for (const pin of pins) {
      const node = footNode(pin.side);
      const world = mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16));
      const target = mat4Decompose(pin.footWorld);
      const offset: Vec3 = [world.t[0] - target.t[0], world.t[1] - target.t[1], world.t[2] - target.t[2]];
      expect(Math.hypot(...offset)).toBeLessThan(1e-4);
      expect(quatAngle(world.q, target.q)).toBeLessThan(1e-4);
    }
  });

  it('reports the evaluation time of Seed-san (budget 0.5 ms)', async ({ annotate }) => {
    const { skeleton } = await loadSkeleton('seed-san.vrm');
    const program = rig(skeleton);
    const ch = program.allocChannels();
    for (let i = 0; i < ch.values.length; i++) if (i % 9 >= 3 && i % 9 < 6) ch.values[i] = Math.sin(i) * 0.3;
    const pose = program.allocPose();
    for (let i = 0; i < 100; i++) program.evaluate(ch, pose);
    const runs = 1000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) program.evaluate(ch, pose);
    const ms = (performance.now() - start) / runs;
    await annotate(`Seed-san evaluate: ${ms.toFixed(4)} ms/pose (${program.controls.length} controls, ${program.nodeCount} nodes)`);
    expect(pose.version).toBe(runs + 100);
  });
});

export type { HumanBoneName };
