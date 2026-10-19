// Mesh Check (M6A-SPEC §5.25, §9 B5 Tests): the synthetic corpus with one fixture per code, the thresholds (1e-6 ×
// the bounds diagonal, 1 % planarity, 1° stray vertices), visibility, ordering, both input forms, clean primitives and
// clean bevel results.
import { EkzaError } from '@ekza-animator/anim-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BitSet,
  checkMesh,
  editMeshFrom,
  MAYA_PRIMITIVE_DEFAULTS,
  MESH_OPS,
  type MeshData,
  type MeshOp,
  type MeshProblem,
  primitive,
  selectionOf,
  validateMesh,
} from '../../src';
import type { CheckOptions } from '../../src/check';
import { buildMeshData } from '../../src/testing';
import { runOk } from '../ops/bevel/harness';
import { CHECK_CORPUS } from './corpus';

type Row = readonly [code: string, domain: string, elements: readonly number[]];
const rows = (problems: readonly MeshProblem[]): Row[] =>
  problems.map((p) => [p.code, p.domain ?? '', Array.from(p.elements ?? [])] as const);

const optionsFor = (code: string): CheckOptions => ({
  closedExpected: code === 'open-border',
  ...(code === 'duplicate-slot' ? { duplicateSlots: new Set([2]) } : {}),
});

/** What each fixture reports: its own code, plus what the fixture cannot avoid (named in the corpus). */
const EXPECTED: Readonly<Record<keyof typeof CHECK_CORPUS, readonly Row[]>> = {
  'non-manifold-edge': [['non-manifold-edge', 'edge', [0]]],
  'non-manifold-vertex': [['non-manifold-vertex', 'point', [0]]],
  lamina: [['lamina', 'face', [1]]],
  'zero-length-edge': [['zero-length-edge', 'edge', [3]]],
  'zero-area-face': [['zero-area-face', 'face', [1]]],
  'inconsistent-winding': [['inconsistent-winding', 'edge', [1, 5]]],
  'nonplanar-ngon': [['nonplanar-ngon', 'face', [0]]],
  'concave-ngon': [['concave-ngon', 'face', [0]]],
  // The self-overlapping hexagon is also out of plane and has reflex corners.
  'ngon-degenerate': [
    ['nonplanar-ngon', 'face', [0]],
    ['concave-ngon', 'face', [0]],
    ['ngon-degenerate', 'face', [0]],
  ],
  'stray-vertex': [['stray-vertex', 'point', [1]]],
  // The triangle's vertex with the wire edge is not one clean fan either.
  'loose-geometry': [
    ['non-manifold-vertex', 'point', [2]],
    ['loose-geometry', 'point', [4]],
    ['loose-geometry', 'edge', [3]],
  ],
  'open-border': [['open-border', 'edge', [0, 1, 2, 3]]],
  'duplicate-slot': [['duplicate-slot', 'face', [2, 4]]],
};

/** `data` scaled about the origin. */
function scaled(data: MeshData, k: number): MeshData {
  return { ...data, position: Float32Array.from(data.position, (x) => x * k) };
}

describe('Mesh Check corpus: one fixture per code', () => {
  it('covers every code of §5.25', () => {
    expect(Object.keys(CHECK_CORPUS).sort()).toEqual(
      [
        'non-manifold-edge',
        'non-manifold-vertex',
        'lamina',
        'zero-length-edge',
        'zero-area-face',
        'inconsistent-winding',
        'nonplanar-ngon',
        'concave-ngon',
        'ngon-degenerate',
        'stray-vertex',
        'loose-geometry',
        'open-border',
        'duplicate-slot',
      ].sort(),
    );
  });

  it.each(Object.keys(CHECK_CORPUS) as (keyof typeof CHECK_CORPUS)[])('%s', (code) => {
    const data = CHECK_CORPUS[code]();
    // A valid stored form: the kernel represents it, Mesh Check reports it.
    expect(validateMesh(data)).toEqual([]);
    const fromData = checkMesh(data, optionsFor(code));
    expect(rows(fromData)).toEqual(EXPECTED[code]);
    expect(rows(checkMesh(editMeshFrom(data), optionsFor(code)))).toEqual(rows(fromData));
    expect(fromData.map((p) => p.code)).toContain(code);
    // The same at any scale (thresholds are relative to the bounds).
    for (const k of [1e-4, 1e4]) expect(rows(checkMesh(scaled(data, k), optionsFor(code)))).toEqual(EXPECTED[code]);
  });

  it('messages count the elements', () => {
    const messages = (code: keyof typeof CHECK_CORPUS) =>
      checkMesh(CHECK_CORPUS[code](), optionsFor(code)).map((p) => p.message);
    expect(messages('non-manifold-edge')).toEqual(['1 edge has more than two faces']);
    expect(messages('inconsistent-winding')).toEqual([
      '2 edges are walked the same way by both faces (inconsistent winding)',
    ]);
    expect(messages('loose-geometry')).toEqual([
      '1 vertex joins faces that are not one fan',
      '1 vertex has no edges',
      '1 edge has no faces',
    ]);
    expect(messages('open-border')).toEqual(['4 border edges on a mesh that should be closed']);
    expect(messages('duplicate-slot')).toEqual(['2 faces use a palette slot two swatches share']);
  });

  it('open borders only when a closed mesh is expected; duplicate slots only when named', () => {
    expect(checkMesh(CHECK_CORPUS['open-border']())).toEqual([]);
    expect(checkMesh(CHECK_CORPUS['open-border'](), { closedExpected: false })).toEqual([]);
    expect(checkMesh(primitive('cube', {}), { closedExpected: true })).toEqual([]);
    expect(checkMesh(CHECK_CORPUS['duplicate-slot']())).toEqual([]);
    expect(checkMesh(CHECK_CORPUS['duplicate-slot'](), { duplicateSlots: new Set() })).toEqual([]);
    // Without a paint layer every face is on slot 0.
    const bare = primitive('cube', {});
    const plain = { ...bare, layers: new Map([...bare.layers].filter(([name]) => name !== 'paint')) };
    expect(rows(checkMesh(plain, { duplicateSlots: new Set([0]) }))).toEqual([
      ['duplicate-slot', 'face', [0, 1, 2, 3, 4, 5]],
    ]);
  });
});

describe('ordering and visibility', () => {
  it('codes come in the §5.25 table order, elements ascending, over a mesh with every face-level problem', () => {
    // Several fixtures side by side in one mesh (each moved along X).
    const parts = (
      ['non-manifold-edge', 'lamina', 'inconsistent-winding', 'concave-ngon', 'stray-vertex'] as const
    ).map((code) => CHECK_CORPUS[code]());
    const positions: number[] = [];
    const faces: number[][] = [];
    parts.forEach((part, i) => {
      const base = positions.length / 3;
      for (let v = 0; v < part.counts.points; v++) {
        positions.push(
          (part.position[3 * v] as number) + 5 * i,
          part.position[3 * v + 1] as number,
          part.position[3 * v + 2] as number,
        );
      }
      for (let f = 0; f < part.counts.faces; f++) {
        const verts: number[] = [];
        const start = part.faceCorner[f] as number;
        let c = start;
        do {
          verts.push(base + (part.cornerVert[c] as number));
          c = part.cornerNext[c] as number;
        } while (c !== start);
        faces.push(verts);
      }
    });
    const problems = checkMesh(buildMeshData({ positions, faces }));
    expect(problems.map((p) => p.code)).toEqual([
      'non-manifold-edge',
      'lamina',
      'inconsistent-winding',
      'concave-ngon',
      'stray-vertex',
    ]);
    for (const p of problems) {
      const list = Array.from(p.elements ?? []);
      expect(list).toEqual([...list].sort((a, b) => a - b));
    }
  });

  it('hidden elements are not checked', () => {
    for (const code of Object.keys(CHECK_CORPUS) as (keyof typeof CHECK_CORPUS)[]) {
      const data = CHECK_CORPUS[code]();
      const { points, edges, faces } = data.counts;
      const hidden = { verts: new BitSet(points), edges: new BitSet(edges), faces: new BitSet(faces) };
      for (const p of checkMesh(data, optionsFor(code))) {
        const target = p.domain === 'point' ? hidden.verts : p.domain === 'edge' ? hidden.edges : hidden.faces;
        for (const i of p.elements ?? []) target.add(i);
      }
      expect(rows(checkMesh(data, { ...optionsFor(code), hidden })), `${code}`).toEqual([]);
      expect(rows(checkMesh(data, { ...optionsFor(code), hidden: null })), `${code}`).toEqual(EXPECTED[code]);
    }
  });

  it('refuses a missing mesh with an EkzaError', () => {
    expect(() => checkMesh(null as unknown as MeshData)).toThrow(EkzaError);
  });
});

describe('thresholds', () => {
  it('stray vertex: within 1° of straight', () => {
    const bent = (degrees: number) => {
      const a = (degrees * Math.PI) / 180;
      return buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1 + Math.cos(a), Math.sin(a), 0, 1, 1, 0],
        faces: [[0, 1, 2, 3]],
      });
    };
    expect(rows(checkMesh(bent(0.9)))).toEqual([['stray-vertex', 'point', [1]]]);
    expect(rows(checkMesh(bent(1.1)))).toEqual([]);
  });

  it('non-planar n-gon: farther than 1 % of its size from its Newell plane', () => {
    // A regular hexagon with its corners lifted ±h in turn: the Newell plane stays z = 0, so the farthest corner is h
    // away; the size (bounding diagonal) is hypot(2, √3, 2h) ≈ 2.646, so 1 % ≈ 0.0265.
    const crown = (h: number) => {
      const positions: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (2 * Math.PI * i) / 6;
        positions.push(Math.cos(a), Math.sin(a), i % 2 === 0 ? h : -h);
      }
      return buildMeshData({ positions, faces: [[0, 1, 2, 3, 4, 5]] });
    };
    expect(rows(checkMesh(crown(0.025)))).toEqual([]);
    expect(rows(checkMesh(crown(0.028)))).toEqual([['nonplanar-ngon', 'face', [0]]]);
  });

  it('concave n-gon: a reflex corner deeper than 1e-6 × the bounds diagonal (straight runs are not reflex)', () => {
    // A 2 × 1 rectangle with a fifth corner dented by `depth` below the middle of its top side (also a stray vertex:
    // its two edges are within 1° of straight).
    const dented = (depth: number) =>
      buildMeshData({ positions: [0, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1 - depth, 0, 0, 1, 0], faces: [[0, 1, 2, 3, 4]] });
    const diagonal = Math.hypot(2, 1);
    expect(rows(checkMesh(dented(0)))).toEqual([['stray-vertex', 'point', [3]]]);
    expect(rows(checkMesh(dented(0.5e-6 * diagonal)))).toEqual([['stray-vertex', 'point', [3]]]);
    expect(rows(checkMesh(dented(4e-6 * diagonal)))).toEqual([
      ['concave-ngon', 'face', [0]],
      ['stray-vertex', 'point', [3]],
    ]);
  });

  it('zero length and zero area: at most 1e-6 × the bounds diagonal', () => {
    // A unit square split by a vertex 3 that sits `gap` above vertex 1 inside a fan of three triangles.
    const fan = (gap: number) =>
      buildMeshData({
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 1, gap, 0, 0, 1, 0],
        faces: [
          [0, 1, 3],
          [0, 3, 2],
          [0, 2, 4],
        ],
      });
    const diagonal = Math.SQRT2;
    expect(rows(checkMesh(fan(0.5e-6 * diagonal)))).toEqual([
      ['zero-length-edge', 'edge', [1]],
      ['zero-area-face', 'face', [0]],
    ]);
    expect(rows(checkMesh(fan(4e-6 * diagonal)))).toEqual([]);
  });

  it('quads are never n-gons: a warped or concave quad is clean', () => {
    const warped = buildMeshData({ positions: [0, 0, 0, 1, 0, 0, 1, 1, 0.5, 0, 1, 0], faces: [[0, 1, 2, 3]] });
    const dart = buildMeshData({ positions: [0, 0, 0, 2, 1, 0, 0, 2, 0, 0.5, 1, 0], faces: [[0, 1, 2, 3]] });
    expect(checkMesh(warped)).toEqual([]);
    expect(checkMesh(dart)).toEqual([]);
  });
});

describe('clean meshes', () => {
  it('every primitive with both default sets is clean (closed ones also when a closed mesh is expected)', () => {
    for (const kind of ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const) {
      for (const params of [{}, MAYA_PRIMITIVE_DEFAULTS[kind] as Record<string, number>]) {
        const data = primitive(kind, params);
        expect(checkMesh(data), `${kind}`).toEqual([]);
        expect(checkMesh(data, { closedExpected: kind !== 'plane' }), `${kind}`).toEqual([]);
      }
    }
  });

  it('bevel results are clean where every bevelled vertex is split (no in-line vertex kept)', () => {
    // Every vertex of a plain box has three edges, and selecting every edge or face of a subdivided one leaves no
    // unselected edge running on through a bevelled vertex. (An in-line vertex at the end of a partial chamfer stays in
    // its strip, which is a non-planar n-gon on a fold: Mesh Check rightly reports it.)
    const bevel = MESH_OPS['mesh.bevel'] as MeshOp;
    fc.assert(
      fc.property(
        fc.record({
          width: fc.double({ min: 0.3, max: 3, noNaN: true }),
          height: fc.double({ min: 0.3, max: 3, noNaN: true }),
          depth: fc.double({ min: 0.3, max: 3, noNaN: true }),
        }),
        fc.array(fc.nat(), { minLength: 1, maxLength: 12 }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        fc.integer({ min: 1, max: 3 }),
        fc.boolean(),
        (size, seeds, fraction, segments, chamfer) => {
          const m = editMeshFrom(primitive('cube', size));
          const sel = selectionOf(
            'edge',
            seeds.map((s) => s % m.counts.edges),
            m.counts,
          );
          runOk(bevel, m, sel, { fraction, segments, chamfer });
          expect(rows(checkMesh(m, { closedExpected: true }))).toEqual([]);
        },
      ),
      { numRuns: 80, seed: 3 },
    );
    for (const faceMode of [false, true]) {
      const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 3 }));
      const n = faceMode ? m.counts.faces : m.counts.edges;
      const all = Array.from({ length: n }, (_, i) => i);
      runOk(bevel, m, selectionOf(faceMode ? 'face' : 'edge', all, m.counts), { segments: 2 });
      expect(rows(checkMesh(m, { closedExpected: true }))).toEqual([]);
    }
  });

  it('a partial chamfer on a fold keeps the in-line vertex in its strip: reported as a non-planar n-gon', () => {
    const bevel = MESH_OPS['mesh.bevel'] as MeshOp;
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }));
    runOk(bevel, m, selectionOf('edge', [0], m.counts), { fraction: 0.5 });
    expect(checkMesh(m, { closedExpected: true }).map((p) => p.code)).toContain('nonplanar-ngon');
  });
});
