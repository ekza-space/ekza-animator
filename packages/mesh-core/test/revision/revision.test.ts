// M6A-SPEC §4.3, §5.20, §5.29 P8 (B1 codec; moved from B0a's reference tests, literal update: the plane carries
// `uv0` now, so the all-default corner layer of `bigPlane` is `uv1`): revisions round-trip bit-identically; chunk sizes; implicit
// default tails read as defaults; canonical tails (trailing all-default chunks never stored); a full and an
// incremental write of the same content give the same manifest id; unchanged chunks keep their hashes after local
// edits; canonical JSON manifests; parseManifest refuses newer versions and malformed manifests.
import fc from 'fast-check';
import { sha256Hex } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  editMeshFrom,
  manifestChunkIds,
  type MeshData,
  morphLayer,
  parseManifest,
  primitive,
  readRevision,
  type RevisionManifest,
  writeRevision,
} from '../../src';
import { buildMeshData } from '../../src/testing';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
};

/** A store of every chunk ever written (the BlobStore stand-in). */
function store(): {
  readonly put: (chunks: ReadonlyMap<string, Uint8Array>) => void;
  readonly get: (id: string) => Uint8Array;
} {
  const blobs = new Map<string, Uint8Array>();
  return {
    put: (chunks) => {
      for (const [id, bytes] of chunks) {
        expect(sha256Hex(bytes)).toBe(id);
        blobs.set(id, bytes);
      }
    },
    get: (id) => {
      const bytes = blobs.get(id);
      if (bytes === undefined) throw new Error(`missing chunk ${id}`);
      return bytes;
    },
  };
}

/** Bit-exact comparison of two stored forms (floats through their bits). */
function bits(data: MeshData): unknown {
  const raw = (
    array: ArrayLike<number> & {
      readonly buffer: ArrayBufferLike;
      readonly byteOffset: number;
      readonly byteLength: number;
    },
  ) => [...new Uint8Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength))];
  return {
    counts: data.counts,
    position: raw(data.position),
    edgeVerts: raw(data.edgeVerts),
    edgeFlags: raw(data.edgeFlags),
    cornerVert: raw(data.cornerVert),
    cornerNext: raw(data.cornerNext),
    faceCorner: raw(data.faceCorner),
    faceMaterial: raw(data.faceMaterial),
    faceFlags: raw(data.faceFlags),
    layers: [...data.layers].map(([name, layer]) => [name, layer.def, raw(layer.data)]),
  };
}

/** A big plane (enough points for several position chunks) with a morph and a uv layer. */
function bigPlane(): MeshData {
  const base = primitive('plane', { subdivisionsWidth: 60, subdivisionsHeight: 70 }); // 4331 points, 3 position chunks
  const m = editMeshFrom(base);
  m.begin('layers');
  m.addLayer(morphLayer('Blink'));
  m.addLayer(BUILTIN_LAYERS.uv1);
  m.end();
  return m.snapshot();
}

describe('writeRevision / readRevision (P8)', () => {
  it('round-trips every primitive bit-identically, with the documented chunk sizes', () => {
    for (const data of [primitive('cube', {}), primitive('cylinder', { subdivisionsCaps: 2 }), bigPlane()]) {
      const out = writeRevision(data);
      const blobs = store();
      blobs.put(out.newChunks);
      expect(bits(readRevision(out.manifest, blobs.get))).toEqual(bits(data));
      expect(out.manifestId).toBe(sha256Hex(out.manifestBytes));
      expect(parseManifest(out.manifestBytes)).toEqual(out.manifest);
    }
    const layers = writeRevision(bigPlane()).manifest.layers;
    const elems = Object.fromEntries(layers.map((layer) => [layer.name, layer.chunkElems]));
    expect(elems).toMatchObject({
      $position: 2048,
      $edgeVerts: 4096,
      $edgeFlags: 32_768,
      $cornerVert: 8192,
      $cornerNext: 8192,
      $faceCorner: 8192,
      $faceMaterial: 16_384,
      $faceFlags: 32_768,
      paint: 16_384,
      uv0: 4096,
      'morph:Blink': 2048,
      uv1: 4096,
    });
    expect(layers.map((layer) => layer.name)).toEqual([
      '$position',
      '$edgeVerts',
      '$edgeFlags',
      '$cornerVert',
      '$cornerNext',
      '$faceCorner',
      '$faceMaterial',
      '$faceFlags',
      'paint',
      'uv0',
      'morph:Blink',
      'uv1',
    ]);
  });

  it('stores no trailing all-default chunk (canonical tails) and reads the missing tail as the default', () => {
    const data = bigPlane();
    const out = writeRevision(data);
    const byName = new Map(out.manifest.layers.map((layer) => [layer.name, layer]));
    expect(byName.get('morph:Blink')?.chunks).toEqual([]);
    expect(byName.get('uv1')?.chunks).toEqual([]);
    expect(byName.get('$faceMaterial')?.chunks).toEqual([]);
    expect(byName.get('$position')?.chunks).toHaveLength(3);
    // A morph that is zero except in the first chunk stores only that chunk.
    const m = editMeshFrom(data);
    m.begin('blink');
    m.layer('morph:Blink')?.set(10, 1, 0.5);
    m.end();
    const edited = writeRevision(m);
    expect(edited.manifest.layers.find((layer) => layer.name === 'morph:Blink')?.chunks).toHaveLength(1);
    const blobs = store();
    blobs.put(out.newChunks);
    blobs.put(edited.newChunks);
    const back = readRevision(edited.manifest, blobs.get);
    expect(back.layers.get('morph:Blink')?.data[10 * 3 + 1]).toBe(0.5);
    expect(back.layers.get('morph:Blink')?.data[3000 * 3]).toBe(0);
    // color0 defaults to white: its implicit tail reads as 1.
    const white = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      faces: [[0, 1, 2]],
      layers: [{ def: BUILTIN_LAYERS.color0 }],
    });
    const whiteOut = writeRevision(white);
    expect(whiteOut.manifest.layers.find((layer) => layer.name === 'color0')?.chunks).toEqual([]);
    const whiteStore = store();
    whiteStore.put(whiteOut.newChunks);
    expect([...(readRevision(whiteOut.manifest, whiteStore.get).layers.get('color0')?.data ?? [])]).toEqual(
      Array.from({ length: 12 }, () => 1),
    );
  });

  it('a −0 is not the default (bit-exact)', () => {
    const data = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      faces: [[0, 1, 2]],
      layers: [{ def: morphLayer('M') }],
    });
    const m = editMeshFrom(data);
    m.begin('neg');
    m.layer('morph:M')?.set(0, 0, -0);
    m.end();
    expect(writeRevision(m).manifest.layers.find((layer) => layer.name === 'morph:M')?.chunks).toHaveLength(1);
  });

  it('a full and an incremental write of the same content give the same manifest id; clean chunks keep their hashes (property)', () => {
    const base = bigPlane();
    const first = writeRevision(base);
    const edit = fc.oneof(
      fc.record({ kind: fc.constant('pos' as const), v: fc.nat(4330), x: fc.double({ noNaN: true, min: -5, max: 5 }) }),
      fc.record({
        kind: fc.constant('morph' as const),
        v: fc.nat(4330),
        x: fc.double({ noNaN: true, min: -1, max: 1 }),
      }),
      fc.record({ kind: fc.constant('uv' as const), c: fc.nat(16_799), x: fc.double({ noNaN: true, min: 0, max: 1 }) }),
      fc.record({ kind: fc.constant('flags' as const), e: fc.nat(8529), x: fc.integer({ min: 0, max: 3 }) }),
      fc.record({ kind: fc.constant('reset' as const), v: fc.nat(4330) }),
    );
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 12 }), (edits) => {
        const m = editMeshFrom(base);
        m.begin('edits');
        for (const e of edits) {
          if (e.kind === 'pos') m.setPosition(e.v, e.x, 0, -e.x);
          else if (e.kind === 'morph') m.layer('morph:Blink')?.set(e.v, 2, e.x);
          else if (e.kind === 'uv') m.layer('uv1')?.set(e.c, 0, e.x);
          else if (e.kind === 'flags') m.setEdgeFlags(e.e, e.x);
          else m.layer('morph:Blink')?.set(e.v, 2, 0); // writes back the default (tails must re-trim)
        }
        const delta = m.end();
        const full = writeRevision(m);
        const incremental = writeRevision(m, { previous: first.manifest, dirty: delta.dirty });
        expect(incremental.manifestId).toBe(full.manifestId);
        // Chunks of untouched position ranges keep their ids.
        const touched = new Set(edits.filter((e) => e.kind === 'pos').map((e) => Math.floor(e.v / 2048)));
        const before = first.manifest.layers[0] as RevisionManifest['layers'][number];
        const after = incremental.manifest.layers[0] as RevisionManifest['layers'][number];
        const moved = after.chunks.filter((id, k) => !touched.has(k) && id !== before.chunks[k]);
        expect(moved).toEqual([]);
        // New chunks are only those the previous revision did not have.
        const old = new Set(manifestChunkIds(first.manifest));
        expect([...incremental.newChunks.keys()].filter((id) => old.has(id))).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it('writes canonical JSON (sorted keys, no whitespace) with bounds', () => {
    const out = writeRevision(primitive('cube', {}));
    const text = new TextDecoder().decode(out.manifestBytes);
    expect(
      text.startsWith(
        '{"bounds":[[-0.5,-0.5,-0.5],[0.5,0.5,0.5]],"counts":{"corners":24,"edges":12,"faces":6,"points":8},"format":"ekza-mesh","layers":[',
      ),
    ).toBe(true);
    expect(text).not.toMatch(/\s/);
    expect(out.manifest.bounds).toEqual([
      [-0.5, -0.5, -0.5],
      [0.5, 0.5, 0.5],
    ]);
    const empty = writeRevision(buildMeshData({ positions: [], faces: [] }));
    expect(empty.manifest.bounds).toBeNull();
    expect(empty.manifest.layers.every((layer) => layer.chunks.length === 0)).toBe(true);
  });

  it('is deterministic: the same geometry gives the same revision id; different geometry another', () => {
    expect(writeRevision(primitive('cube', {})).manifestId).toBe(writeRevision(primitive('cube', {})).manifestId);
    expect(writeRevision(primitive('cube', {})).manifestId).not.toBe(
      writeRevision(primitive('cube', { width: 2 })).manifestId,
    );
  });

  it('keeps unknown layers and their metadata', () => {
    const def = {
      name: 'vendor.heat',
      domain: 'face' as const,
      type: 'f32' as const,
      comps: 2 as const,
      interp: 'linear' as const,
      mirror: 'none' as const,
      default: [0, 1],
      meta: { unit: 'kelvin', joints: [{ id: 'a', parent: null }] },
    };
    const data = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      faces: [[0, 1, 2]],
      layers: [{ def, data: [3, 4] }],
    });
    const out = writeRevision(data);
    const blobs = store();
    blobs.put(out.newChunks);
    const back = readRevision(out.manifest, blobs.get);
    expect(back.layers.get('vendor.heat')?.def).toEqual(def);
    expect([...(back.layers.get('vendor.heat')?.data ?? [])]).toEqual([3, 4]);
  });
});

describe('parseManifest', () => {
  const valid = writeRevision(primitive('cube', {})).manifest;
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  it('refuses a newer version (read-only, "Update the app to edit this mesh")', () => {
    expect(code(() => parseManifest(bytes({ ...valid, version: 2 })))).toBe('mesh-manifest-version');
  });

  it('refuses malformed manifests', () => {
    expect(code(() => parseManifest(new Uint8Array([0xff, 0xfe])))).toBe('invalid-mesh-manifest');
    expect(code(() => parseManifest(bytes({ ...valid, format: 'other' })))).toBe('invalid-mesh-manifest');
    expect(code(() => parseManifest(bytes({ ...valid, version: 0 })))).toBe('invalid-mesh-manifest');
    expect(code(() => parseManifest(bytes({ ...valid, counts: { points: -1 } })))).toBe('invalid-mesh-manifest');
    expect(code(() => parseManifest(bytes({ ...valid, layers: valid.layers.slice(1) })))).toBe('invalid-mesh-manifest');
    const badChunk = valid.layers.map((layer, i) => (i === 0 ? { ...layer, chunks: ['xyz'] } : layer));
    expect(code(() => parseManifest(bytes({ ...valid, layers: badChunk })))).toBe('invalid-mesh-manifest');
    const tooMany = valid.layers.map((layer, i) =>
      i === 0 ? { ...layer, chunks: [...layer.chunks, ...layer.chunks] } : layer,
    );
    expect(code(() => parseManifest(bytes({ ...valid, layers: tooMany })))).toBe('invalid-mesh-manifest');
  });

  it('readRevision refuses a chunk of the wrong size', () => {
    const out = writeRevision(primitive('cube', {}));
    expect(code(() => readRevision(out.manifest, () => new Uint8Array(3)))).toBe('mesh-chunk-size');
  });
});
