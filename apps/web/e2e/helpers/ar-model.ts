// Auto-Rig ① Model e2e helpers (AUTORIG-SPEC §10 D3, §11: "variants built in the test helpers by transforming those
// bytes in memory … no new binary fixtures"): fixture bytes, a root transform on a fixture's mesh node (Z-up, ×100,
// off-centre), a box "sword" added to a fixture, a flat grid of N real triangles, a JSON-only file claiming N
// triangles, and the ① UI: choose a file through the picker, read the report, press a fix.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { autorig, type AutoRigTestState } from './autorig';

export const fixtureBytes = (file: string): Buffer =>
  readFileSync(new URL(`../../../../fixtures/models/${file}`, import.meta.url));

interface GltfJson {
  [key: string]: unknown;
  nodes?: Record<string, unknown>[];
  meshes?: Record<string, unknown>[];
  accessors?: Record<string, unknown>[];
  bufferViews?: Record<string, unknown>[];
  buffers?: { byteLength: number }[];
  scenes?: { nodes: number[] }[];
}

const pad4 = (n: number): number => (n + 3) & ~3;

function readGlb(bytes: Buffer): { json: GltfJson; bin: Buffer } {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as GltfJson;
  const binStart = 20 + jsonLength;
  const bin =
    binStart + 8 <= bytes.length
      ? bytes.subarray(binStart + 8, binStart + 8 + bytes.readUInt32LE(binStart))
      : Buffer.alloc(0);
  return { json, bin: Buffer.from(bin) };
}

function writeGlb(json: GltfJson, bin: Buffer): Buffer {
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonLength = pad4(text.length);
  const binLength = pad4(bin.length);
  const total = 20 + jsonLength + (bin.length > 0 ? 8 + binLength : 0);
  const out = Buffer.alloc(total, 0);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  out.fill(0x20, 20, 20 + jsonLength);
  text.copy(out, 20);
  if (bin.length > 0) {
    const at = 20 + jsonLength;
    out.writeUInt32LE(binLength, at);
    out.writeUInt32LE(0x004e4942, at + 4);
    bin.copy(out, at + 8);
  }
  return out;
}

/** The fixture with a TRS on its mesh node (the Cube Lad and Polybot have none). */
export function rootTransformed(
  file: string,
  trs: { rotation?: readonly number[]; scale?: readonly number[]; translation?: readonly number[] },
): Buffer {
  const { json, bin } = readGlb(fixtureBytes(file));
  const node = json.nodes?.find((n) => typeof n['mesh'] === 'number');
  if (node === undefined) throw new Error(`${file} has no mesh node`);
  Object.assign(node, trs);
  return writeGlb(json, bin);
}

/** AS-AR-5's bad placement: the Cube Lad Z-up (+90° about X), ×100 (centimetres), off-centre. */
export const badCubeLad = (): Buffer =>
  rootTransformed('cube-lad.glb', {
    rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    scale: [100, 100, 100],
    translation: [37, 5, -12],
  });

/** Appends a mesh (positions, triangle indices) as its own node to a parsed GLB. */
function appendMesh(json: GltfJson, bin: Buffer, name: string, positions: Float32Array, indices: Uint32Array): Buffer {
  const start = pad4(bin.length);
  const out = Buffer.alloc(start + positions.byteLength + indices.byteLength);
  bin.copy(out, 0);
  Buffer.from(positions.buffer).copy(out, start);
  Buffer.from(indices.buffer).copy(out, start + positions.byteLength);
  const views = (json.bufferViews ??= []);
  const accessors = (json.accessors ??= []);
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    lo = lo.map((v, k) => Math.min(v, positions[i + k] ?? 0));
    hi = hi.map((v, k) => Math.max(v, positions[i + k] ?? 0));
  }
  views.push({ buffer: 0, byteOffset: start, byteLength: positions.byteLength, target: 34962 });
  accessors.push({
    bufferView: views.length - 1,
    componentType: 5126,
    count: positions.length / 3,
    type: 'VEC3',
    min: lo,
    max: hi,
  });
  const position = accessors.length - 1;
  views.push({ buffer: 0, byteOffset: start + positions.byteLength, byteLength: indices.byteLength, target: 34963 });
  accessors.push({ bufferView: views.length - 1, componentType: 5125, count: indices.length, type: 'SCALAR' });
  const meshes = (json.meshes ??= []);
  meshes.push({ name, primitives: [{ attributes: { POSITION: position }, indices: accessors.length - 1 }] });
  const nodes = (json.nodes ??= []);
  nodes.push({ name, mesh: meshes.length - 1 });
  (json.scenes ??= [{ nodes: [] }])[0]?.nodes.push(nodes.length - 1);
  (json.buffers ??= [{ byteLength: 0 }])[0] = { byteLength: out.length };
  return out;
}

/** An axis-aligned box mesh (8 points, 12 triangles, outward winding). */
function box(min: readonly number[], max: readonly number[]): { positions: Float32Array; indices: Uint32Array } {
  const [x0, y0, z0] = min as [number, number, number];
  const [x1, y1, z1] = max as [number, number, number];
  const positions = new Float32Array([
    x0,
    y0,
    z0,
    x1,
    y0,
    z0,
    x1,
    y1,
    z0,
    x0,
    y1,
    z0,
    x0,
    y0,
    z1,
    x1,
    y0,
    z1,
    x1,
    y1,
    z1,
    x0,
    y1,
    z1,
  ]);
  const quads = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [5, 1, 2, 6],
    [0, 4, 7, 3],
    [7, 6, 2, 3],
    [0, 1, 5, 4],
  ];
  const indices = new Uint32Array(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d] as number[]));
  return { positions, indices };
}

/** AS-AR-6's two-mesh scene: the textured T-posed Polybot and a box "Sword" lying on the floor beside it. */
export function polybotWithSword(): Buffer {
  const { json, bin } = readGlb(fixtureBytes('polybot-unskinned-tpose.glb'));
  const sword = box([0.9, 0, -0.05], [1.6, 0.06, 0.05]);
  return writeGlb(json, appendMesh(json, bin, 'Sword', sword.positions, sword.indices));
}

/**
 * Polybot with its texture replaced by a flat-colour material (AR-D9-1): an orange base colour factor, no image, as
 * low-poly game assets (Quaternius, Kenney) ship.
 */
export function polybotFlatColour(): Buffer {
  const { json, bin } = readGlb(fixtureBytes('polybot-unskinned-tpose.glb'));
  json['materials'] = [
    {
      name: 'M_Main',
      pbrMetallicRoughness: { baseColorFactor: [0.8, 0.4, 0.04, 1], metallicFactor: 0, roughnessFactor: 0.9 },
    },
  ];
  delete json['textures'];
  delete json['images'];
  delete json['samplers'];
  delete json['extensionsUsed'];
  return writeGlb(json, bin);
}

/** A flat grid of real triangles (≥ `triangles`), standing up 1.7 m in the XY plane: a heavy but loadable model. */
export function gridGlb(triangles: number): Buffer {
  const quads = Math.ceil(triangles / 2);
  const columns = Math.ceil(Math.sqrt(quads));
  const rows = Math.ceil(quads / columns);
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= columns; c++) {
      const i = 3 * (r * (columns + 1) + c);
      positions[i] = (c / columns - 0.5) * 0.6;
      positions[i + 1] = (r / rows) * 1.7;
      positions[i + 2] = 0;
    }
  }
  const indices = new Uint32Array(rows * columns * 6);
  let k = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c;
      const b = a + 1;
      const d = a + columns + 1;
      const e = d + 1;
      indices.set([a, b, e, a, e, d], k);
      k += 6;
    }
  }
  const json: GltfJson = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] };
  return writeGlb(json, appendMesh(json, Buffer.alloc(0), 'Grid', positions, indices));
}

/** A JSON-only GLB whose one mesh claims `triangles` triangles: the intake refuses it before reading any data. */
export function claimedTriangles(triangles: number): Buffer {
  return writeGlb(
    {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Heavy', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { componentType: 5126, count: triangles, type: 'VEC3' },
        { componentType: 5125, count: 3 * triangles, type: 'SCALAR' },
      ],
    },
    Buffer.alloc(0),
  );
}

/** Loads a file through ①'s picker ("Choose file…"), as a user would. */
export async function chooseFile(page: Page, name: string, bytes: Buffer): Promise<void> {
  await page
    .getByTestId('ar-model-picker')
    .first()
    .setInputFiles({ name, mimeType: 'model/gltf-binary', buffer: bytes });
}

/** Waits until the wizard's report names `fileName` and nothing is loading; returns the wizard state. */
export async function waitForReport(page: Page, fileName: string): Promise<AutoRigTestState> {
  await expect
    .poll(
      async () =>
        (await autorig(page))?.intake !== null &&
        ((await autorig(page))?.intake as { fileName?: string } | null)?.fileName === fileName,
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.getByTestId('ar-loading')).toHaveCount(0);
  const state = await autorig(page);
  if (state === null) throw new Error('no Auto-Rig state');
  return state;
}

/** The report's check row (`centred`, `grounded`, `facing`, `upright`, `size`, `transforms`, `pose`). */
export const checkRow = (page: Page, check: string) =>
  page.locator(`[data-testid="ar-model-report"] [data-check="${check}"]`);

/** The intake report of the wizard state. */
export interface ReportLike {
  readonly kind: string;
  readonly fileName: string | null;
  readonly meshes: readonly string[];
  readonly triangles: number;
  readonly height: number;
  readonly weight: string;
  readonly checks: Record<string, boolean | string>;
  readonly pose: { armAngle: number; kind: 't' | 'a' } | null;
}

export async function report(page: Page): Promise<ReportLike | null> {
  return ((await autorig(page))?.intake ?? null) as ReportLike | null;
}
