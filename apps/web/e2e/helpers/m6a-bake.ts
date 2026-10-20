// Bake helpers shared by E2E-MOD-12 (B8) and E2E-MOD-31 (INT): Polybot's forearm ring edge, the made-editable body as
// the page holds it, dense accessor values of a GLB and the JSON values a bake changed outside the allowed diffs.
import type { Page } from '@playwright/test';
import { call } from './test-api';

export type Json = Record<string, unknown>;

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** World translation of a node (TRS chain; Polybot has no matrix nodes). */
export function nodeWorld(json: Json, node: number): Vec3 {
  const nodes = json['nodes'] as Json[];
  const parent = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const child of (n['children'] as number[] | undefined) ?? []) parent.set(child, i);
  });
  const chain: number[] = [];
  for (let n: number | undefined = node; n !== undefined; n = parent.get(n)) chain.unshift(n);
  let t: Vec3 = [0, 0, 0];
  let q: Quat = [0, 0, 0, 1];
  for (const n of chain) {
    const local = (nodes[n]?.['translation'] as Vec3 | undefined) ?? [0, 0, 0];
    const rotation = (nodes[n]?.['rotation'] as Quat | undefined) ?? [0, 0, 0, 1];
    const r = qmul(qmul(q, [local[0], local[1], local[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
    t = [t[0] + r[0], t[1] + r[1], t[2] + r[2]];
    q = qmul(q, rotation);
  }
  return t;
}

/** The made-editable body as the page holds it (B7's mesh test API: local positions, edges, skin layers). */
export interface Body {
  readonly positions: readonly (readonly number[])[];
  readonly edges: readonly (readonly [number, number])[];
  readonly joints: readonly (readonly number[])[];
  readonly weights: readonly (readonly number[])[];
}

export async function bodyOf(page: Page, id: string): Promise<Body> {
  return {
    positions: await call(page, 'meshPositions', id),
    edges: (await call(page, 'meshEdges', id)).map((edge) => edge.v),
    joints: await call(page, 'meshLayer', id, 'skin.joints'),
    weights: await call(page, 'meshLayer', id, 'skin.weights'),
  };
}

export const dot = (u: readonly number[], v: readonly number[]): number =>
  (u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0) + (u[2] ?? 0) * (v[2] ?? 0);

/** An edge along the left forearm (both ends between the elbow and the wrist, near the bone axis): a ring edge. */
export function forearmRingEdge(body: Body, json: Json): number {
  const vrm = (json['extensions'] as Json)['VRM'] as { humanoid: { humanBones: { bone: string; node: number }[] } };
  const nodeOf = (bone: string): number => vrm.humanoid.humanBones.find((b) => b.bone === bone)?.node ?? -1;
  const a = nodeWorld(json, nodeOf('leftLowerArm'));
  const b = nodeWorld(json, nodeOf('leftHand'));
  const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...axis);
  const along = (p: readonly number[]): { readonly t: number; readonly d: number } => {
    const v = [(p[0] ?? 0) - a[0], (p[1] ?? 0) - a[1], (p[2] ?? 0) - a[2]];
    const t = dot(v, axis) / (length * length);
    return { t, d: Math.hypot(...v.map((c, k) => c - t * (axis[k] ?? 0))) };
  };
  for (let e = 0; e < body.edges.length; e++) {
    const [i, j] = body.edges[e] ?? [0, 0];
    const p = body.positions[i] ?? [];
    const q = body.positions[j] ?? [];
    const [sp, sq] = [along(p), along(q)];
    if (sp.t < 0.25 || sp.t > 0.75 || sq.t < 0.25 || sq.t > 0.75) continue;
    if (sp.d > 0.25 * length || sq.d > 0.25 * length) continue;
    const dir = [0, 1, 2].map((k) => (q[k] ?? 0) - (p[k] ?? 0));
    if (Math.abs(dot(dir, axis)) / (Math.hypot(...dir) * length) > 0.8) return e;
  }
  throw new Error('no forearm ring edge');
}

/** Dense accessor values of a GLB (float or unsigned integers). */
export function accessorValues(glb: { readonly json: Json; readonly bin: Uint8Array }, index: number): number[] {
  const accessor = (glb.json['accessors'] as Json[])[index] as Json;
  const view = (glb.json['bufferViews'] as Json[])[accessor['bufferView'] as number] as Json;
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor['type'] as 'VEC3'] ?? 1;
  const n = (accessor['count'] as number) * comps;
  const offset =
    ((view['byteOffset'] as number | undefined) ?? 0) + ((accessor['byteOffset'] as number | undefined) ?? 0);
  const dv = new DataView(glb.bin.buffer, glb.bin.byteOffset + offset);
  const type = accessor['componentType'] as number;
  return Array.from({ length: n }, (_, i) =>
    type === 5126
      ? dv.getFloat32(4 * i, true)
      : type === 5125
        ? dv.getUint32(4 * i, true)
        : type === 5123
          ? dv.getUint16(2 * i, true)
          : dv.getUint8(i),
  );
}

/** JSON values of the original outside the allowed diffs that the bake changed (E2E-MOD-12). */
export function changedValues(before: Json, after: Json): string[] {
  const problems: string[] = [];
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  for (const [key, value] of Object.entries(before)) {
    if (['extensionsUsed', 'extensionsRequired', 'animations'].includes(key)) continue;
    const other = after[key];
    if (key === 'asset') {
      const { extras: _a, generator: _g, ...rest } = value as Json;
      const { extras: _b, generator: _h, ...restAfter } = other as Json;
      if (!same(rest, restAfter)) problems.push('asset');
    } else if (key === 'buffers') {
      const [b0] = value as Json[];
      const [a0] = other as Json[];
      if (!same({ ...b0, byteLength: 0 }, { ...a0, byteLength: 0 })) problems.push('buffers');
    } else if (key === 'meshes') {
      const { primitives: _p, ...rest } = (value as Json[])[0] as Json;
      const { primitives: _q, ...restAfter } = (other as Json[])[0] as Json;
      if (!same(rest, restAfter)) problems.push('meshes[0]');
    } else if (Array.isArray(value)) {
      if (!same((other as unknown[]).slice(0, value.length), value)) problems.push(key);
    } else if (!same(value, other)) {
      problems.push(key);
    }
  }
  return problems;
}
