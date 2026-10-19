// mesh.bevel on concave n-gons (M6A-SPEC §5.9 "valence 2: the bisector between the two strips"): prisms over L-, U-
// and star-shaped caps, whose caps have reflex corners (interior angle over 180°). Concave n-gons are ordinary low-poly
// input (after Multi-Cut, Delete Edge or Combine), and face mode bevels every edge of an L-shaped face.
//
// A miter at a reflex corner is the meet of the two strips' inward offset lines, x − d·(â + b̂), not x + d·(â + b̂)
// (that point lies in the notch, outside the face). Properties, beyond the harness's P1/P5/P8:
// - convex-edge-only bevels never add material (signed volume), concave-edge-only bevels never remove it;
// - every rebuilt face's corners lie inside (or on) its original polygon;
// - with one width everywhere, the chamfer strips of a rectilinear prism (every corner 90° or 270°) are planar.
// The Maya slide rule (§5.9 valence 1: new vertices on the neighbouring edges) is only defined for a slide out of a
// convex face corner, so the edge sets keep every reflex corner with both or neither of its edges selected.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  EDGE_HARD,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  type MeshData,
  MESH_OPS,
  type MeshOp,
  selectionOf,
  topologyStats,
} from '../../../src';
import { buildMeshData, signedVolume, vef } from '../../../src/testing';
import { at, consistentlyWound, ctxOf, edgeBetween, faceVerts, runChecked, runOk } from './harness';

const bevel = MESH_OPS['mesh.bevel'] as MeshOp;

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

/** A prism over the counterclockwise polygon `poly` (z = 0 … h): top cap first, bottom cap, then the side quads. */
function prism(poly: readonly Vec2[], h: number): MeshData {
  const n = poly.length;
  return buildMeshData({
    positions: [...poly.flatMap(([x, y]) => [x, y, 0]), ...poly.flatMap(([x, y]) => [x, y, h])],
    faces: [
      Array.from({ length: n }, (_, i) => n + i),
      Array.from({ length: n }, (_, i) => n - 1 - i),
      ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i]),
    ],
    edgeFlags: EDGE_HARD,
  });
}

const L_CAP: readonly Vec2[] = [
  [0, 0],
  [2, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [0, 2],
];

/** Whether polygon corner i turns clockwise (a reflex corner of a counterclockwise polygon). */
function reflexAt(poly: readonly Vec2[], i: number): boolean {
  const n = poly.length;
  const [px, py] = poly[(i + n - 1) % n] as Vec2;
  const [x, y] = poly[i] as Vec2;
  const [nx, ny] = poly[(i + 1) % n] as Vec2;
  return (x - px) * (ny - y) - (y - py) * (nx - x) < 0;
}

// ---------- geometry checks ----------

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function newellOf(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec3;
    const b = points[(i + 1) % points.length] as Vec3;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** The farthest corner of a polygon from its Newell plane through the centroid. */
function planarity(points: readonly Vec3[]): number {
  const n = newellOf(points);
  const c: Vec3 = [0, 1, 2].map((k) => points.reduce((s, p) => s + (p[k] as number), 0) / points.length) as never;
  return Math.max(...points.map((p) => Math.abs(dot(sub(p, c), n))));
}

/** Whether q lies inside or on the planar polygon `poly` (2D test in the polygon's plane, tolerance `tol`). */
function insidePolygon(q: Vec3, poly: readonly Vec3[], tol: number): boolean {
  const n = newellOf(poly);
  if (Math.abs(dot(sub(q, poly[0] as Vec3), n)) > tol) return false;
  const u0 = Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
  const lu = Math.hypot(...u0);
  const u: Vec3 = [u0[0] / lu, u0[1] / lu, u0[2] / lu];
  const v = cross(n, u);
  const flat = (p: Vec3): Vec2 => [dot(p, u), dot(p, v)];
  const [qx, qy] = flat(q);
  const ring = poly.map(flat);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i] as Vec2;
    const [bx, by] = ring[j] as Vec2;
    // On an edge within tol counts as inside.
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((qx - ax) * ex + (qy - ay) * ey) / (ex * ex + ey * ey)));
    if (Math.hypot(qx - ax - t * ex, qy - ay - t * ey) <= tol) return true;
    if (ay > qy !== by > qy && qx < ((bx - ax) * (qy - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const facePoints = (m: EditMesh | MeshData, f: number): Vec3[] => {
  const mesh = 'snapshot' in m ? m : editMeshFrom(m);
  return faceVerts(mesh, f).map((v) => at(mesh, v));
};

/**
 * Faces of the result outside `bevelFaces` that do not lie inside an original face: each must lie in the plane of
 * an original face (same orientation) and, with `inside`, have every corner inside or on one of the original faces in
 * that plane. (A concave bevel fills its corner: the face across a concave strip's end grows into the notch along the
 * strip's profile, so only the plane holds there.)
 */
function outsideOriginal(
  m: EditMesh,
  original: MeshData,
  bevelFaces: ReadonlySet<number>,
  tol: number,
  inside = true,
): string[] {
  const polys = Array.from({ length: original.counts.faces }, (_, f) => facePoints(original, f));
  const normals = polys.map(newellOf);
  const bad: string[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    if (bevelFaces.has(f)) continue;
    const points = facePoints(m, f);
    const n = newellOf(points);
    const candidates = polys.filter(
      (poly, i) =>
        dot(n, normals[i] as Vec3) > 0.999 && points.every((p) => Math.abs(dot(sub(p, poly[0] as Vec3), n)) <= tol),
    );
    if (candidates.length === 0) bad.push(`face ${f} lies in no original face's plane`);
    if (!inside) continue;
    for (const p of points) {
      if (!candidates.some((poly) => insidePolygon(p, poly, tol))) bad.push(`face ${f} corner ${p.join(',')}`);
    }
  }
  return bad;
}

// ---------- the reported case ----------

describe('reflex corners (§5.9 valence 2)', () => {
  /** The two top-cap edges at the notch corner (1, 1, 1) of the L prism. */
  const notchEdges = (m: EditMesh): number[] => [
    edgeBetween(m, [2, 1, 1], [1, 1, 1]),
    edgeBetween(m, [1, 1, 1], [1, 2, 1]),
  ];

  it('two cap edges at a reflex corner miter at the meet of their inward offset lines', () => {
    const m = editMeshFrom(prism(L_CAP, 1));
    const before = signedVolume(m);
    const edges = notchEdges(m);
    expect(edges).not.toContain(-1);
    const result = runOk(bevel, m, selectionOf('edge', edges, m.counts), { fraction: 0.5 });
    // d = 0.5 × ½ × 1 = 0.25 at every end: the cap's corner moves inward to (0.75, 0.75, 1), not into the notch.
    const points = Array.from({ length: m.counts.points }, (_, v) => at(m, v));
    const near = (q: Vec3) => points.some((p) => Math.hypot(...sub(p, q)) <= 1e-6);
    expect(near([0.75, 0.75, 1])).toBe(true);
    expect(near([1.25, 1.25, 1])).toBe(false);
    // Both strips are planar chamfers: y + z = 1.75 and x + z = 1.75.
    const strips = Array.from(result.selection.faces.toArray(), (f) => facePoints(m, f));
    expect(strips).toHaveLength(2);
    const planes = strips.map((pts) => {
      expect(planarity(pts)).toBeLessThanOrEqual(1e-6);
      return pts.every((p) => Math.abs(p[1] + p[2] - 1.75) <= 1e-6)
        ? 'y+z'
        : pts.every((p) => Math.abs(p[0] + p[2] - 1.75) <= 1e-6)
          ? 'x+z'
          : 'other';
    });
    expect(planes.sort()).toEqual(['x+z', 'y+z']);
    // Two convex edges: the bevel removes material (two wedges of 1 × 0.25² / 2, less their overlap at the corner).
    expect(signedVolume(m)).toBeLessThan(before);
    expect(outsideOriginal(m, prism(L_CAP, 1), new Set(result.selection.faces.toArray()), 1e-6)).toEqual([]);
    expect(topologyStats(m)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, euler: 2 });
  });

  it('a reflex miter that would cross the far side of a thin arm is clamped (the rebuilt face stays simple)', () => {
    // Arms 0.25 thick: at fraction 0.8 the notch miter (d ≈ 0.25 along both axes) would reach the corner (0, 0).
    const thin: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 0.25],
      [0.25, 0.25],
      [0.25, 1],
      [0, 1],
    ];
    const data = prism(thin, 0.63);
    const m = editMeshFrom(data);
    const edges = [
      edgeBetween(m, [1, 0.25, 0.63], [0.25, 0.25, 0.63]),
      edgeBetween(m, [0.25, 0.25, 0.63], [0.25, 1, 0.63]),
    ];
    expect(edges).not.toContain(-1);
    const result = runOk(bevel, m, selectionOf('edge', edges, m.counts), { fraction: 0.8 });
    expect(result.warnings.map((w) => w.code)).toEqual(['bevel.clamped']);
    expect(outsideOriginal(m, data, new Set(result.selection.faces.toArray()), 1e-6)).toEqual([]);
    expect(consistentlyWound(m)).toBe(true);
  });

  it('uv0 at a reflex miter extrapolates the face’s affine map (a planar projection stays exact)', () => {
    const data = prism(L_CAP, 1);
    // The cap's corners come first (face 0): uv0 = (x, y) there, the planar projection along Z.
    const uv = new Float32Array(2 * data.counts.corners);
    L_CAP.forEach(([x, y], i) => uv.set([x, y], 2 * i));
    const layers = new Map(data.layers);
    layers.set('uv0', { def: BUILTIN_LAYERS.uv0, data: uv });
    const m = editMeshFrom({ ...data, layers });
    runOk(bevel, m, selectionOf('edge', notchEdges(m), m.counts), { fraction: 0.5 });
    const layer = m.layer('uv0');
    let cap = -1;
    for (let f = 0; f < m.counts.faces; f++) {
      if (facePoints(m, f).every((p) => Math.abs(p[2] - 1) <= 1e-9) && m.faceLen(f) >= 6) cap = f;
    }
    expect(cap).not.toBe(-1);
    const start = m.faceCorner(cap);
    let c = start;
    let checked = 0;
    do {
      const p = at(m, m.cornerVert(c));
      expect(layer?.get(c, 0)).toBeCloseTo(p[0], 6);
      expect(layer?.get(c, 1)).toBeCloseTo(p[1], 6);
      checked++;
      c = m.cornerNext(c);
    } while (c !== start);
    expect(checked).toBe(m.faceLen(cap));
  });

  it('every edge of the L prism: the corner patch at the notch uses the inward miter', () => {
    const m = editMeshFrom(prism(L_CAP, 1));
    const before = signedVolume(m);
    const result = runOk(
      bevel,
      m,
      selectionOf(
        'edge',
        Array.from({ length: m.counts.edges }, (_, e) => e),
        m.counts,
      ),
      { fraction: 0.5 },
    );
    const points = Array.from({ length: m.counts.points }, (_, v) => at(m, v));
    for (const z of [0, 1]) {
      expect(points.some((p) => Math.hypot(...sub(p, [0.75, 0.75, z])) <= 1e-6)).toBe(true);
      expect(points.some((p) => Math.hypot(p[0] - 1.25, p[1] - 1.25) <= 1e-6)).toBe(false);
    }
    expect(signedVolume(m)).toBeLessThan(before);
    expect(outsideOriginal(m, prism(L_CAP, 1), new Set(result.selection.faces.toArray()), 1e-6)).toEqual([]);
    expect(consistentlyWound(m)).toBe(true);
  });

  it('face mode on the L-shaped cap bevels its six edges inward', () => {
    const m = editMeshFrom(prism(L_CAP, 1));
    const before = signedVolume(m);
    const result = runOk(bevel, m, selectionOf('face', [0], m.counts), { fraction: 0.5, segments: 2 });
    // Six strips of two rows each, plus the shrunk cap (face mode keeps it selected).
    expect(result.selection.faces.count()).toBe(13);
    expect(vef(m)).toBe('24/42/20');
    const points = Array.from({ length: m.counts.points }, (_, v) => at(m, v));
    expect(points.some((p) => Math.hypot(...sub(p, [0.75, 0.75, 1])) <= 1e-6)).toBe(true);
    expect(signedVolume(m)).toBeLessThan(before);
    const shrunk = Array.from(result.selection.faces.toArray()).filter((f) => m.faceLen(f) === 6);
    expect(shrunk).toHaveLength(1);
    for (const p of facePoints(m, shrunk[0] as number)) {
      expect(insidePolygon(p, facePoints(prism(L_CAP, 1), 0), 1e-6)).toBe(true);
    }
  });
});

// ---------- properties over concave prisms ----------

interface Shape {
  readonly name: string;
  readonly poly: readonly Vec2[];
  readonly h: number;
  /** Every corner 90° or 270° (L, U). */
  readonly rectilinear: boolean;
}

const size = (min: number, max: number) => fc.double({ min, max, noNaN: true });

const arbL = fc.record({ a: size(1, 3), d: size(1, 3), s: size(0.25, 0.75), t: size(0.25, 0.75), h: size(0.3, 2) }).map(
  ({ a, d, s, t, h }): Shape => ({
    name: 'L',
    poly: [
      [0, 0],
      [a, 0],
      [a, d * t],
      [a * s, d * t],
      [a * s, d],
      [0, d],
    ],
    h,
    rectilinear: true,
  }),
);

const arbU = fc.record({ w: size(1.5, 3), hg: size(1, 3), p: size(0.2, 0.4), b: size(0.2, 0.7), h: size(0.3, 2) }).map(
  ({ w, hg, p, b, h }): Shape => ({
    name: 'U',
    poly: [
      [0, 0],
      [w, 0],
      [w, hg],
      [w * (1 - p), hg],
      [w * (1 - p), hg * b],
      [w * p, hg * b],
      [w * p, hg],
      [0, hg],
    ],
    h,
    rectilinear: true,
  }),
);

const arbStar = fc
  .record({ n: fc.integer({ min: 5, max: 8 }), r: size(0.35, 0.7), phase: size(0, 1), h: size(0.3, 2) })
  .map(
    ({ n, r, phase, h }): Shape => ({
      name: 'star',
      poly: Array.from({ length: 2 * n }, (_, i): Vec2 => {
        const angle = ((i + phase) * Math.PI) / n;
        const radius = i % 2 === 0 ? 1 : r;
        return [radius * Math.cos(angle), radius * Math.sin(angle)];
      }),
      h,
      rectilinear: false,
    }),
  );

const arbShape = fc.oneof(arbL, arbU, arbStar);

type Mode = 'convex' | 'concave' | 'mixed';

/**
 * An edge set of the prism over `shape` by mode: convex edges (cap edges and the side edges at convex corners),
 * concave edges (the side edges at reflex corners) or any. Every reflex cap corner ends with both or neither of its
 * edges selected (the slide rule needs a convex corner); closing a convex set adds cap edges only, so it stays convex.
 */
function edgeSet(m: EditMesh, shape: Shape, mode: Mode, seeds: readonly number[]): number[] {
  const n = shape.poly.length;
  const vertical = (e: number): number => {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    return Math.abs(a - b) === n ? Math.min(a, b) : -1;
  };
  const concave = (e: number): boolean => vertical(e) !== -1 && reflexAt(shape.poly, vertical(e));
  const pool = Array.from({ length: m.counts.edges }, (_, e) => e).filter((e) =>
    mode === 'mixed' ? true : mode === 'concave' ? concave(e) : !concave(e),
  );
  const set = new Set(seeds.map((s) => pool[s % pool.length] as number));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (!reflexAt(shape.poly, i)) continue;
      for (const base of [0, n]) {
        const pair = [m.findEdge(base + ((i + n - 1) % n), base + i), m.findEdge(base + i, base + ((i + 1) % n))];
        const picked = pair.filter((e) => set.has(e)).length;
        if (picked === 1) {
          for (const e of pair) set.add(e);
          changed = true;
        }
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

describe('clamp and P1–P4 on concave prisms', () => {
  it('convex-only bevels remove material inside the original faces; concave-only bevels add material', () => {
    const seen = { convex: 0, concave: 0, mixed: 0 };
    fc.assert(
      fc.property(
        arbShape,
        fc.constantFrom<Mode>('convex', 'concave', 'mixed'),
        fc.array(fc.nat(), { minLength: 1, maxLength: 8 }),
        fc.record({
          fraction: size(0.01, 1),
          segments: fc.integer({ min: 1, max: 3 }),
          chamfer: fc.boolean(),
          roundness: size(0, 0.9),
        }),
        (shape, mode, seeds, args) => {
          const data = prism(shape.poly, shape.h);
          const m = editMeshFrom(data);
          const volume = signedVolume(m);
          const edges = edgeSet(m, shape, mode, seeds);
          const ctx = ctxOf(m);
          const { result } = runChecked(bevel, m, selectionOf('edge', edges, m.counts), args, ctx);
          if (isRefusal(result)) throw new Error(`${shape.name} ${mode}: ${result.code} ${result.reason}`);
          seen[mode]++;
          expect(consistentlyWound(m)).toBe(true);
          expect(topologyStats(m)).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, euler: 2 });
          const after = signedVolume(m);
          expect(after).toBeGreaterThan(0);
          // Roundness above 0.5 puts the profile's control point C′ past the original corner (§5.9), so a profile
          // leaves the original faces near its ends: the material and inside checks hold for the other profiles.
          const tame = args.chamfer || args.roundness <= 0.5;
          const removes = !(tame && mode === 'convex') || after <= volume * (1 + 1e-6);
          const adds = !(tame && mode === 'concave') || after >= volume * (1 - 1e-6);
          expect({ shape: shape.name, mode, volume, after, removes, adds }).toMatchObject({
            removes: true,
            adds: true,
          });
          const bevelFaces = new Set(result.selection.faces.toArray());
          const inside = tame && mode === 'convex';
          expect(outsideOriginal(m, data, bevelFaces, 1e-5, inside), `${shape.name} ${mode}`).toEqual([]);
        },
      ),
      { numRuns: 300, seed: 17 },
    );
    expect(seen.convex).toBeGreaterThan(50);
    expect(seen.concave).toBeGreaterThan(50);
    expect(seen.mixed).toBeGreaterThan(50);
  });

  it('face mode on either cap of a concave prism bevels inward and removes material', () => {
    fc.assert(
      fc.property(arbShape, fc.subarray([0, 1], { minLength: 1 }), size(0.01, 1), (shape, caps, fraction) => {
        const data = prism(shape.poly, shape.h);
        const m = editMeshFrom(data);
        const volume = signedVolume(m);
        const result = runOk(bevel, m, selectionOf('face', caps, m.counts), { fraction });
        expect(signedVolume(m)).toBeLessThanOrEqual(volume * (1 + 1e-6));
        // The shrunk caps are part of selection′ (Maya): each must lie inside its original cap.
        const shrunk = Array.from(result.selection.faces.toArray()).filter((f) => m.faceLen(f) === shape.poly.length);
        expect(shrunk).toHaveLength(caps.length);
        const originals = caps.map((f) => facePoints(data, f));
        for (const f of shrunk) {
          const points = facePoints(m, f);
          expect(originals.some((poly) => points.every((p) => insidePolygon(p, poly, 1e-5)))).toBe(true);
        }
      }),
      { numRuns: 80, seed: 19 },
    );
  });

  it('with one width everywhere, the chamfer rows of a rectilinear prism are planar', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbL, arbU),
        fc.array(fc.nat(), { minLength: 1, maxLength: 10 }),
        size(0.05, 1),
        fc.integer({ min: 1, max: 3 }),
        (shape, seeds, share, segments) => {
          const data = prism(shape.poly, shape.h);
          const m = editMeshFrom(data);
          let shortest = Infinity;
          for (let e = 0; e < m.counts.edges; e++) {
            shortest = Math.min(shortest, Math.hypot(...sub(at(m, m.edgeVert(e, 0)), at(m, m.edgeVert(e, 1)))));
          }
          // Below the 0.98 clamp at every vertex, so every width is the same (the λ search scales them together).
          const offset = share * 0.49 * shortest;
          const edges = edgeSet(m, shape, 'mixed', seeds);
          const result = runOk(bevel, m, selectionOf('edge', edges, m.counts), {
            offsetAsFraction: false,
            offset,
            segments,
          });
          for (const f of result.selection.faces.toArray()) {
            if (m.faceLen(f) < 4) continue;
            expect(planarity(facePoints(m, f)), `${shape.name} face ${f}`).toBeLessThanOrEqual(1e-5);
          }
        },
      ),
      { numRuns: 150, seed: 23 },
    );
  });
});
