// M6A-SPEC §5.21 (B8): Make editable — licence gate, size and compression refusals, the morph- and skin-aware weld,
// per-corner layers, hard-edge recovery, degenerate triangles, strips and fans, and the real fixtures (Polybot,
// Seed-san, UAL) giving valid, deterministic meshes.
import { readFixture } from '@ekza-studio/doc/testing';
import {
  EDGE_HARD,
  parseManifest,
  readRevision,
  setKernelDebug,
  topologyStats,
  validateMesh,
  writeRevision,
} from '@ekza-studio/mesh-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { editLicence, meshFacts, meshFromGltf } from '../src/mesh';
import type { MakeEditableResult } from '../src/mesh';
import type { GlbContainer } from '../src/types';
import { quadWithSeam, syntheticContainer } from './helpers/mesh';

beforeAll(() => setKernelDebug(true));

type Made = Exclude<MakeEditableResult, { refused: true }>;

function made(result: MakeEditableResult): Made {
  if ('refused' in result) throw new Error(`refused (${result.code}): ${result.reason}`);
  return result;
}

const fixtures = new Map<string, Promise<GlbContainer>>();
const fixture = (name: 'polybot.vrm' | 'seed-san.vrm' | 'quaternius-ual.glb' | 'quaternius-idle-meshopt.glb') => {
  let container = fixtures.get(name);
  if (container === undefined) {
    container = parseGlb(readFixture(name));
    fixtures.set(name, container);
  }
  return container;
};

describe('meshFromGltf: weld, layers and hard edges', () => {
  it('welds a UV seam into shared points and keeps the corner UVs', async () => {
    const result = made(await meshFromGltf(await syntheticContainer({ primitives: [quadWithSeam()] }), 0));
    expect(result.data.counts).toEqual({ points: 4, edges: 5, faces: 2, corners: 6 });
    expect(validateMesh(result.data)).toEqual([]);
    expect(result.report).toMatchObject({ triangles: 2, pointsBefore: 6, pointsAfter: 4, degenerateDropped: 0 });
    expect(result.report.layers).toEqual(['uv0', 'normal.custom']);
    const uv = result.data.layers.get('uv0')?.data as Float32Array;
    // Corner 3 is the second triangle's first corner (glTF vertex 3, UV 0.5/0.5): the seam survives per corner.
    expect([uv[6], uv[7]]).toEqual([0.5, 0.5]);
    // Same normals on both sides: no hard edge.
    expect(result.report.hardEdges).toBe(0);
    expect([...result.data.edgeFlags].every((flags) => (flags & EDGE_HARD) === 0)).toBe(true);
  });

  it('welds −0 with +0 (a centre-line vertex written as −0), in positions, weights and morph deltas', async () => {
    // quadWithSeam's v3 duplicates v0 at the origin: written as (−0, 0, −0) it still welds to v0.
    const seam = quadWithSeam();
    const positions = [...seam.positions];
    positions[9] = -0;
    positions[11] = -0;
    expect(Object.is(new Float32Array(positions)[9], -0)).toBe(true);
    const delta = Array.from({ length: 18 }, () => 0);
    delta[9] = -0;
    const weights = Array.from({ length: 6 }, () => [1, 0, 0, 0]).flat();
    weights[13] = -0;
    const result = made(
      await meshFromGltf(
        await syntheticContainer({
          primitives: [
            {
              ...seam,
              positions,
              joints: Array.from({ length: 24 }, () => 0),
              weights,
              targets: [{ position: delta }],
            },
          ],
          targetNames: ['smile'],
          skinned: true,
        }),
        0,
      ),
    );
    expect(result.data.counts).toEqual({ points: 4, edges: 5, faces: 2, corners: 6 });
    expect(validateMesh(result.data)).toEqual([]);
    expect(topologyStats(result.data).shells).toBe(1);
    // Other bits still decide: a vertex at +1e-30 next to +0 stays its own point.
    const apart = [...seam.positions];
    apart[9] = 1e-30;
    const split = made(
      await meshFromGltf(await syntheticContainer({ primitives: [{ ...seam, positions: apart }] }), 0),
    );
    expect(split.data.counts.points).toBe(5);
  });

  it('recovers a hard edge where the faces disagree on a corner normal', async () => {
    const result = made(
      await meshFromGltf(await syntheticContainer({ primitives: [quadWithSeam({ hardDiagonal: true })] }), 0),
    );
    expect(result.report.hardEdges).toBe(1);
    const hard = [...result.data.edgeFlags].map((flags, e) => [flags & EDGE_HARD, e]).filter(([f]) => f !== 0);
    expect(hard).toHaveLength(1);
    const e = (hard[0] as number[])[1] as number;
    const ends = [result.data.edgeVerts[2 * e] as number, result.data.edgeVerts[2 * e + 1] as number].sort(
      (a, b) => a - b,
    );
    // The diagonal joins point 0 (0,0) and point 2 (1,1).
    expect(ends).toEqual([0, 2]);
  });

  it('treats a primitive without NORMAL as flat: every edge hard, no custom normals', async () => {
    const quad = quadWithSeam();
    const result = made(
      await meshFromGltf(
        await syntheticContainer({ primitives: [{ positions: quad.positions, indices: quad.indices ?? [] }] }),
        0,
      ),
    );
    expect(result.report.hardEdges).toBe(result.data.counts.edges);
    expect(result.data.layers.has('normal.custom')).toBe(false);
  });

  it('keeps coincident vertices apart when a morph target separates them (lips, eyelids)', async () => {
    // Two triangles touching at x = 1 with duplicated vertices: identical positions, but the target opens the gap.
    const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 2, 0, 0, 1, 1, 0];
    const openDelta = [0, 0, 0, -0.1, 0, 0, -0.1, 0, 0, 0.1, 0, 0, 0, 0, 0, 0.1, 0, 0];
    const still = Array.from({ length: 18 }, () => 0);
    const closed = made(
      await meshFromGltf(
        await syntheticContainer({
          primitives: [{ positions, indices: [0, 1, 2, 3, 4, 5], targets: [{ position: still }] }],
        }),
        0,
      ),
    );
    expect(closed.data.counts.points).toBe(4);
    const open = made(
      await meshFromGltf(
        await syntheticContainer({
          primitives: [{ positions, indices: [0, 1, 2, 3, 4, 5], targets: [{ position: openDelta }] }],
          targetNames: ['mouth_open'],
        }),
        0,
      ),
    );
    expect(open.data.counts.points).toBe(6);
    expect(open.report.layers).toEqual(['morph:mouth_open']);
    expect(validateMesh(open.data)).toEqual([]);
    expect(topologyStats(open.data).shells).toBe(2);
  });

  it('keeps vertices with different skin weights apart and stores the joint palette with parents', async () => {
    const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 2, 0, 0, 1, 1, 0];
    const joints = Array.from({ length: 24 }, () => 0);
    const sameWeights = Array.from({ length: 6 }, () => [1, 0, 0, 0]).flat();
    const splitWeights = [...sameWeights.slice(0, 12), 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0];
    const weld = async (weights: number[]) =>
      made(
        await meshFromGltf(
          await syntheticContainer({
            skinned: true,
            primitives: [{ positions, indices: [0, 1, 2, 3, 4, 5], joints, weights }],
          }),
          0,
        ),
      );
    expect((await weld(sameWeights)).data.counts.points).toBe(4);
    const split = await weld(splitWeights);
    expect(split.data.counts.points).toBe(6);
    const skin = split.data.layers.get('skin.joints');
    expect(skin?.def.meta).toEqual({
      skin: 0,
      joints: [
        { id: 'node:1', name: 'Root', parent: -1 },
        { id: 'node:2', name: 'Child', parent: 0 },
      ],
    });
    expect(split.report.layers).toEqual(['skin.joints', 'skin.weights']);
  });

  it('drops and counts triangles with fewer than three distinct points', async () => {
    const quad = quadWithSeam();
    const result = made(
      await meshFromGltf(
        await syntheticContainer({ primitives: [{ ...quad, indices: [0, 1, 2, 3, 4, 5, 0, 3, 1] }] }),
        0,
      ),
    );
    expect(result.report.degenerateDropped).toBe(1);
    expect(result.report.triangles).toBe(2);
    expect(result.report.warnings.join(' ')).toMatch(/1 degenerate triangle was dropped/);
  });

  it('reads strips and fans as triangle lists', async () => {
    const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const strip = made(
      await meshFromGltf(
        await syntheticContainer({ primitives: [{ positions: square, indices: [0, 1, 3, 2], mode: 5 }] }),
        0,
      ),
    );
    const fan = made(
      await meshFromGltf(
        await syntheticContainer({ primitives: [{ positions: square, indices: [0, 1, 2, 3], mode: 6 }] }),
        0,
      ),
    );
    for (const mesh of [strip, fan]) {
      expect(mesh.data.counts).toEqual({ points: 4, edges: 5, faces: 2, corners: 6 });
      expect(validateMesh(mesh.data)).toEqual([]);
      expect(topologyStats(mesh.data).nonManifoldEdges).toBe(0);
    }
  });

  it('concatenates primitives: the face material is the primitive index, slots name the glTF materials', async () => {
    const quad = quadWithSeam();
    const result = made(
      await meshFromGltf(
        await syntheticContainer({
          materials: 2,
          primitives: [
            { ...quad, material: 1 },
            { ...quad, positions: quad.positions.map((v, i) => (i % 3 === 2 ? 1 : v)) },
          ],
        }),
        0,
      ),
    );
    expect([...result.data.faceMaterial]).toEqual([0, 0, 1, 1]);
    const container = await syntheticContainer({ primitives: [quad] });
    expect(result.slots.map((slot) => slot.material)).toEqual([1, 2]);
    expect(result.slots.every((slot) => slot.asset.length === 64)).toBe(true);
    expect(container.sha256).toHaveLength(64);
  });

  it('expands VEC3 colours to linear RGBA and reports tangents', async () => {
    const quad = quadWithSeam();
    const result = made(
      await meshFromGltf(
        await syntheticContainer({
          primitives: [{ ...quad, colors: Array.from({ length: 18 }, () => 0.5), colorType: 'VEC3', tangents: true }],
        }),
        0,
      ),
    );
    const color = result.data.layers.get('color0')?.data as Float32Array;
    expect([...color.subarray(0, 4)]).toEqual([0.5, 0.5, 0.5, 1]);
    expect(result.report.hadTangents).toBe(true);
    expect(result.report.warnings.join(' ')).toMatch(/Tangents will be refused at export/);
  });
});

describe('meshFromGltf: refusals', () => {
  const vrm1 = (modification: string) => ({
    extensions: { VRMC_vrm: { specVersion: '1.0', meta: { name: 'x', authors: ['a'], modification } } },
    extensionsUsed: ['VRMC_vrm'],
  });

  it('refuses a VRM 1.0 whose meta forbids modification, with a reason naming it', async () => {
    const container = await syntheticContainer({ primitives: [quadWithSeam()], ...vrm1('prohibited') });
    const licence = editLicence(container);
    expect(licence.ok).toBe(false);
    const result = await meshFromGltf(container, 0);
    expect(result).toMatchObject({ refused: true, code: 'licence' });
    expect((result as { reason: string }).reason).toMatch(/modification/);
    const allowed = await syntheticContainer({ primitives: [quadWithSeam()], ...vrm1('allowModification') });
    expect(editLicence(allowed)).toEqual({ ok: true });
  });

  it('refuses a VRM 0.x with a no-derivatives licence and allows CC0 (Polybot)', async () => {
    const vrm0 = (licenseName: string) =>
      syntheticContainer({
        primitives: [quadWithSeam()],
        extensions: { VRM: { meta: { title: 't', licenseName } } },
        extensionsUsed: ['VRM'],
      });
    const nd = editLicence(await vrm0('CC_BY_ND'));
    expect(nd.ok).toBe(false);
    expect((nd as { reason: string }).reason).toMatch(/CC_BY_ND.*modification/);
    expect(editLicence(await vrm0('CC_BY'))).toEqual({ ok: true });
    expect(editLicence(await fixture('polybot.vrm'))).toEqual({ ok: true });
    expect(editLicence(await fixture('seed-san.vrm'))).toEqual({ ok: true });
  });

  it('refuses meshes above the triangle limit, points and lines, a missing mesh and compressed data', async () => {
    const quad = await syntheticContainer({ primitives: [quadWithSeam()] });
    expect(await meshFromGltf(quad, 0, { maxTriangles: 1 })).toMatchObject({ refused: true, code: 'too-large' });
    expect(await meshFromGltf(quad, 3)).toMatchObject({ refused: true, code: 'unsupported' });
    const lines = await syntheticContainer({ primitives: [{ positions: [0, 0, 0, 1, 0, 0], mode: 1 }] });
    expect(await meshFromGltf(lines, 0)).toMatchObject({ refused: true, code: 'unsupported' });
    const meshopt = await fixture('quaternius-idle-meshopt.glb');
    const refused = await meshFromGltf(meshopt, 0);
    expect(refused).toMatchObject({ refused: true, code: 'compressed' });
    expect((refused as { reason: string }).reason).toMatch(/decoder/);
  });

  it('decodes compressed meshes through the injected decoder', async () => {
    const meshopt = await fixture('quaternius-idle-meshopt.glb');
    const plain = await fixture('quaternius-ual.glb');
    // A stand-in decoder: the uncompressed source of the same mesh.
    const result = made(await meshFromGltf(meshopt, 0, { decode: () => Promise.resolve(plain) }));
    expect(result.data.counts.faces).toBeGreaterThan(0);
    expect(result.slots[0]?.asset).toBe(meshopt.sha256);
  });
});

describe('meshFromGltf: fixtures', () => {
  it('Polybot body: valid, skinned, 16 morph targets with normals, deterministic', async () => {
    const polybot = await fixture('polybot.vrm');
    const result = made(await meshFromGltf(polybot, 0));
    expect(validateMesh(result.data)).toEqual([]);
    expect(result.report.pointsBefore).toBe(1722);
    expect(result.report.pointsAfter).toBeLessThan(1722);
    expect(result.report.triangles + result.report.degenerateDropped).toBe(2130);
    expect(result.report.morphNormals).toHaveLength(16);
    expect(result.report.layers.slice(0, 4)).toEqual(['uv0', 'normal.custom', 'skin.joints', 'skin.weights']);
    expect(result.report.layers.filter((name) => name.startsWith('morph:'))).toHaveLength(16);
    expect(result.report.layers).toContain('morph:blendShape1.vrc_v_th');
    expect(result.report.hadTangents).toBe(false);
    expect(result.slots).toEqual([{ asset: polybot.sha256, material: 0 }]);
    const again = made(await meshFromGltf(polybot, 0));
    expect(writeRevision(again.data).manifestId).toBe(writeRevision(result.data).manifestId);
    // The revision codec keeps every layer, the skin palette meta included.
    const out = writeRevision(result.data);
    const chunks = new Map(out.newChunks);
    const read = readRevision(parseManifest(out.manifestBytes), (id) => chunks.get(id) as Uint8Array);
    expect(read.counts).toEqual(result.data.counts);
    expect(read.layers.get('skin.joints')?.def.meta).toEqual(result.data.layers.get('skin.joints')?.def.meta);
  });

  it('Seed-san head: three primitives as three slots, 43 targets, NORMAL deltas where any primitive has them', async () => {
    const seed = await fixture('seed-san.vrm');
    const result = made(await meshFromGltf(seed, 2));
    expect(validateMesh(result.data)).toEqual([]);
    expect(new Set(result.data.faceMaterial)).toEqual(new Set([0, 1, 2]));
    expect(result.slots.map((slot) => slot.material)).toEqual([2, 3, 4]);
    expect(result.report.layers.filter((name) => name.startsWith('morph:'))).toHaveLength(43);
    const head = (
      seed.json['meshes'] as { extras: { targetNames: string[] }; primitives: { targets: object[] }[] }[]
    )[2];
    const withNormals = head?.extras.targetNames.filter((_, t) =>
      head.primitives.some((p) => 'NORMAL' in (p.targets[t] as object)),
    );
    expect(withNormals?.length).toBeGreaterThan(0);
    expect(withNormals?.length).toBeLessThan(43);
    expect(result.report.morphNormals).toEqual(withNormals);
    expect(result.report.layers).toContain('morph:blink_L');
  });

  it('UAL mannequin: two UV sets, unsigned short indices', async () => {
    const ual = await fixture('quaternius-ual.glb');
    const result = made(await meshFromGltf(ual, 0));
    expect(validateMesh(result.data)).toEqual([]);
    expect(result.report.layers).toEqual(['uv0', 'uv1', 'normal.custom', 'skin.joints', 'skin.weights']);
    expect(result.report.triangles + result.report.degenerateDropped).toBe(5731 + 8012);
  });
});

describe('meshFacts', () => {
  it('names the targets with NORMAL deltas and reports tangents like Make editable', async () => {
    const polybot = await fixture('polybot.vrm');
    const made = await meshFromGltf(polybot, 0);
    if ('refused' in made) throw new Error(made.reason);
    expect(meshFacts(polybot, 0)).toEqual({ morphNormals: made.report.morphNormals, hadTangents: false });
    const seed = await fixture('seed-san.vrm');
    const head = await meshFromGltf(seed, 2);
    if ('refused' in head) throw new Error(head.reason);
    expect(meshFacts(seed, 2).morphNormals).toEqual(head.report.morphNormals);
    expect(meshFacts(seed, 99)).toEqual({ morphNormals: [], hadTangents: false });
  });
});
