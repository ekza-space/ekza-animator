// GLB variants for the Auto-Rig ① tests (AUTORIG-SPEC §11: "variants built in the test helpers by transforming those
// bytes in memory … no new binary fixtures"): a root transform on a fixture's mesh node, a skinned copy (one joint,
// JOINTS_0 / WEIGHTS_0 on every vertex, the skinned node moved off its bind pose), a JSON-only file whose accessors
// claim N triangles (the intake refuses it before reading any data) and a JSON-only file with given top-level fields.

interface Json {
  [key: string]: unknown;
  nodes?: Record<string, unknown>[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors?: Record<string, unknown>[];
  bufferViews?: Record<string, unknown>[];
  buffers?: { byteLength: number }[];
  skins?: Record<string, unknown>[];
}

const pad4 = (n: number): number => (n + 3) & ~3;

export function readGlb(bytes: Uint8Array): { json: Json; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Json;
  const binStart = 20 + jsonLength;
  const bin =
    binStart + 8 <= bytes.byteLength
      ? bytes.slice(binStart + 8, binStart + 8 + view.getUint32(binStart, true))
      : new Uint8Array(0);
  return { json, bin };
}

export function writeGlb(json: Json, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(text.length);
  const binLength = pad4(bin.length);
  const total = 12 + 8 + jsonLength + (bin.length > 0 ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  if (bin.length > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true);
    out.set(bin, at + 8);
  }
  return out;
}

/** A JSON-only GLB with the given top-level fields. */
export function glbWith(fields: Record<string, unknown>): Uint8Array {
  return writeGlb({ asset: { version: '2.0' }, ...fields }, new Uint8Array(0));
}

/** A JSON-only GLB whose one mesh instance claims `triangles` triangles (index accessor without data). */
export function heavyGlb(triangles: number): Uint8Array {
  return glbWith({
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Heavy', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { componentType: 5126, count: triangles, type: 'VEC3' },
      { componentType: 5125, count: 3 * triangles, type: 'SCALAR' },
    ],
  });
}

/** The fixture with a TRS on its first mesh node (the Cube Lad and Polybot have none). */
export function rootTransformed(
  bytes: Uint8Array,
  trs: {
    readonly rotation?: readonly number[];
    readonly scale?: readonly number[];
    readonly translation?: readonly number[];
  },
): Uint8Array {
  const { json, bin } = readGlb(bytes);
  const node = json.nodes?.find((n) => typeof n['mesh'] === 'number');
  if (node === undefined) throw new Error('no mesh node');
  if (trs.rotation !== undefined) node['rotation'] = trs.rotation;
  if (trs.scale !== undefined) node['scale'] = trs.scale;
  if (trs.translation !== undefined) node['translation'] = trs.translation;
  return writeGlb(json, bin);
}

/**
 * A skinned copy: one joint node, a skin, JOINTS_0 (all 0) and WEIGHTS_0 (1, 0, 0, 0) on every vertex of the first
 * mesh, and the skinned node moved 5 m along +X (glTF ignores a skinned node's transform: its bind pose is the data).
 */
export function skinnedCopy(bytes: Uint8Array): Uint8Array {
  const { json, bin } = readGlb(bytes);
  const nodes = json.nodes ?? [];
  const meshNode = nodes.findIndex((n) => typeof n['mesh'] === 'number');
  const node = nodes[meshNode] as Record<string, unknown>;
  const primitive = json.meshes?.[node['mesh'] as number]?.primitives[0];
  if (primitive === undefined) throw new Error('no primitive');
  const count = (json.accessors?.[primitive.attributes['POSITION'] as number]?.['count'] as number) ?? 0;
  const start = pad4(bin.length);
  const joints = new Uint8Array(4 * count);
  const weights = new Float32Array(4 * count);
  for (let i = 0; i < count; i++) weights[4 * i] = 1;
  const out = new Uint8Array(start + joints.length + weights.byteLength);
  out.set(bin, 0);
  out.set(joints, start);
  out.set(new Uint8Array(weights.buffer), start + joints.length);
  const views = (json.bufferViews ??= []);
  const accessors = (json.accessors ??= []);
  views.push({ buffer: 0, byteOffset: start, byteLength: joints.length });
  accessors.push({ bufferView: views.length - 1, componentType: 5121, count, type: 'VEC4' });
  primitive.attributes['JOINTS_0'] = accessors.length - 1;
  views.push({ buffer: 0, byteOffset: start + joints.length, byteLength: weights.byteLength });
  accessors.push({ bufferView: views.length - 1, componentType: 5126, count, type: 'VEC4' });
  primitive.attributes['WEIGHTS_0'] = accessors.length - 1;
  (json.buffers ??= [{ byteLength: 0 }])[0] = { byteLength: out.length };
  nodes.push({ name: 'Root' });
  json.skins = [{ joints: [nodes.length - 1] }];
  node['skin'] = 0;
  node['translation'] = [5, 0, 0];
  const scenes = json['scenes'] as { nodes: number[] }[];
  scenes[0]?.nodes.push(nodes.length - 1);
  return writeGlb(json, out);
}

type Box = readonly [readonly [number, number, number], readonly [number, number, number]];

/**
 * One mesh of axis-aligned boxes (each its own island: 8 shared corners, 12 outward triangles), named `name` — a
 * synthetic part such as a hairdo of a top box and two side boxes (AR-R4-5).
 */
export function boxesGlb(name: string, boxes: readonly Box[]): Uint8Array {
  const positions: number[] = [];
  const indices: number[] = [];
  // the 12 triangles of a box over its corners (bit 0 = x max, bit 1 = y max, bit 2 = z max), counter-clockwise outside
  const tris = [
    [0, 2, 1],
    [1, 2, 3],
    [4, 5, 6],
    [5, 7, 6],
    [0, 1, 4],
    [1, 5, 4],
    [2, 6, 3],
    [3, 6, 7],
    [0, 4, 2],
    [2, 4, 6],
    [1, 3, 5],
    [3, 7, 5],
  ];
  for (const [lo, hi] of boxes) {
    const base = positions.length / 3;
    for (let c = 0; c < 8; c++) {
      positions.push(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]);
    }
    for (const tri of tris) indices.push(...tri.map((i) => base + i));
  }
  const pos = new Float32Array(positions);
  const idx = new Uint16Array(indices);
  const start = pad4(pos.byteLength);
  const bin = new Uint8Array(start + pad4(idx.byteLength));
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), start);
  const lo = [0, 1, 2].map((k) => Math.min(...boxes.map((box) => box[0][k] as number)));
  const hi = [0, 1, 2].map((k) => Math.max(...boxes.map((box) => box[1][k] as number)));
  return writeGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name, mesh: 0 }],
      meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] } as never],
      accessors: [
        { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: lo, max: hi },
        { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
        { buffer: 0, byteOffset: start, byteLength: idx.byteLength },
      ],
      buffers: [{ byteLength: bin.length }],
    },
    bin,
  );
}
