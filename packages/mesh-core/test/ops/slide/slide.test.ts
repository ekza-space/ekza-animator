// M6A-SPEC §5.12 Slide Edge/Vertex (`mesh.slide`, B4): a loop slides along its rails (E2E-MOD-24 at kernel level: on
// the rail segment, on the pre-slide surface), the reference picks the positive side, negative percents take the other
// side, `adjust` re-solves from the pre-slide positions, vertex mode, and symmetry (P10): partners slide along mirrored
// rails, seam vertices only along rails in the plane.
import { describe, expect, it } from 'vitest';
import { type EditMesh, editMeshFrom, isRefusal, MESH_OPS, primitive, selectionOf } from '../../../src';
import { context, position, refusedCode, runOk, vertexAt } from '../harness';
import { asymmetry, testSymmetryMap } from '../symmetry-fixture';

const slide = MESH_OPS['mesh.slide'] as NonNullable<(typeof MESH_OPS)[string]>;

/** The horizontal edges of a cylinder ring at height y (both ends at y). */
function ringEdges(m: EditMesh, y: number): number[] {
  const out: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) {
    const a = position(m, m.edgeVert(e, 0));
    const b = position(m, m.edgeVert(e, 1));
    if (Math.abs(a[1] - y) < 1e-6 && Math.abs(b[1] - y) < 1e-6) out.push(e);
  }
  return out;
}

function ringVerts(m: EditMesh, y: number): number[] {
  const out: number[] = [];
  for (let v = 0; v < m.counts.points; v++) if (Math.abs(position(m, v)[1] - y) < 1e-6) out.push(v);
  return out;
}

/** The vertical edge from v toward height y (or −1). */
function railTo(m: EditMesh, v: number, y: number): number {
  for (let e = 0; e < m.counts.edges; e++) {
    const o = m.edgeOther(e, v);
    if (o !== -1 && Math.abs(position(m, o)[1] - y) < 1e-6 && position(m, o)[0] === position(m, v)[0]) return e;
  }
  return -1;
}

describe('mesh.slide (edge loops)', () => {
  const y1 = -0.5 + 1 / 3;
  const y2 = -0.5 + 2 / 3;

  it('E2E-MOD-24 (kernel): a cylinder loop slides 30 % toward the reference ring, every vertex on its rail', () => {
    const m = editMeshFrom(primitive('cylinder', { subdivisionsHeight: 3 }));
    const loop = ringEdges(m, position(m, ringVerts(m, y1)[0] as number)[1]);
    expect(loop).toHaveLength(8);
    const verts = ringVerts(m, position(m, ringVerts(m, y1)[0] as number)[1]);
    const before = verts.map((v) => position(m, v));
    const ref = { vertex: verts[0] as number, rail: railTo(m, verts[0] as number, y2) };
    expect(ref.rail).toBeGreaterThanOrEqual(0);
    const result = runOk(m, slide, selectionOf('edge', loop, m.counts), { percent: 0.3, reference: ref });
    verts.forEach((v, i) => {
      const p = position(m, v);
      const q = before[i] as [number, number, number];
      // On its vertical rail: x and z bit-equal, y 30 % of the way up (float32).
      expect(p[0]).toBe(q[0]);
      expect(p[2]).toBe(q[2]);
      expect(p[1]).toBe(Math.fround(q[1] + 0.3 * (y2 - q[1])));
    });
    expect(result.selection.edges.toArray()).toEqual(Uint32Array.from(loop));
    // Negative percent: the other side (down toward the bottom ring).
    const n = editMeshFrom(primitive('cylinder', { subdivisionsHeight: 3 }));
    runOk(n, slide, selectionOf('edge', loop, n.counts), { percent: -0.5, reference: ref });
    for (const v of verts) expect(position(n, v)[1]).toBeCloseTo((y1 - 0.5) / 2, 6);
  });

  it('adjust re-solves new percents from the pre-slide positions', () => {
    const m = editMeshFrom(primitive('cylinder', { subdivisionsHeight: 3 }));
    const verts = ringVerts(m, position(m, ringVerts(m, y1)[0] as number)[1]);
    const loop = ringEdges(m, position(m, verts[0] as number)[1]);
    const ref = { vertex: verts[0] as number, rail: railTo(m, verts[0] as number, y2) };
    m.begin('slide');
    const result = slide.run(m, selectionOf('edge', loop, m.counts), { percent: 0.3, reference: ref }, context());
    m.end();
    if (isRefusal(result) || result.adjust === undefined) throw new Error('no adjust');
    m.begin('adjust');
    expect(result.adjust({ percent: 1 })).toBe(true);
    m.end();
    for (const v of verts) expect(position(m, v)[1]).toBeCloseTo(y2, 6);
    m.begin('adjust');
    expect(result.adjust({ reference: null })).toBe(false);
    m.abort();
  });

  it('without a reference the chain through the lowest edge slides to its left side; all vertices the same way', () => {
    const m = editMeshFrom(primitive('cylinder', { subdivisionsHeight: 3 }));
    const verts = ringVerts(m, position(m, ringVerts(m, y1)[0] as number)[1]);
    const loop = ringEdges(m, position(m, verts[0] as number)[1]);
    runOk(m, slide, selectionOf('edge', loop, m.counts), { percent: 0.5 });
    const ys = new Set(verts.map((v) => Math.round(position(m, v)[1] * 1e6)));
    expect(ys.size).toBe(1);
  });

  it('refuses faces and empty selections', () => {
    const m = editMeshFrom(primitive('cube', {}));
    expect(refusedCode(m, slide, selectionOf('face', [0], m.counts))).toBe('slide.no-components');
    expect(refusedCode(m, slide, selectionOf('edge', [], m.counts))).toBe('slide.no-components');
    expect(refusedCode(m, slide, null)).toBe('slide.no-components');
  });
});

describe('mesh.slide (vertices)', () => {
  it('a grid vertex slides along the reference rail, negative percents along the opposite edge', () => {
    const m = editMeshFrom(primitive('plane', { width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    const centre = vertexAt(m, [0, 0, 0]);
    const east = vertexAt(m, [1, 0, 0]);
    const rail = m.findEdge(centre, east);
    runOk(m, slide, selectionOf('vertex', [centre], m.counts), { percent: 0.25, reference: { vertex: centre, rail } });
    expect(position(m, centre)).toEqual([0.25, 0, 0]);
    const n = editMeshFrom(primitive('plane', { width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    runOk(n, slide, selectionOf('vertex', [centre], n.counts), { percent: -0.5, reference: { vertex: centre, rail } });
    expect(position(n, centre)).toEqual([-0.5, 0, 0]);
  });
});

describe('mesh.slide under symmetry (P10)', () => {
  it('a loop and its mirrored loop slide along mirrored rails', () => {
    const m = editMeshFrom(primitive('cube', { width: 2, subdivisionsWidth: 4 }));
    const map = testSymmetryMap(m);
    // The ring of edges around the cube at x = 0.5 (edges with both ends at x = 0.5).
    const loop: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) {
      if (position(m, m.edgeVert(e, 0))[0] === 0.5 && position(m, m.edgeVert(e, 1))[0] === 0.5) loop.push(e);
    }
    expect(loop).toHaveLength(4);
    const v = m.edgeVert(loop[0] as number, 0);
    const rail = m.findEdge(v, vertexAt(m, [1, position(m, v)[1], position(m, v)[2]]));
    runOk(
      m,
      slide,
      selectionOf('edge', loop, m.counts),
      { percent: 0.4, reference: { vertex: v, rail } },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    expect(asymmetry(m, map)).toBeLessThan(1e-6);
    expect(position(m, v)[0]).toBeCloseTo(0.7, 6);
    expect(position(m, map.vertex[v] as number)[0]).toBeCloseTo(-0.7, 6);
  });

  it('seam vertices slide only along rails in the plane', () => {
    // XZ plane 2×2: the row of edges at z = 0 crosses the seam at the centre vertex.
    const m = editMeshFrom(primitive('plane', { width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    const map = testSymmetryMap(m);
    const centre = vertexAt(m, [0, 0, 0]);
    const row = [m.findEdge(centre, vertexAt(m, [1, 0, 0])), m.findEdge(centre, vertexAt(m, [-1, 0, 0]))];
    const east = vertexAt(m, [1, 0, 0]);
    const rail = m.findEdge(east, vertexAt(m, [1, 0, 1]));
    runOk(
      m,
      slide,
      selectionOf('edge', row, m.counts),
      { percent: 0.5, reference: { vertex: east, rail } },
      context({ symmetry: { map, preserveSeam: true } }),
    );
    // The centre's rails run along z (in the plane x = 0): it slides; x stays 0.
    expect(position(m, centre)).toEqual([0, 0, 0.5]);
    expect(asymmetry(m, map)).toBeLessThan(1e-6);
    // A z-row at x = 0 (in-seam edges): its rails leave the plane, so its vertices stay.
    const n = editMeshFrom(primitive('plane', { width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 }));
    const nmap = testSymmetryMap(n);
    const c = vertexAt(n, [0, 0, 0]);
    const column = [n.findEdge(c, vertexAt(n, [0, 0, 1])), n.findEdge(c, vertexAt(n, [0, 0, -1]))];
    const before = n.snapshot();
    runOk(
      n,
      slide,
      selectionOf('edge', column, n.counts),
      { percent: 0.5 },
      context({ symmetry: { map: nmap, preserveSeam: true } }),
    );
    expect(position(n, c)).toEqual(position(before, c));
  });
});
