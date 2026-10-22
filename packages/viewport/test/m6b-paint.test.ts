// The Paint Skin Weights brush (M6B-SPEC §5.11; C6): falloffs, metres per pixel, the pane projection round trip, and
// the points of one stamp — Surface reach follows the point graph (no painting through a gap to another part within
// the Euclidean radius), Volume reach does, front faces only drops the far side, strengths are opacity × falloff.
import type { CameraSnapshot } from '../src/types';
import { describe, expect, it } from 'vitest';
import {
  falloff,
  metresPerPx,
  type PaintSurface,
  paneRay,
  pickSurfaces,
  projectToPane,
  stampAt,
} from '../src/tools/rig/paint/pick';

/** Two 3 × 3 point grids (0.2 m) in z = +0.05 (facing +Z) and z = −0.05 (facing −Z), not connected. */
function slabs(): PaintSurface {
  const positions: number[] = [];
  const tris: number[] = [];
  for (const [z, flip] of [
    [0.05, false],
    [-0.05, true],
  ] as const) {
    const base = positions.length / 3;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) positions.push(-0.1 + 0.1 * i, -0.1 + 0.1 * j, z);
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const a = base + j * 3 + i;
        const quad = [a, a + 1, a + 4, a, a + 4, a + 3];
        if (flip)
          for (let k = 0; k < 6; k += 3) [quad[k + 1], quad[k + 2]] = [quad[k + 2] as number, quad[k + 1] as number];
        tris.push(...quad);
      }
    }
  }
  const P = positions.length / 3;
  const neighbours: Set<number>[] = Array.from({ length: P }, () => new Set());
  const incident: number[][] = Array.from({ length: P }, () => []);
  for (let t = 0; t < tris.length / 3; t++) {
    const v = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]] as number[];
    for (let k = 0; k < 3; k++) {
      (incident[v[k] as number] as number[]).push(t);
      (neighbours[v[k] as number] as Set<number>).add(v[(k + 1) % 3] as number);
      (neighbours[v[(k + 1) % 3] as number] as Set<number>).add(v[k] as number);
    }
  }
  const csr = (lists: readonly Iterable<number>[]) => {
    const start = [0];
    const next: number[] = [];
    for (const list of lists) {
      next.push(...[...list].sort((a, b) => a - b));
      start.push(next.length);
    }
    return { start: Int32Array.from(start), items: Int32Array.from(next) };
  };
  const graph = csr(neighbours);
  const pointTris = csr(incident);
  return {
    mesh: 'msh_slabs',
    positions: Float32Array.from(positions),
    tris: Uint32Array.from(tris),
    graph: { start: graph.start, next: graph.items },
    pointTris: { start: pointTris.start, tris: pointTris.items },
    placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  };
}

const front: CameraSnapshot = {
  projection: 'perspective',
  position: [0, 0, 2],
  quaternion: [0, 0, 0, 1],
  target: [0, 0, 0],
  fovY: Math.PI / 4,
  orthoHeight: 2,
};
const view = { camera: () => front, paneRect: () => ({ w: 400, h: 300 }) };

const BRUSH = { opacity: 1, falloff: 'smooth' as const, reach: 'surface' as const, frontOnly: true };

describe('Paint Skin Weights brush', () => {
  it('falloffs: smooth 1 − 3t² + 2t³, linear 1 − t, constant 1, all 0 at t ≥ 1', () => {
    expect([0, 0.5, 1].map((t) => falloff('smooth', t))).toEqual([1, 0.5, 0]);
    expect(falloff('linear', 0.25)).toBe(0.75);
    expect(falloff('constant', 0.99)).toBe(1);
    expect(falloff('constant', 1)).toBe(0);
  });

  it('metres per pixel at the hit depth; pane projection inverts the pane ray', () => {
    const h = 300;
    expect(metresPerPx(front, h, [0, 0, 0])).toBeCloseTo((2 * Math.tan(Math.PI / 8) * 2) / h, 12);
    expect(metresPerPx({ ...front, projection: 'orthographic' }, h, [0, 0, 0])).toBeCloseTo(2 / h, 12);
    const ray = paneRay(view, 'p', 120, 80);
    if (ray === null) throw new Error('no ray');
    const point: [number, number, number] = [
      ray.origin[0] + ray.dir[0],
      ray.origin[1] + ray.dir[1],
      ray.origin[2] + ray.dir[2],
    ];
    const back = projectToPane(front, 400, 300, point);
    expect(back?.x).toBeCloseTo(120, 6);
    expect(back?.y).toBeCloseTo(80, 6);
  });

  it('a stamp: surface reach stays on the hit part, volume crosses the gap; front faces only; strengths', () => {
    const surface = slabs();
    const ray = paneRay(view, 'p', 200, 150);
    if (ray === null) throw new Error('no ray');
    const hit = pickSurfaces([surface], ray);
    expect(hit?.point[2]).toBeCloseTo(0.05, 6);
    if (hit === null) return;
    const surfaceStamp = stampAt(hit, 0.12, BRUSH, front);
    expect(Array.from(surfaceStamp.points).every((v) => v < 9)).toBe(true);
    expect(surfaceStamp.points.length).toBe(5); // centre + 4 edge neighbours within 0.12
    const centre = Array.from(surfaceStamp.points).indexOf(4);
    expect(surfaceStamp.strength[centre]).toBeCloseTo(1, 6);
    // Volume reaches the back slab (0.1 away), but front faces only drops it; with back faces it stays.
    const volume = stampAt(hit, 0.12, { ...BRUSH, reach: 'volume' }, front);
    expect(Array.from(volume.points).some((v) => v >= 9)).toBe(false);
    const both = stampAt(hit, 0.12, { ...BRUSH, reach: 'volume', frontOnly: false }, front);
    expect(Array.from(both.points).some((v) => v >= 9)).toBe(true);
    const half = stampAt(hit, 0.12, { ...BRUSH, opacity: 0.5, falloff: 'constant' }, front);
    expect(Array.from(half.strength).every((s) => s === 0.5)).toBe(true);
  });
});
