// UV projections (M6A-SPEC §5.28): the frames (u right, v up seen from outside), box planes and charts, the
// cylindrical wrap, the camera frame through the placement, and the fit (0–1, aspect and relative size kept, charts
// packed without overlap). Cross-checks against the primitives' own UV layouts, which were written independently.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EditMesh, editMeshFrom, primitive } from '../../../src';
import {
  BOX_FRAMES,
  boxPlane,
  CHART_GAP,
  cameraFrame,
  cornersOfFace,
  cylinderAxes,
  fitCharts,
  planarFrame,
  type Projection,
  projectBox,
  projectCylindrical,
  projectPlanar,
} from '../../../src/uv/project';

type V3 = readonly [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const NORMALS: readonly V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const allFaces = (m: EditMesh): number[] => Array.from({ length: m.counts.faces }, (_, f) => f);

/** Per chart: [minU, minV, maxU, maxV] over its corners. */
function chartBoxes(p: Projection): number[][] {
  const boxes = Array.from({ length: p.charts }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let c = 0; c < p.chart.length; c++) {
    const k = p.chart[c] as number;
    if (k < 0) continue;
    const box = boxes[k] as number[];
    const u = p.uv[2 * c] as number;
    const v = p.uv[2 * c + 1] as number;
    box[0] = Math.min(box[0] as number, u);
    box[1] = Math.min(box[1] as number, v);
    box[2] = Math.max(box[2] as number, u);
    box[3] = Math.max(box[3] as number, v);
  }
  return boxes;
}

describe('frames', () => {
  it('box frames: u × v is the plane’s outward normal (no mirrored image seen from outside)', () => {
    BOX_FRAMES.forEach((frame, i) => {
      expect(cross(frame.u, frame.v).map((x) => x + 0)).toEqual(NORMALS[i]);
    });
    expect(planarFrame('x')).toBe(BOX_FRAMES[0]);
    expect(planarFrame('y')).toBe(BOX_FRAMES[2]);
    expect(planarFrame('z')).toBe(BOX_FRAMES[4]);
  });

  it('box plane of a normal: the dominant axis and its sign, ties x before y before z', () => {
    expect(NORMALS.map((n) => boxPlane(n))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(boxPlane([1, 1, 1])).toBe(0);
    expect(boxPlane([-1, 1, 1])).toBe(1);
    expect(boxPlane([0, -2, 2])).toBe(3);
    expect(boxPlane([0.1, 0.2, -0.3])).toBe(5);
    expect(boxPlane([0, 0, 0])).toBe(0);
  });

  it('cylinder axes: right = axis × front, the wrap opposite the front', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const a = cylinderAxes(axis);
      expect(cross(a.axis, a.front)).toEqual(a.right.map((x) => x + 0));
    }
    expect(cylinderAxes('y').front).toEqual([0, 0, 1]);
    expect(cylinderAxes('x').front).toEqual([0, 0, 1]);
    expect(cylinderAxes('z').front).toEqual([0, 1, 0]);
  });

  it('camera frame: right and up of the view, taken into mesh space through the placement', () => {
    const identity = { q: [0, 0, 0, 1], s: [1, 1, 1] };
    // Looking down −Z with +Y up: the front view, u = x, v = y.
    const front = cameraFrame({ direction: [0, 0, -1], up: [0, 1, 0] }, identity);
    expect(front?.u.map((x) => x + 0)).toEqual([1, 0, 0]);
    expect(front?.v.map((x) => x + 0)).toEqual([0, 1, 0]);
    // An up vector that is not perpendicular is made so.
    const tilted = cameraFrame({ direction: [0, 0, -2], up: [0, 1, 0.5] }, identity);
    expect(tilted?.v[1]).toBeCloseTo(1, 12);
    expect(tilted?.v[2]).toBeCloseTo(0, 12);
    // The mesh turned 90° about +Y: its local +X faces world −Z... the camera's right (+X world) is local +Z.
    const s = Math.SQRT1_2;
    const turned = cameraFrame({ direction: [0, 0, -1], up: [0, 1, 0] }, { q: [0, s, 0, s], s: [1, 1, 1] });
    expect(turned?.u[0]).toBeCloseTo(0, 12);
    expect(turned?.u[2]).toBeCloseTo(1, 12);
    // Scale: u = right · (S·p), so a mesh scaled 2 in X spans twice the u.
    const stretched = cameraFrame({ direction: [0, 0, -1], up: [0, 1, 0] }, { q: [0, 0, 0, 1], s: [2, 1, 1] });
    expect(stretched?.u).toEqual([2, 0, 0]);
    // Unusable cameras.
    expect(cameraFrame({ direction: [0, 0, 0], up: [0, 1, 0] }, identity)).toBeNull();
    expect(cameraFrame({ direction: [0, 1, 0], up: [0, 2, 0] }, identity)).toBeNull();
    expect(cameraFrame({ direction: [Number.NaN, 0, -1], up: [0, 1, 0] }, identity)).toBeNull();
  });
});

describe('projections against the primitives’ own layouts', () => {
  it('planar Y with the fit is the plane primitive’s UV layout', () => {
    const m = editMeshFrom(primitive('plane', { subdivisionsWidth: 3, subdivisionsHeight: 2 }));
    const p = projectPlanar(m, allFaces(m), planarFrame('y'));
    fitCharts(p);
    const uv0 = m.layer('uv0');
    for (let c = 0; c < m.counts.corners; c++) {
      expect(p.uv[2 * c]).toBeCloseTo(uv0?.get(c, 0) as number, 6);
      expect(p.uv[2 * c + 1]).toBeCloseTo(uv0?.get(c, 1) as number, 6);
    }
  });

  it('box mapping of the unit cube without the fit is the cube primitive’s layout less ½', () => {
    const m = editMeshFrom(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 3 }));
    const p = projectBox(m, allFaces(m));
    expect(p.charts).toBe(6);
    const uv0 = m.layer('uv0');
    for (let c = 0; c < m.counts.corners; c++) {
      expect(p.uv[2 * c]).toBeCloseTo((uv0?.get(c, 0) as number) - 0.5, 6);
      expect(p.uv[2 * c + 1]).toBeCloseTo((uv0?.get(c, 1) as number) - 0.5, 6);
    }
  });

  it('cylindrical mapping of the cylinder’s side band follows the primitive’s u (seam on −Z, u to the right)', () => {
    const m = editMeshFrom(primitive('cylinder', { subdivisionsAxis: 12, subdivisionsCaps: 0 }));
    const side = allFaces(m).filter((f) => m.faceLen(f) === 4);
    const p = projectCylindrical(m, side, 'y');
    const uv0 = m.layer('uv0');
    const circumference = 2 * Math.PI * 0.5; // radius 0.5 (low-poly default)
    const corners: number[] = [];
    for (const f of side) {
      for (const c of cornersOfFace(m, f, corners)) {
        expect((p.uv[2 * c] as number) / circumference).toBeCloseTo(uv0?.get(c, 0) as number, 6);
      }
    }
  });
});

describe('cylindrical wrap', () => {
  it('no face spans the wrap: every face covers less than half the circumference', () => {
    // The primitives turned so their axis (+Y) becomes the projection axis.
    const turn: Record<'x' | 'y' | 'z', (x: number, y: number, z: number) => V3> = {
      x: (x, y, z) => [y, -x, z],
      y: (x, y, z) => [x, y, z],
      z: (x, y, z) => [x, -z, y],
    };
    for (const kind of ['cylinder', 'sphere', 'cone', 'torus'] as const) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const data = primitive(kind, {});
        const position = new Float32Array(data.position.length);
        for (let v = 0; v < data.counts.points; v++) {
          const p = data.position;
          position.set(turn[axis](p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number), 3 * v);
        }
        const m = editMeshFrom({ ...data, position });
        const faces = allFaces(m).filter((f) => m.faceLen(f) <= 4);
        const p = projectCylindrical(m, faces, axis);
        const corners: number[] = [];
        let worst = 0;
        let span = 0;
        for (const f of faces) {
          const us = cornersOfFace(m, f, corners).map((c) => p.uv[2 * c] as number);
          worst = Math.max(worst, Math.max(...us) - Math.min(...us));
        }
        for (let c = 0; c < p.chart.length; c++) {
          if ((p.chart[c] as number) >= 0) span = Math.max(span, p.uv[2 * c] as number);
        }
        expect(worst, `${kind} ${axis}`).toBeLessThan(span / 2);
      }
    }
  });
});

describe('fit', () => {
  it('keeps one chart’s aspect, starts it at (0, 0) and makes its larger side 1', () => {
    const m = editMeshFrom(primitive('plane', { width: 4, height: 1 }));
    const p = projectPlanar(m, allFaces(m), planarFrame('y'));
    fitCharts(p);
    expect(chartBoxes(p)).toEqual([[0, 0, 1, 0.25]]);
  });

  it('packs several charts inside 0–1 without overlap, each keeping its aspect and relative size', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('cube', 'sphere', 'cylinder', 'cone', 'torus'),
        fc.record({ x: fc.double({ min: 0.2, max: 4, noNaN: true }), y: fc.double({ min: 0.2, max: 4, noNaN: true }) }),
        (kind, scale) => {
          const data = primitive(kind, {});
          const position = Float32Array.from(data.position, (x, i) =>
            i % 3 === 0 ? x * scale.x : i % 3 === 1 ? x * scale.y : x,
          );
          const m = editMeshFrom({ ...data, position });
          const raw = projectBox(m, allFaces(m));
          const before = chartBoxes(raw);
          const p = projectBox(m, allFaces(m));
          fitCharts(p);
          const after = chartBoxes(p);
          let side = 0;
          for (const box of after) {
            expect(box[0]).toBeGreaterThanOrEqual(-1e-12);
            expect(box[1]).toBeGreaterThanOrEqual(-1e-12);
            expect(box[2]).toBeLessThanOrEqual(1 + 1e-12);
            expect(box[3]).toBeLessThanOrEqual(1 + 1e-12);
            side = Math.max(side, box[2] as number, box[3] as number);
          }
          expect(side).toBeCloseTo(1, 12);
          // One uniform scale: every chart's width and height shrink by the same factor.
          const k =
            ((after[0] as number[])[2]! - (after[0] as number[])[0]!) /
            ((before[0] as number[])[2]! - (before[0] as number[])[0]!);
          after.forEach((box, i) => {
            const b = before[i] as number[];
            expect(box[2]! - box[0]!).toBeCloseTo(k * (b[2]! - b[0]!), 9);
            expect(box[3]! - box[1]!).toBeCloseTo(k * (b[3]! - b[1]!), 9);
          });
          // No two charts overlap (their boxes are at least the gap apart on one axis).
          const gap = CHART_GAP * k * Math.max(...before.map((b) => Math.max(b[2]! - b[0]!, b[3]! - b[1]!)));
          for (let i = 0; i < after.length; i++) {
            for (let j = i + 1; j < after.length; j++) {
              const a = after[i] as number[];
              const b = after[j] as number[];
              const apart =
                a[2]! + gap * 0.999 <= b[0]! ||
                b[2]! + gap * 0.999 <= a[0]! ||
                a[3]! + gap * 0.999 <= b[1]! ||
                b[3]! + gap * 0.999 <= a[1]!;
              expect(apart, `charts ${i} and ${j}`).toBe(true);
            }
          }
        },
      ),
      { numRuns: 40, seed: 4 },
    );
  });

  it('a run without faces has no charts; the fit leaves it alone', () => {
    const m = editMeshFrom(primitive('cube', {}));
    const p = projectBox(m, []);
    expect(p.charts).toBe(0);
    fitCharts(p);
    expect(Array.from(p.chart).every((k) => k === -1)).toBe(true);
  });
});
