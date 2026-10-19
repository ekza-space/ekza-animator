// Grow, shrink and convert (M6A-SPEC §5.6): adjacency by shared vertices, touching vs contained, perimeter, border,
// shell, loop and ring conversions; hidden components never added; per-mode memory of the other kinds kept.
import { describe, expect, it } from 'vitest';
import {
  BitSet,
  type ComponentKind,
  convertSelection,
  edgeLoop,
  edgeRing,
  editMeshFrom,
  growSelection,
  shrinkSelection,
} from '../../src';
import { buildMeshData, cubeData } from '../../src/testing';
import {
  faceCentroid,
  faceVerts,
  hiddenSet,
  hideFaces,
  members,
  membersOf,
  mesh,
  position,
  sel,
  sorted,
  vertexAt,
} from './fixtures';

/** The 4 × 4 plane (25/40/16) in XZ, vertices at x, z ∈ {−0.5, −0.25, 0, 0.25, 0.5}. */
const grid = (): ReturnType<typeof mesh> => mesh('plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 });

/** Faces of the grid whose centroid lies within the box |x|, |z| ≤ r. */
const facesWithin = (m: ReturnType<typeof mesh>, x0: number, x1: number, z0: number, z1: number): number[] => {
  const out: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    const [x, , z] = faceCentroid(m, f);
    if (x > x0 && x < x1 && z > z0 && z < z1) out.push(f);
  }
  return out;
};

describe('grow and shrink', () => {
  it('vertices grow across edges and faces (a 3 × 3 block, then the whole grid) and shrink back', () => {
    const m = grid();
    expect(m.counts).toMatchObject({ points: 25, edges: 40, faces: 16 });
    const centre = vertexAt(m, 0, 0, 0);
    const once = growSelection(m, sel(m, 'vertex', [centre]));
    expect(membersOf(once).length).toBe(9);
    for (const v of membersOf(once)) {
      const [x, , z] = position(m, v);
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThan(0.3);
    }
    expect(membersOf(growSelection(m, once)).length).toBe(25);
    expect(membersOf(shrinkSelection(m, once))).toEqual([centre]);
    // Order: the picks first, the grown members after them (ascending); the active pick is kept.
    expect(once.order?.[once.order.length - 1]).toBe(centre);
    expect(once.active).toBe(centre);
  });

  it('edges grow to every edge sharing a vertex; faces to every face sharing a vertex', () => {
    const m = grid();
    const e = m.findEdge(vertexAt(m, 0, 0, 0), vertexAt(m, 0.25, 0, 0));
    expect(membersOf(growSelection(m, sel(m, 'edge', [e]))).length).toBe(7);
    const inner = facesWithin(m, -0.25, 0, -0.25, 0);
    expect(inner.length).toBe(1);
    const grown = growSelection(m, sel(m, 'face', inner));
    expect(sorted(membersOf(grown))).toEqual(sorted(facesWithin(m, -0.5, 0.25, -0.5, 0.25)));
    // Shrink removes only faces touching an unselected face; the mesh border is no neighbour (Blender's select
    // less), so the block's 2 × 2 corner at the grid corner stays.
    expect(sorted(membersOf(shrinkSelection(m, grown)))).toEqual(sorted(facesWithin(m, -0.5, 0, -0.5, 0)));
    // Away from the border a 3 × 3 block shrinks to its centre.
    const big = mesh('plane', { width: 6, height: 6, subdivisionsWidth: 6, subdivisionsHeight: 6 });
    const block = growSelection(big, sel(big, 'face', facesWithin(big, -1, 0, -1, 0)));
    expect(membersOf(block).length).toBe(9);
    expect(membersOf(shrinkSelection(big, block))).toEqual(facesWithin(big, -1, 0, -1, 0));
  });

  it('shrink keeps a selection with no unselected neighbour (a whole grid)', () => {
    const m = grid();
    const all = sel(m, 'face', [...Array(16).keys()]);
    expect(membersOf(shrinkSelection(m, all)).length).toBe(16);
  });

  it('hidden components are never added and do not count as unselected neighbours', () => {
    const m = grid();
    const inner = facesWithin(m, -0.25, 0, -0.25, 0);
    const neighbours = facesWithin(m, -0.5, 0.25, -0.5, 0.25).filter((f) => f !== inner[0]);
    const hidden = hiddenSet(m, { faces: neighbours.slice(0, 4) });
    const grown = growSelection(m, sel(m, 'face', inner), hidden);
    expect(membersOf(grown).length).toBe(5);
    for (const f of neighbours.slice(0, 4)) expect(grown.faces.has(f)).toBe(false);
    // The 5 shrink to the inner face only if its visible neighbours are all selected: hiding the other 4 too keeps it.
    const allHidden = hiddenSet(m, { faces: neighbours });
    expect(membersOf(shrinkSelection(m, sel(m, 'face', inner), allHidden))).toEqual(inner);
  });

  it('only the selection kind changes: the other kinds are copies (per-mode memory), never aliases', () => {
    const m = grid();
    const s0 = sel(m, 'vertex', [vertexAt(m, 0, 0, 0)]);
    s0.edges.add(3);
    s0.faces.add(5);
    const grown = growSelection(m, s0);
    expect(members(grown.edges)).toEqual([3]);
    expect(members(grown.faces)).toEqual([5]);
    expect(grown.edges).not.toBe(s0.edges);
    grown.faces.add(6);
    expect(members(s0.faces)).toEqual([5]);
    expect(members(s0.verts)).toEqual([vertexAt(m, 0, 0, 0)]);
  });
});

describe('convert', () => {
  const cube = (): ReturnType<typeof mesh> => mesh('cube');
  const top = (m: ReturnType<typeof mesh>): number =>
    [...Array(m.counts.faces).keys()].find((f) => faceCentroid(m, f)[1] > 0.49) as number;

  it('touching and contained between every pair of kinds (cube top face)', () => {
    const m = cube();
    const t = top(m);
    const f = sel(m, 'face', [t]);
    const verts = convertSelection(m, f, 'vertex', 'touching');
    expect(verts.kind).toBe('vertex');
    expect(sorted(membersOf(verts))).toEqual(sorted(faceVerts(m, t)));
    expect(membersOf(convertSelection(m, f, 'edge', 'touching')).length).toBe(4);
    expect(membersOf(convertSelection(m, f, 'face', 'touching'))).toEqual([t]);
    expect(membersOf(convertSelection(m, verts, 'face', 'touching')).length).toBe(5);
    expect(membersOf(convertSelection(m, verts, 'face', 'contained'))).toEqual([t]);
    expect(membersOf(convertSelection(m, verts, 'edge', 'touching')).length).toBe(8);
    expect(membersOf(convertSelection(m, verts, 'edge', 'contained')).length).toBe(4);
    const edges = convertSelection(m, f, 'edge', 'contained');
    expect(membersOf(convertSelection(m, edges, 'face', 'touching')).length).toBe(5);
    expect(membersOf(convertSelection(m, edges, 'face', 'contained'))).toEqual([t]);
    expect(membersOf(convertSelection(m, edges, 'vertex', 'contained')).length).toBe(4);
    // Contained over a single edge: no face has every edge selected.
    expect(membersOf(convertSelection(m, sel(m, 'edge', [0]), 'face', 'contained'))).toEqual([]);
  });

  it('perimeter: the boundary of the selected face region (faces, or faces a vertex/edge selection contains)', () => {
    const m = grid();
    const block = facesWithin(m, -0.25, 0.25, -0.25, 0.25); // 2 × 2
    expect(block.length).toBe(4);
    const s = sel(m, 'face', block);
    expect(membersOf(convertSelection(m, s, 'edge', 'perimeter')).length).toBe(8);
    expect(membersOf(convertSelection(m, s, 'vertex', 'perimeter')).length).toBe(8);
    expect(sorted(membersOf(convertSelection(m, s, 'face', 'perimeter')))).toEqual(sorted(block));
    const big = facesWithin(m, -0.5, 0.25, -0.5, 0.25); // 3 × 3
    const perimeterFaces = membersOf(convertSelection(m, sel(m, 'face', big), 'face', 'perimeter'));
    expect(perimeterFaces.length).toBe(8);
    expect(perimeterFaces).not.toContain(facesWithin(m, -0.25, 0, -0.25, 0)[0]);
    // From vertices: a 3 × 3 vertex block contains the 2 × 2 faces.
    const vs: number[] = [];
    for (const x of [-0.25, 0, 0.25]) for (const z of [-0.25, 0, 0.25]) vs.push(vertexAt(m, x, 0, z));
    expect(membersOf(convertSelection(m, sel(m, 'vertex', vs), 'edge', 'perimeter')).length).toBe(8);
    // Mesh-border edges of region faces are perimeter edges too.
    const corner = facesWithin(m, -0.5, -0.25, -0.5, -0.25);
    expect(membersOf(convertSelection(m, sel(m, 'face', corner), 'edge', 'perimeter')).length).toBe(4);
  });

  it('border: whole mesh-border loops touching the selection', () => {
    const m = grid();
    expect(membersOf(convertSelection(m, sel(m, 'vertex', [vertexAt(m, 0, 0, 0)]), 'edge', 'border'))).toEqual([]);
    const corner = sel(m, 'vertex', [vertexAt(m, -0.5, 0, -0.5)]);
    const border = convertSelection(m, corner, 'edge', 'border');
    expect(membersOf(border).length).toBe(16);
    for (const e of membersOf(border)) expect(m.edgeFaceCount(e)).toBe(1);
    expect(membersOf(convertSelection(m, corner, 'vertex', 'border')).length).toBe(16);
    expect(membersOf(convertSelection(m, corner, 'face', 'border')).length).toBe(12);
  });

  it('shell: the connected piece touching the selection (two cubes in one mesh)', () => {
    const one = cubeData();
    const positions = [...one.position, ...Array.from(one.position, (v, i) => (i % 3 === 0 ? v + 3 : v))];
    const faces: number[][] = [];
    for (let f = 0; f < 6; f++) {
      const vs: number[] = [];
      for (let c = 0; c < 4; c++) vs.push(one.cornerVert[4 * f + c] as number);
      faces.push(
        vs,
        vs.map((v) => v + 8),
      );
    }
    const m = editMeshFrom(buildMeshData({ positions, faces }));
    expect(m.counts).toMatchObject({ points: 16, edges: 24, faces: 12 });
    const s = sel(m, 'face', [0]);
    const shellFaces = membersOf(convertSelection(m, s, 'face', 'shell'));
    expect(shellFaces).toEqual([0, 2, 4, 6, 8, 10]);
    expect(membersOf(convertSelection(m, s, 'vertex', 'shell'))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(membersOf(convertSelection(m, s, 'edge', 'shell')).length).toBe(12);
  });

  it('loop and ring: the loops / rings of the selected edges, then converted touching', () => {
    const m = mesh('torus');
    const e = 0;
    const loop = sorted(edgeLoop(m, e));
    const ring = sorted(edgeRing(m, e));
    expect(sorted(membersOf(convertSelection(m, sel(m, 'edge', [e]), 'edge', 'loop')))).toEqual(loop);
    expect(sorted(membersOf(convertSelection(m, sel(m, 'edge', [e]), 'edge', 'ring')))).toEqual(ring);
    // A ring converted to faces is the face strip between the ring edges.
    expect(membersOf(convertSelection(m, sel(m, 'edge', [e]), 'face', 'ring')).length).toBe(ring.length);
    expect(membersOf(convertSelection(m, sel(m, 'edge', [e]), 'vertex', 'loop')).length).toBe(loop.length);
    // From vertices: the loops of the edges between selected vertices.
    const v0 = m.edgeVert(e, 0);
    const v1 = m.edgeVert(e, 1);
    expect(sorted(membersOf(convertSelection(m, sel(m, 'vertex', [v0, v1]), 'edge', 'loop')))).toEqual(loop);
    // Cube: a ring of four parallel edges touches the four faces around them.
    const c = mesh('cube');
    expect(membersOf(convertSelection(c, sel(c, 'edge', [0]), 'face', 'ring')).length).toBe(4);
  });

  it('hidden components are left out of every conversion', () => {
    const m = cube();
    const t = top(m);
    const hidden = hideFaces(m, [t]);
    const all = sel(m, 'vertex', [...Array(8).keys()]);
    const faces = membersOf(convertSelection(m, all, 'face', 'contained', hidden));
    expect(faces.length).toBe(5);
    expect(faces).not.toContain(t);
    const h2 = hiddenSet(m, { verts: [faceVerts(m, t)[0] as number] });
    expect(membersOf(convertSelection(m, sel(m, 'face', [t]), 'vertex', 'touching', h2)).length).toBe(3);
  });

  it('the same kind keeps its pick order; a new kind starts ascending', () => {
    const m = grid();
    const s = sel(m, 'face', [9, 2, 5]);
    const same = convertSelection(m, s, 'face', 'touching');
    expect(Array.from(same.order ?? [])).toEqual([9, 2, 5]);
    expect(same.active).toBe(5);
    const v = convertSelection(m, s, 'vertex', 'touching');
    const order = Array.from(v.order ?? []);
    expect(order).toEqual(sorted(order));
  });

  it('rejects unknown kinds and modes (caller errors)', () => {
    const m = grid();
    expect(() => convertSelection(m, sel(m, 'face', [0]), 'face', 'nope' as never)).toThrow(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
    expect(() => convertSelection(m, sel(m, 'face', [0]), 'uv' as ComponentKind, 'touching')).toThrow(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
    expect(new BitSet(1).size).toBe(1);
  });
});
