import { parseGlb, readAnimations, skeletonFromGltf } from '@ekza-animator/io';
import { expect, test } from '@playwright/test';
import {
  boneWorldRotations,
  exportOne,
  flipYaw,
  humanLocalFromWorlds,
  qangle,
  qinv,
  qmul,
  readGlb,
  sampleBytes,
  sampleRotation,
  validatorErrors,
} from './helpers/g4-export';
import { controlIdOf, gateOnA1, playVrma } from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-07 (M2A-SPEC §9.1, §5.8 export): a crouch with the hips lowered and the left IK foot moved bakes through
// the rig like FK: the animation GLB and the VRMA validate, the GLB's raw leg locals at frame 10 equal the editor's
// boneWorld-derived locals (E2E-18 method), and three-vrm-animation plays the VRMA with the editor's normalized
// rotations (E2E-17 method).
const LEG_BONES = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
const FRAME = 10;
const CHECK_FRAMES = [0, 5, 10, 15, 20] as const;

test('E2E-M2A-07: export bakes IK', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await gateOnA1(page);
  const restClip = (await call(page, 'state')).activeClip ?? '';
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'crouch' });
  const cog = await controlIdOf(page, 'cog');
  const ikLeg = await controlIdOf(page, 'ik.leg.L');
  for (const [frame, ty, tx] of [
    [0, 0, 0],
    [10, -0.1, 0.05],
    [20, 0, 0],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', {
      edits: [
        { control: cog, channel: 'ty', value: ty },
        { control: ikLeg, channel: 'tx', value: tx },
      ],
      key: 'force',
    });
  }

  const glb = await exportOne(page, { kind: 'animation-glb', character, clips: [clip] });
  expect(await validatorErrors(glb.bytes)).toEqual([]);
  const vrma = await exportOne(page, { kind: 'vrma', character, clips: [clip] });
  expect(await validatorErrors(vrma.bytes)).toEqual([]);

  // E2E-18 method on the leg bones: raw locals at frame 10 against W_parent⁻¹ · W_node from boneWorld.
  const container = await parseGlb(glb.bytes);
  const skeleton = skeletonFromGltf(container);
  const animation = readAnimations(container, skeleton)[0];
  if (animation === undefined) throw new Error('the GLB has no animation');
  const crouch = (await call(page, 'clips', character)).find((candidate) => candidate.id === clip);
  const time = (FRAME - (crouch?.start ?? 0)) / (crouch?.fps ?? 30);
  // The animation-only GLB keeps the source's node names but has no humanoid map: name the leg nodes from the VRM.
  const source = readGlb(sampleBytes('seed-san.vrm')).json;
  const humanBones =
    (source.extensions?.['VRMC_vrm'] as { humanoid?: { humanBones?: Record<string, { node?: number }> } } | undefined)
      ?.humanoid?.humanBones ?? {};
  const pairs = LEG_BONES.flatMap((bone) => {
    const sourceNode = humanBones[bone]?.node;
    const sourceName = sourceNode === undefined ? undefined : source.nodes?.[sourceNode]?.name;
    const found = sourceName === undefined ? -1 : skeleton.nodes.findIndex((n) => n.name === sourceName);
    const node = found === -1 ? undefined : found;
    const channel = animation.channels.find((candidate) => candidate.node === node && candidate.path === 'rotation');
    const parent = node === undefined ? undefined : skeleton.nodes[skeleton.nodes[node]?.parent ?? -1];
    const name = node === undefined ? undefined : skeleton.nodes[node]?.name;
    return channel === undefined || parent === undefined || name === undefined
      ? []
      : [{ channel, name, parent: parent.name }];
  });
  expect(pairs.length).toBe(LEG_BONES.length);
  const [worlds] = await boneWorldRotations(
    page,
    character,
    [...new Set(pairs.flatMap((p) => [p.name, p.parent]))],
    [FRAME],
  );
  if (worlds === undefined) throw new Error('no bone worlds');
  for (const { channel, name, parent } of pairs) {
    const editorLocal = qmul(qinv(worlds[parent] ?? [0, 0, 0, 1]), worlds[name] ?? [0, 0, 0, 1]);
    const fileLocal = sampleRotation(channel.interpolation, channel.times, channel.values, time);
    expect(qangle(fileLocal, editorLocal), `${name} local at frame ${FRAME}`).toBeLessThan(1e-4);
  }

  // E2E-17 method: normalized rotations (rest = the empty default clip) against three-vrm-animation's playback.
  const vrm = readGlb(sampleBytes('seed-san.vrm')).json.extensions?.['VRMC_vrm'] as
    | { humanoid: { humanBones: Record<string, unknown> } }
    | undefined;
  const bones = Object.keys(vrm?.humanoid.humanBones ?? {});
  const at = await boneWorldRotations(page, character, bones, CHECK_FRAMES);
  await runOk(page, 'clip.setActive', { clip: restClip });
  const [rest] = await boneWorldRotations(page, character, bones, [0]);
  await runOk(page, 'clip.setActive', { clip });
  if (rest === undefined) throw new Error('no rest worlds');
  const reference = at.map((world) => humanLocalFromWorlds(world, rest));
  const played = await playVrma(
    page,
    vrma.bytes,
    CHECK_FRAMES.map((frame) => frame / (crouch?.fps ?? 30)),
  );
  const vrmaBones = Object.keys(
    (readGlb(vrma.bytes).json.extensions?.['VRMC_vrm_animation'] as { humanoid?: { humanBones?: object } } | undefined)
      ?.humanoid?.humanBones ?? {},
  );
  for (const [model, result] of Object.entries(played)) {
    const shared = vrmaBones.filter((bone) => result.bones.includes(bone));
    let maxError = 0;
    let worst = '';
    result.samples.forEach((sample, i) => {
      for (const bone of shared) {
        const n = reference[i]?.[bone];
        const got = sample.rotations[bone];
        if (n === undefined || got === undefined) continue;
        const error = qangle(got, result.metaVersion === '0' ? flipYaw(n) : n);
        if (error > maxError) [maxError, worst] = [error, `${bone} at frame ${CHECK_FRAMES[i]}`];
      }
    });
    expect(maxError, `${model}: max error at ${worst}`).toBeLessThan(1e-3);
  }
});
