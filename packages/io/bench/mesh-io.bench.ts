// B8 benches (M6A-SPEC §5.27, report only): Make editable from a GLB ≤ 150 ms, export of one edited mesh (the
// surgeon's geometry step) ≤ 50 ms, the display rebuild of an edited Seed-san ≤ 300 ms (rebuild + three.js load in
// Node, standing in for the browser's ModelLoader). Run: npx vitest bench --run (in packages/io).
import { readFixture } from '@ekza-animator/doc/testing';
import { setKernelDebug } from '@ekza-animator/mesh-core';
import { bench, describe } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { meshFromGltf } from '../src/mesh';
import { rebuildContainer, replacePrimitives } from '../src/surgeon/replacePrimitives';
import { loadGltfInNode } from '../src/testing';
import type { PrimitiveEdit } from '../src/types';
import { splitFaces } from '../test/helpers/mesh';

setKernelDebug(false);

const polybot = await parseGlb(readFixture('polybot.vrm'));
const seed = await parseGlb(readFixture('seed-san.vrm'));

async function edit(container: typeof polybot, meshIndex: number): Promise<PrimitiveEdit> {
  const made = await meshFromGltf(container, meshIndex);
  if ('refused' in made) throw new Error(made.reason);
  return {
    meshIndex,
    data: splitFaces(
      made.data,
      Array.from({ length: 50 }, (_, f) => f),
    ),
    morphNormals: new Set(made.report.morphNormals),
    hadTangents: false,
    dropTangents: false,
  };
}

const polybotEdit = await edit(polybot, 0);
const seedEdit = await edit(seed, 2);
let sink = 0;

describe('Make editable (budget 150 ms)', () => {
  bench('Polybot body (2,130 triangles, 16 targets)', async () => {
    const made = await meshFromGltf(polybot, 0);
    sink += 'refused' in made ? 0 : made.data.counts.faces;
  });
  bench('Seed-san head (10,550 triangles, 43 targets)', async () => {
    const made = await meshFromGltf(seed, 2);
    sink += 'refused' in made ? 0 : made.data.counts.faces;
  });
});

describe('export one edited mesh (budget 50 ms)', () => {
  bench('Polybot body: meshToPrimitives + replace primitives', async () => {
    sink += (await replacePrimitives(polybot.bytes, [polybotEdit], { marker: true })).length;
  });
});

describe('display rebuild (budget 300 ms)', () => {
  bench('Seed-san head: rebuildContainer + three.js load', async () => {
    const rebuilt = await rebuildContainer(seed, [seedEdit]);
    const loaded = await loadGltfInNode(rebuilt.bytes);
    sink += loaded.nodeByIndex.length;
  });
});

export { sink };
