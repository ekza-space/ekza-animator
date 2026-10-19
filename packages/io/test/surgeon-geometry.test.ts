// M6A-SPEC §5.22 (B8): the surgeon's "replace primitives" step and bake marker v2 on the three fixtures — untouched
// JSON values and the BIN prefix byte-identical, validator without new errors, morph NORMAL kept, new vertices
// normalized, the extension diffs, the rebuild for display, rollback and re-bake with geometry and clips together,
// and animation-only bakes unchanged (v1 bytes).
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import type { MeshData } from '@ekza-animator/mesh-core';
import { setKernelDebug } from '@ekza-animator/mesh-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { GltfReader } from '../src/gltf/accessor';
import { jsonEqual } from '../src/gltf/json';
import { meshFromGltf } from '../src/mesh';
import { skeletonFromGltf } from '../src/skeleton/read';
import { bakeIntoModel, preexistingTracks } from '../src/surgeon/bakeIntoModel';
import { BAKE_MARKER_KEY, BAKE_MARKER_V2_KEY } from '../src/surgeon/marker';
import { rebuildContainer, replacePrimitives } from '../src/surgeon/replacePrimitives';
import { loadGltfInNode } from '../src/testing';
import type { BakedClip, EkzaBakeMarkerV2, GlbContainer, PrimitiveEdit } from '../src/types';
import { compareValidation, validateGltf } from '../src/validate/validate';
import { splitFaces, syntheticContainer } from './helpers/mesh';
import { metaOf, rawClip } from './helpers/poses';

beforeAll(() => setKernelDebug(true));

type Json = Record<string, unknown>;

const containers = new Map<string, Promise<GlbContainer>>();
const load = (name: LicensedFixture): Promise<GlbContainer> => {
  let container = containers.get(name);
  if (container === undefined) {
    container = parseGlb(readFixture(name));
    containers.set(name, container);
  }
  return container;
};

/** Make editable, then split the first `n` faces at their centroids (a topology edit with new vertices). */
async function editOf(
  container: GlbContainer,
  meshIndex: number,
  n = 40,
): Promise<{ data: MeshData; edit: PrimitiveEdit }> {
  const made = await meshFromGltf(container, meshIndex);
  if ('refused' in made) throw new Error(made.reason);
  const data = splitFaces(
    made.data,
    Array.from({ length: Math.min(n, made.data.counts.faces) }, (_, f) => f),
  );
  return {
    data,
    edit: {
      meshIndex,
      data,
      morphNormals: new Set(made.report.morphNormals),
      hadTangents: made.report.hadTangents,
      dropTangents: false,
    },
  };
}

/** JSON of a GLB's chunk (parsed) and its BIN. */
async function glb(bytes: Uint8Array): Promise<GlbContainer> {
  return parseGlb(bytes);
}

/**
 * Every JSON value of `source` survives in `out` except the allowed diffs (§5.22, E2E-MOD-12): the edited meshes'
 * `primitives`, appended accessors/bufferViews (their prefixes stay), buffers[0].byteLength, asset.extras (marker),
 * the extension lists, and `animations`/`asset.generator` when clips are baked.
 */
function preservationProblems(
  source: GlbContainer,
  out: GlbContainer,
  opts: { readonly meshes: readonly number[]; readonly clips?: boolean },
): string[] {
  const before = source.json as Json;
  const after = out.json as Json;
  const problems: string[] = [];
  for (const [key, value] of Object.entries(before)) {
    if (key === 'extensionsUsed' || key === 'extensionsRequired') continue;
    if (key === 'animations' && opts.clips === true) continue;
    if (key === 'asset') {
      const { extras: _a, generator: _g, ...restBefore } = value as Json;
      const { extras: _b, generator: _h, ...restAfter } = after[key] as Json;
      if (!jsonEqual(restBefore, restAfter)) problems.push('asset');
      if (opts.clips !== true && !jsonEqual((value as Json)['generator'], (after[key] as Json)['generator'])) {
        problems.push('asset.generator');
      }
      continue;
    }
    if (key === 'buffers') {
      const [b0, ...others] = value as Json[];
      const [a0, ...othersAfter] = after[key] as Json[];
      const { byteLength: _x, ...b0rest } = b0 ?? {};
      const { byteLength: _y, ...a0rest } = a0 ?? {};
      if (!jsonEqual(b0rest, a0rest) || !jsonEqual(others, othersAfter)) problems.push('buffers');
      continue;
    }
    if (key === 'meshes') {
      (value as Json[]).forEach((mesh, i) => {
        const other = (after[key] as Json[])[i] as Json;
        if (opts.meshes.includes(i)) {
          const { primitives: _p, ...rest } = mesh;
          const { primitives: _q, ...restAfter } = other;
          if (!jsonEqual(rest, restAfter)) problems.push(`meshes[${i}] (outside primitives)`);
        } else if (!jsonEqual(mesh, other)) {
          problems.push(`meshes[${i}]`);
        }
      });
      continue;
    }
    if (Array.isArray(value)) {
      const list = after[key] as unknown[];
      value.forEach((entry, i) => {
        if (!jsonEqual(entry, list[i])) problems.push(`${key}[${i}]`);
      });
      continue;
    }
    if (!jsonEqual(value, after[key])) problems.push(key);
  }
  return problems;
}

function binPrefixEqual(source: GlbContainer, out: GlbContainer): boolean {
  const length = ((source.json['buffers'] as Json[])[0]?.['byteLength'] as number) ?? 0;
  const a = source.bin?.subarray(0, length) ?? new Uint8Array(0);
  const b = out.bin?.subarray(0, length) ?? new Uint8Array(0);
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

async function newErrors(source: GlbContainer, out: GlbContainer): Promise<readonly unknown[]> {
  return compareValidation(await validateGltf(source.bytes), await validateGltf(out.bytes));
}

const markerV2 = (c: GlbContainer): EkzaBakeMarkerV2 | undefined =>
  (c.json.asset.extras as Record<string, EkzaBakeMarkerV2> | undefined)?.[BAKE_MARKER_V2_KEY];

describe('replacePrimitives on the fixtures', () => {
  for (const [name, mesh] of [
    ['polybot.vrm', 0],
    ['seed-san.vrm', 2],
    ['quaternius-ual.glb', 0],
  ] as const) {
    it(`${name}: untouched JSON and BIN prefix kept, no new validator errors, the edit read back`, async () => {
      const source = await load(name);
      const { data, edit } = await editOf(source, mesh);
      const out = await glb(await replacePrimitives(source.bytes, [edit], { marker: true }));
      expect(preservationProblems(source, out, { meshes: [mesh] })).toEqual([]);
      expect(binPrefixEqual(source, out)).toBe(true);
      expect(await newErrors(source, out)).toEqual([]);
      // Accessors and bufferViews are appended: the originals keep their indices (and stay, unused).
      expect((out.json['accessors'] as unknown[]).length).toBeGreaterThan(
        (source.json['accessors'] as unknown[]).length,
      );
      // The marker v2: the baseline before any geometry step and the original primitives JSON.
      const marker = markerV2(out);
      expect(marker).toMatchObject({
        version: 2,
        baseAccessors: (source.json['accessors'] as unknown[]).length,
        baseBufferViews: (source.json['bufferViews'] as unknown[]).length,
        baseBinLength: (source.json['buffers'] as Json[])[0]?.['byteLength'],
        baseSha256: source.sha256,
        replaced: {},
      });
      expect(marker?.replacedPrimitives[String(mesh)]).toEqual((source.json['meshes'] as Json[])[mesh]?.['primitives']);
      expect(out.json.asset.extras?.[BAKE_MARKER_KEY]).toBeUndefined();
      // Making the output editable again gives the edited mesh (triangle count, every position).
      const again = await meshFromGltf(out, mesh);
      if ('refused' in again) throw new Error(again.reason);
      expect(again.data.counts.faces).toBe(data.counts.faces);
      const positions = (d: MeshData) => {
        const out: string[] = [];
        for (let c = 0; c < d.counts.corners; c++) {
          const p = d.cornerVert[c] as number;
          out.push([0, 1, 2].map((k) => (d.position[3 * p + k] as number).toFixed(6)).join(','));
        }
        return out.sort();
      };
      expect(positions(again.data)).toEqual(positions(data));
    });
  }

  it('Polybot: morph targets keep NORMAL (vertex count, finite) and new vertices keep normalized weights', async () => {
    const source = await load('polybot.vrm');
    const { edit } = await editOf(source, 0);
    const out = await glb(await replacePrimitives(source.bytes, [edit], { marker: false }));
    const reader = new GltfReader(out.json, out.bin);
    const primitive = (out.json['meshes'] as { primitives: Json[] }[])[0]?.primitives[0] as Json;
    const attributes = primitive['attributes'] as Record<string, number>;
    const count = reader.accessor(attributes['POSITION'] as number).count;
    const targets = primitive['targets'] as Record<string, number>[];
    expect(targets).toHaveLength(16);
    for (const target of targets) {
      expect(target['NORMAL']).toBeDefined();
      const normal = reader.readFloat(target['NORMAL'] as number);
      expect(normal.length).toBe(3 * count);
      expect(normal.every(Number.isFinite)).toBe(true);
    }
    const weights = reader.readFloat(attributes['WEIGHTS_0'] as number);
    let worst = 0;
    for (let v = 0; v < count; v++) {
      const sum =
        (weights[4 * v] as number) +
        (weights[4 * v + 1] as number) +
        (weights[4 * v + 2] as number) +
        (weights[4 * v + 3] as number);
      worst = Math.max(worst, Math.abs(sum - 1));
    }
    expect(worst).toBeLessThan(1e-6);
    expect(Object.keys(attributes)).toEqual(['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0']);
    expect(primitive['extras']).toEqual(
      (source.json['meshes'] as { primitives: Json[] }[])[0]?.primitives[0]?.['extras'],
    );
    // Without a marker nothing is recorded in asset.extras.
    expect(markerV2(out)).toBeUndefined();
  });

  it('rebuilds a container for display that three.js loads with the edited primitive', async () => {
    const source = await load('polybot.vrm');
    const { data, edit } = await editOf(source, 0);
    const rebuilt = await rebuildContainer(source, [edit]);
    expect(rebuilt.sha256).toHaveLength(64);
    const loaded = await loadGltfInNode(rebuilt.bytes);
    let triangles = 0;
    loaded.scene.traverse((object) => {
      const geometry = (object as { geometry?: { index: { count: number } | null } }).geometry;
      if (geometry?.index !== undefined && geometry.index !== null) triangles += geometry.index.count / 3;
    });
    expect(triangles).toBe(data.counts.faces);
    expect(loaded.vrm).not.toBeNull();
  });

  it('refuses a mesh that had tangents unless they are dropped', async () => {
    const container = await syntheticContainer({
      primitives: [
        {
          positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
          normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
          indices: [0, 1, 2],
          tangents: true,
        },
      ],
    });
    const made = await meshFromGltf(container, 0);
    if ('refused' in made) throw new Error(made.reason);
    const edit: PrimitiveEdit = {
      meshIndex: 0,
      data: made.data,
      morphNormals: new Set(),
      hadTangents: true,
      dropTangents: false,
    };
    await expect(replacePrimitives(container.bytes, [edit], { marker: false })).rejects.toMatchObject({
      code: 'tangents',
    });
    const out = await glb(
      await replacePrimitives(container.bytes, [{ ...edit, dropTangents: true }], { marker: false }),
    );
    const attributes = (out.json['meshes'] as { primitives: { attributes: Json }[] }[])[0]?.primitives[0]?.attributes;
    expect(Object.keys(attributes ?? {})).toEqual(['POSITION', 'NORMAL']);
    expect((await validateGltf(out.bytes)).errors).toBe(0);
  });

  it('drops KHR_mesh_quantization with its last user and the marker restores the lists', async () => {
    const base = await syntheticContainer({
      primitives: [
        { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] },
      ],
    });
    // Rewrite POSITION as quantized int16 (non-normalized), as KHR_mesh_quantization allows.
    const json = structuredClone(base.json) as Json;
    const accessors = json['accessors'] as Json[];
    const views = json['bufferViews'] as Json[];
    // Vertex attribute elements are 4-byte aligned: int16 VEC3 needs a byteStride of 8.
    const offset = base.bin?.length ?? 0;
    const bin = new Uint8Array(offset + 24);
    bin.set(base.bin ?? new Uint8Array(0));
    const dv = new DataView(bin.buffer);
    [0, 0, 0, 1, 0, 0, 1, 1, 0].forEach((value, i) => {
      dv.setInt16(offset + 8 * Math.floor(i / 3) + 2 * (i % 3), value, true);
    });
    views.push({ buffer: 0, byteOffset: offset, byteLength: 24, byteStride: 8, target: 34962 });
    accessors.push({
      bufferView: views.length - 1,
      componentType: 5122,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 1, 0],
    });
    const mesh = (json['meshes'] as { primitives: { attributes: Json }[] }[])[0];
    if (mesh?.primitives[0] !== undefined) mesh.primitives[0].attributes['POSITION'] = accessors.length - 1;
    json['buffers'] = [{ byteLength: bin.length }];
    json['extensionsUsed'] = ['KHR_mesh_quantization'];
    json['extensionsRequired'] = ['KHR_mesh_quantization'];
    const { makeGlb } = await import('../src/testing/glb');
    const quantized = await parseGlb(makeGlb(json, bin));
    expect((await validateGltf(quantized.bytes)).errors).toBe(0);
    const made = await meshFromGltf(quantized, 0);
    if ('refused' in made) throw new Error(made.reason);
    const edit: PrimitiveEdit = {
      meshIndex: 0,
      data: made.data,
      morphNormals: new Set(),
      hadTangents: false,
      dropTangents: false,
    };
    const out = await glb(await replacePrimitives(quantized.bytes, [edit], { marker: true }));
    expect(out.json['extensionsUsed']).toBeUndefined();
    expect(out.json['extensionsRequired']).toBeUndefined();
    expect(markerV2(out)?.originalExtensions).toEqual({
      used: ['KHR_mesh_quantization'],
      required: ['KHR_mesh_quantization'],
    });
    expect((await validateGltf(out.bytes)).errors).toBe(0);
  });
});

describe('bake marker v2: geometry and clips together', () => {
  async function setup(): Promise<{ source: GlbContainer; skeleton: SkeletonDesc }> {
    const source = await load('polybot.vrm');
    return { source, skeleton: skeletonFromGltf(source) };
  }
  const bake = (
    original: GlbContainer,
    skeleton: SkeletonDesc,
    clips: readonly BakedClip[],
    geometry?: readonly PrimitiveEdit[],
  ) =>
    bakeIntoModel(original, skeleton, clips, {
      meta: metaOf(clips, skeleton),
      fileName: 'out.vrm',
      profile: null,
      ...(geometry === undefined ? {} : { geometry }),
    });

  it('an animation-only bake still writes v1, byte-identical with and without an empty geometry list', async () => {
    const { source, skeleton } = await setup();
    const clip = rawClip(skeleton, 'wave');
    const plain = await bake(source, skeleton, [clip]);
    const empty = await bake(source, skeleton, [clip], []);
    expect(Buffer.compare(Buffer.from(plain.bytes), Buffer.from(empty.bytes))).toBe(0);
    const out = await glb(plain.bytes);
    expect((out.json.asset.extras as Json)[BAKE_MARKER_KEY]).toBeDefined();
    expect(markerV2(out)).toBeUndefined();
  });

  it('a bake with a geometry step writes v2; a re-bake without edits keeps the geometry and replaces the clips', async () => {
    const { source, skeleton } = await setup();
    const { data, edit } = await editOf(source, 0, 60);
    const a = await bake(source, skeleton, [rawClip(skeleton, 'wave')], [edit]);
    const fileA = await glb(a.bytes);
    expect(a.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(a.readBack?.ok).toBe(true);
    expect(preservationProblems(source, fileA, { meshes: [0], clips: true })).toEqual([]);
    expect(binPrefixEqual(source, fileA)).toBe(true);
    expect(await newErrors(source, fileA)).toEqual([]);
    const markerA = markerV2(fileA);
    expect(markerA?.baseSha256).toBe(source.sha256);
    expect((fileA.json['animations'] as Json[]).map((x) => x['name'])).toEqual(['wave']);

    // Re-bake A (as a re-imported file) with another clip and no edits: rollback + carry + new clips.
    const b = await bake(fileA, skeletonFromGltf(fileA), [rawClip(skeleton, 'idle', 3)]);
    const fileB = await glb(b.bytes);
    expect(b.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(b.readBack?.ok).toBe(true);
    const markerB = markerV2(fileB);
    expect(markerB).toMatchObject({
      baseSha256: source.sha256,
      baseAccessors: markerA?.baseAccessors,
      baseBufferViews: markerA?.baseBufferViews,
      baseBinLength: markerA?.baseBinLength,
    });
    expect(markerB?.replacedPrimitives).toEqual(markerA?.replacedPrimitives);
    expect((fileB.json['animations'] as Json[]).map((x) => x['name'])).toEqual(['idle']);
    expect(await newErrors(source, fileB)).toEqual([]);
    expect(preservationProblems(source, fileB, { meshes: [0], clips: true })).toEqual([]);
    const meshB = await meshFromGltf(fileB, 0);
    if ('refused' in meshB) throw new Error(meshB.reason);
    expect(meshB.data.counts.faces).toBe(data.counts.faces);
    let worst = 0;
    const meshA = await meshFromGltf(fileA, 0);
    if ('refused' in meshA) throw new Error(meshA.reason);
    for (let i = 0; i < meshA.data.position.length; i++) {
      worst = Math.max(worst, Math.abs((meshA.data.position[i] as number) - (meshB.data.position[i] as number)));
    }
    expect(worst).toBeLessThan(1e-6);
    // The tracks of the original file (none for Polybot) are what a re-bake keeps: v2 rolls the clips back.
    expect(preexistingTracks(fileA, skeletonFromGltf(fileA), ['idle']).size).toBe(0);
  });

  it('a re-bake with a new edit of the same mesh writes the new geometry over the original baseline', async () => {
    const { source, skeleton } = await setup();
    const { edit } = await editOf(source, 0, 10);
    const fileA = await glb((await bake(source, skeleton, [rawClip(skeleton, 'wave')], [edit])).bytes);
    const second = await editOf(fileA, 0, 30);
    const fileC = await glb(
      (await bake(fileA, skeletonFromGltf(fileA), [rawClip(skeleton, 'wave')], [second.edit])).bytes,
    );
    const meshC = await meshFromGltf(fileC, 0);
    if ('refused' in meshC) throw new Error(meshC.reason);
    expect(meshC.data.counts.faces).toBe(second.data.counts.faces);
    expect(markerV2(fileC)?.replacedPrimitives['0']).toEqual((source.json['meshes'] as Json[])[0]?.['primitives']);
    expect(markerV2(fileC)?.baseAccessors).toBe((source.json['accessors'] as unknown[]).length);
    expect(await newErrors(source, fileC)).toEqual([]);
  });

  it('reports dropped tangents as the lint mesh.tangents-dropped', async () => {
    const { source, skeleton } = await setup();
    const { edit } = await editOf(source, 0, 4);
    const out = await bake(
      source,
      skeleton,
      [rawClip(skeleton, 'wave')],
      [{ ...edit, hadTangents: true, dropTangents: true }],
    );
    expect(out.lints.find((lint) => lint.code === 'mesh.tangents-dropped')).toMatchObject({ severity: 'info' });
  });
});
