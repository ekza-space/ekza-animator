// E2E-MOD-12 (M6A-SPEC §10.1; B8): Make editable on Polybot. The sample's body is listed as a virtual `asset` row
// with its derived id; `mesh.makeEditable` creates the record under that id (badge `edit`) holding the welded body;
// the synthetic prohibited-modification VRM is refused with a reason and gets no record. The loop-and-export part
// inserts an edge loop on the forearm (B3's `mesh.insertLoop`) and bakes into the model: validator 0 errors,
// untouched JSON and BIN prefix, new vertices weighted between their edge's endpoints and every morph target with
// NORMAL; it is gated on B3 (§10.1 Gates column) and reads the body through B7's mesh test API. A last B8 check (not
// part of E2E-MOD-12, gated on B7's primitives) reads a static export back through three.js in the page and finds it
// in lastExport().
import { readFileSync } from 'node:fs';
import { derivedId } from '@ekza-animator/doc';
import { expect, type Page, test } from '@playwright/test';
import { exportOne, readGlb, sampleBytes, validatorErrors } from './helpers/g4-export';
import { seedSample, seedWaveClip } from './helpers/seed';
import {
  call,
  expectKernelStarted,
  lastExport,
  loadFile,
  openEditor,
  run,
  runOk,
  waitForCount,
} from './helpers/test-api';

type Json = Record<string, unknown>;

const PROHIBITED = new URL('../../../fixtures/synthetic/prohibited-modification.vrm', import.meta.url);

/** Polybot's body made editable: io's weld of its 1,722 glTF vertices (pinned by io's mesh-from-gltf tests). */
const POLYBOT_BODY = { v: 1184, e: 3260, f: 2130, c: 6390, tris: 2130 } as const;

test('E2E-MOD-12: Make editable on Polybot (derived id, badge edit) and the licence refusal', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  const id = derivedId('mesh', 'asset', [character], '', 0);
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === id) ?? null, { timeout: 30_000 })
    .toMatchObject({ badge: 'asset', manifest: null, runtime: 'none', owner: `char:${character}` });

  const made = await runOk<{ mesh: string }>(page, 'mesh.makeEditable', { character, meshIndex: 0 });
  expect(made.mesh).toBe(id);
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === id)?.runtime, { timeout: 30_000 })
    .toBe('ready');
  const row = (await call(page, 'meshes')).find((candidate) => candidate.id === id);
  expect(row).toMatchObject({ badge: 'edit', rev: 1, faceted: false, generator: null });
  // The record holds the welded body: its counts, and a mesh the kernel validates without problems.
  const info = await call(page, 'meshInfo', id);
  expect(info?.counts).toEqual(POLYBOT_BODY);
  expect(info?.problems).toBe(0);
  expect(info?.layers).toEqual(expect.arrayContaining(['uv0', 'normal.custom', 'skin.joints', 'skin.weights']));
  // No virtual row is left for the body.
  expect((await call(page, 'meshes')).filter((candidate) => candidate.badge === 'asset')).toEqual([]);

  // The prohibited-modification VRM: refused with a reason, no record.
  await loadFile(page, 'prohibited-modification.vrm', new Uint8Array(readFileSync(PROHIBITED)), { auto: true });
  await waitForCount(page, 'characters', 2);
  const other = (await call(page, 'characters')).find((candidate) => candidate.id !== character)?.id ?? '';
  const otherId = derivedId('mesh', 'asset', [other], '', 0);
  await expect
    .poll(async () => (await call(page, 'meshes')).find((candidate) => candidate.id === otherId)?.badge ?? null, {
      timeout: 30_000,
    })
    .toBe('asset');
  const refused = await run(page, 'mesh.makeEditable', { character: other, meshIndex: 0 });
  expect(refused.status).toBe('cancelled');
  expect(refused.status === 'cancelled' ? refused.reason : '').toMatch(/modification/);
  const records = (await call(page, 'meshes')).filter((candidate) => candidate.badge !== 'asset');
  expect(records.map((candidate) => candidate.id)).toEqual([id]);
});

// ---------- the loop-and-export part (B3) ----------

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** World translation of a node (TRS chain; Polybot has no matrix nodes). */
function nodeWorld(json: Json, node: number): Vec3 {
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
interface Body {
  readonly positions: readonly (readonly number[])[];
  readonly edges: readonly (readonly [number, number])[];
  readonly joints: readonly (readonly number[])[];
  readonly weights: readonly (readonly number[])[];
}

async function bodyOf(page: Page, id: string): Promise<Body> {
  return {
    positions: await call(page, 'meshPositions', id),
    edges: (await call(page, 'meshEdges', id)).map((edge) => edge.v),
    joints: await call(page, 'meshLayer', id, 'skin.joints'),
    weights: await call(page, 'meshLayer', id, 'skin.weights'),
  };
}

const dot = (u: readonly number[], v: readonly number[]): number =>
  (u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0) + (u[2] ?? 0) * (v[2] ?? 0);

/** An edge along the left forearm (both ends between the elbow and the wrist, near the bone axis): a ring edge. */
function forearmRingEdge(body: Body, json: Json): number {
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
function values(glb: { readonly json: Json; readonly bin: Uint8Array }, index: number): number[] {
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
function changedValues(before: Json, after: Json): string[] {
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

test('E2E-MOD-12 (loop and export): bake an edge loop on the forearm into Polybot', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { character, clip } = await seedWaveClip(page, 'polybot');
  const id = derivedId('mesh', 'asset', [character], '', 0);
  await runOk(page, 'mesh.makeEditable', { character, meshIndex: 0 });
  const body = await bodyOf(page, id);
  const before = readGlb(sampleBytes('polybot.vrm'));
  const seedEdge = forearmRingEdge(body, before.json);
  // A scripted kernel-op run outside a component mode names its kind (§4.6 `MeshOpArgs.kind`, as E2E-MOD-09 does).
  await runOk(page, 'mesh.insertLoop', { meshes: [id], kind: 'edge', seedEdge, weight: 0.5 });
  const baked = await exportOne(page, { kind: 'bake-into-model', character, clips: [clip] });
  expect(await validatorErrors(baked.bytes)).toEqual([]);
  const after = readGlb(baked.bytes);
  expect(changedValues(before.json, after.json)).toEqual([]);
  // The BIN prefix is byte-identical up to the baseline length.
  const marker = ((after.json['asset'] as Json)['extras'] as Json)['ekza_animator_bake_v2'] as Json;
  expect(marker).toMatchObject({ version: 2 });
  const baseBinLength = marker['baseBinLength'] as number;
  const prefix = (bin: Uint8Array): Buffer => Buffer.from(bin.subarray(0, baseBinLength));
  expect(Buffer.compare(prefix(after.bin), prefix(before.bin))).toBe(0);

  // New vertices: weights sum to 1 and lie between their edge endpoints' weights (union of joints).
  const meshes = after.json['meshes'] as Json[];
  const primitive = ((meshes[0]?.['primitives'] ?? []) as Json[])[0] as Json;
  const attributes = primitive['attributes'] as Record<string, number>;
  const position = values(after, attributes['POSITION'] ?? -1);
  const joints = values(after, attributes['JOINTS_0'] ?? -1);
  const weights = values(after, attributes['WEIGHTS_0'] ?? -1);
  const count = position.length / 3;
  const key = (p: readonly number[]): string => p.map((c) => Math.fround(c)).join(',');
  const known = new Set(body.positions.map(key));
  const weightOf = (point: number, joint: number): number => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (body.joints[point]?.[k] === joint) w += body.weights[point]?.[k] ?? 0;
    return w;
  };
  let added = 0;
  for (let v = 0; v < count; v++) {
    const sum = [0, 1, 2, 3].reduce((total, k) => total + (weights[4 * v + k] ?? 0), 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    const p = [position[3 * v] ?? 0, position[3 * v + 1] ?? 0, position[3 * v + 2] ?? 0];
    if (known.has(key(p))) continue;
    added++;
    // The original edge the new vertex lies on.
    const edge = body.edges.findIndex(([i, j]) => {
      const pa = body.positions[i] ?? [];
      const pb = body.positions[j] ?? [];
      const ab = [0, 1, 2].map((k) => (pb[k] ?? 0) - (pa[k] ?? 0));
      const ap = [0, 1, 2].map((k) => (p[k] ?? 0) - (pa[k] ?? 0));
      const t = dot(ap, ab) / dot(ab, ab);
      return t > 0 && t < 1 && Math.hypot(...ap.map((c, k) => c - t * (ab[k] ?? 0))) < 1e-5;
    });
    expect(edge, `vertex ${v} lies on an original edge`).toBeGreaterThanOrEqual(0);
    const [a, b] = body.edges[edge] ?? [0, 0];
    for (const joint of new Set([...(body.joints[a] ?? []), ...(body.joints[b] ?? [])])) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (joints[4 * v + k] === joint) w += weights[4 * v + k] ?? 0;
      expect(w).toBeGreaterThanOrEqual(Math.min(weightOf(a, joint), weightOf(b, joint)) - 1e-6);
      expect(w).toBeLessThanOrEqual(Math.max(weightOf(a, joint), weightOf(b, joint)) + 1e-6);
    }
  }
  expect(added).toBeGreaterThan(0);

  // Every morph target that had NORMAL still has it, with the primitive's vertex count and finite values.
  for (const target of primitive['targets'] as Record<string, number>[]) {
    expect(target['NORMAL']).toBeDefined();
    const normal = values(after, target['NORMAL'] ?? -1);
    expect(normal.length).toBe(3 * count);
    expect(normal.every(Number.isFinite)).toBe(true);
  }
});

// ---------- B8's static export in the browser (§6.2 `file.exportModel`, §4.8 `lastExport()`) ----------

// Needs a scene mesh, which B7's `mesh.create.cube` creates (a stub until B7 lands): the export is read back through
// three.js's GLTFLoader in the page (the display loader), and lastExport() reports it with its lints and read-back.
test('file.exportModel in the browser: the three.js read-back and lastExport()', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const { mesh: cube } = await runOk<{ mesh: string }>(page, 'mesh.create.cube');
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === cube)?.runtime, { timeout: 30_000 })
    .toBe('ready');
  const download = page.waitForEvent('download', { timeout: 60_000 });
  const result = await run(page, 'file.exportModel', {
    objects: [cube],
    fileName: 'cube.glb',
    profile: 'local/generic',
  });
  expect(result.status).toBe('finished');
  expect((await download).suggestedFilename()).toBe('cube.glb');
  const last = await page.evaluate(() => {
    const value = window.__EKZA_ANIMATOR_TEST__?.lastExport() ?? null;
    return value === null ? null : { fileName: value.fileName, lints: value.lints, readBack: value.readBack };
  });
  expect(last).toMatchObject({
    fileName: 'cube.glb',
    readBack: {
      ok: true,
      kind: 'static',
      meshes: 1,
      primitives: 1,
      triangles: 12,
      three: { ok: true, primitives: 1, triangles: 12 },
    },
  });
  expect((last?.lints ?? []).filter((lint) => (lint as { severity?: string }).severity === 'error')).toEqual([]);
  const bytes = (await lastExport(page))?.bytes;
  expect(bytes).toBeDefined();
  expect(await validatorErrors(new Uint8Array(bytes ?? []))).toEqual([]);
});
