// B13 content helpers (M6A-SPEC §9 B13, §10.1): faces found by position, reference images imported through Create ›
// Reference Image, a scripted handheld sword (`buildSword`, E2E-MOD-13), GLB and `.ekzanim` readers for assertions.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import { createPrimitive, meshRuntime, setMode } from './m6a-model';
import { call, runOk } from './test-api';

export const FIXTURE_IMAGES = resolve(process.cwd(), '../../fixtures/images');

/** The fixture bytes of a reference image (`reference-front.png`, `reference-side.png`). */
export function referenceImage(name: 'reference-front.png' | 'reference-side.png'): Buffer {
  return readFileSync(resolve(FIXTURE_IMAGES, name));
}

/** World-space vertex positions of each face of a mesh (`meshFaces` × `meshPositions`). */
export async function facePositions(page: Page, mesh: string): Promise<number[][][]> {
  const faces = await call(page, 'meshFaces', mesh);
  const positions = await call(page, 'meshPositions', mesh, undefined, 'world');
  return faces.map((face) => face.map((v) => positions[v] as number[]));
}

/** The face whose centroid is extreme along an axis (`+1` largest, `-1` smallest): a cube's top face is (1, +1). */
export async function extremeFace(page: Page, mesh: string, axis: 0 | 1 | 2, sign: 1 | -1): Promise<number> {
  const faces = await facePositions(page, mesh);
  let best = -1;
  let bestValue = -Infinity;
  faces.forEach((face, index) => {
    const centroid = face.reduce((sum, p) => sum + (p[axis] as number), 0) / face.length;
    if (sign * centroid > bestValue) {
      bestValue = sign * centroid;
      best = index;
    }
  });
  return best;
}

/** Vertex indices whose position along `axis` is within 1e-6 of the mesh's extreme there. */
export async function extremeVertices(page: Page, mesh: string, axis: 0 | 1 | 2, sign: 1 | -1): Promise<number[]> {
  const positions = await call(page, 'meshPositions', mesh, undefined, 'local');
  const values = positions.map((p) => sign * (p[axis] as number));
  const top = Math.max(...values);
  return values.flatMap((value, index) => (Math.abs(value - top) <= 1e-6 ? [index] : []));
}

/** Opens Create › Reference Image › <view>…, chooses the fixture file and imports it; returns the new plane id. */
export async function importReferenceImage(
  page: Page,
  camera: 'front' | 'side' | 'top',
  file: 'reference-front.png' | 'reference-side.png',
): Promise<string> {
  const before = new Set((await call(page, 'imagePlanes')).map((plane) => plane.id));
  await page.getByTestId('menu-create').click();
  await page.getByTestId('menu-sub-create.reference-image').click();
  await page.getByTestId(`menu-item-builtin.model.create.reference-image.${camera}`).click();
  const dialog = page.getByTestId('image-plane-import');
  await expect(dialog).toBeVisible();
  await page.getByTestId('image-plane-file').setInputFiles(resolve(FIXTURE_IMAGES, file));
  await expect(page.getByTestId(`image-plane-camera-${camera}`)).toHaveAttribute('data-state', 'checked');
  await page.getByTestId('image-plane-confirm').click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await call(page, 'imagePlanes')).length).toBe(before.size + 1);
  const created = (await call(page, 'imagePlanes')).find((plane) => !before.has(plane.id));
  if (created === undefined) throw new Error('no new image plane');
  return created.id;
}

/** Types into an Attributes field and commits it with Enter. */
export async function setAttributeField(page: Page, testId: string, text: string): Promise<void> {
  const field = page.getByTestId(testId);
  await field.click();
  await field.fill(text);
  await field.press('Enter');
}

/** Selects scene objects through the test API's operator path (B10's `select.objects`). */
export async function selectObjects(page: Page, ids: readonly string[]): Promise<void> {
  await runOk(page, 'select.objects', { ids, mode: 'replace' });
}

/** Moves objects (B12a's `scene.object.transform`) to world translations, keeping rotation and scale. */
export async function placeObjects(page: Page, placements: Readonly<Record<string, readonly number[]>>): Promise<void> {
  const ids = Object.keys(placements);
  await runOk(page, 'scene.object.transform', {
    ids,
    placements: ids.map((id) => ({ t: placements[id], q: [0, 0, 0, 1], s: [1, 1, 1] })),
  });
}

export interface Sword {
  readonly group: string;
  readonly blade: string;
  readonly hilt: string;
}

/**
 * E2E-MOD-13's scripted handheld sword (about 110 triangles, inside the 80–400 the scenario asks for): the Handheld
 * template, a cube scaled to a blade above the grip (four height segments), its top face extruded twice and the tip
 * vertices merged to their centre, a 6-sided cylinder handle (three segments) and a cube cross-guard combined into
 * the hilt. Needs B3 (extrude), B4 (Merge to Center, Combine), B10 (component selection) and B12a
 * (object transforms).
 */
export async function buildSword(page: Page): Promise<Sword> {
  const { root: group } = await runOk<{ root: string }>(page, 'mesh.create.template', { template: 'handheld' });
  const template = (await call(page, 'meshes')).find((row) => row.parent === group);
  if (template !== undefined) await runOk(page, 'scene.delete', { ids: [template.id] });

  // The blade: created into the selected Handheld group (§5.16), then raised above the guard.
  await selectObjects(page, [group]);
  const blade = await createPrimitive(page, 'cube', { width: 0.06, height: 0.5, depth: 0.012, subdivisionsHeight: 4 });
  await placeObjects(page, { [blade]: [0, 0.32, 0] });
  await runOk(page, 'model.hilite', { meshes: [blade], mode: 'replace' });
  await setMode(page, 'face');
  const top = await extremeFace(page, blade, 1, 1);
  await runOk(page, 'select.components', { mesh: blade, kind: 'face', indices: [top], mode: 'replace' });
  await runOk(page, 'mesh.extrude', { localTranslateZ: 0.12 });
  await runOk(page, 'mesh.extrude', { localTranslateZ: 0.06, localScaleX: 0.2, localScaleY: 0.2 });
  await setMode(page, 'vertex');
  const tip = await extremeVertices(page, blade, 1, 1);
  await runOk(page, 'select.components', { mesh: blade, kind: 'vertex', indices: tip, mode: 'replace' });
  await runOk(page, 'mesh.mergeToCenter');
  await setMode(page, 'object');

  // The hilt: a 6-sided handle and a cube cross-guard, combined.
  await selectObjects(page, [group]);
  const handle = await createPrimitive(page, 'cylinder', {
    radius: 0.015,
    height: 0.16,
    subdivisionsAxis: 6,
    subdivisionsHeight: 3,
  });
  await selectObjects(page, [group]);
  const guard = await createPrimitive(page, 'cube', { width: 0.16, height: 0.02, depth: 0.03 });
  await placeObjects(page, { [handle]: [0, 0, 0], [guard]: [0, 0.08, 0] });
  await selectObjects(page, [handle, guard]);
  const before = new Set((await call(page, 'meshes')).map((row) => row.id));
  await runOk(page, 'mesh.combine');
  const hilt = (await call(page, 'meshes')).find((row) => !before.has(row.id))?.id;
  if (hilt === undefined) throw new Error('Combine created no mesh');
  await expect.poll(() => meshRuntime(page, hilt)).toBe('ready');
  await selectObjects(page, [group]);
  return { group, blade, hilt };
}

// ---------- file readers ----------

/** The JSON chunk of a GLB. */
export function glbJson(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(Buffer.from(bytes.subarray(20, 20 + length)).toString('utf8')) as Record<string, unknown>;
}

/** The bytes of one entry of a zip archive (stored or deflated), or null. */
export function zipEntry(zip: Uint8Array, name: string): Buffer | null {
  const buffer = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: the last "PK\x05\x06".
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) return null;
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const entry = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (entry === name) {
      const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(dataStart, dataStart + compressed);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** Entry names of a zip archive. */
export function zipNames(zip: Uint8Array): string[] {
  const buffer = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) return [];
  let offset = buffer.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = buffer.readUInt16LE(end + 10); i > 0; i--) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return names;
}

// ---------- GLB accessors and the palette PNG ----------

const COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

interface GltfAccessor {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
}
interface GltfBufferView {
  readonly buffer: number;
  readonly byteOffset?: number;
  readonly byteLength: number;
  readonly byteStride?: number;
}

/** The BIN chunk of a GLB. */
export function glbBin(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return bytes.subarray(binStart + 8, binStart + 8 + binLength);
}

/** An accessor's elements as number tuples (float32, uint8/16/32; tightly packed or strided views). */
export function readAccessor(bytes: Uint8Array, index: number): number[][] {
  const json = glbJson(bytes) as { accessors: GltfAccessor[]; bufferViews: GltfBufferView[] };
  const accessor = json.accessors[index];
  if (accessor === undefined || accessor.bufferView === undefined) throw new Error(`no accessor ${index}`);
  const bufferView = json.bufferViews[accessor.bufferView] as GltfBufferView;
  const bin = glbBin(bytes);
  const k = COMPONENTS[accessor.type] ?? 1;
  const size =
    accessor.componentType === 5126 || accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
  const stride = bufferView.byteStride ?? k * size;
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = (at: number): number =>
    accessor.componentType === 5126
      ? view.getFloat32(at, true)
      : accessor.componentType === 5125
        ? view.getUint32(at, true)
        : accessor.componentType === 5123
          ? view.getUint16(at, true)
          : view.getUint8(at);
  return Array.from({ length: accessor.count }, (_, i) =>
    Array.from({ length: k }, (_, c) => read(base + i * stride + c * size)),
  );
}

/** Decodes an 8-bit RGB, non-interlaced PNG whose rows all use filter 0 (the `ekza-palette-v1` texture). */
export function decodePalettePng(png: Uint8Array): {
  width: number;
  height: number;
  rgb(x: number, y: number): number[];
} {
  const buffer = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = width * 3 + 1;
  return {
    width,
    height,
    rgb: (x, y) => {
      const at = y * rowBytes + 1 + x * 3;
      return [raw[at] as number, raw[at + 1] as number, raw[at + 2] as number];
    },
  };
}

/** The exact sRGB EOTF (8-bit sRGB → linear). */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
