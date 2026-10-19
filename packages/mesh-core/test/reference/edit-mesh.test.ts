// M6A-SPEC §4.3, §9 B0a: the reference EditMesh for static meshes — edit links and traversal on the reference
// primitives, value writes and layers through the write log, exact undo (P5: `apply(delta, 'backward')` is
// bit-identical, `forward` re-yields the after state), `abort`, transaction rules, Euler operators refusing
// `not-implemented`, and the debug switch validating at `end()`.
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  EDGE_HARD,
  type EditMesh,
  editMeshFrom,
  emptyMesh,
  type MeshData,
  morphLayer,
  primitive,
  setKernelDebug,
  validateMesh,
  writeRevision,
} from '../../src';
import { buildMeshData, cubeData } from '../../src/testing';

// test/setup.ts turns the debug switch on for every test; tests that turn it off restore it.
afterEach(() => setKernelDebug(true));

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
};

/** Everything an EditMesh stores, as plain arrays (bit-exact comparison through Float32Array copies). */
function state(m: EditMesh): unknown {
  const data = m.snapshot();
  return {
    counts: data.counts,
    position: [...new Uint32Array(data.position.buffer.slice(0))],
    edgeFlags: [...data.edgeFlags],
    faceMaterial: [...data.faceMaterial],
    faceFlags: [...data.faceFlags],
    layers: [...data.layers].map(([name, layer]) => [name, layer.def, [...new Uint8Array(layer.data.buffer.slice(0))]]),
  };
}

describe('edit links and traversal', () => {
  it.each([
    ['cube', primitive('cube', {})],
    ['cube 2×3×1', primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 3 })],
    ['plane 2×2', primitive('plane', { subdivisionsWidth: 2, subdivisionsHeight: 2 })],
    ['cylinder caps 2', primitive('cylinder', { subdivisionsCaps: 2, subdivisionsHeight: 2 })],
  ] as const)('%s: links are consistent and validateMesh finds nothing', (_name, data: MeshData) => {
    const m = editMeshFrom(data);
    expect(validateMesh(m)).toEqual([]);
    const { points: P, edges: E, faces: F, corners: C } = m.counts;
    let cornerSum = 0;
    for (let f = 0; f < F; f++) cornerSum += m.faceLen(f);
    expect(cornerSum).toBe(C);
    for (let c = 0; c < C; c++) {
      const e = m.cornerEdge(c);
      const a = m.cornerVert(c);
      const b = m.cornerVert(m.cornerNext(c));
      expect(m.findEdge(a, b)).toBe(e);
      expect(m.findEdge(b, a)).toBe(e);
      expect(m.edgeOther(e, a)).toBe(b);
      expect(m.cornerPrev(m.cornerNext(c))).toBe(c);
      expect(m.cornerFace(m.cornerNext(c))).toBe(m.cornerFace(c));
    }
    let valence = 0;
    for (let v = 0; v < P; v++) {
      valence += m.vertValence(v);
      expect(m.isManifoldVert(v)).toBe(true);
    }
    expect(valence).toBe(2 * E);
    let radial = 0;
    for (let e = 0; e < E; e++) radial += m.edgeFaceCount(e);
    expect(radial).toBe(C);
  });

  it('answers −1 for absent links and detects non-manifold vertices (bow-tie, wire edge)', () => {
    // Two triangles sharing only vertex 0 (a bow-tie), plus a vertex 5 without edges.
    const bowtie = editMeshFrom(
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0, 9, 9, 9],
        faces: [
          [0, 1, 2],
          [0, 3, 4],
        ],
      }),
    );
    expect(bowtie.isManifoldVert(0)).toBe(false);
    expect(bowtie.isManifoldVert(1)).toBe(true);
    expect(bowtie.isManifoldVert(5)).toBe(true);
    expect(bowtie.vertEdge(5)).toBe(-1);
    expect(bowtie.vertValence(5)).toBe(0);
    expect(bowtie.findEdge(1, 3)).toBe(-1);
    expect(bowtie.edgeOther(0, 4)).toBe(-1);
    expect(bowtie.edgeDiskNext(0, 4)).toBe(-1);
    // A plane's border edge has one face; its corners are manifold (half-disc).
    const plane = editMeshFrom(primitive('plane', {}));
    expect(plane.edgeFaceCount(0)).toBe(1);
    expect(plane.cornerRadialNext(plane.edgeCorner(0))).toBe(plane.edgeCorner(0));
  });

  it('refuses data that breaks the stored-form invariants (invalid-mesh)', () => {
    const cube = cubeData();
    expect(code(() => editMeshFrom({ ...cube, edgeFlags: new Uint8Array(3) }))).toBe('invalid-mesh');
    const twoEdges = cube.edgeVerts.slice();
    twoEdges[2] = twoEdges[0] as number;
    twoEdges[3] = twoEdges[1] as number;
    expect(code(() => editMeshFrom({ ...cube, edgeVerts: twoEdges }))).toBe('invalid-mesh');
    const open = cube.cornerNext.slice();
    open[3] = 1;
    expect(code(() => editMeshFrom({ ...cube, cornerNext: open }))).toBe('invalid-mesh');
  });

  it('the empty mesh', () => {
    const m = emptyMesh();
    expect(m.counts).toEqual({ points: 0, edges: 0, faces: 0, corners: 0 });
    expect(validateMesh(m)).toEqual([]);
    expect(m.snapshot().position.length).toBe(0);
  });
});

describe('write log (P5 exact undo on value writes)', () => {
  it('records value writes and layer changes; backward restores bit-identically, forward re-applies', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const before = state(m);
    m.begin('test.edit');
    expect(m.inTransaction).toBe(true);
    m.setPosition(0, 1.1, -2.2, 3.3);
    m.setPosition(0, 0.1, 0.2, 0.3); // coalesced per slot
    m.setEdgeFlags(3, 0);
    m.setFaceFlags(2, 1);
    m.setFaceMaterial(4, 7);
    const morph = m.addLayer(morphLayer('Blink'));
    morph.set(5, 1, 0.25);
    m.layer('paint')?.set(1, 0, 9);
    m.removeLayer('paint');
    const delta = m.end();
    expect(m.inTransaction).toBe(false);
    const after = state(m);
    expect(after).not.toEqual(before);
    expect(delta.opId).toBe('test.edit');
    expect(delta.dirty.topology).toBe(false);
    expect([...(delta.dirty.edges as Uint32Array)]).toEqual([3]);
    expect(delta.dirty.faces).toBe('all'); // a face layer was removed
    expect(delta.dirty.points).toBe('all'); // a point layer was added
    expect(delta.dirty.layers).toEqual(['morph:Blink', 'paint']);
    expect(delta.remap.point.forward).toBeNull();
    expect(delta.bytes).toBeGreaterThan(0);
    expect(m.layer('paint')).toBeUndefined();

    m.apply(delta, 'backward');
    expect(state(m)).toEqual(before);
    expect(m.layer('paint')?.def).toEqual(BUILTIN_LAYERS.paint);
    m.apply(delta, 'forward');
    expect(state(m)).toEqual(after);
    m.apply(delta, 'backward');
    expect(writeRevision(m).manifestId).toBe(writeRevision(primitive('cube', {})).manifestId);
  });

  it('abort restores the exact pre-begin state; a write equal to the value logs nothing', () => {
    const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 3 }));
    const before = state(m);
    m.begin('test.abort');
    m.setPosition(2, 5, 5, 5);
    m.addLayer(BUILTIN_LAYERS.uv0).set(0, 1, 0.5);
    m.abort();
    expect(state(m)).toEqual(before);
    expect(m.layer('uv0')).toBeUndefined();
    m.begin('test.same');
    const p = m.position;
    m.setPosition(0, p[0] as number, p[1] as number, p[2] as number);
    const delta = m.end();
    expect(delta.dirty.points).toEqual(new Uint32Array(0));
  });

  it('random value-write sequences undo bit-identically and redo to the same state (property)', () => {
    const base = primitive('cylinder', { subdivisionsHeight: 2 });
    const write = fc.oneof(
      fc.record({ kind: fc.constant('pos' as const), i: fc.nat(), x: fc.double({ noNaN: true, min: -10, max: 10 }) }),
      fc.record({ kind: fc.constant('edge' as const), i: fc.nat(), x: fc.integer({ min: 0, max: 255 }) }),
      fc.record({ kind: fc.constant('mat' as const), i: fc.nat(), x: fc.integer({ min: 0, max: 65_535 }) }),
      fc.record({ kind: fc.constant('paint' as const), i: fc.nat(), x: fc.integer({ min: 0, max: 65_534 }) }),
      fc.record({ kind: fc.constant('uv' as const), i: fc.nat(), x: fc.double({ noNaN: true, min: -1, max: 2 }) }),
    );
    fc.assert(
      fc.property(fc.array(write, { maxLength: 40 }), (writes) => {
        const m = editMeshFrom(base);
        const before = state(m);
        m.begin('fuzz');
        for (const w of writes) {
          if (w.kind === 'pos') m.setPosition(w.i % m.counts.points, w.x, -w.x, w.x / 3);
          else if (w.kind === 'edge') m.setEdgeFlags(w.i % m.counts.edges, w.x);
          else if (w.kind === 'mat') m.setFaceMaterial(w.i % m.counts.faces, w.x);
          else if (w.kind === 'paint') m.layer('paint')?.set(w.i % m.counts.faces, 0, w.x);
          else m.addLayer(BUILTIN_LAYERS.uv0).set(w.i % m.counts.corners, w.i % 2, w.x);
        }
        const delta = m.end();
        const after = state(m);
        m.apply(delta, 'backward');
        expect(state(m)).toEqual(before);
        m.apply(delta, 'forward');
        expect(state(m)).toEqual(after);
      }),
      { numRuns: 120 },
    );
  });

  it('enforces the transaction rules', () => {
    const m = editMeshFrom(primitive('cube', {}));
    expect(code(() => m.setPosition(0, 1, 1, 1))).toBe('mesh-no-transaction');
    expect(code(() => m.addLayer(BUILTIN_LAYERS.uv0))).toBe('mesh-no-transaction');
    expect(code(() => m.end())).toBe('mesh-no-transaction');
    m.begin('a');
    expect(code(() => m.begin('b'))).toBe('mesh-transaction-open');
    const delta = m.end();
    m.begin('c');
    expect(code(() => m.apply(delta, 'forward'))).toBe('mesh-transaction-open');
    m.abort();
    expect(code(() => m.apply({ ...delta, writes: null }, 'forward'))).toBe('invalid-delta');
    m.begin('d');
    expect(code(() => m.setPosition(99, 0, 0, 0))).toBe('out-of-range');
    expect(code(() => m.layer('paint')?.set(0, 1, 0))).toBe('out-of-range');
    m.abort();
  });

  it('stores floats through Math.fround and integer layers by their width', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('round');
    m.setPosition(0, 0.1, 0, 0);
    m.layer('paint')?.set(0, 0, 70_000);
    m.end();
    expect(m.position[0]).toBe(Math.fround(0.1));
    expect(m.layer('paint')?.get(0)).toBe(70_000 & 0xffff);
    const out = new Float64Array(4);
    m.layer('paint')?.read(0, out, 1);
    expect(out[1]).toBe(70_000 & 0xffff);
  });

  it('Euler operators refuse not-implemented in the reference kernel (static meshes only)', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('euler');
    expect(code(() => m.makeVert(0, 0, 0))).toBe('not-implemented');
    expect(code(() => m.splitEdgeMakeVert(0, 0.5))).toBe('not-implemented');
    expect(code(() => m.makeFace([0, 1, 2]))).toBe('not-implemented');
    expect(code(() => m.reverseFace(0))).toBe('not-implemented');
    m.abort();
  });

  it('with the debug switch, end() validates (a valid edit passes)', () => {
    setKernelDebug(true);
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('debug');
    m.setPosition(0, 0, 0, 0);
    expect(() => m.end()).not.toThrow();
    // Positions that are not finite violate invariant 7: end() rolls the edit back and throws invalid-mesh.
    m.begin('broken');
    m.setPosition(1, Number.NaN, 0, 0);
    expect(code(() => m.end())).toBe('invalid-mesh');
    expect(Number.isFinite(m.position[3])).toBe(true);
    expect(m.edgeFlags(0) & EDGE_HARD).toBe(EDGE_HARD);
  });
});
