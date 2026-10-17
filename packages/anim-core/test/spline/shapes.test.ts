import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_CONTROL_SHAPES,
  type Disposer,
  getControlShape,
  listControlShapes,
  registerControlShape,
  type SplineSet,
  tessellateSplineSet,
} from '../../src';

const BUILTINS = BUILTIN_CONTROL_SHAPES.filter((kind) => kind !== 'custom');
const PLANAR = ['circle', 'halfCircle', 'square', 'arrow4', 'star', 'cross', 'lollipop'] as const;

/** Segment endpoints of a tessellation as [x, y, z] triples. */
function vertices(lines: Float32Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < lines.length; i += 3) out.push([lines[i]!, lines[i + 1]!, lines[i + 2]!]);
  return out;
}

const disposers: Disposer[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('built-in control shapes (MVP-SPEC §4.11.15)', () => {
  it('lists the ten built-ins in contract order; custom is not a registry entry', () => {
    expect(listControlShapes()).toEqual(BUILTINS);
    expect(getControlShape('custom')).toBeUndefined();
    expect(getControlShape('nope')).toBeUndefined();
    for (const kind of BUILTINS) {
      const shape = getControlShape(kind);
      expect(shape?.v).toBe(1);
      expect(shape?.splines.length).toBeGreaterThan(0);
    }
  });

  it('are frozen shared data', () => {
    const circle = getControlShape('circle') as SplineSet;
    expect(Object.isFrozen(circle)).toBe(true);
    expect(Object.isFrozen(circle.splines[0]?.points[0])).toBe(true);
    expect(getControlShape('circle')).toBe(circle);
  });

  it('are unit size: every vertex within the unit box, touching it', () => {
    const extents = BUILTINS.filter((k) => k !== 'lollipop').map((kind) => {
      const v = vertices(tessellateSplineSet(getControlShape(kind) as SplineSet));
      return [kind, Math.round(1e5 * Math.max(...v.map((p) => Math.max(...p.map(Math.abs))))) / 1e5] as const;
    });
    expect(extents.filter(([, extent]) => extent !== 1)).toEqual([]);
  });

  it('planar shapes lie in XY (normal +Z)', () => {
    const offPlane = PLANAR.filter((kind) =>
      vertices(tessellateSplineSet(getControlShape(kind) as SplineSet)).some((p) => p[2] !== 0),
    );
    expect(offPlane).toEqual([]);
  });

  it('circle: 48 segments by default, every point on the unit circle (≤ 1e-5), a closed loop', () => {
    const lines = tessellateSplineSet(getControlShape('circle') as SplineSet);
    expect(lines.length).toBe(48 * 6);
    const v = vertices(lines);
    for (const p of v) expect(Math.abs(Math.hypot(p[0], p[1]) - 1)).toBeLessThan(1e-5);
    // segment ends chain into the next segment's start, and the last ends where the first starts
    for (let s = 0; s < 48; s++) {
      const end = v[2 * s + 1]!;
      const next = v[(2 * s + 2) % 96]!;
      expect(end).toEqual(next);
    }
  });

  it('sphere = three great circles; halfCircle is the open +Y half; lollipop stick then head', () => {
    const sphere = getControlShape('sphere') as SplineSet;
    expect(sphere.splines.length).toBe(3);
    for (const p of vertices(tessellateSplineSet(sphere))) expect(Math.hypot(...p)).toBeCloseTo(1, 5);
    const half = vertices(tessellateSplineSet(getControlShape('halfCircle') as SplineSet));
    expect(half.length).toBe(4 * 6 * 2);
    expect(half[0]).toEqual([1, 0, 0]);
    expect(half[half.length - 1]![0]).toBeCloseTo(-1, 6);
    for (const p of half) expect(p[1]).toBeGreaterThanOrEqual(-1e-7);
    const lollipop = getControlShape('lollipop') as SplineSet;
    expect(lollipop.splines[0]?.points).toEqual([
      [0, 0, 0],
      [0, 3, 0],
    ]);
    for (const p of vertices(tessellateSplineSet({ v: 1, splines: [lollipop.splines[1]!] }))) {
      expect(Math.hypot(p[0], p[1] - 4)).toBeCloseTo(1, 5);
    }
  });

  it('cube has its 12 edges; diamond is an octahedron (12 edges)', () => {
    expect(tessellateSplineSet(getControlShape('cube') as SplineSet).length / 6).toBe(12);
    expect(tessellateSplineSet(getControlShape('diamond') as SplineSet).length / 6).toBe(12);
  });
});

describe('tessellateSplineSet', () => {
  it('poly splines give one segment per edge (plus the closing edge); Bézier spans subdivide', () => {
    const open: SplineSet = {
      v: 1,
      splines: [
        {
          kind: 'poly',
          closed: false,
          points: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
          ],
        },
      ],
    };
    expect(Array.from(tessellateSplineSet(open))).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]);
    const closed: SplineSet = { v: 1, splines: [{ ...open.splines[0]!, closed: true }] };
    expect(tessellateSplineSet(closed).length).toBe(3 * 6);
    const circle = getControlShape('circle') as SplineSet;
    expect(tessellateSplineSet(circle, 1).length).toBe(8 * 6);
    expect(tessellateSplineSet(circle, 12).length).toBe(96 * 6);
    expect(tessellateSplineSet({ v: 1, splines: [{ kind: 'poly', closed: true, points: [[0, 0, 0]] }] }).length).toBe(
      0,
    );
    expect(() => tessellateSplineSet(circle, 0)).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });

  it('a Bézier span without handles is a straight line', () => {
    const s: SplineSet = {
      v: 1,
      splines: [
        {
          kind: 'bezier',
          closed: false,
          points: [
            [0, 0, 0],
            [3, 0, 0],
          ],
        },
      ],
    };
    const v = vertices(tessellateSplineSet(s, 3));
    expect(v.map((p) => p[0])).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('control shape registry (ARCHITECTURE §12)', () => {
  const triangle: SplineSet = {
    v: 1,
    splines: [
      {
        kind: 'poly',
        closed: true,
        points: [
          [0, 1, 0],
          [-1, -1, 0],
          [1, -1, 0],
        ],
      },
    ],
  };

  it('registers extension shapes after the built-ins and removes them with the disposer', () => {
    const dispose = registerControlShape('triangle', triangle);
    disposers.push(dispose);
    expect(listControlShapes()).toEqual([...BUILTINS, 'triangle']);
    const stored = getControlShape('triangle') as SplineSet;
    expect(stored).toEqual(triangle);
    expect(stored).not.toBe(triangle); // copied
    expect(Object.isFrozen(stored.splines[0]?.points)).toBe(true);
    dispose();
    expect(getControlShape('triangle')).toBeUndefined();
    dispose(); // idempotent
    expect(listControlShapes()).toEqual(BUILTINS);
  });

  it('a stale disposer does not remove a newer registration of the same kind', () => {
    const first = registerControlShape('triangle', triangle);
    first();
    disposers.push(registerControlShape('triangle', triangle));
    first();
    expect(getControlShape('triangle')).toBeDefined();
  });

  it('rejects built-in kinds, custom, duplicates and empty kinds', () => {
    disposers.push(registerControlShape('triangle', triangle));
    for (const kind of ['circle', 'custom', 'triangle', '']) {
      expect(() => registerControlShape(kind, triangle)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    }
  });

  it('rejects malformed shapes with invalid-record', () => {
    const bad: unknown[] = [
      { v: 2, splines: [] },
      { v: 1, splines: [{ kind: 'nurbs', closed: false, points: [] }] },
      { v: 1, splines: [{ kind: 'poly', closed: false, points: [[0, 0]] }] },
      { v: 1, splines: [{ kind: 'poly', closed: false, points: [[0, Number.NaN, 0]] }] },
      { v: 1, splines: [{ kind: 'bezier', closed: false, points: [[0, 0, 0]], handlesIn: [], handlesOut: [] }] },
    ];
    for (const shape of bad) {
      expect(() => registerControlShape('broken', shape as SplineSet)).toThrow(
        expect.objectContaining({ code: 'invalid-record' }),
      );
    }
    expect(getControlShape('broken')).toBeUndefined();
  });
});
