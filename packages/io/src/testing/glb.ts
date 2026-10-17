// Synthetic GLB construction for tests (shared test kit): a small accessor builder over one BIN buffer plus the
// budget-stress and hostile files of MVP-SPEC §4.11.14.
import { assembleGlb } from '../glb/write';

type Json = Record<string, unknown>;

/** Assembles a GLB from a glTF JSON object and its BIN bytes (null: no BIN chunk). */
export function makeGlb(json: object, bin: Uint8Array | null): Uint8Array {
  return assembleGlb(JSON.stringify(json), bin === null ? null : [bin]);
}

/** Appends typed data to one BIN buffer and records bufferViews/accessors in a glTF JSON object. */
export class GltfBuilder {
  readonly json: Json & {
    asset: Json;
    accessors: Json[];
    bufferViews: Json[];
    buffers: Json[];
  };
  private readonly parts: Uint8Array[] = [];
  private length = 0;

  constructor(asset: Json = { version: '2.0', generator: 'ekza-animator test kit' }) {
    this.json = { asset, accessors: [], bufferViews: [], buffers: [] };
  }

  /** Adds a tightly packed accessor (float32, uint16 or uint32 data) and returns its index. */
  accessor(
    data: Float32Array | Uint16Array | Uint32Array | Int16Array | Uint8Array,
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4',
    opts: { readonly minMax?: boolean; readonly normalized?: boolean } = {},
  ): number {
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const componentType =
      data instanceof Float32Array
        ? 5126
        : data instanceof Uint32Array
          ? 5125
          : data instanceof Uint16Array
            ? 5123
            : data instanceof Int16Array
              ? 5122
              : 5121;
    const view = this.view(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const accessor: Json = { bufferView: view, componentType, count: data.length / components, type };
    if (opts.normalized === true) accessor['normalized'] = true;
    if (opts.minMax === true) {
      const min = Array.from({ length: components }, () => Infinity);
      const max = Array.from({ length: components }, () => -Infinity);
      data.forEach((v, i) => {
        const c = i % components;
        min[c] = Math.min(min[c] as number, v);
        max[c] = Math.max(max[c] as number, v);
      });
      accessor['min'] = min;
      accessor['max'] = max;
    }
    this.json.accessors.push(accessor);
    return this.json.accessors.length - 1;
  }

  /** Adds raw bytes as a bufferView (4-byte aligned) and returns its index. */
  view(bytes: Uint8Array): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad > 0) {
      this.parts.push(new Uint8Array(pad));
      this.length += pad;
    }
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength });
    this.parts.push(bytes.slice());
    this.length += bytes.byteLength;
    return this.json.bufferViews.length - 1;
  }

  /** The GLB: the JSON (with buffers[0] sized to the BIN data) and the BIN chunk. */
  build(): Uint8Array {
    const bin = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      bin.set(part, offset);
      offset += part.length;
    }
    const json: Json = { ...this.json };
    // buffers[0] is the BIN chunk; tests may add further buffers after it.
    const buffers = Array.isArray(json['buffers']) ? (json['buffers'] as Json[]) : [];
    if (this.length > 0) json['buffers'] = [{ ...buffers[0], byteLength: this.length }, ...buffers.slice(1)];
    else if (buffers.length === 0) delete json['buffers'];
    if (this.json.accessors.length === 0) delete json['accessors'];
    if (this.json.bufferViews.length === 0) delete json['bufferViews'];
    return makeGlb(json, this.length > 0 ? bin : null);
  }
}

/**
 * A VRM-like avatar at the top of the input budgets (§4.11.14 test): 280,000 body vertices, a 20,000-vertex face
 * mesh with 60 morph targets (POSITION + NORMAL), five attributes each, indices, one skin and a VRMC_vrm humanoid.
 * Accessors of equal shape share zero-filled bufferViews, so the file stays small while every count is real.
 */
export function makeBudgetStressGlb(): Uint8Array {
  const body = 280_000;
  const face = 20_000;
  const morphs = 60;
  const b = new GltfBuilder();
  const json = b.json as Json;
  const largest = body * 16; // WEIGHTS_0 float32 VEC4
  const shared = b.view(new Uint8Array(largest));
  const zeros = (count: number, type: string, componentType: number): number => {
    b.json.accessors.push({ bufferView: shared, componentType, count, type });
    return b.json.accessors.length - 1;
  };
  const positions = (count: number): number => {
    const index = zeros(count, 'VEC3', 5126);
    (b.json.accessors[index] as Json)['min'] = [0, 0, 0];
    (b.json.accessors[index] as Json)['max'] = [0, 0, 0];
    return index;
  };
  const primitive = (count: number, targets: number): Json => ({
    attributes: {
      POSITION: positions(count),
      NORMAL: zeros(count, 'VEC3', 5126),
      TEXCOORD_0: zeros(count, 'VEC2', 5126),
      JOINTS_0: zeros(count, 'VEC4', 5123),
      WEIGHTS_0: zeros(count, 'VEC4', 5126),
    },
    indices: zeros(count * 3, 'SCALAR', 5125),
    ...(targets > 0
      ? {
          targets: Array.from({ length: targets }, () => ({
            POSITION: positions(count),
            NORMAL: zeros(count, 'VEC3', 5126),
          })),
        }
      : {}),
  });
  const bones = [
    'hips',
    'spine',
    'chest',
    'neck',
    'head',
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
  ];
  const parents: Record<string, string> = {
    spine: 'hips',
    chest: 'spine',
    neck: 'chest',
    head: 'neck',
    leftUpperLeg: 'hips',
    leftLowerLeg: 'leftUpperLeg',
    leftFoot: 'leftLowerLeg',
    rightUpperLeg: 'hips',
    rightLowerLeg: 'rightUpperLeg',
    rightFoot: 'rightLowerLeg',
    leftUpperArm: 'chest',
    leftLowerArm: 'leftUpperArm',
    leftHand: 'leftLowerArm',
    rightUpperArm: 'chest',
    rightLowerArm: 'rightUpperArm',
    rightHand: 'rightLowerArm',
  };
  const nodes: Json[] = bones.map((name) => ({
    name,
    translation: [0, name === 'hips' ? 1 : 0.1, 0],
    children: [] as number[],
  }));
  bones.forEach((name, i) => {
    const parent = parents[name];
    if (parent !== undefined) ((nodes[bones.indexOf(parent)] as Json)['children'] as number[]).push(i);
  });
  const ibm = b.accessor(
    new Float32Array(bones.length * 16).map((_, i) => (i % 17 === 0 ? 1 : 0)),
    'MAT4',
  );
  json['meshes'] = [
    { name: 'Body', primitives: [primitive(body, 0)] },
    { name: 'Face', primitives: [primitive(face, morphs)] },
  ];
  nodes.push({ name: 'Body', mesh: 0, skin: 0 }, { name: 'Face', mesh: 1, skin: 0 });
  json['nodes'] = nodes;
  json['skins'] = [{ joints: bones.map((_, i) => i), inverseBindMatrices: ibm }];
  json['scenes'] = [{ nodes: [0, bones.length, bones.length + 1] }];
  json['scene'] = 0;
  json['extensionsUsed'] = ['VRMC_vrm'];
  json['extensions'] = {
    VRMC_vrm: {
      specVersion: '1.0',
      meta: { name: 'Budget stress', authors: ['ekza-animator tests'], licenseUrl: 'https://vrm.dev/licenses/1.0/' },
      humanoid: { humanBones: Object.fromEntries(bones.map((name, i) => [name, { node: i }])) },
    },
  };
  return b.build();
}

/**
 * Hostile variants for the structural checks (§4.11.14): an out-of-range bufferView, a 2^31 count, a node cycle, a
 * mesh index past the vertex count and a JOINTS_0 value past the skin's joint count.
 */
export type HostileKind =
  | 'view-out-of-range'
  | 'huge-count'
  | 'cyclic-nodes'
  | 'index-out-of-range'
  | 'joint-out-of-range';

export function makeHostileGlb(kinds: readonly HostileKind[]): Uint8Array {
  const b = new GltfBuilder();
  const json = b.json as Json;
  const positions = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { minMax: true });
  const indices = b.accessor(new Uint16Array([0, 1, kinds.includes('index-out-of-range') ? 3 : 2]), 'SCALAR');
  const joints = b.accessor(
    new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, kinds.includes('joint-out-of-range') ? 2 : 1, 0, 0, 0]),
    'VEC4',
  );
  const weights = b.accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4');
  json['meshes'] = [
    { primitives: [{ attributes: { POSITION: positions, JOINTS_0: joints, WEIGHTS_0: weights }, indices }] },
  ];
  json['nodes'] = [{ name: 'a', children: [1] }, { name: 'b' }, { name: 'mesh', mesh: 0, skin: 0 }];
  json['skins'] = [{ joints: [0, 1] }];
  json['scenes'] = [{ nodes: [0, 2] }];
  if (kinds.includes('view-out-of-range')) {
    // A view that starts past the end of the buffer.
    b.json.bufferViews.push({ buffer: 0, byteOffset: 1_000_000, byteLength: 64 });
    b.json.accessors.push({ bufferView: b.json.bufferViews.length - 1, componentType: 5126, count: 4, type: 'SCALAR' });
  }
  if (kinds.includes('huge-count')) {
    b.json.accessors.push({ bufferView: 0, componentType: 5126, count: 2 ** 31, type: 'VEC3' });
  }
  if (kinds.includes('cyclic-nodes')) {
    ((json['nodes'] as Json[])[1] as Json)['children'] = [0];
    json['scenes'] = [{ nodes: [2] }];
  }
  return b.build();
}
