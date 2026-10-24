// Primitives (M6A-SPEC §5.16, §6.3): cube, sphere, cylinder, cone, plane and torus with the §6.3 parameters (missing
// ones take the low-poly defaults, `DCC_PRIMITIVE_DEFAULTS` is the other set; values are clamped like every op
// argument). Every primitive is faceted (every edge EDGE_HARD), wound CCW seen from outside (each face is oriented by
// its Newell normal against the outward direction, so winding never depends on hand-ordered corners), centred at
// the origin, with `paint` = slot 0 and `uv0` per corner:
// - cube: each side 0–1 (u right, v up seen from outside; subdivisions share their side's square);
// - plane (XZ, facing +Y): 0–1, u along +X, v along −Z;
// - sphere: cylindrical, u = 1 − angle/2π from −Z (the seam; u grows to the right seen from outside), v from the
//   bottom pole (0) to the top (1); corners split at the wrap (u = 1 on one side of the seam, 0 on the other);
// - cylinder, cone: the side band cylindrical like the sphere in v ∈ [0.5, 1]; the caps as discs centred at
//   (0.25, 0.25) (bottom) and (0.75, 0.25) (top), radius 0.25, seen from outside;
// - torus: u around the axis (seam on −Z), v around the section (seam on the outer equator).
// Axes of cylinder, cone and torus along +Y; rings start on −Z. `humanoidBody` is B13's template generator.
import { coerceArgs } from '@ekza-studio/anim-core';
import { EDGE_HARD } from '../constants';
import { buildMeshData } from '../core/build';
import { notImplemented } from '../kernel';
import { BUILTIN_LAYERS } from '../layers/builtin';
import { PRIMITIVE_PARAMS } from '../primitiveParams';
import { humanoidBody } from '../templates';
import type { MeshData, PrimitiveKind } from '../types';

type Vec = readonly [number, number, number];

class Builder {
  readonly positions: number[] = [];
  readonly faces: number[][] = [];
  readonly uvs: number[] = [];

  vertex(x: number, y: number, z: number): number {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }

  /** Adds a face with its corner UVs (u, v per corner), reversing both when its Newell normal points against `outward`. */
  face(corners: readonly number[], uv: readonly number[], outward: Vec): void {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const p = this.positions;
    for (let i = 0; i < corners.length; i++) {
      const a = 3 * (corners[i] as number);
      const b = 3 * (corners[(i + 1) % corners.length] as number);
      nx += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
      ny += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
      nz += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
    }
    const flip = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0;
    const order = corners.map((_, i) => i);
    if (flip) order.reverse();
    this.faces.push(order.map((i) => corners[i] as number));
    for (const i of order) this.uvs.push(uv[2 * i] as number, uv[2 * i + 1] as number);
  }

  build(): MeshData {
    return buildMeshData({
      positions: this.positions,
      faces: this.faces,
      edgeFlags: EDGE_HARD,
      layers: [{ def: BUILTIN_LAYERS.paint }, { def: BUILTIN_LAYERS.uv0, data: this.uvs }],
    });
  }
}

const num = (params: Readonly<Record<string, unknown>>, name: string): number => params[name] as number;
const TAU = 2 * Math.PI;

function cube(params: Readonly<Record<string, unknown>>): MeshData {
  const [W, H, D] = [num(params, 'width'), num(params, 'height'), num(params, 'depth')];
  const [w, h, d] = [
    num(params, 'subdivisionsWidth'),
    num(params, 'subdivisionsHeight'),
    num(params, 'subdivisionsDepth'),
  ];
  const b = new Builder();
  const index = new Map<number, number>();
  const key = (i: number, j: number, k: number): number => (k * (h + 1) + j) * (w + 1) + i;
  for (let k = 0; k <= d; k++) {
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        if (i !== 0 && i !== w && j !== 0 && j !== h && k !== 0 && k !== d) continue;
        index.set(key(i, j, k), b.vertex(-W / 2 + (W * i) / w, -H / 2 + (H * j) / h, -D / 2 + (D * k) / d));
      }
    }
  }
  const at = (i: number, j: number, k: number): number => index.get(key(i, j, k)) as number;
  type Grid = readonly [number, number, number];
  /** A side quad over grid points with (u, v) of each point. */
  const quad = (pts: readonly Grid[], uv: (g: Grid) => readonly [number, number], outward: Vec): void => {
    b.face(
      pts.map(([i, j, k]) => at(i, j, k)),
      pts.flatMap((g) => uv(g)),
      outward,
    );
  };
  // The desktop DCC's side order: front (+Z), top (+Y), back (−Z), bottom (−Y), right (+X), left (−X).
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      quad(
        [
          [i, j, d],
          [i + 1, j, d],
          [i + 1, j + 1, d],
          [i, j + 1, d],
        ],
        ([gi, gj]) => [gi / w, gj / h],
        [0, 0, 1],
      );
  for (let k = d; k > 0; k--)
    for (let i = 0; i < w; i++)
      quad(
        [
          [i, h, k],
          [i + 1, h, k],
          [i + 1, h, k - 1],
          [i, h, k - 1],
        ],
        ([gi, , gk]) => [gi / w, 1 - gk / d],
        [0, 1, 0],
      );
  for (let j = h; j > 0; j--)
    for (let i = 0; i < w; i++)
      quad(
        [
          [i, j, 0],
          [i + 1, j, 0],
          [i + 1, j - 1, 0],
          [i, j - 1, 0],
        ],
        ([gi, gj]) => [1 - gi / w, gj / h],
        [0, 0, -1],
      );
  for (let k = 0; k < d; k++)
    for (let i = 0; i < w; i++)
      quad(
        [
          [i, 0, k],
          [i + 1, 0, k],
          [i + 1, 0, k + 1],
          [i, 0, k + 1],
        ],
        ([gi, , gk]) => [gi / w, gk / d],
        [0, -1, 0],
      );
  for (let j = 0; j < h; j++)
    for (let k = d; k > 0; k--)
      quad(
        [
          [w, j, k],
          [w, j, k - 1],
          [w, j + 1, k - 1],
          [w, j + 1, k],
        ],
        ([, gj, gk]) => [1 - gk / d, gj / h],
        [1, 0, 0],
      );
  for (let j = 0; j < h; j++)
    for (let k = 0; k < d; k++)
      quad(
        [
          [0, j, k],
          [0, j, k + 1],
          [0, j + 1, k + 1],
          [0, j + 1, k],
        ],
        ([, gj, gk]) => [gk / d, gj / h],
        [-1, 0, 0],
      );
  return b.build();
}

function plane(params: Readonly<Record<string, unknown>>): MeshData {
  const [W, H] = [num(params, 'width'), num(params, 'height')];
  const [w, h] = [num(params, 'subdivisionsWidth'), num(params, 'subdivisionsHeight')];
  const b = new Builder();
  // In XZ facing +Y: X along the width, Z along the height; rows from −Z to +Z.
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) b.vertex(-W / 2 + (W * i) / w, 0, -H / 2 + (H * j) / h);
  const at = (i: number, j: number): number => j * (w + 1) + i;
  const uv = (i: number, j: number): [number, number] => [i / w, 1 - j / h];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      b.face(
        [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)],
        [...uv(i, j), ...uv(i, j + 1), ...uv(i + 1, j + 1), ...uv(i + 1, j)],
        [0, 1, 0],
      );
    }
  }
  return b.build();
}

/** u of ring index k of n around +Y (k = n is the far side of the seam: u = 0). */
const ringU = (k: number, n: number): number => 1 - k / n;
const radial = (angle: number): Vec => [Math.sin(angle), 0, -Math.cos(angle)];

/** Disc UV of a cap point at ring index k and radius fraction s, centred at (cu, cv), radius 0.25, seen from outside. */
function capUV(k: number, n: number, s: number, cu: number, top: boolean): [number, number] {
  const a = (TAU * k) / n;
  return [cu + 0.25 * s * Math.sin(a), 0.25 + (top ? 0.25 : -0.25) * s * Math.cos(a)];
}

/**
 * A cap over `outer` (ring of n vertices at radius fraction 1): one n-gon when `caps` is 0, else `caps − 1` inner
 * rings and a centre fan. Inner rings and the centre are created here.
 */
function cap(
  b: Builder,
  outer: readonly number[],
  y: number,
  radius: number,
  n: number,
  caps: number,
  top: boolean,
): void {
  const outward: Vec = [0, top ? 1 : -1, 0];
  const cu = top ? 0.75 : 0.25;
  const angle = (k: number): number => (TAU * k) / n;
  if (caps === 0) {
    b.face(
      outer,
      outer.flatMap((_, k) => capUV(k, n, 1, cu, top)),
      outward,
    );
    return;
  }
  let ring = outer;
  let s = 1;
  for (let step = 1; step < caps; step++) {
    const t = (caps - step) / caps;
    const rr = (radius * (caps - step)) / caps;
    const inner = Array.from({ length: n }, (_, k) => b.vertex(rr * Math.sin(angle(k)), y, -rr * Math.cos(angle(k))));
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      b.face(
        [ring[k] as number, ring[k1] as number, inner[k1] as number, inner[k] as number],
        [
          ...capUV(k, n, s, cu, top),
          ...capUV(k1, n, s, cu, top),
          ...capUV(k1, n, t, cu, top),
          ...capUV(k, n, t, cu, top),
        ],
        outward,
      );
    }
    ring = inner;
    s = t;
  }
  const center = b.vertex(0, y, 0);
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    b.face(
      [ring[k] as number, ring[k1] as number, center],
      [...capUV(k, n, s, cu, top), ...capUV(k1, n, s, cu, top), cu, 0.25],
      outward,
    );
  }
}

function cylinder(params: Readonly<Record<string, unknown>>): MeshData {
  const [r, height] = [num(params, 'radius'), num(params, 'height')];
  const [n, rows, caps] = [
    num(params, 'subdivisionsAxis'),
    num(params, 'subdivisionsHeight'),
    num(params, 'subdivisionsCaps'),
  ];
  const b = new Builder();
  const angle = (k: number): number => (TAU * k) / n;
  const rings: number[][] = [];
  for (let t = 0; t <= rows; t++) {
    const y = -height / 2 + (height * t) / rows;
    rings.push(Array.from({ length: n }, (_, k) => b.vertex(r * Math.sin(angle(k)), y, -r * Math.cos(angle(k)))));
  }
  // Cap rings and centres are created before the side faces (the reference vertex order: rings, bottom cap, top cap).
  const pending: (() => void)[] = [];
  const capLater = (outer: number[], y: number, top: boolean): void => {
    if (caps === 0) {
      pending.push(() => cap(b, outer, y, r, n, 0, top));
      return;
    }
    // Create the inner vertices now (bottom first), faces after the sides.
    const facesStart = b.faces.length;
    const uvStart = b.uvs.length;
    cap(b, outer, y, r, n, caps, top);
    const faces = b.faces.splice(facesStart);
    const uvs = b.uvs.splice(uvStart);
    pending.push(() => {
      b.faces.push(...faces);
      b.uvs.push(...uvs);
    });
  };
  capLater(rings[0] as number[], -height / 2, false);
  capLater(rings[rows] as number[], height / 2, true);
  for (let t = 0; t < rows; t++) {
    const lower = rings[t] as number[];
    const upper = rings[t + 1] as number[];
    const v0 = 0.5 + (0.5 * t) / rows;
    const v1 = 0.5 + (0.5 * (t + 1)) / rows;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      b.face(
        [lower[k] as number, lower[k1] as number, upper[k1] as number, upper[k] as number],
        [ringU(k, n), v0, ringU(k + 1, n), v0, ringU(k + 1, n), v1, ringU(k, n), v1],
        radial(angle(k + 0.5)),
      );
    }
  }
  for (const run of pending) run();
  return b.build();
}

function cone(params: Readonly<Record<string, unknown>>): MeshData {
  const [r, height] = [num(params, 'radius'), num(params, 'height')];
  const [n, rows, caps] = [
    num(params, 'subdivisionsAxis'),
    num(params, 'subdivisionsHeight'),
    num(params, 'subdivisionsCaps'),
  ];
  const b = new Builder();
  const angle = (k: number): number => (TAU * k) / n;
  const rings: number[][] = [];
  for (let t = 0; t < rows; t++) {
    const y = -height / 2 + (height * t) / rows;
    const rt = r * (1 - t / rows);
    rings.push(Array.from({ length: n }, (_, k) => b.vertex(rt * Math.sin(angle(k)), y, -rt * Math.cos(angle(k)))));
  }
  const apex = b.vertex(0, height / 2, 0);
  const vOf = (t: number): number => 0.5 + (0.5 * t) / rows;
  for (let t = 0; t + 1 < rows; t++) {
    const lower = rings[t] as number[];
    const upper = rings[t + 1] as number[];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      b.face(
        [lower[k] as number, lower[k1] as number, upper[k1] as number, upper[k] as number],
        [ringU(k, n), vOf(t), ringU(k + 1, n), vOf(t), ringU(k + 1, n), vOf(t + 1), ringU(k, n), vOf(t + 1)],
        radial(angle(k + 0.5)),
      );
    }
  }
  const last = rings[rows - 1] as number[];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    b.face(
      [last[k] as number, last[k1] as number, apex],
      [ringU(k, n), vOf(rows - 1), ringU(k + 1, n), vOf(rows - 1), ringU(k + 0.5, n), 1],
      radial(angle(k + 0.5)),
    );
  }
  cap(b, rings[0] as number[], -height / 2, r, n, caps, false);
  return b.build();
}

function sphere(params: Readonly<Record<string, unknown>>): MeshData {
  const r = num(params, 'radius');
  const [n, h] = [num(params, 'subdivisionsAxis'), num(params, 'subdivisionsHeight')];
  const b = new Builder();
  const angle = (k: number): number => (TAU * k) / n;
  // Rings from the bottom (j = 1) to the top (j = h − 1), then the bottom and top poles (the desktop DCC's order).
  const rings: number[][] = [];
  for (let j = 1; j < h; j++) {
    const phi = (Math.PI * j) / h;
    const y = -r * Math.cos(phi);
    const rho = r * Math.sin(phi);
    rings.push(Array.from({ length: n }, (_, k) => b.vertex(rho * Math.sin(angle(k)), y, -rho * Math.cos(angle(k)))));
  }
  const south = b.vertex(0, -r, 0);
  const north = b.vertex(0, r, 0);
  const vOf = (j: number): number => j / h;
  const outwardOf = (k: number, j: number): Vec => {
    const phi = (Math.PI * j) / h;
    const a = angle(k + 0.5);
    return [Math.sin(phi) * Math.sin(a), -Math.cos(phi), -Math.sin(phi) * Math.cos(a)];
  };
  const first = rings[0] as number[];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    b.face(
      [south, first[k] as number, first[k1] as number],
      [ringU(k + 0.5, n), 0, ringU(k, n), vOf(1), ringU(k + 1, n), vOf(1)],
      outwardOf(k, 0.5),
    );
  }
  for (let j = 1; j + 1 < h; j++) {
    const lower = rings[j - 1] as number[];
    const upper = rings[j] as number[];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      b.face(
        [lower[k] as number, lower[k1] as number, upper[k1] as number, upper[k] as number],
        [ringU(k, n), vOf(j), ringU(k + 1, n), vOf(j), ringU(k + 1, n), vOf(j + 1), ringU(k, n), vOf(j + 1)],
        outwardOf(k, j + 0.5),
      );
    }
  }
  const top = rings[h - 2] as number[];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    b.face(
      [top[k] as number, top[k1] as number, north],
      [ringU(k, n), vOf(h - 1), ringU(k + 1, n), vOf(h - 1), ringU(k + 0.5, n), 1],
      outwardOf(k, h - 0.5),
    );
  }
  return b.build();
}

function torus(params: Readonly<Record<string, unknown>>): MeshData {
  const [R, r] = [num(params, 'radius'), num(params, 'sectionRadius')];
  const [n, m] = [num(params, 'subdivisionsAxis'), num(params, 'subdivisionsHeight')];
  const b = new Builder();
  const theta = (j: number): number => (TAU * j) / n;
  const phi = (i: number): number => (TAU * i) / m;
  const point = (j: number, i: number): Vec => {
    const [rx, , rz] = radial(theta(j));
    const c = Math.cos(phi(i));
    const s = Math.sin(phi(i));
    return [(R + r * c) * rx, r * s, (R + r * c) * rz];
  };
  const index: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < m; i++) index.push(b.vertex(...point(j, i)));
  const at = (j: number, i: number): number => index[(j % n) * m + (i % m)] as number;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < m; i++) {
      const [rx, , rz] = radial(theta(j + 0.5));
      const c = Math.cos(phi(i + 0.5));
      const s = Math.sin(phi(i + 0.5));
      b.face(
        [at(j, i), at(j + 1, i), at(j + 1, i + 1), at(j, i + 1)],
        [ringU(j, n), i / m, ringU(j + 1, n), i / m, ringU(j + 1, n), (i + 1) / m, ringU(j, n), (i + 1) / m],
        [c * rx, s, c * rz],
      );
    }
  }
  return b.build();
}

/**
 * A primitive's stored form with its §6.3 parameters (missing ones take the low-poly defaults; values are clamped
 * like every op argument; unknown names are ignored). `humanoidBody` delegates to B13's generator.
 */
export function primitive(kind: PrimitiveKind, params: Readonly<Record<string, number | boolean | string>>): MeshData {
  const defs = PRIMITIVE_PARAMS[kind];
  if (defs === undefined) throw notImplemented(`primitive('${String(kind)}')`);
  const { args } = coerceArgs(defs, params ?? {});
  switch (kind) {
    case 'cube':
      return cube(args);
    case 'plane':
      return plane(args);
    case 'cylinder':
      return cylinder(args);
    case 'cone':
      return cone(args);
    case 'sphere':
      return sphere(args);
    case 'torus':
      return torus(args);
    case 'humanoidBody':
      return humanoidBody({
        style: args['style'] === 'segmented' ? 'segmented' : 'smooth',
        height: num(args, 'height'),
      });
  }
}
