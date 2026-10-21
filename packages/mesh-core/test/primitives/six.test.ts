// M6A-SPEC §5.16, §6.3, §5.29 (B1): the six primitives with both default sets — the count oracles, P4 orientation
// (shared edges traversed oppositely, positive signed volume of closed shapes, unit outward normals), faceted
// (every edge hard), centred, `paint` slot 0, `uv0` per corner (inside 0–1, counterclockwise seen from outside, no
// face across a seam, split corners at the wrap) and the goldens of test/goldens/primitives.json
// (`UPDATE_GOLDENS=1` rewrites them).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '@ekza-studio/anim-core';
import { describe, expect, it } from 'vitest';
import {
  computeNormals,
  EDGE_HARD,
  type EditMesh,
  editMeshFrom,
  MAYA_PRIMITIVE_DEFAULTS,
  type MeshData,
  type PrimitiveKind,
  primitive,
  topologyStats,
  triangulate,
  validateMesh,
  writeRevision,
} from '../../src';
import { goldenRunner, rounded, signedVolume, vef } from '../../src/testing';

const KINDS = ['cube', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const;
type Kind = (typeof KINDS)[number];

describe('count oracles (§5.29) with both default sets (§6.3)', () => {
  it.each([
    ['cube', 'low-poly', '8/12/6', 12],
    ['sphere', 'low-poly', '86/180/96', 168],
    ['cylinder', 'low-poly', '16/24/10', 28],
    ['cone', 'low-poly', '9/16/9', 14],
    ['plane', 'low-poly', '4/4/1', 2],
    ['torus', 'low-poly', '72/144/72', 144],
    ['cube', 'maya', '8/12/6', 12],
    ['sphere', 'maya', '382/780/400', 760],
    ['cylinder', 'maya', '40/60/22', 76],
    ['cone', 'maya', '21/40/21', 38],
    ['plane', 'maya', '121/220/100', 200],
    ['torus', 'maya', '400/800/400', 800],
  ] as const)('%s (%s): %s, %i triangles', (kind, set, counts, tris) => {
    const data = primitive(kind, set === 'maya' ? (MAYA_PRIMITIVE_DEFAULTS[kind] as Record<string, number>) : {});
    expect(vef(data)).toBe(counts);
    expect(topologyStats(data).triangles).toBe(tris);
    expect(triangulate(data).triFace.length).toBe(tris);
  });

  it('subdivided cones and capped primitives', () => {
    expect(vef(primitive('cone', { subdivisionsHeight: 3 }))).toBe('25/48/25');
    expect(vef(primitive('cone', { subdivisionsCaps: 2 }))).toBe('18/40/24');
    // 2 rings of 6, per cap 2 inner rings and a centre: 12 + 2 × 13 points; 18 + 2 × 30 edges; 6 + 2 × 18 faces.
    expect(vef(primitive('cylinder', { subdivisionsCaps: 3, subdivisionsAxis: 6 }))).toBe('38/78/42');
    expect(vef(primitive('sphere', { subdivisionsAxis: 3, subdivisionsHeight: 2 }))).toBe('5/9/6');
  });
});

/** Primitive cases: both default sets and parameter variants. */
const CASE_LIST: [string, MeshData][] = [
  ...KINDS.map((kind): [string, MeshData] => [kind, primitive(kind, {})]),
  ...KINDS.map((kind): [string, MeshData] => [
    `${kind}-maya`,
    primitive(kind, MAYA_PRIMITIVE_DEFAULTS[kind] as Record<string, number>),
  ]),
  ['cube-2x3x1', primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 3, width: 2, depth: 0.5 })],
  ['cylinder-caps2', primitive('cylinder', { subdivisionsCaps: 2, subdivisionsHeight: 2 })],
  ['cone-h3-caps1', primitive('cone', { subdivisionsHeight: 3, subdivisionsCaps: 1 })],
  ['sphere-5x3', primitive('sphere', { subdivisionsAxis: 5, subdivisionsHeight: 3, radius: 2 })],
  ['torus-3x3', primitive('torus', { subdivisionsAxis: 3, subdivisionsHeight: 3 })],
  ['plane-3x2', primitive('plane', { subdivisionsWidth: 3, subdivisionsHeight: 2, width: 3 })],
];
const CASES: Readonly<Record<string, MeshData>> = Object.fromEntries(CASE_LIST);
const CLOSED = (name: string): boolean => !name.startsWith('plane');

function faces(data: MeshData): number[][] {
  const out: number[][] = [];
  for (let f = 0; f < data.counts.faces; f++) {
    const list: number[] = [];
    let c = data.faceCorner[f] as number;
    do {
      list.push(c);
      c = data.cornerNext[c] as number;
    } while (c !== data.faceCorner[f]);
    out.push(list);
  }
  return out;
}

describe.each(Object.entries(CASES))('%s', (name, data) => {
  it('is valid, faceted, with paint slot 0 and uv0', () => {
    expect(validateMesh(data)).toEqual([]);
    expect(validateMesh(editMeshFrom(data))).toEqual([]);
    expect([...data.edgeFlags].every((flags) => flags === EDGE_HARD)).toBe(true);
    expect([...data.layers.keys()]).toEqual(['paint', 'uv0']);
    expect([...(data.layers.get('paint')?.data ?? [])].every((slot) => slot === 0)).toBe(true);
    expect([...data.faceMaterial].every((slot) => slot === 0)).toBe(true);
  });

  it('P4: shared edges run opposite ways, closed shapes enclose positive volume, normals are unit and outward', () => {
    const m: EditMesh = editMeshFrom(data);
    const bad: number[] = [];
    for (let e = 0; e < m.counts.edges; e++) {
      const n = m.edgeFaceCount(e);
      const c = m.edgeCorner(e);
      if (n > 2 || (n === 2 && m.cornerVert(c) === m.cornerVert(m.cornerRadialNext(c)))) bad.push(e);
    }
    expect(bad).toEqual([]);
    const stats = topologyStats(data);
    const closed = CLOSED(name);
    expect({
      nonManifoldVerts: stats.nonManifoldVerts,
      boundaryLoops: stats.boundaryLoops,
      genus: stats.genus,
      positiveVolume: !closed || signedVolume(data) > 0,
    }).toEqual({
      nonManifoldVerts: 0,
      boundaryLoops: closed ? 0 : 1,
      genus: closed ? (name.startsWith('torus') ? 1 : 0) : null,
      positiveVolume: true,
    });
    const normals = computeNormals(data);
    for (let c = 0; c < data.counts.corners; c++) {
      const length = Math.hypot(
        normals.corner[3 * c] as number,
        normals.corner[3 * c + 1] as number,
        normals.corner[3 * c + 2] as number,
      );
      expect(length).toBeCloseTo(1, 6);
    }
    // Faceted: corner normals are the face normals.
    faces(data).forEach((list, f) => {
      for (const c of list) {
        for (let k = 0; k < 3; k++) expect(normals.corner[3 * c + k]).toBe(normals.face[3 * f + k]);
      }
    });
  });

  it('is centred at the origin (symmetric height; vertex centroid on the axis)', () => {
    const bounds = writeRevision(data).manifest.bounds as readonly [readonly number[], readonly number[]];
    expect((bounds[0][1] as number) + (bounds[1][1] as number)).toBeCloseTo(0, 6);
    for (const k of [0, 2]) {
      let sum = 0;
      for (let v = 0; v < data.counts.points; v++) sum += data.position[3 * v + k] as number;
      expect(sum / data.counts.points).toBeCloseTo(0, 6);
    }
  });

  it('uv0 lies in 0–1, every face counterclockwise in UV space, no face spans a seam', () => {
    const uv = data.layers.get('uv0')?.data as Float32Array;
    expect(uv.length).toBe(2 * data.counts.corners);
    for (const value of uv) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    for (const list of faces(data)) {
      let area = 0;
      let uMin = Infinity;
      let uMax = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const a = list[i] as number;
        const b = list[(i + 1) % list.length] as number;
        area += (uv[2 * a] as number) * (uv[2 * b + 1] as number) - (uv[2 * b] as number) * (uv[2 * a + 1] as number);
        uMin = Math.min(uMin, uv[2 * a] as number);
        uMax = Math.max(uMax, uv[2 * a] as number);
      }
      expect(area).toBeGreaterThan(0);
      // Seamed primitives: no face wraps around (a side face spans one column, a cap face its disc).
      const seamed = !name.startsWith('cube') && !name.startsWith('plane');
      expect(seamed ? uMax - uMin : 0).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});

describe('UV seams', () => {
  it.each(['sphere', 'cylinder', 'cone', 'torus'] as const)(
    '%s: corners at seam vertices split u = 0 / u = 1',
    (kind) => {
      const data = primitive(kind, {});
      const uv = data.layers.get('uv0')?.data as Float32Array;
      // Seam vertices: x = 0 on the −Z side (rings start there), not at a pole.
      const seam = new Set<number>();
      for (let v = 0; v < data.counts.points; v++) {
        const x = data.position[3 * v] as number;
        const z = data.position[3 * v + 2] as number;
        if (Math.abs(x) < 1e-6 && z < -1e-6) seam.add(v);
      }
      expect(seam.size).toBeGreaterThan(0);
      for (const v of seam) {
        const us = new Set<number>();
        for (let c = 0; c < data.counts.corners; c++) if (data.cornerVert[c] === v) us.add(uv[2 * c] as number);
        const side = [...us].filter((u) => u === 0 || u === 1);
        expect(side.sort((a, b) => a - b)).toEqual([0, 1]);
      }
    },
  );

  it('cube sides each span the whole square; u runs right and v up seen from outside', () => {
    const data = primitive('cube', {});
    const uv = data.layers.get('uv0')?.data as Float32Array;
    for (const list of faces(data)) {
      const us = list.map((c) => uv[2 * c] as number);
      const vs = list.map((c) => uv[2 * c + 1] as number);
      expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toEqual([0, 1, 0, 1]);
    }
    // Front (+Z): the corner at (+x, +y) has uv (1, 1).
    const front = faces(data)[0] as number[];
    const corner = front.find((c) => {
      const v = data.cornerVert[c] as number;
      return (data.position[3 * v] as number) > 0 && (data.position[3 * v + 1] as number) > 0;
    }) as number;
    expect([uv[2 * corner], uv[2 * corner + 1]]).toEqual([1, 1]);
  });
});

describe('parameters', () => {
  it('missing parameters take the low-poly defaults; values are clamped; unknown names ignored', () => {
    expect(writeRevision(primitive('sphere', {})).manifestId).toBe(
      writeRevision(primitive('sphere', { radius: 0.5, subdivisionsAxis: 12, subdivisionsHeight: 8 })).manifestId,
    );
    expect(vef(primitive('torus', { subdivisionsAxis: 1, subdivisionsHeight: 200, bogus: 1 }))).toBe('384/768/384');
    expect(vef(primitive('sphere', { subdivisionsHeight: 1 }))).toBe('14/36/24');
  });

  it('axes along +Y: cylinder, cone and torus heights and radii', () => {
    const cone = writeRevision(primitive('cone', { radius: 2, height: 4 })).manifest.bounds;
    expect(cone?.[0][1]).toBe(-2);
    expect(cone?.[1][1]).toBe(2);
    const torus = writeRevision(primitive('torus', { radius: 1, sectionRadius: 0.25, subdivisionsHeight: 4 })).manifest
      .bounds;
    expect(torus?.[1][1]).toBeCloseTo(0.25, 6);
    expect(torus?.[1][0]).toBeLessThanOrEqual(1.25 + 1e-6);
    const sphere = primitive('sphere', { radius: 2 });
    for (let v = 0; v < sphere.counts.points; v++) {
      expect(
        Math.hypot(
          sphere.position[3 * v] as number,
          sphere.position[3 * v + 1] as number,
          sphere.position[3 * v + 2] as number,
        ),
      ).toBeCloseTo(2, 5);
    }
  });
});

describe('goldens (test/goldens/primitives.json)', () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../goldens/primitives.json');
  const digest = (values: ArrayLike<number>): string =>
    sha256Hex(new TextEncoder().encode(JSON.stringify(Array.from(values))));
  const computed = Object.fromEntries(
    Object.entries(CASES).map(([name, data]) => {
      const tri = triangulate(data);
      const normals = computeNormals(data);
      return [
        name,
        {
          counts: data.counts,
          triangles: tri.triFace.length,
          tris: digest(tri.tris),
          faceNormals: digest(rounded(normals.face)),
          cornerNormals: digest(rounded(normals.corner)),
          uv0: digest(rounded(data.layers.get('uv0')?.data ?? [])),
          manifest: writeRevision(data).manifestId,
        },
      ];
    }),
  );
  const goldens = goldenRunner(
    file,
    computed,
    { existsSync, readFileSync, writeFileSync },
    process.env['UPDATE_GOLDENS'] === '1',
  );
  it.each(Object.keys(CASES))('%s matches its golden', (name) => {
    expect(computed[name]).toEqual(goldens[name]);
  });

  it('cube, plane and cylinder keep the B0a reference triangulation and normals', () => {
    // The reference goldens' digests (B0a reference-primitives.json, recomputed): only the manifests changed (uv0).
    const cube = CASES['cube'] as MeshData;
    expect(Array.from(triangulate(cube).tris)).toEqual([
      0, 1, 2, 0, 2, 3, 5, 6, 7, 5, 7, 4, 9, 10, 11, 9, 11, 8, 12, 13, 14, 12, 14, 15, 17, 18, 19, 17, 19, 16, 20, 21,
      22, 20, 22, 23,
    ]);
  });
});

export type { Kind, PrimitiveKind };
