// Topology helpers of the overlays and the picker: flat arrays from edit and stored forms, the one visibility rule
// (hidden faces take the edges and vertices only they use along; isolate sets), diagonals, centroids and CSR maps;
// and the view-side mirrored partners (§5.6 "expanded minus stored").
import { BitSet, type HiddenSet, selectionOf, type SymmetryMap } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import { mirroredOf, partnerOf } from '../src';
import {
  allVisible,
  copyPositions,
  csr,
  deriveVisibility,
  faceCentroids,
  meanEdgeLength,
  topoOfData,
  topoOfEdit,
  triangulationDiagonals,
  vertexCorners,
  vertexEdges,
} from '../src/internal/topo';
import { centroidOf, cube, plane, prng, vertexAt } from './support';

function hidden(counts: { points: number; edges: number; faces: number }): HiddenSet {
  return { verts: new BitSet(counts.points), edges: new BitSet(counts.edges), faces: new BitSet(counts.faces) };
}

describe('topology arrays', () => {
  it('agree between the edit and the stored form', () => {
    const d = cube({ subdivisionsWidth: 2 });
    const a = topoOfEdit(d.mesh);
    const b = topoOfData(d.data);
    expect(Array.from(a.cv)).toEqual(Array.from(b.cv));
    expect(Array.from(a.cf)).toEqual(Array.from(b.cf));
    expect(Array.from(a.fstart)).toEqual(Array.from(b.fstart));
    expect(Array.from(a.fcorners)).toEqual(Array.from(b.fcorners));
    expect(b.ce).toBeNull();
    for (let c = 0; c < a.corners; c++) expect(a.ce?.[c]).toBe(d.mesh.cornerEdge(c));
  });

  it('builds CSR maps, centroids, mean edge length and diagonals', () => {
    const d = cube();
    const t = topoOfEdit(d.mesh);
    const ve = vertexEdges(t);
    const vc = vertexCorners(t);
    for (let v = 0; v < 8; v++) {
      expect((ve.start[v + 1] as number) - (ve.start[v] as number)).toBe(3);
      expect((vc.start[v + 1] as number) - (vc.start[v] as number)).toBe(3);
    }
    const centroids = faceCentroids(t, d.mesh.position, new Float32Array(18));
    for (let f = 0; f < 6; f++) {
      const c = centroidOf(d, f);
      for (let k = 0; k < 3; k++) expect(centroids[3 * f + k]).toBeCloseTo(c[k] as number, 6);
    }
    expect(meanEdgeLength(t, d.mesh.position)).toBeCloseTo(1, 6);
    // A cube's 6 quads give 6 diagonals, each once.
    expect(triangulationDiagonals(t, d.tri.tris)).toHaveLength(12);
    const m = csr(
      3,
      4,
      (i) => [0, 2, 2, 5][i] as number,
      (i) => i * 10,
    );
    expect(Array.from(m.start)).toEqual([0, 1, 1, 3]);
    expect(Array.from(m.items)).toEqual([0, 10, 20]);
    const dst = new Float32Array(6);
    copyPositions(dst, [1, 2, 3, 4, 5, 6, 7, 8, 9], 2);
    expect(Array.from(dst)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('visibility', () => {
  it('hides the edges and vertices only hidden faces use, and follows the isolate set', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const t = topoOfEdit(d.mesh);
    const right = centroidOf(d, 0)[0] > 0 ? 0 : 1;
    const h = hidden(d.mesh.counts);
    h.faces.add(right);
    const vis = deriveVisibility(t, h, null, allVisible(t));
    expect(vis.faces[right]).toBe(0);
    expect(vis.faces[1 - right]).toBe(1);
    expect(vis.verts[vertexAt(d, [1, 0, 0.5])]).toBe(0);
    expect(vis.verts[vertexAt(d, [0, 0, 0.5])]).toBe(1);
    const shared = d.mesh.findEdge(vertexAt(d, [0, 0, -0.5]), vertexAt(d, [0, 0, 0.5]));
    const outer = d.mesh.findEdge(vertexAt(d, [1, 0, -0.5]), vertexAt(d, [1, 0, 0.5]));
    expect(vis.edges[shared]).toBe(1);
    expect(vis.edges[outer]).toBe(0);
    // The isolate set draws only its faces.
    const only = new BitSet(d.mesh.counts.faces);
    only.add(right);
    const iso = deriveVisibility(t, null, only, allVisible(t));
    expect(Array.from(iso.faces)).toEqual(right === 0 ? [1, 0] : [0, 1]);
    expect(iso.verts[vertexAt(d, [-1, 0, 0.5])]).toBe(0);
    // Hidden bits of edges and vertices hide them directly.
    const h2 = hidden(d.mesh.counts);
    h2.edges.add(shared);
    h2.verts.add(0);
    const v2 = deriveVisibility(t, h2, null, allVisible(t));
    expect(v2.edges[shared]).toBe(0);
    expect(v2.verts[0]).toBe(0);
    expect(Array.from(v2.faces)).toEqual([1, 1]);
  });

  it('matches a direct rule on random hidden sets', () => {
    const d = cube({ subdivisionsWidth: 3, subdivisionsHeight: 2, subdivisionsDepth: 2 });
    const t = topoOfEdit(d.mesh);
    const random = prng(7);
    for (let trial = 0; trial < 30; trial++) {
      const h = hidden(d.mesh.counts);
      for (let f = 0; f < t.faces; f++) if (random() < 0.4) h.faces.add(f);
      for (let e = 0; e < t.edges; e++) if (random() < 0.05) h.edges.add(e);
      for (let v = 0; v < t.points; v++) if (random() < 0.05) h.verts.add(v);
      const vis = deriveVisibility(t, h, null, allVisible(t));
      for (let e = 0; e < t.edges; e++) {
        let anyVisible = false;
        const start = d.mesh.edgeCorner(e);
        let c = start;
        do {
          if (!h.faces.has(d.mesh.cornerFace(c))) anyVisible = true;
          c = d.mesh.cornerRadialNext(c);
        } while (c !== start);
        expect(vis.edges[e]).toBe(!h.edges.has(e) && anyVisible ? 1 : 0);
      }
      for (let v = 0; v < t.points; v++) {
        let anyEdge = false;
        const start = d.mesh.vertEdge(v);
        let e = start;
        do {
          if (vis.edges[e] === 1) anyEdge = true;
          e = d.mesh.edgeDiskNext(e, v);
        } while (e !== start);
        expect(vis.verts[v]).toBe(!h.verts.has(v) && anyEdge ? 1 : 0);
      }
    }
  });
});

describe('mirrored partners', () => {
  function xMap(d: ReturnType<typeof cube>): SymmetryMap {
    const { points, edges, faces } = d.mesh.counts;
    const p = d.mesh.position;
    const vertex = new Int32Array(points);
    for (let v = 0; v < points; v++) {
      vertex[v] = vertexAt(d, [-(p[3 * v] as number), p[3 * v + 1] as number, p[3 * v + 2] as number]);
    }
    const edge = new Int32Array(edges);
    for (let e = 0; e < edges; e++) {
      edge[e] = d.mesh.findEdge(vertex[d.mesh.edgeVert(e, 0)] as number, vertex[d.mesh.edgeVert(e, 1)] as number);
    }
    const face = new Int32Array(faces).fill(-1);
    return {
      axis: 'x',
      space: 'object',
      plane: 0,
      tolerance: 1e-4,
      vertex,
      edge,
      edgeReversed: new Uint8Array(edges),
      edgeSelf: new Uint8Array(edges),
      face,
      unmatched: 0,
    };
  }

  it('adds the partners that are not selected themselves', () => {
    const d = cube({ subdivisionsWidth: 2 });
    const map = xMap(d);
    const right = vertexAt(d, [0.5, 0.5, 0.5]);
    const left = vertexAt(d, [-0.5, 0.5, 0.5]);
    const seam = vertexAt(d, [0, 0.5, 0.5]);
    const sel = selectionOf('vertex', [right, seam], d.mesh.counts);
    const mirrored = mirroredOf(sel, map);
    expect(mirrored?.kind).toBe('vertex');
    expect(Array.from(mirrored?.verts.toArray() ?? [])).toEqual([left]);
    // Both sides picked: nothing to add.
    expect(mirroredOf(selectionOf('vertex', [right, left], d.mesh.counts), map)).toBeNull();
    expect(mirroredOf(sel, null)).toBeNull();
    expect(partnerOf(map, 'vertex', right)).toBe(left);
    expect(partnerOf(map, 'vertex', seam)).toBe(-1);
    expect(partnerOf(map, 'face', 0)).toBe(-1);
    expect(partnerOf(null, 'vertex', right)).toBe(-1);
  });
});
