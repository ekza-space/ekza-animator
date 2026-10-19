// M6A-SPEC §5.16, §6.3, §5.29 count oracles (moved from B0a's reference tests): cube, plane and cylinder with their
// §6.3 parameters — counts, faceted (all edges hard), CCW seen from outside (positive signed volume of closed shapes,
// face normals pointing away from the centre), centred at the origin, `paint` at slot 0, parameters clamped.
// Literal updates (B1): primitives carry `uv0` next to `paint`; sphere, cone and torus exist (test/primitives/
// six.test.ts), only humanoidBody waits for B13.
import { describe, expect, it } from 'vitest';
import {
  computeNormals,
  EDGE_HARD,
  editMeshFrom,
  type MeshData,
  primitive,
  topologyStats,
  writeRevision,
} from '../../src';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
};

const vef = (data: MeshData): string => `${data.counts.points}/${data.counts.edges}/${data.counts.faces}`;

/** Signed volume (divergence theorem over the fan triangles of each face). */
function signedVolume(data: MeshData): number {
  let volume = 0;
  const p = data.position;
  for (let f = 0; f < data.counts.faces; f++) {
    const first = data.faceCorner[f] as number;
    const a = data.cornerVert[first] as number;
    let c = data.cornerNext[first] as number;
    while ((data.cornerNext[c] as number) !== first) {
      const b = data.cornerVert[c] as number;
      const d = data.cornerVert[data.cornerNext[c] as number] as number;
      const [ax, ay, az] = [p[3 * a], p[3 * a + 1], p[3 * a + 2]] as [number, number, number];
      const [bx, by, bz] = [p[3 * b], p[3 * b + 1], p[3 * b + 2]] as [number, number, number];
      const [dx, dy, dz] = [p[3 * d], p[3 * d + 1], p[3 * d + 2]] as [number, number, number];
      volume += (ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx)) / 6;
      c = data.cornerNext[c] as number;
    }
  }
  return volume;
}

describe('cube, plane, cylinder (§6.3, §5.29 counts)', () => {
  it.each([
    ['cube', {}, '8/12/6', 12],
    ['cube', { subdivisionsWidth: 2 }, '12/20/10', 20],
    ['cube', { subdivisionsWidth: 2, subdivisionsHeight: 3, subdivisionsDepth: 1 }, '24/44/22', 44],
    ['plane', {}, '4/4/1', 2],
    ['plane', { width: 2, subdivisionsWidth: 2, subdivisionsHeight: 1 }, '6/7/2', 4],
    ['plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 }, '25/40/16', 32],
    ['cylinder', {}, '16/24/10', 28],
    ['cylinder', { subdivisionsHeight: 3 }, '32/56/26', 60],
    ['cylinder', { subdivisionsCaps: 1 }, '18/40/24', 32],
  ] as const)('%s %j → %s (%i tris)', (kind, params, counts, tris) => {
    const data = primitive(kind, params);
    expect(vef(data)).toBe(counts);
    expect(topologyStats(data).triangles).toBe(tris);
  });

  it('are faceted (every edge hard) with paint slot 0 and uv0', () => {
    for (const data of [primitive('cube', {}), primitive('plane', {}), primitive('cylinder', {})]) {
      expect([...data.edgeFlags].every((flags) => (flags & EDGE_HARD) !== 0)).toBe(true);
      expect([...data.layers.keys()]).toEqual(['paint', 'uv0']);
      expect([...(data.layers.get('paint')?.data ?? [])].every((slot) => slot === 0)).toBe(true);
    }
  });

  it('wind CCW seen from outside and are centred at the origin', () => {
    expect(signedVolume(primitive('cube', {}))).toBeCloseTo(1, 6);
    // An 8-sided prism of circumradius 0.5 and height 1: area 2·r²·√2 = 0.7071…
    expect(signedVolume(primitive('cylinder', {}))).toBeCloseTo(2 * 0.25 * Math.SQRT2, 6);
    expect(topologyStats(primitive('cylinder', {})).genus).toBe(0);
    for (const data of [primitive('cube', { subdivisionsDepth: 2 }), primitive('cylinder', { subdivisionsCaps: 2 })]) {
      const normals = computeNormals(data);
      for (let f = 0; f < data.counts.faces; f++) {
        // Face centroid · normal > 0 for convex shapes centred at the origin.
        let cx = 0;
        let cy = 0;
        let cz = 0;
        let n = 0;
        let c = data.faceCorner[f] as number;
        do {
          const v = data.cornerVert[c] as number;
          cx += data.position[3 * v] as number;
          cy += data.position[3 * v + 1] as number;
          cz += data.position[3 * v + 2] as number;
          n++;
          c = data.cornerNext[c] as number;
        } while (c !== data.faceCorner[f]);
        const dot =
          (cx * (normals.face[3 * f] as number) +
            cy * (normals.face[3 * f + 1] as number) +
            cz * (normals.face[3 * f + 2] as number)) /
          n;
        expect(dot).toBeGreaterThan(0);
      }
    }
    const bounds = writeRevision(primitive('cube', { width: 2, height: 3, depth: 4 })).manifest.bounds;
    expect(bounds).toEqual([
      [-1, -1.5, -2],
      [1, 1.5, 2],
    ]);
    const plane = primitive('plane', { width: 2, height: 4 });
    expect(writeRevision(plane).manifest.bounds).toEqual([
      [-1, 0, -2],
      [1, 0, 2],
    ]);
    expect(computeNormals(plane).face[1]).toBe(1); // facing +Y
  });

  it('cylinder rings start on −Z and the axis is +Y', () => {
    const data = primitive('cylinder', { radius: 1, height: 2 });
    expect(Array.from(data.position.slice(0, 3), (x) => Math.round(x * 1e6) / 1e6 + 0)).toEqual([0, -1, -1]);
    const bounds = writeRevision(data).manifest.bounds;
    expect(bounds?.[0][1]).toBe(-1);
    expect(bounds?.[1][1]).toBe(1);
  });

  it('clamps parameters like op arguments and ignores unknown ones', () => {
    expect(vef(primitive('cube', { subdivisionsWidth: 0, bogus: 3 }))).toBe('8/12/6');
    expect(vef(primitive('cylinder', { subdivisionsAxis: 2 }))).toBe('6/9/5'); // clamped to 3 sides
  });

  it('builds valid edit meshes', () => {
    for (const data of [primitive('cube', { subdivisionsHeight: 2 }), primitive('cylinder', { subdivisionsCaps: 3 })]) {
      expect(() => editMeshFrom(data)).not.toThrow();
    }
  });

  it('humanoidBody waits for B13 (sphere, cone and torus are built: six.test.ts)', () => {
    expect(code(() => primitive('humanoidBody', {}))).toBe('not-implemented');
    for (const kind of ['sphere', 'cone', 'torus'] as const) expect(code(() => primitive(kind, {}))).toBeNull();
  });
});
