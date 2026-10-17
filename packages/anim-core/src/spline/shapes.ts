import type { ReadonlyVec3, Spline, SplineSet } from '../types';

/**
 * Built-in control shapes (MVP-SPEC §4.11.15, ADR 0004 §10, research 07 §5.4 / 09 §5.7): unit size (radius or
 * half-extent 1), centred on the origin unless noted; planar shapes lie in XY with normal +Z, so a shape's `offset`
 * orients them (e.g. a limb circle's normal along the bone). Circular arcs are cubic Bézier spans of 45° (8 per
 * circle), which tessellate to 48 segments per circle at the default 6 segments per span.
 *
 * | kind         | geometry |
 * |--------------|----------|
 * | `circle`     | unit circle in XY |
 * | `halfCircle` | open upper half (+Y) of the unit circle, from +X to −X |
 * | `square`     | closed square (±1, ±1) in XY |
 * | `cube`       | the 12 edges of [−1, 1]³ |
 * | `sphere`     | three unit circles in XY, YZ and ZX |
 * | `diamond`    | octahedron wireframe (vertices at ±1 on each axis) as three closed rhombi |
 * | `arrow4`     | four-way arrow outline in XY (tips at ±1, shafts 0.2 wide, heads 0.5 wide and 0.4 long) |
 * | `star`       | eight-pointed star outline in XY (outer radius 1, inner 0.55), a point on +Y |
 * | `cross`      | plus-sign outline in XY (arms to ±1, 2/3 wide) |
 * | `lollipop`   | a stick from the origin to (0, 3, 0) and a unit circle centred at (0, 4, 0), in XY |
 */
export type BuiltinShapeKind =
  | 'circle'
  | 'halfCircle'
  | 'square'
  | 'cube'
  | 'sphere'
  | 'diamond'
  | 'arrow4'
  | 'star'
  | 'cross'
  | 'lollipop';

/** Handle length of a cubic Bézier approximating a 45° unit arc: (4/3)·tan(π/16). */
const ARC_KAPPA = (4 / 3) * Math.tan(Math.PI / 16);

type Plane = 'xy' | 'yz' | 'zx';

function planePoint(plane: Plane, a: number, b: number, cx = 0, cy = 0, cz = 0): ReadonlyVec3 {
  switch (plane) {
    case 'xy':
      return [cx + a, cy + b, cz];
    case 'yz':
      return [cx, cy + a, cz + b];
    case 'zx':
      return [cx + b, cy, cz + a];
  }
}

/** A Bézier arc of `spans` 45° spans starting at angle `start` (radians) in `plane`, radius `r`, centre (cx, cy, cz). */
function arc(plane: Plane, spans: number, closed: boolean, r = 1, center: ReadonlyVec3 = [0, 0, 0]): Spline {
  const count = closed ? spans : spans + 1;
  const points: ReadonlyVec3[] = [];
  const handlesIn: ReadonlyVec3[] = [];
  const handlesOut: ReadonlyVec3[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i * Math.PI) / 4;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const k = ARC_KAPPA * r;
    points.push(planePoint(plane, r * c, r * s, ...center));
    handlesIn.push(planePoint(plane, r * c + k * s, r * s - k * c, ...center));
    handlesOut.push(planePoint(plane, r * c - k * s, r * s + k * c, ...center));
  }
  return { kind: 'bezier', closed, points, handlesIn, handlesOut };
}

function poly(closed: boolean, points: readonly ReadonlyVec3[]): Spline {
  return { kind: 'poly', closed, points };
}

function xy(points: readonly (readonly [number, number])[]): ReadonlyVec3[] {
  return points.map(([x, y]) => [x, y, 0]);
}

function arrow4(): Spline {
  // one arm along +X, rotated by 90° steps (counter-clockwise outline)
  const arm: (readonly [number, number])[] = [
    [0.1, -0.1],
    [0.6, -0.1],
    [0.6, -0.25],
    [1, 0],
    [0.6, 0.25],
    [0.6, 0.1],
    [0.1, 0.1],
  ];
  const outline: (readonly [number, number])[] = [];
  for (let quarter = 0; quarter < 4; quarter++) {
    for (let i = 1; i < arm.length; i++) {
      const [x, y] = arm[i]!;
      // rotate by quarter·90°: (x, y) → (−y, x)
      let px = x;
      let py = y;
      for (let r = 0; r < quarter; r++) [px, py] = [-py, px];
      outline.push([px, py]);
    }
  }
  return poly(true, xy(outline));
}

function star(points: number, inner: number): Spline {
  const outline: (readonly [number, number])[] = [];
  for (let i = 0; i < 2 * points; i++) {
    const angle = Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? 1 : inner;
    outline.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return poly(true, xy(outline));
}

function cross(w: number): Spline {
  return poly(
    true,
    xy([
      [w, w],
      [w, 1],
      [-w, 1],
      [-w, w],
      [-1, w],
      [-1, -w],
      [-w, -w],
      [-w, -1],
      [w, -1],
      [w, -w],
      [1, -w],
      [1, w],
    ]),
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function set(splines: readonly Spline[]): SplineSet {
  return deepFreeze({ v: 1, splines });
}

/** Builds the built-in table (called once, lazily). */
export function buildBuiltinShapes(): ReadonlyMap<BuiltinShapeKind, SplineSet> {
  const square: ReadonlyVec3[] = [
    [1, 1, 0],
    [-1, 1, 0],
    [-1, -1, 0],
    [1, -1, 0],
  ];
  const cubeFace = (z: number): ReadonlyVec3[] => square.map(([x, y]) => [x, y, z]);
  return new Map<BuiltinShapeKind, SplineSet>([
    ['circle', set([arc('xy', 8, true)])],
    ['halfCircle', set([arc('xy', 4, false)])],
    ['square', set([poly(true, square)])],
    [
      'cube',
      set([
        poly(true, cubeFace(-1)),
        poly(true, cubeFace(1)),
        ...square.map(([x, y]) => poly(false, [[x, y, -1] as const, [x, y, 1] as const])),
      ]),
    ],
    ['sphere', set([arc('xy', 8, true), arc('yz', 8, true), arc('zx', 8, true)])],
    [
      'diamond',
      set([
        poly(true, [
          [1, 0, 0],
          [0, 1, 0],
          [-1, 0, 0],
          [0, -1, 0],
        ]),
        poly(true, [
          [0, 1, 0],
          [0, 0, 1],
          [0, -1, 0],
          [0, 0, -1],
        ]),
        poly(true, [
          [0, 0, 1],
          [1, 0, 0],
          [0, 0, -1],
          [-1, 0, 0],
        ]),
      ]),
    ],
    ['arrow4', set([arrow4()])],
    ['star', set([star(8, 0.55)])],
    ['cross', set([cross(1 / 3)])],
    [
      'lollipop',
      set([
        poly(false, [
          [0, 0, 0],
          [0, 3, 0],
        ]),
        arc('xy', 8, true, 1, [0, 4, 0]),
      ]),
    ],
  ]);
}
