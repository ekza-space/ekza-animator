// The humanoid body generator (M6A-SPEC §5.16, §9 B13 tests): 400–900 triangles, closed, manifold, consistently
// wound outwards, X-symmetric with every off-seam vertex partnered exactly, T-pose, grounded, facing +Z, with one
// hexagonal n-gon cap at each hand (normal ±X) and foot (normal −Y); `segmented` = separate closed shells.
import {
  computeNormals,
  EDGE_HARD,
  editMeshFrom,
  type EditMesh,
  humanoidBody,
  type MeshData,
  primitive,
  topologyStats,
  triangulate,
  validateMesh,
} from '../../src';
import { signedVolume } from '../../src/testing';

type Style = 'smooth' | 'segmented';
const STYLES: readonly Style[] = ['smooth', 'segmented'];

function faceVerts(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const first = m.faceCorner(f);
  let c = first;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== first);
  return out;
}

function centroid(m: EditMesh, f: number): [number, number, number] {
  const vs = faceVerts(m, f);
  const c: [number, number, number] = [0, 0, 0];
  for (const v of vs)
    for (let i = 0; i < 3; i++) c[i] = (c[i] as number) + (m.position[3 * v + i] as number) / vs.length;
  return c;
}

const pos = (m: EditMesh | MeshData, v: number): [number, number, number] => [
  m.position[3 * v] as number,
  m.position[3 * v + 1] as number,
  m.position[3 * v + 2] as number,
];

/** Faces whose Newell normal is within 1e-6 of `axis` and whose centroid is extreme along it. */
function caps(m: EditMesh, data: MeshData, axis: readonly [number, number, number]): number[] {
  const normals = computeNormals(data).face;
  const out: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    const n = [normals[3 * f] as number, normals[3 * f + 1] as number, normals[3 * f + 2] as number];
    if (Math.abs((n[0] as number) * axis[0] + (n[1] as number) * axis[1] + (n[2] as number) * axis[2] - 1) < 1e-5) {
      out.push(f);
    }
  }
  return out;
}

describe.each(STYLES)('humanoidBody (%s)', (style) => {
  const data = humanoidBody({ style, height: 1.6 });
  const m = editMeshFrom(data);
  const stats = topologyStats(m);

  it('is valid, closed and manifold, 400–900 triangles, every edge hard, paint slot 0', () => {
    expect(validateMesh(m)).toEqual([]);
    expect(stats.boundaryLoops).toBe(0);
    expect(stats.nonManifoldEdges).toBe(0);
    expect(stats.nonManifoldVerts).toBe(0);
    const tris = triangulate(data).tris.length / 3;
    expect(tris).toBeGreaterThanOrEqual(400);
    expect(tris).toBeLessThanOrEqual(900);
    expect(tris).toBe(style === 'smooth' ? 494 : 560);
    expect([...data.edgeFlags].every((flags) => (flags & EDGE_HARD) !== 0)).toBe(true);
    expect([...(data.layers.get('paint')?.data ?? [1])].every((slot) => slot === 0)).toBe(true);
  });

  it('has the shells of its style, each a sphere (χ = 2)', () => {
    expect(stats.shells).toBe(style === 'smooth' ? 1 : 16);
    expect(stats.euler).toBe(2 * stats.shells);
  });

  it('is wound consistently and outwards (every edge walked both ways, positive volume)', () => {
    for (let e = 0; e < m.counts.edges; e++) {
      expect(m.edgeFaceCount(e)).toBe(2);
      const c = m.edgeCorner(e);
      const r = m.cornerRadialNext(c);
      // the two corners on an edge start at opposite ends
      expect(m.cornerVert(c)).not.toBe(m.cornerVert(r));
    }
    expect(signedVolume(data)).toBeGreaterThan(0);
  });

  it('is X-symmetric: seam vertices on x = 0 exactly, every other vertex mirrored exactly, faces mirrored', () => {
    const key = (p: readonly number[]): string => p.join(',');
    const at = new Map<string, number>();
    for (let v = 0; v < m.counts.points; v++) at.set(key(pos(m, v)), v);
    const partner = new Int32Array(m.counts.points);
    let seam = 0;
    for (let v = 0; v < m.counts.points; v++) {
      const [x, y, z] = pos(m, v);
      if (x === 0) seam += 1;
      const mirrored = at.get(key([x === 0 ? 0 : -x, y, z]));
      expect(mirrored, `vertex ${v} at ${x},${y},${z} has a partner`).toBeDefined();
      partner[v] = mirrored as number;
    }
    expect(seam).toBeGreaterThan(0);
    const faces = new Set<string>();
    const canonical = (vs: readonly number[]): string => [...vs].sort((a, b) => a - b).join(',');
    for (let f = 0; f < m.counts.faces; f++) faces.add(canonical(faceVerts(m, f)));
    for (let f = 0; f < m.counts.faces; f++) {
      expect(faces.has(canonical(faceVerts(m, f).map((v) => partner[v] as number)))).toBe(true);
    }
  });

  it('stands in T-pose on the ground, 1.6 m tall, facing +Z', () => {
    let [minY, maxY, maxX] = [Infinity, -Infinity, -Infinity];
    for (let v = 0; v < m.counts.points; v++) {
      const [x, y] = pos(m, v);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      maxX = Math.max(maxX, x);
    }
    expect(minY).toBe(0);
    expect(maxY).toBeCloseTo(1.6, 6);
    // the arms reach about the height (T-pose) at shoulder level
    expect(2 * maxX).toBeGreaterThan(1.4);
    // segmented limbs also have inner caps facing ±X and −Y: the hand and foot caps are the outermost ones
    const hands = caps(m, data, [1, 0, 0])
      .concat(caps(m, data, [-1, 0, 0]))
      .filter((f) => Math.abs(Math.abs(centroid(m, f)[0]) - maxX) < 1e-6);
    expect(hands).toHaveLength(2);
    for (const f of hands) {
      expect(faceVerts(m, f)).toHaveLength(6);
      const c = centroid(m, f);
      expect(Math.abs(c[0])).toBeCloseTo(maxX, 6);
      expect(c[1]).toBeCloseTo(1.25, 6);
    }
    const feet = caps(m, data, [0, -1, 0]).filter((f) => centroid(m, f)[1] === 0);
    expect(feet).toHaveLength(2);
    for (const f of feet) {
      expect(faceVerts(m, f)).toHaveLength(6);
      const c = centroid(m, f);
      expect(c[1]).toBe(0);
      // the feet reach forward (+Z)
      expect(c[2]).toBeGreaterThan(0);
    }
  });

  it('the left hand cap is the face with the largest centroid x (E2E-MOD-04 picks it that way)', () => {
    let best = -1;
    let bestX = -Infinity;
    for (let f = 0; f < m.counts.faces; f++) {
      const x = centroid(m, f)[0];
      if (x > bestX) [best, bestX] = [f, x];
    }
    expect(caps(m, data, [1, 0, 0])).toContain(best);
    expect(faceVerts(m, best)).toHaveLength(6);
  });

  it('scales with height (0.5…3, clamped) and is deterministic', () => {
    const tall = editMeshFrom(humanoidBody({ style, height: 2.4 }));
    for (let v = 0; v < m.counts.points; v++) {
      const [x, y, z] = pos(m, v);
      const [tx, ty, tz] = pos(tall, v);
      expect(tx).toBeCloseTo(x * 1.5, 5);
      expect(ty).toBeCloseTo(y * 1.5, 5);
      expect(tz).toBeCloseTo(z * 1.5, 5);
    }
    const again = humanoidBody({ style, height: 1.6 });
    expect(again.position).toEqual(data.position);
    expect(again.cornerVert).toEqual(data.cornerVert);
    const clamped = humanoidBody({ style, height: 10 });
    expect(Math.max(...Array.from({ length: clamped.counts.points }, (_, v) => pos(clamped, v)[1]))).toBeCloseTo(3, 5);
  });
});

describe('smooth body topology', () => {
  const data = humanoidBody({ style: 'smooth', height: 1.6 });
  const m = editMeshFrom(data);

  it('has 6-sided limbs, 8-sided torso rings and quads everywhere except the three end caps per side', () => {
    const lengths = new Map<number, number>();
    for (let f = 0; f < m.counts.faces; f++) {
      const n = faceVerts(m, f).length;
      lengths.set(n, (lengths.get(n) ?? 0) + 1);
    }
    expect(Object.fromEntries(lengths)).toEqual({ 4: 236, 6: 4, 8: 1 });
    expect(m.counts.points).toBe(249);
  });

  it('crosses the seam with edges on x = 0 down the torso front (Multi-Cut on the centre line, E2E-MOD-20)', () => {
    let seamEdges = 0;
    for (let e = 0; e < m.counts.edges; e++) {
      const [a, b] = [m.edgeVert(e, 0), m.edgeVert(e, 1)];
      if (pos(m, a)[0] === 0 && pos(m, b)[0] === 0) seamEdges += 1;
    }
    expect(seamEdges).toBeGreaterThan(10);
  });

  it('primitive("humanoidBody") delegates to the generator', () => {
    const viaPrimitive = primitive('humanoidBody', { height: 1.6, style: 'smooth' });
    expect(viaPrimitive.position).toEqual(data.position);
    const segmented = primitive('humanoidBody', { style: 'segmented' });
    expect(topologyStats(segmented).shells).toBe(16);
  });
});
