// Helpers of the viewport scenarios (MVP-SPEC §6.2 E2E-02, 04, 05, 06, 22, 25, 26): pointer gestures at test-API
// coordinates, pane and camera reads, and a minimal GLB reader for the source-side expectations computed in Node.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { call, type TestApi } from './test-api';

export type Point = { readonly x: number; readonly y: number };
export type PaneId = 'pane-left' | 'pane-right' | (string & {});
export type CameraSnapshot = ReturnType<TestApi['cameraOf']>;

/** Polls a test-API point until the panel has drawn it. */
export async function pointOf(page: Page, read: () => Promise<Point | null>, what: string): Promise<Point> {
  let point: Point | null = null;
  await expect
    .poll(
      async () => {
        point = await read();
        return point !== null;
      },
      { message: `${what} on screen`, timeout: 15_000 },
    )
    .toBe(true);
  return point as unknown as Point;
}

export async function paneRect(page: Page, id: PaneId): Promise<{ x: number; y: number; w: number; h: number }> {
  const pane = (await call(page, 'panes')).find((candidate) => candidate.id === id);
  if (pane === undefined) throw new Error(`no pane ${id}`);
  return pane.rect;
}

export const centreOf = (rect: { x: number; y: number; w: number; h: number }): Point => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
});

/**
 * A real pointer drag: press at `from`, move by (dx, dy) in `steps` moves, release. `modifiers` are held for the
 * whole gesture (e.g. Alt for Maya navigation).
 */
export async function drag(
  page: Page,
  from: Point,
  delta: { readonly dx: number; readonly dy: number },
  opts: { readonly steps?: number; readonly modifiers?: readonly string[] } = {},
): Promise<void> {
  const steps = opts.steps ?? 10;
  const modifiers = opts.modifiers ?? [];
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from.x + (delta.dx * step) / steps, from.y + (delta.dy * step) / steps);
  }
  await page.mouse.up();
  for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

/** Largest absolute difference between two camera snapshots (position and quaternion, sign of q ignored). */
export function cameraDelta(a: CameraSnapshot, b: CameraSnapshot): { position: number; rotation: number } {
  const position = Math.max(...a.position.map((value, i) => Math.abs(value - (b.position[i] ?? Number.NaN))));
  return { position, rotation: quaternionDelta(a.quaternion, b.quaternion) };
}

/** Largest component difference of two unit quaternions, taking q ≡ −q. */
export function quaternionDelta(a: readonly number[], b: readonly number[]): number {
  const same = Math.max(...a.map((value, i) => Math.abs(value - (b[i] ?? Number.NaN))));
  const flipped = Math.max(...a.map((value, i) => Math.abs(value + (b[i] ?? Number.NaN))));
  return Math.min(same, flipped);
}

/** Waits until the editor has run at least two animation frames (pending input handled and drawn). */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

// ---------- GLB (source-side facts, computed in Node) ----------

export interface GltfNode {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly matrix?: readonly number[];
}

export interface GltfJson {
  readonly nodes: readonly GltfNode[];
  readonly accessors: readonly { readonly count: number }[];
  readonly animations?: readonly {
    readonly name?: string;
    readonly channels: readonly { readonly sampler: number; readonly target: { node?: number; path: string } }[];
    readonly samplers: readonly { readonly input: number; readonly output: number; readonly interpolation?: string }[];
  }[];
  readonly extensions?: Record<string, unknown>;
}

export const fixtureUrl = (path: string): URL => new URL(`../../../../fixtures/${path}`, import.meta.url);

export function readFixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(fixtureUrl(path)));
}

/** The JSON chunk of a GLB container. */
export function glbJson(bytes: Uint8Array): GltfJson {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('the first GLB chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as GltfJson;
}

type Mat4 = number[];

function trsMatrix(node: GltfNode): Mat4 {
  if (node.matrix !== undefined) return [...node.matrix];
  const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
  const [x = 0, y = 0, z = 0, w = 1] = node.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
  // Column-major (glTF), M = T · R · S.
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out: Mat4 = Array.from({ length: 16 }, () => 0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] as number) * (b[col * 4 + k] as number);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Rotation of an orthonormal (unit-scale) column-major matrix as a quaternion [x, y, z, w]. */
function quaternionOf(m: Mat4): [number, number, number, number] {
  const sx = Math.hypot(m[0] as number, m[1] as number, m[2] as number);
  const sy = Math.hypot(m[4] as number, m[5] as number, m[6] as number);
  const sz = Math.hypot(m[8] as number, m[9] as number, m[10] as number);
  const [m00, m10, m20] = [(m[0] as number) / sx, (m[1] as number) / sx, (m[2] as number) / sx];
  const [m01, m11, m21] = [(m[4] as number) / sy, (m[5] as number) / sy, (m[6] as number) / sy];
  const [m02, m12, m22] = [(m[8] as number) / sz, (m[9] as number) / sz, (m[10] as number) / sz];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** World transform of a node at rest: the product of the TRS of its ancestors and its own (glTF scene graph). */
export function restWorld(
  json: GltfJson,
  node: number,
): { t: [number, number, number]; q: [number, number, number, number] } {
  const parent = new Map<number, number>();
  json.nodes.forEach((candidate, index) => {
    for (const child of candidate.children ?? []) parent.set(child, index);
  });
  const chain: number[] = [];
  for (let at: number | undefined = node; at !== undefined; at = parent.get(at)) chain.unshift(at);
  let world: Mat4 = trsMatrix({});
  for (const index of chain) world = multiply(world, trsMatrix(json.nodes[index] ?? {}));
  return { t: [world[12] as number, world[13] as number, world[14] as number], q: quaternionOf(world) };
}

/** The node of a VRM humanoid bone (VRM 1.0 `VRMC_vrm` or VRM 0.x `VRM`). */
export function humanoidNode(json: GltfJson, bone: string): number {
  const vrm1 = json.extensions?.['VRMC_vrm'] as
    | { humanoid?: { humanBones?: Record<string, { node: number }> } }
    | undefined;
  const v1 = vrm1?.humanoid?.humanBones?.[bone]?.node;
  if (v1 !== undefined) return v1;
  const vrm0 = json.extensions?.['VRM'] as { humanoid?: { humanBones?: { bone: string; node: number }[] } } | undefined;
  const v0 = vrm0?.humanoid?.humanBones?.find((entry) => entry.bone === bone)?.node;
  if (v0 === undefined) throw new Error(`no humanoid bone ${bone}`);
  return v0;
}
