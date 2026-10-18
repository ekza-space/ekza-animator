// E2E-18 (MVP-SPEC §6.2): UAL with `Idle_Loop` exported as an animation-only GLB. The file validates with 0 errors,
// has no meshes or skins, keeps the source's node names (and their parents), and its raw locals re-read in Node with
// io's `readAnimations` equal, at frame 10, the locals the editor's `boneWorld` gives (`W_parent⁻¹ · W_node`).
import { parseGlb, readAnimations, skeletonFromGltf } from '@ekza-animator/io';
import { expect, test } from '@playwright/test';
import {
  boneWorldRotations,
  exportOne,
  parentsOf,
  qangle,
  qinv,
  qmul,
  readGlb,
  sampleBytes,
  sampleRotation,
  validatorErrors,
} from './helpers/g4-export';
import { seedSample } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor } from './helpers/test-api';

const FRAME = 10;

test('E2E-18: export, animation-only GLB', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await fixmeIfKernelUnavailable(page);
  const { character } = await seedSample(page, 'quaternius-ual');
  const idle = (await call(page, 'clips', character)).find((clip) => clip.name === 'Idle_Loop');
  if (idle === undefined) throw new Error('UAL was seeded without Idle_Loop');

  const exported = await exportOne(page, { kind: 'animation-glb', character, clips: [idle.id] });
  expect(exported.name).toMatch(/\.glb$/);
  expect(await validatorErrors(exported.bytes)).toEqual([]);

  const { json } = readGlb(exported.bytes);
  expect(json.meshes ?? []).toEqual([]);
  expect(json.skins ?? []).toEqual([]);
  expect((json.animations ?? []).map((animation) => animation.name)).toEqual(['Idle_Loop']);

  // Node names match the source: every written node is a source node with the same name and the same parent.
  const source = readGlb(sampleBytes('quaternius-ual.glb')).json;
  const sourceNames = (source.nodes ?? []).map((node) => node.name ?? '');
  const sourceParents = parentsOf(source);
  const parentNameIn = (names: readonly string[], parents: readonly number[], index: number) =>
    (parents[index] ?? -1) === -1 ? null : names[parents[index] as number];
  const names = (json.nodes ?? []).map((node) => node.name ?? '');
  const parents = parentsOf(json);
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names).size).toBe(names.length);
  for (const [index, name] of names.entries()) {
    const at = sourceNames.indexOf(name);
    expect(at, `node '${name}' is a source node`).toBeGreaterThanOrEqual(0);
    expect(parentNameIn(names, parents, index), `parent of '${name}'`).toBe(
      parentNameIn(sourceNames, sourceParents, at),
    );
  }

  // Re-read in Node: raw rotation locals at frame 10 against the editor's boneWorld-derived locals.
  const container = await parseGlb(exported.bytes);
  const skeleton = skeletonFromGltf(container);
  const clip = readAnimations(container, skeleton).find((candidate) => candidate.name === 'Idle_Loop');
  if (clip === undefined) throw new Error('readAnimations found no Idle_Loop');
  const rotations = clip.channels.filter((channel) => channel.path === 'rotation');
  expect(rotations.length).toBeGreaterThan(40);
  const pairs = rotations.map((channel) => {
    const node = skeleton.nodes[channel.node];
    const parent = node === undefined ? undefined : skeleton.nodes[node.parent];
    if (node === undefined || parent === undefined) throw new Error(`rotation channel on a root node ${channel.node}`);
    return { channel, node: node.name, parent: parent.name };
  });
  const [worlds] = await boneWorldRotations(
    page,
    character,
    [...new Set(pairs.flatMap((pair) => [pair.node, pair.parent]))],
    [FRAME],
  );
  if (worlds === undefined) throw new Error('no bone worlds');
  const time = (FRAME - idle.start) / idle.fps;
  let maxError = 0;
  let worst = '';
  let moving = 0;
  for (const { channel, node, parent } of pairs) {
    const editorLocal = qmul(qinv(worlds[parent] ?? [0, 0, 0, 1]), worlds[node] ?? [0, 0, 0, 1]);
    const fileLocal = sampleRotation(channel.interpolation, channel.times, channel.values, time);
    const error = qangle(fileLocal, editorLocal);
    if (error > maxError) [maxError, worst] = [error, node];
    if (channel.times.length > 2) moving++;
  }
  test.info().annotations.push({
    type: 'animation-glb',
    description: `${pairs.length} rotation tracks (${moving} animated) at frame ${FRAME}: max error ${maxError.toExponential(2)} rad (${worst})`,
  });
  expect(moving, 'animated rotation tracks').toBeGreaterThan(10);
  expect(maxError, `max local rotation error (${worst})`).toBeLessThan(1e-4);
});
