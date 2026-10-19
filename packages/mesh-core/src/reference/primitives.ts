// Reference primitives of B0a (M6A-SPEC §5.16, §6.3): cube, plane and cylinder with the §6.3 parameters, faceted
// (every edge EDGE_HARD), CCW seen from outside, centred at the origin, with the `paint` layer at slot 0; no UVs
// (B1's primitives add them and the sphere, cone, torus; `humanoidBody` is B13's template generator). Faces are
// oriented by their Newell normal against the outward direction, so winding never depends on hand-ordered corners.
import { coerceArgs } from '@ekza-animator/anim-core';
import { EDGE_HARD } from '../constants';
import { notImplemented } from '../kernel';
import { PRIMITIVE_PARAMS } from '../primitiveParams';
import type { MeshData, PrimitiveKind } from '../types';
import { buildMeshData } from './build';
import { BUILTIN_LAYERS } from './layers';

type Vec = readonly [number, number, number];

class Builder {
  readonly positions: number[] = [];
  readonly faces: number[][] = [];

  vertex(x: number, y: number, z: number): number {
    this.positions.push(x, y, z);
    return this.positions.length / 3 - 1;
  }

  /** Adds a face, reversing its corner order when its Newell normal points against `outward`. */
  face(corners: readonly number[], outward: Vec): void {
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
    const dot = nx * outward[0] + ny * outward[1] + nz * outward[2];
    this.faces.push(dot < 0 ? [...corners].reverse() : [...corners]);
  }

  build(): MeshData {
    return buildMeshData({
      positions: this.positions,
      faces: this.faces,
      edgeFlags: EDGE_HARD,
      layers: [{ def: BUILTIN_LAYERS.paint }],
    });
  }
}

const num = (params: Readonly<Record<string, unknown>>, name: string): number => params[name] as number;

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
  // Maya's side order: front (+Z), top (+Y), back (−Z), bottom (−Y), right (+X), left (−X).
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) b.face([at(i, j, d), at(i + 1, j, d), at(i + 1, j + 1, d), at(i, j + 1, d)], [0, 0, 1]);
  for (let k = d; k > 0; k--)
    for (let i = 0; i < w; i++) b.face([at(i, h, k), at(i + 1, h, k), at(i + 1, h, k - 1), at(i, h, k - 1)], [0, 1, 0]);
  for (let j = h; j > 0; j--)
    for (let i = 0; i < w; i++)
      b.face([at(i, j, 0), at(i + 1, j, 0), at(i + 1, j - 1, 0), at(i, j - 1, 0)], [0, 0, -1]);
  for (let k = 0; k < d; k++)
    for (let i = 0; i < w; i++)
      b.face([at(i, 0, k), at(i + 1, 0, k), at(i + 1, 0, k + 1), at(i, 0, k + 1)], [0, -1, 0]);
  for (let j = 0; j < h; j++)
    for (let k = d; k > 0; k--) b.face([at(w, j, k), at(w, j, k - 1), at(w, j + 1, k - 1), at(w, j + 1, k)], [1, 0, 0]);
  for (let j = 0; j < h; j++)
    for (let k = 0; k < d; k++)
      b.face([at(0, j, k), at(0, j, k + 1), at(0, j + 1, k + 1), at(0, j + 1, k)], [-1, 0, 0]);
  return b.build();
}

function plane(params: Readonly<Record<string, unknown>>): MeshData {
  const [W, H] = [num(params, 'width'), num(params, 'height')];
  const [w, h] = [num(params, 'subdivisionsWidth'), num(params, 'subdivisionsHeight')];
  const b = new Builder();
  // In XZ facing +Y: X along the width, Z along the height; rows from −Z to +Z.
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) b.vertex(-W / 2 + (W * i) / w, 0, -H / 2 + (H * j) / h);
  const at = (i: number, j: number): number => j * (w + 1) + i;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) b.face([at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)], [0, 1, 0]);
  }
  return b.build();
}

function cylinder(params: Readonly<Record<string, unknown>>): MeshData {
  const [r, height] = [num(params, 'radius'), num(params, 'height')];
  const [n, rows, caps] = [
    num(params, 'subdivisionsAxis'),
    num(params, 'subdivisionsHeight'),
    num(params, 'subdivisionsCaps'),
  ];
  const b = new Builder();
  const angle = (k: number): number => (2 * Math.PI * k) / n;
  // Ring k starts on −Z (the UV seam side, §5.16) and turns towards +X.
  const ringPoint = (radius: number, y: number, k: number): number =>
    b.vertex(radius * Math.sin(angle(k)), y, -radius * Math.cos(angle(k)));
  const rings: number[][] = [];
  for (let t = 0; t <= rows; t++) {
    const y = -height / 2 + (height * t) / rows;
    rings.push(Array.from({ length: n }, (_, k) => ringPoint(r, y, k)));
  }
  const capRings = (y: number): { readonly inner: number[][]; readonly center: number } => {
    const inner: number[][] = [];
    for (let s = 1; s < caps; s++)
      inner.push(Array.from({ length: n }, (_, k) => ringPoint((r * (caps - s)) / caps, y, k)));
    return { inner, center: caps > 0 ? b.vertex(0, y, 0) : -1 };
  };
  const bottom = capRings(-height / 2);
  const top = capRings(height / 2);
  for (let t = 0; t < rows; t++) {
    const lower = rings[t] as number[];
    const upper = rings[t + 1] as number[];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const mid = angle(k + 0.5);
      b.face(
        [lower[k] as number, lower[k1] as number, upper[k1] as number, upper[k] as number],
        [Math.sin(mid), 0, -Math.cos(mid)],
      );
    }
  }
  const cap = (outer: number[], parts: { readonly inner: number[][]; readonly center: number }, outward: Vec): void => {
    if (caps === 0) {
      b.face(outer, outward);
      return;
    }
    let ring = outer;
    for (const inner of parts.inner) {
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        b.face([ring[k] as number, ring[k1] as number, inner[k1] as number, inner[k] as number], outward);
      }
      ring = inner;
    }
    for (let k = 0; k < n; k++) b.face([ring[k] as number, ring[(k + 1) % n] as number, parts.center], outward);
  };
  cap(rings[0] as number[], bottom, [0, -1, 0]);
  cap(rings[rows] as number[], top, [0, 1, 0]);
  return b.build();
}

/**
 * A primitive's stored form with its §6.3 parameters (missing ones take the low-poly defaults; values are clamped
 * like every op argument). The reference kernel builds cube, plane and cylinder; the others throw
 * `EkzaError('not-implemented')` until B1 (sphere, cone, torus) and B13 (humanoidBody) land them.
 */
export function primitive(kind: PrimitiveKind, params: Readonly<Record<string, number | boolean | string>>): MeshData {
  const defs = PRIMITIVE_PARAMS[kind];
  if (defs === undefined) throw notImplemented(`primitive('${String(kind)}')`);
  const { args } = coerceArgs(defs, params);
  switch (kind) {
    case 'cube':
      return cube(args);
    case 'plane':
      return plane(args);
    case 'cylinder':
      return cylinder(args);
    case 'sphere':
    case 'cone':
    case 'torus':
      throw notImplemented(`primitive('${kind}') (B1)`);
    case 'humanoidBody':
      throw notImplemented(`primitive('humanoidBody') (B13)`);
  }
}
