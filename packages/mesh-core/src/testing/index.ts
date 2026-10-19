// `@ekza-animator/mesh-core/testing` (M6A-SPEC §4.3, §5.29): fixtures, state dumps, fast-check arbitraries and the
// golden runner for kernel tests (B1) and every op package's tests (B2…B5). Test-only: imports fast-check; never
// imported by shipped code.
import fc from 'fast-check';
import { EDGE_HARD } from '../constants';
import { buildMeshData } from '../core/build';
import { BUILTIN_LAYERS, groupLayer } from '../layers/builtin';
import type { EditMesh, MeshData, PrimitiveKind } from '../types';

export { buildMeshData, emptyMeshData, type MeshBuild } from '../core/build';

// ---------- fixtures ----------

/** A unit cube (8/12/6) built from a face list, optionally with smooth (non-hard) edges. */
export function cubeData(opts: { readonly hard?: boolean } = {}): MeshData {
  return buildMeshData({
    positions: [
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
      -0.5, 0.5, -0.5,
    ],
    faces: [
      [0, 1, 2, 3],
      [3, 2, 6, 7],
      [7, 6, 5, 4],
      [4, 5, 1, 0],
      [1, 5, 6, 2],
      [4, 0, 3, 7],
    ],
    edgeFlags: opts.hard === false ? 0 : EDGE_HARD,
  });
}

/**
 * Stored forms that break one §5.1 invariant each (validateMesh must report them, editMeshFrom must refuse them):
 * the problem code `validateMesh` reports is the key, before an optional parenthesised note.
 */
export function brokenMeshes(): Readonly<Record<string, MeshData>> {
  const good = cubeData();
  const with_ = (patch: Partial<MeshData>): MeshData => ({ ...good, ...patch });
  const counts = good.counts;
  const cornerNext = good.cornerNext.slice();
  cornerNext[3] = 1; // face 0 closes early: corner 3 points into its own face's middle
  const repeatedVert = good.cornerVert.slice();
  repeatedVert[1] = repeatedVert[0] as number;
  const edgeVerts = good.edgeVerts.slice();
  edgeVerts[2] = edgeVerts[0] as number;
  edgeVerts[3] = edgeVerts[1] as number;
  const position = good.position.slice();
  position[4] = Number.NaN;
  const loop = good.edgeVerts.slice();
  loop[1] = loop[0] as number;
  // A face layer one value short (the primitives' paint layer).
  const paint = { def: BUILTIN_LAYERS.paint, data: new Uint16Array(counts.faces * BUILTIN_LAYERS.paint.comps) };
  return {
    'counts.length': with_({ edgeFlags: new Uint8Array(counts.edges - 1) }),
    'counts.length (layer)': with_({ layers: new Map([['paint', { def: paint.def, data: paint.data.subarray(1) }]]) }),
    'index.range': with_({ cornerVert: Uint32Array.from(good.cornerVert, (v, i) => (i === 0 ? 99 : v)) }),
    'face.shared-corner': with_({ cornerNext }),
    'face.repeated-vertex': with_({ cornerVert: repeatedVert }),
    'edge.duplicate': with_({ edgeVerts }),
    'edge.loop': with_({ edgeVerts: loop }),
    'float.non-finite': with_({ position }),
  };
}

/**
 * The synthetic non-manifold corpus (research 13 §12 "synthetic nasties"): meshes the kernel must represent and
 * validate without complaint, while Mesh Check reports them.
 */
export function nonManifoldCorpus(): Readonly<Record<string, MeshData>> {
  return {
    // Two triangles touching at vertex 0 only.
    bowtie: buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0],
      faces: [
        [0, 1, 2],
        [0, 3, 4],
      ],
    }),
    // Three triangles around edge 0–1 (a fin).
    'three-face-edge': buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1],
      faces: [
        [0, 1, 2],
        [1, 0, 3],
        [0, 1, 4],
      ],
    }),
    // A quad strip whose middle face is wound the other way.
    'flipped-face': buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0, 3, 1, 0],
      faces: [[0, 1, 5, 4], [1, 2, 6, 5].reverse(), [2, 3, 7, 6]],
    }),
    // The same quad twice (front and back cards share every edge).
    'duplicate-faces': buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
      faces: [
        [0, 1, 2, 3],
        [0, 1, 2, 3],
        [3, 2, 1, 0],
      ],
    }),
    // A zero-area triangle (collinear) next to a regular one, plus a zero-length edge.
    'zero-area': buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0, 1, 1, 0, 1, 1, 0],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
        [3, 2, 4],
      ],
    }),
    // A loose vertex and a wire edge beside a triangle.
    loose: buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5],
      faces: [[0, 1, 2]],
    }),
    // A non-planar, self-overlapping hexagon (earcut falls back to a fan).
    'bad-ngon': buildMeshData({
      positions: [0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 1, 0, 0, 2, 0, 1, 0.5, 0.3],
      faces: [[0, 1, 2, 3, 4, 5]],
    }),
  };
}

// ---------- state dumps ----------

type Raw = { readonly buffer: ArrayBufferLike; readonly byteOffset: number; readonly byteLength: number };
const bytesOf = (array: Raw): number[] => [
  ...new Uint8Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength)),
];

/** Every stored array and layer of a mesh as plain numbers (floats through their bytes: bit-exact comparisons). */
export function storedState(m: MeshData | EditMesh): unknown {
  const data = typeof (m as EditMesh).snapshot === 'function' ? (m as EditMesh).snapshot() : (m as MeshData);
  return {
    counts: { ...data.counts },
    position: bytesOf(data.position),
    edgeVerts: [...data.edgeVerts],
    edgeFlags: [...data.edgeFlags],
    cornerVert: [...data.cornerVert],
    cornerNext: [...data.cornerNext],
    faceCorner: [...data.faceCorner],
    faceMaterial: [...data.faceMaterial],
    faceFlags: [...data.faceFlags],
    layers: [...data.layers].map(([name, layer]) => [name, layer.def, bytesOf(layer.data)]),
  };
}

/** Every edit link of an EditMesh, traversed through its public API (P5 "edit arrays", canonical-link checks). */
export function linkState(m: EditMesh): unknown {
  const { points: P, edges: E, corners: C } = m.counts;
  const vert: number[] = [];
  for (let v = 0; v < P; v++) vert.push(m.vertEdge(v));
  const edge: number[] = [];
  for (let e = 0; e < E; e++) {
    edge.push(m.edgeCorner(e), m.edgeDiskNext(e, m.edgeVert(e, 0)), m.edgeDiskNext(e, m.edgeVert(e, 1)));
  }
  const corner: number[] = [];
  for (let c = 0; c < C; c++) {
    corner.push(m.cornerPrev(c), m.cornerEdge(c), m.cornerFace(c), m.cornerRadialNext(c));
  }
  return { vert, edge, corner };
}

/** Byte-exact comparison of two stored forms; the first difference as a sentence, or null when they are equal. */
export function diffStored(a: MeshData | EditMesh, b: MeshData | EditMesh): string | null {
  const x = typeof (a as EditMesh).snapshot === 'function' ? (a as EditMesh).snapshot() : (a as MeshData);
  const y = typeof (b as EditMesh).snapshot === 'function' ? (b as EditMesh).snapshot() : (b as MeshData);
  const c1 = x.counts;
  const c2 = y.counts;
  if (c1.points !== c2.points || c1.edges !== c2.edges || c1.faces !== c2.faces || c1.corners !== c2.corners) {
    return `counts ${vefc(c1)} ≠ ${vefc(c2)}`;
  }
  const arrays: [string, Raw, Raw][] = [
    ['position', x.position, y.position],
    ['edgeVerts', x.edgeVerts, y.edgeVerts],
    ['edgeFlags', x.edgeFlags, y.edgeFlags],
    ['cornerVert', x.cornerVert, y.cornerVert],
    ['cornerNext', x.cornerNext, y.cornerNext],
    ['faceCorner', x.faceCorner, y.faceCorner],
    ['faceMaterial', x.faceMaterial, y.faceMaterial],
    ['faceFlags', x.faceFlags, y.faceFlags],
  ];
  const names1 = [...x.layers.keys()];
  const names2 = [...y.layers.keys()];
  if (names1.join('|') !== names2.join('|')) return `layers ${names1.join(',')} ≠ ${names2.join(',')}`;
  for (const [name, layer] of x.layers) {
    const other = y.layers.get(name) as { readonly def: unknown; readonly data: Raw };
    if (JSON.stringify(layer.def) !== JSON.stringify(other.def)) return `layer ${name} definition`;
    arrays.push([`layer ${name}`, layer.data, other.data]);
  }
  for (const [name, p, q] of arrays) {
    if (p.byteLength !== q.byteLength) return `${name} length`;
    const u = new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
    const v = new Uint8Array(q.buffer, q.byteOffset, q.byteLength);
    for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return `${name} byte ${i}`;
  }
  return null;
}

const vefc = (c: MeshData['counts']): string => `${c.points}/${c.edges}/${c.faces}/${c.corners}`;

/** Every edit link of an EditMesh as one Int32Array (fast exact comparisons in property tests). */
export function linkArray(m: EditMesh): Int32Array {
  const { points: P, edges: E, corners: C } = m.counts;
  const out = new Int32Array(P + 3 * E + 4 * C);
  let o = 0;
  for (let v = 0; v < P; v++) out[o++] = m.vertEdge(v);
  for (let e = 0; e < E; e++) {
    out[o++] = m.edgeCorner(e);
    out[o++] = m.edgeDiskNext(e, m.edgeVert(e, 0));
    out[o++] = m.edgeDiskNext(e, m.edgeVert(e, 1));
  }
  for (let c = 0; c < C; c++) {
    out[o++] = m.cornerPrev(c);
    out[o++] = m.cornerEdge(c);
    out[o++] = m.cornerFace(c);
    out[o++] = m.cornerRadialNext(c);
  }
  return out;
}

/** Index of the first difference of two integer arrays (−1 when equal). */
export function firstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Signed volume of the closed surface (divergence theorem over each face's fan); positive for outward winding. */
export function signedVolume(m: MeshData | EditMesh): number {
  const data = typeof (m as EditMesh).snapshot === 'function' ? (m as EditMesh).snapshot() : (m as MeshData);
  let volume = 0;
  const p = data.position;
  for (let f = 0; f < data.counts.faces; f++) {
    const first = data.faceCorner[f] as number;
    const a = data.cornerVert[first] as number;
    let c = data.cornerNext[first] as number;
    while ((data.cornerNext[c] as number) !== first) {
      const b = data.cornerVert[c] as number;
      const d = data.cornerVert[data.cornerNext[c] as number] as number;
      const ax = p[3 * a] as number;
      const ay = p[3 * a + 1] as number;
      const az = p[3 * a + 2] as number;
      const bx = p[3 * b] as number;
      const by = p[3 * b + 1] as number;
      const bz = p[3 * b + 2] as number;
      const dx = p[3 * d] as number;
      const dy = p[3 * d + 1] as number;
      const dz = p[3 * d + 2] as number;
      volume += (ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx)) / 6;
      c = data.cornerNext[c] as number;
    }
  }
  return volume;
}

/** `V/E/F` of a mesh, the count oracles' notation (§5.29). */
export function vef(m: MeshData | EditMesh): string {
  return `${m.counts.points}/${m.counts.edges}/${m.counts.faces}`;
}

// ---------- arbitraries ----------

/** A primitive kind and small random parameters (P1/P4/P8 on "primitives with random divisions"). */
export function arbPrimitive(): fc.Arbitrary<{
  readonly kind: PrimitiveKind;
  readonly params: Record<string, number>;
}> {
  const size = fc.double({ min: 0.1, max: 3, noNaN: true });
  return fc.oneof(
    fc.record({
      kind: fc.constant('cube' as const),
      params: fc.record({
        width: size,
        height: size,
        depth: size,
        subdivisionsWidth: fc.integer({ min: 1, max: 4 }),
        subdivisionsHeight: fc.integer({ min: 1, max: 4 }),
        subdivisionsDepth: fc.integer({ min: 1, max: 4 }),
      }),
    }),
    fc.record({
      kind: fc.constant('plane' as const),
      params: fc.record({
        width: size,
        height: size,
        subdivisionsWidth: fc.integer({ min: 1, max: 6 }),
        subdivisionsHeight: fc.integer({ min: 1, max: 6 }),
      }),
    }),
    fc.record({
      kind: fc.constant('cylinder' as const),
      params: fc.record({
        radius: size,
        height: size,
        subdivisionsAxis: fc.integer({ min: 3, max: 12 }),
        subdivisionsHeight: fc.integer({ min: 1, max: 4 }),
        subdivisionsCaps: fc.integer({ min: 0, max: 3 }),
      }),
    }),
    fc.record({
      kind: fc.constant('cone' as const),
      params: fc.record({
        radius: size,
        height: size,
        subdivisionsAxis: fc.integer({ min: 3, max: 12 }),
        subdivisionsHeight: fc.integer({ min: 1, max: 4 }),
        subdivisionsCaps: fc.integer({ min: 0, max: 3 }),
      }),
    }),
    fc.record({
      kind: fc.constant('sphere' as const),
      params: fc.record({
        radius: size,
        subdivisionsAxis: fc.integer({ min: 3, max: 12 }),
        subdivisionsHeight: fc.integer({ min: 2, max: 8 }),
      }),
    }),
    fc.record({
      kind: fc.constant('torus' as const),
      params: fc.record({
        radius: fc.double({ min: 0.6, max: 3, noNaN: true }),
        sectionRadius: fc.double({ min: 0.05, max: 0.5, noNaN: true }),
        subdivisionsAxis: fc.integer({ min: 3, max: 12 }),
        subdivisionsHeight: fc.integer({ min: 3, max: 8 }),
      }),
    }),
  );
}

/**
 * A synthetic polygon soup over a few vertices (non-manifold edges, bow-ties, duplicate and flipped faces, loose
 * vertices): every face has ≥ 3 corners and no two consecutive corners share a vertex, so it is a valid stored form.
 */
export function arbSoup(opts: { readonly maxVerts?: number; readonly maxFaces?: number } = {}): fc.Arbitrary<MeshData> {
  const maxVerts = opts.maxVerts ?? 8;
  const maxFaces = opts.maxFaces ?? 8;
  return fc
    .record({
      points: fc.integer({ min: 3, max: maxVerts }),
      coords: fc.array(fc.integer({ min: -4, max: 4 }), { minLength: 3 * maxVerts, maxLength: 3 * maxVerts }),
      faces: fc.array(fc.array(fc.nat(), { minLength: 3, maxLength: 6 }), { maxLength: maxFaces }),
      hard: fc.boolean(),
    })
    .map(({ points, coords, faces, hard }) => {
      const list: number[][] = [];
      for (const raw of faces) {
        const face: number[] = [];
        for (const x of raw) {
          const v = x % points;
          if (face.length > 0 && face[face.length - 1] === v) continue;
          face.push(v);
        }
        while (face.length > 1 && face[0] === face[face.length - 1]) face.pop();
        if (face.length >= 3) list.push(face);
      }
      return buildMeshData({
        positions: coords.slice(0, 3 * points).map((x) => x / 2),
        faces: list,
        edgeFlags: hard ? EDGE_HARD : 0,
      });
    });
}

/**
 * One abstract Euler step: the runner (test/properties) maps the seeds onto elements of the current mesh, so any
 * sequence is meaningful on any mesh.
 */
export type EulerStep =
  | { readonly op: 'makeVert'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly op: 'killVert'; readonly seed: number }
  | { readonly op: 'makeEdge'; readonly a: number; readonly b: number }
  | { readonly op: 'killEdge'; readonly seed: number }
  | { readonly op: 'makeFace'; readonly seeds: readonly number[]; readonly example: number | null }
  | { readonly op: 'killFace'; readonly seed: number }
  | { readonly op: 'splitEdge'; readonly seed: number; readonly t: number }
  | { readonly op: 'joinEdge'; readonly seed: number }
  | { readonly op: 'splitFace'; readonly seed: number; readonly a: number; readonly b: number }
  | { readonly op: 'joinFace'; readonly seed: number }
  | { readonly op: 'reverseFace'; readonly seed: number }
  | { readonly op: 'setPosition'; readonly seed: number; readonly x: number }
  | { readonly op: 'setFlags'; readonly seed: number; readonly flags: number }
  | { readonly op: 'layer'; readonly name: 'uv0' | 'paint' | 'morph'; readonly seed: number; readonly value: number }
  | { readonly op: 'addLayer'; readonly name: 'color0' | 'group' | 'crease' }
  | { readonly op: 'removeLayer'; readonly name: 'color0' | 'group' | 'crease' | 'uv0' };

const coord = fc.integer({ min: -8, max: 8 }).map((x) => x / 4);

/** One abstract Euler step (`EulerStep`), weighted towards the topology operators. */
export function arbEulerStep(): fc.Arbitrary<EulerStep> {
  const seed = fc.nat({ max: 1_000_000 });
  return fc.oneof(
    { weight: 2, arbitrary: fc.record({ op: fc.constant('makeVert' as const), x: coord, y: coord, z: coord }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('killVert' as const), seed }) },
    { weight: 2, arbitrary: fc.record({ op: fc.constant('makeEdge' as const), a: seed, b: seed }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('killEdge' as const), seed }) },
    {
      weight: 3,
      arbitrary: fc.record({
        op: fc.constant('makeFace' as const),
        seeds: fc.array(seed, { minLength: 3, maxLength: 6 }),
        example: fc.option(seed, { nil: null }),
      }),
    },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('killFace' as const), seed }) },
    {
      weight: 4,
      arbitrary: fc.record({
        op: fc.constant('splitEdge' as const),
        seed,
        t: fc.integer({ min: 1, max: 15 }).map((x) => x / 16),
      }),
    },
    { weight: 2, arbitrary: fc.record({ op: fc.constant('joinEdge' as const), seed }) },
    { weight: 4, arbitrary: fc.record({ op: fc.constant('splitFace' as const), seed, a: seed, b: seed }) },
    { weight: 2, arbitrary: fc.record({ op: fc.constant('joinFace' as const), seed }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('reverseFace' as const), seed }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('setPosition' as const), seed, x: coord }) },
    {
      weight: 1,
      arbitrary: fc.record({ op: fc.constant('setFlags' as const), seed, flags: fc.integer({ min: 0, max: 7 }) }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        op: fc.constant('layer' as const),
        name: fc.constantFrom('uv0' as const, 'paint' as const, 'morph' as const),
        seed,
        value: fc.integer({ min: 0, max: 64 }).map((x) => x / 8),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        op: fc.constant('addLayer' as const),
        name: fc.constantFrom('color0' as const, 'group' as const, 'crease' as const),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        op: fc.constant('removeLayer' as const),
        name: fc.constantFrom('color0' as const, 'group' as const, 'crease' as const, 'uv0' as const),
      }),
    },
  );
}

// ---------- the Euler step runner ----------

const STEP_LAYERS = {
  color0: BUILTIN_LAYERS.color0,
  group: groupLayer('Test', 'point', 'bit'),
  crease: BUILTIN_LAYERS.crease,
  uv0: BUILTIN_LAYERS.uv0,
} as const;

function cornersOf(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  do {
    out.push(c);
    c = m.cornerNext(c);
  } while (c !== start && out.length <= m.counts.corners);
  return out;
}

/** Faces using edge `e` (distinct) and their total corner count. */
function facesOfEdge(m: EditMesh, e: number): number[] {
  const out = new Set<number>();
  const start = m.edgeCorner(e);
  if (start !== -1) {
    let c = start;
    do {
      out.add(m.cornerFace(c));
      c = m.cornerRadialNext(c);
    } while (c !== start);
  }
  return [...out];
}

function facesOfVert(m: EditMesh, v: number): number[] {
  const out = new Set<number>();
  const start = m.vertEdge(v);
  if (start === -1) return [];
  let e = start;
  do {
    for (const f of facesOfEdge(m, e)) out.add(f);
    e = m.edgeDiskNext(e, v);
  } while (e !== start && e !== -1);
  return [...out];
}

/** An Euler step resolved against the current mesh: the call, its count oracle and its label. */
export interface ResolvedStep {
  readonly label: string;
  /** Expected counts after the step (the model of the model-based tests). */
  readonly expect: {
    readonly points: number;
    readonly edges: number;
    readonly faces: number;
    readonly corners: number;
  };
  readonly run: () => void;
}

/**
 * Maps an abstract step onto the current mesh (seeds modulo the element counts) with its count oracle, or null when
 * the mesh has no element the step needs. The call itself may still refuse (`EkzaError('mesh-euler')`, e.g. joining
 * at a vertex of valence 3); the oracle holds only when it does not.
 */
export function resolveEulerStep(m: EditMesh, step: EulerStep): ResolvedStep | null {
  const { points: P, edges: E, faces: F, corners: C } = m.counts;
  const counts = (dp: number, de: number, df: number, dc: number) => ({
    points: P + dp,
    edges: E + de,
    faces: F + df,
    corners: C + dc,
  });
  switch (step.op) {
    case 'makeVert':
      return { label: 'makeVert', expect: counts(1, 0, 0, 0), run: () => m.makeVert(step.x, step.y, step.z) };
    case 'killVert': {
      if (P === 0) return null;
      const v = step.seed % P;
      const faces = facesOfVert(m, v);
      const corners = faces.reduce((n, f) => n + m.faceLen(f), 0);
      return {
        label: `killVert ${v}`,
        expect: counts(-1, -m.vertValence(v), -faces.length, -corners),
        run: () => m.killVert(v),
      };
    }
    case 'makeEdge': {
      if (P < 2) return null;
      const a = step.a % P;
      const b = step.b % P;
      if (a === b) return null;
      return {
        label: `makeEdge ${a} ${b}`,
        expect: counts(0, m.findEdge(a, b) === -1 ? 1 : 0, 0, 0),
        run: () => m.makeEdge(a, b),
      };
    }
    case 'killEdge': {
      if (E === 0) return null;
      const e = step.seed % E;
      const faces = facesOfEdge(m, e);
      const corners = faces.reduce((n, f) => n + m.faceLen(f), 0);
      return { label: `killEdge ${e}`, expect: counts(0, -1, -faces.length, -corners), run: () => m.killEdge(e) };
    }
    case 'makeFace': {
      if (P < 3) return null;
      const verts: number[] = [];
      for (const seed of step.seeds) {
        const v = seed % P;
        if (verts.length > 0 && verts[verts.length - 1] === v) continue;
        verts.push(v);
      }
      while (verts.length > 1 && verts[0] === verts[verts.length - 1]) verts.pop();
      if (verts.length < 3) return null;
      const missing = new Set<string>();
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i] as number;
        const b = verts[(i + 1) % verts.length] as number;
        if (m.findEdge(a, b) === -1) missing.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
      const example = step.example === null || F === 0 ? undefined : step.example % F;
      return {
        label: `makeFace ${verts.join(',')}${example === undefined ? '' : ` like ${example}`}`,
        expect: counts(0, missing.size, 1, verts.length),
        run: () => m.makeFace(verts, example === undefined ? undefined : { example }),
      };
    }
    case 'killFace': {
      if (F === 0) return null;
      const f = step.seed % F;
      return { label: `killFace ${f}`, expect: counts(0, 0, -1, -m.faceLen(f)), run: () => m.killFace(f) };
    }
    case 'splitEdge': {
      if (E === 0) return null;
      const e = step.seed % E;
      return {
        label: `splitEdge ${e} ${step.t}`,
        expect: counts(1, 1, 0, m.edgeFaceCount(e)),
        run: () => m.splitEdgeMakeVert(e, step.t),
      };
    }
    case 'joinEdge': {
      if (P === 0) return null;
      const v = step.seed % P;
      let at = 0;
      for (let c = 0; c < C; c++) if (m.cornerVert(c) === v) at++;
      return { label: `joinEdge ${v}`, expect: counts(-1, -1, 0, -at), run: () => m.joinEdgeKillVert(v) };
    }
    case 'splitFace': {
      if (F === 0) return null;
      const f = step.seed % F;
      const corners = cornersOf(m, f);
      const cA = corners[step.a % corners.length] as number;
      const cB = corners[step.b % corners.length] as number;
      const exists = m.findEdge(m.cornerVert(cA), m.cornerVert(cB)) !== -1;
      return {
        label: `splitFace ${f} ${cA} ${cB}`,
        expect: counts(0, exists ? 0 : 1, 1, 2),
        run: () => m.splitFaceMakeEdge(f, cA, cB),
      };
    }
    case 'joinFace': {
      if (E === 0) return null;
      const e = step.seed % E;
      return { label: `joinFace ${e}`, expect: counts(0, -1, -1, -2), run: () => m.joinFaceKillEdge(e) };
    }
    case 'reverseFace': {
      if (F === 0) return null;
      const f = step.seed % F;
      return { label: `reverseFace ${f}`, expect: counts(0, 0, 0, 0), run: () => m.reverseFace(f) };
    }
    case 'setPosition': {
      if (P === 0) return null;
      const v = step.seed % P;
      return {
        label: `setPosition ${v}`,
        expect: counts(0, 0, 0, 0),
        run: () => m.setPosition(v, step.x, -step.x, step.x / 2),
      };
    }
    case 'setFlags': {
      if (E === 0) return null;
      const e = step.seed % E;
      return {
        label: `setFlags ${e} ${step.flags}`,
        expect: counts(0, 0, 0, 0),
        run: () => {
          m.setEdgeFlags(e, step.flags);
          if (F > 0) m.setFaceFlags(step.seed % F, step.flags & 1);
        },
      };
    }
    case 'layer': {
      const name = step.name === 'morph' ? 'morph:Test' : step.name;
      const layer = m.layer(name);
      if (layer === undefined) return null;
      const n =
        layer.def.domain === 'point' ? P : layer.def.domain === 'face' ? F : layer.def.domain === 'edge' ? E : C;
      if (n === 0) return null;
      const i = step.seed % n;
      return {
        label: `layer ${name} ${i}`,
        expect: counts(0, 0, 0, 0),
        run: () => {
          for (let k = 0; k < layer.def.comps; k++) layer.set(i, k, step.value + k);
        },
      };
    }
    case 'addLayer':
      return {
        label: `addLayer ${step.name}`,
        expect: counts(0, 0, 0, 0),
        run: () => {
          m.addLayer(STEP_LAYERS[step.name]);
        },
      };
    case 'removeLayer':
      return {
        label: `removeLayer ${step.name}`,
        expect: counts(0, 0, 0, 0),
        run: () => m.removeLayer(STEP_LAYERS[step.name].name),
      };
  }
}

// ---------- goldens ----------

/** File access for the golden runner (tests pass `node:fs`; browser tests read goldens through imports instead). */
export interface GoldenIo {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
}

/**
 * The golden runner: compares `computed` (case name → JSON value) with the JSON file at `path`. The file is written
 * when it does not exist or `update` is true (`UPDATE_GOLDENS=1`); otherwise the stored values are returned for the
 * caller's assertions, so a missing case or a changed value fails the test that reads it.
 */
export function goldenRunner(
  path: string,
  computed: Readonly<Record<string, unknown>>,
  io: GoldenIo,
  update = false,
): Readonly<Record<string, unknown>> {
  const normalized = JSON.parse(JSON.stringify(computed)) as Record<string, unknown>;
  if (update || !io.existsSync(path)) io.writeFileSync(path, `${JSON.stringify(normalized, null, 1)}\n`);
  return JSON.parse(io.readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** Floats rounded to 1e-6 for goldens (−0 written as 0). */
export function rounded(values: ArrayLike<number>, digits = 6): number[] {
  const scale = 10 ** digits;
  return Array.from(values, (v) => Math.round(v * scale) / scale + 0);
}
