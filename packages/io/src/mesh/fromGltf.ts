// Make editable (M6A-SPEC §5.21, research 13 §10.1): one glTF mesh → one MeshData.
//
//   1. Licence gate (`editLicence`), size gate (200,000 triangles by default), compression (Draco/meshopt need the
//      host's decoder, `opts.decode`; quantized accessors are read as numbers like any other).
//   2. Every primitive's vertices are concatenated (the face material is the primitive index → slot).
//   3. Weld: glTF vertices become one point when their positions are bit-equal (−0 = +0) AND their skin joints and
//      weights are equal AND every morph target's POSITION delta is equal (coincident lip or eyelid vertices that separate in a
//      target stay apart). Points keep the order of their first vertex; unreferenced vertices become no point.
//   4. Per-corner layers from the split vertices: TEXCOORD_0/1 → uv0/uv1, COLOR_0 → color0 (linear RGBA), NORMAL →
//      normal.custom; per-point JOINTS_0/WEIGHTS_0 → skin.joints/skin.weights (the glTF skin's joints as layer meta),
//      morph POSITION deltas → `morph:<name>` in glTF order.
//   5. Hard edges where two faces' corner normals differ at either endpoint (a face of a primitive without NORMAL is
//      flat: its edges are hard). Triangles with fewer than three distinct points are dropped and counted.
//
// Deterministic: the same container and mesh index always give the same MeshData.
import type { AssetId, AssetMaterialRef } from '@ekza-studio/doc';
import type { LayerDef, MeshData } from '@ekza-studio/mesh-core';
import { CompressedDataError, GltfReader } from '../gltf/accessor';
import {
  accessorsOf,
  DRACO_EXTENSION,
  type GltfPrimitiveDef,
  isIndex,
  isRecord,
  type JsonRecord,
  meshesOf,
  nodesOf,
  skinsOf,
  unknownList,
} from '../gltf/schema';
import type { GlbContainer, MakeEditableRefusal, MakeEditableReport } from '../types';
import { BUILTIN_LAYERS, EDGE_HARD, morphLayer } from './kernel';
import { editLicence } from './licence';

export const MAKE_EDITABLE_MAX_TRIANGLES = 200_000;

const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;
/** Two unit normals "differ" when the angle between them exceeds ≈ 0.08° (dot < 1 − 1e-6). */
const NORMAL_DOT_SAME = 1 - 1e-6;

export type MakeEditableResult =
  | { readonly data: MeshData; readonly slots: readonly AssetMaterialRef[]; readonly report: MakeEditableReport }
  | MakeEditableRefusal;

const refusal = (code: MakeEditableRefusal['code'], reason: string): MakeEditableRefusal => ({
  refused: true,
  code,
  reason,
});

/** One primitive's vertex data, read and checked. */
interface PrimitiveData {
  readonly count: number;
  readonly position: Float32Array;
  readonly normal: Float32Array | null;
  readonly uv0: Float32Array | null;
  readonly uv1: Float32Array | null;
  /** RGBA (a VEC3 COLOR_0 gets alpha 1). */
  readonly color: Float32Array | null;
  readonly joints: Uint32Array | null;
  readonly weights: Float32Array | null;
  readonly targets: readonly { readonly position: Float32Array | null; readonly normal: boolean }[];
  /** Local vertex indices, three per triangle (strips and fans converted). */
  readonly triangles: Uint32Array;
  readonly tangents: boolean;
}

/** Decodes the glTF mesh's primitives, concatenates them, welds, recovers hard edges, keeps normals and layers. */
export async function meshFromGltf(
  container: GlbContainer,
  meshIndex: number,
  opts: {
    readonly decode?: (container: GlbContainer, meshIndex: number) => Promise<GlbContainer>;
    readonly maxTriangles?: number;
  } = {},
): Promise<MakeEditableResult> {
  const licence = editLicence(container);
  if (!licence.ok) return refusal('licence', licence.reason);
  const mesh = isIndex(meshIndex) ? meshesOf(container.json)[meshIndex] : undefined;
  if (mesh === undefined) return refusal('unsupported', `The model has no mesh ${String(meshIndex)}`);
  const label = meshLabel(mesh as unknown as JsonRecord, meshIndex);
  const primitives = primitivesOf(mesh as unknown as JsonRecord);
  if (primitives.length === 0) return refusal('unsupported', `${label} has no primitives`);
  for (const primitive of primitives) {
    const mode = primitive.mode ?? TRIANGLES;
    if (mode !== TRIANGLES && mode !== TRIANGLE_STRIP && mode !== TRIANGLE_FAN) {
      return refusal(
        'unsupported',
        `${label} has points or lines (primitive mode ${String(mode)}); only triangle meshes can be made editable`,
      );
    }
    if (!isIndex(primitive.attributes?.['POSITION'])) return refusal('unsupported', `${label} has no POSITION`);
  }
  const max = opts.maxTriangles ?? MAKE_EDITABLE_MAX_TRIANGLES;
  const estimate = estimateTriangles(container, primitives);
  if (estimate > max) {
    return refusal(
      'too-large',
      `${label} has ${estimate.toLocaleString('en-US')} triangles; meshes above ${max.toLocaleString('en-US')} ` +
        'stay read-only until decimated (Reduce arrives in M7)',
    );
  }

  let source = container;
  if (isCompressed(container, primitives)) {
    if (opts.decode === undefined) {
      return refusal(
        'compressed',
        `${label} is compressed (Draco or meshopt); making it editable needs the browser's decoders`,
      );
    }
    source = await opts.decode(container, meshIndex);
    const decoded = meshesOf(source.json)[meshIndex];
    const decodedPrimitives = decoded === undefined ? [] : primitivesOf(decoded as unknown as JsonRecord);
    if (decodedPrimitives.length !== primitives.length || isCompressed(source, decodedPrimitives)) {
      return refusal('compressed', `${label} could not be decoded`);
    }
  }
  const sourceMesh = meshesOf(source.json)[meshIndex] as unknown as JsonRecord;
  const sourcePrimitives = primitivesOf(sourceMesh);

  const warnings: string[] = [];
  let read: PrimitiveData[];
  try {
    const reader = new GltfReader(source.json, source.bin);
    read = sourcePrimitives.map((primitive, k) => readPrimitive(reader, primitive, `${label}, primitive ${k}`));
  } catch (error) {
    if (error instanceof CompressedDataError) return refusal('compressed', `${label}: ${error.message}`);
    return refusal('unsupported', `${label}: ${(error as Error).message}`);
  }
  const targetCount = read[0]?.targets.length ?? 0;
  if (read.some((p) => p.targets.length !== targetCount)) {
    return refusal('unsupported', `${label}: its primitives have different numbers of morph targets`);
  }
  for (const primitive of sourcePrimitives) {
    const names = Object.keys(primitive.attributes ?? {});
    const dropped = names.filter((name) => DROPPED_ATTRIBUTE.test(name));
    if (dropped.length > 0) warnings.push(`Attributes ${dropped.join(', ')} are not editable and were left out`);
  }
  if (read.some((p) => p.targets.some((_, t) => targetHasTangent(sourcePrimitives, t)))) {
    warnings.push('Morph target TANGENT deltas are not editable and were left out');
  }
  const hadTangents = read.some((p) => p.tangents);
  if (hadTangents) warnings.push('Tangents will be refused at export unless you drop them');

  const names = targetNames(sourceMesh, sourcePrimitives[0], targetCount);
  const morphNormals = names.filter((_, t) => read.some((p) => p.targets[t]?.normal === true));
  const skin = skinOf(source, meshIndex);
  const built = build(read, names, skin);
  if (built.data.counts.faces === 0) {
    return refusal('unsupported', `${label} has no triangle with three distinct points`);
  }
  if (built.degenerate > 0) {
    warnings.push(`${built.degenerate} degenerate triangle${built.degenerate === 1 ? ' was' : 's were'} dropped`);
  }
  const materials = unknownList((container.json as JsonRecord)['materials']).length;
  const slots: AssetMaterialRef[] = primitives.map((primitive) => ({
    asset: container.sha256 as AssetId,
    // A primitive without `material` uses the glTF default material: recorded as one past the material list.
    material: isIndex(primitive.material) ? primitive.material : materials,
  }));
  return {
    data: built.data,
    slots,
    report: {
      triangles: built.data.counts.faces,
      pointsBefore: read.reduce((sum, p) => sum + p.count, 0),
      pointsAfter: built.data.counts.points,
      degenerateDropped: built.degenerate,
      hardEdges: built.hardEdges,
      layers: [...built.data.layers.keys()],
      morphNormals,
      hadTangents,
      warnings,
    },
  };
}

/**
 * What an export of the mesh's edits needs to know about its source (M6A-SPEC §5.21 "meshToPrimitives"): the morph
 * targets whose primitives carried NORMAL deltas (named as Make editable names them) and whether any primitive had
 * TANGENT. Read from the glTF JSON only.
 */
export function meshFacts(
  container: GlbContainer,
  meshIndex: number,
): { readonly morphNormals: readonly string[]; readonly hadTangents: boolean } {
  const mesh = isIndex(meshIndex) ? meshesOf(container.json)[meshIndex] : undefined;
  if (mesh === undefined) return { morphNormals: [], hadTangents: false };
  const primitives = primitivesOf(mesh as unknown as JsonRecord);
  const count = unknownList(primitives[0]?.targets).length;
  const names = targetNames(mesh as unknown as JsonRecord, primitives[0], count);
  const withNormals = (t: number): boolean =>
    primitives.some((p) => {
      const target = unknownList(p.targets)[t];
      return isRecord(target) && target['NORMAL'] !== undefined;
    });
  return {
    morphNormals: names.filter((_, t) => withNormals(t)),
    hadTangents: primitives.some((p) => p.attributes?.['TANGENT'] !== undefined),
  };
}

// ---------- reading ----------

/** Attributes Make editable does not keep (reported). */
const DROPPED_ATTRIBUTE = /^(TEXCOORD_([2-9]|\d{2,})|COLOR_([1-9]\d*)|JOINTS_([1-9]\d*)|WEIGHTS_([1-9]\d*))$/;

function primitivesOf(mesh: JsonRecord): GltfPrimitiveDef[] {
  return unknownList(mesh['primitives']).filter(isRecord) as unknown as GltfPrimitiveDef[];
}

function meshLabel(mesh: JsonRecord, index: number): string {
  const name = mesh['name'];
  return typeof name === 'string' && name.trim() !== '' ? `Mesh '${name}'` : `Mesh ${index}`;
}

function estimateTriangles(container: GlbContainer, primitives: readonly GltfPrimitiveDef[]): number {
  const accessors = accessorsOf(container.json);
  let total = 0;
  for (const primitive of primitives) {
    const indices = isIndex(primitive.indices) ? accessors[primitive.indices] : undefined;
    const position = accessors[primitive.attributes['POSITION'] as number];
    const count = (indices ?? position)?.count ?? 0;
    const mode = primitive.mode ?? TRIANGLES;
    total += mode === TRIANGLES ? Math.floor(count / 3) : Math.max(0, count - 2);
  }
  return total;
}

function isCompressed(container: GlbContainer, primitives: readonly GltfPrimitiveDef[]): boolean {
  const reader = new GltfReader(container.json, container.bin);
  for (const primitive of primitives) {
    if (isRecord(primitive.extensions) && primitive.extensions[DRACO_EXTENSION] !== undefined) return true;
    const accessors = [
      ...Object.values(primitive.attributes ?? {}),
      ...(isIndex(primitive.indices) ? [primitive.indices] : []),
      ...unknownList(primitive.targets).flatMap((t) => (isRecord(t) ? Object.values(t) : [])),
    ];
    for (const accessor of accessors) {
      try {
        if (isIndex(accessor) && reader.isCompressed(accessor)) return true;
      } catch {
        // A malformed accessor is reported when the primitive is read.
      }
    }
  }
  return false;
}

function targetHasTangent(primitives: readonly GltfPrimitiveDef[], t: number): boolean {
  return primitives.some((p) => {
    const target = unknownList(p.targets)[t];
    return isRecord(target) && target['TANGENT'] !== undefined;
  });
}

function readPrimitive(reader: GltfReader, primitive: GltfPrimitiveDef, where: string): PrimitiveData {
  const attributes = primitive.attributes;
  const position = reader.readFloat(attributes['POSITION'] as number);
  if (reader.accessor(attributes['POSITION'] as number).type !== 'VEC3') {
    throw new Error(`${where}: POSITION must be VEC3`);
  }
  const count = position.length / 3;
  const optional = (
    name: string,
    type: readonly string[],
    comps: number,
    ints = false,
  ): Float32Array | Uint32Array | null => {
    const index = attributes[name];
    if (index === undefined) return null;
    if (!isIndex(index)) throw new Error(`${where}: ${name} is not an accessor index`);
    const accessor = reader.accessor(index);
    if (!type.includes(accessor.type)) throw new Error(`${where}: ${name} has type ${accessor.type}`);
    if (accessor.count !== count)
      throw new Error(`${where}: ${name} has ${accessor.count} values for ${count} vertices`);
    const values = ints ? reader.readUint(index) : reader.readFloat(index);
    if (values.length !== count * comps) throw new Error(`${where}: ${name} has the wrong size`);
    return values;
  };
  const normal = optional('NORMAL', ['VEC3'], 3) as Float32Array | null;
  const uv0 = optional('TEXCOORD_0', ['VEC2'], 2) as Float32Array | null;
  const uv1 = optional('TEXCOORD_1', ['VEC2'], 2) as Float32Array | null;
  let color: Float32Array | null = null;
  const colorIndex = attributes['COLOR_0'];
  if (colorIndex !== undefined) {
    const type = isIndex(colorIndex) ? reader.accessor(colorIndex).type : '';
    const comps = type === 'VEC3' ? 3 : 4;
    const raw = optional('COLOR_0', ['VEC3', 'VEC4'], comps) as Float32Array;
    color = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) {
      for (let k = 0; k < 3; k++) color[4 * v + k] = raw[comps * v + k] as number;
      color[4 * v + 3] = comps === 4 ? (raw[4 * v + 3] as number) : 1;
    }
  }
  const joints = optional('JOINTS_0', ['VEC4'], 4, true) as Uint32Array | null;
  const weights = optional('WEIGHTS_0', ['VEC4'], 4) as Float32Array | null;
  if ((joints === null) !== (weights === null)) throw new Error(`${where}: JOINTS_0 and WEIGHTS_0 come together`);
  const targets = unknownList(primitive.targets).map((target, t) => {
    if (!isRecord(target)) throw new Error(`${where}: morph target ${t} is malformed`);
    const index = target['POSITION'];
    let delta: Float32Array | null = null;
    if (index !== undefined) {
      if (!isIndex(index)) throw new Error(`${where}: morph target ${t} POSITION is not an accessor index`);
      delta = reader.readFloat(index);
      if (delta.length !== count * 3) throw new Error(`${where}: morph target ${t} POSITION has the wrong size`);
    }
    return { position: delta, normal: target['NORMAL'] !== undefined };
  });
  let indices: Uint32Array;
  if (primitive.indices === undefined) {
    indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
  } else {
    if (!isIndex(primitive.indices)) throw new Error(`${where}: indices is not an accessor index`);
    indices = reader.readUint(primitive.indices);
  }
  for (let i = 0; i < indices.length; i++) {
    if ((indices[i] as number) >= count) throw new Error(`${where}: index ${indices[i]} is out of range`);
  }
  return {
    count,
    position,
    normal,
    uv0,
    uv1,
    color,
    joints,
    weights,
    targets,
    triangles: toTriangles(indices, primitive.mode ?? TRIANGLES),
    tangents: attributes['TANGENT'] !== undefined,
  };
}

/** Triangle list of a primitive's index list (glTF 2.0 §3.7.2.1 for strips and fans). */
function toTriangles(indices: Uint32Array, mode: number): Uint32Array {
  if (mode === TRIANGLES) return indices.subarray(0, indices.length - (indices.length % 3));
  const n = Math.max(0, indices.length - 2);
  const out = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (mode === TRIANGLE_FAN) {
      out[3 * i] = indices[0] as number;
      out[3 * i + 1] = indices[i + 1] as number;
      out[3 * i + 2] = indices[i + 2] as number;
    } else {
      out[3 * i] = indices[i] as number;
      out[3 * i + 1] = indices[i + 1 + (i % 2)] as number;
      out[3 * i + 2] = indices[i + 2 - (i % 2)] as number;
    }
  }
  return out;
}

/** Morph target names: `mesh.extras.targetNames`, else the first primitive's, else `target_<i>`; made unique. */
function targetNames(mesh: JsonRecord, first: GltfPrimitiveDef | undefined, count: number): string[] {
  const fromExtras = (owner: unknown): readonly unknown[] => {
    const extras = isRecord(owner) ? owner['extras'] : undefined;
    return isRecord(extras) ? unknownList(extras['targetNames']) : [];
  };
  const listed = fromExtras(mesh).length > 0 ? fromExtras(mesh) : fromExtras(first);
  const used = new Set<string>();
  const out: string[] = [];
  for (let t = 0; t < count; t++) {
    const given = listed[t];
    let name = typeof given === 'string' && given.trim() !== '' ? given : `target_${t}`;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${name} ${n}`)) n++;
      name = `${name} ${n}`;
    }
    used.add(name);
    out.push(name);
  }
  return out;
}

/** The glTF skin that deforms the mesh (the first node using it with a skin) and its joint palette meta. */
function skinOf(
  container: GlbContainer,
  meshIndex: number,
): { readonly skin: number; readonly meta: Readonly<Record<string, unknown>> } | null {
  const nodes = nodesOf(container.json);
  const node = nodes.find((n) => n.mesh === meshIndex && isIndex(n.skin));
  if (node === undefined) return null;
  const skinIndex = node.skin as number;
  const skin = skinsOf(container.json)[skinIndex];
  if (skin === undefined) return null;
  const joints = unknownList(skin.joints).filter(isIndex);
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const child of unknownList(n.children)) if (isIndex(child)) parentOf.set(child, i);
  });
  const paletteIndex = new Map(joints.map((joint, i) => [joint, i]));
  return {
    skin: skinIndex,
    meta: {
      skin: skinIndex,
      joints: joints.map((joint) => {
        let parent = parentOf.get(joint);
        while (parent !== undefined && !paletteIndex.has(parent)) parent = parentOf.get(parent);
        return {
          id: `node:${joint}`,
          name: nodes[joint]?.name ?? null,
          parent: parent === undefined ? -1 : paletteIndex.get(parent),
        };
      }),
    },
  };
}

// ---------- weld and build ----------

interface Built {
  readonly data: MeshData;
  readonly degenerate: number;
  readonly hardEdges: number;
}

function build(
  primitives: readonly PrimitiveData[],
  names: readonly string[],
  skin: { readonly skin: number; readonly meta: Readonly<Record<string, unknown>> } | null,
): Built {
  const V = primitives.reduce((sum, p) => sum + p.count, 0);
  const T = names.length;
  const hasUv0 = primitives.some((p) => p.uv0 !== null);
  const hasUv1 = primitives.some((p) => p.uv1 !== null);
  const hasColor = primitives.some((p) => p.color !== null);
  const hasNormal = primitives.some((p) => p.normal !== null);
  const hasSkin = primitives.some((p) => p.joints !== null);

  // Concatenated vertex arrays.
  const position = new Float32Array(3 * V);
  const normal = new Float32Array(3 * V);
  const flat = new Uint8Array(V); // 1: the vertex's primitive has no NORMAL (flat shading)
  const uv0 = hasUv0 ? new Float32Array(2 * V) : null;
  const uv1 = hasUv1 ? new Float32Array(2 * V) : null;
  const color = hasColor ? new Float32Array(4 * V).fill(1) : null;
  const joints = hasSkin ? new Uint32Array(4 * V) : null;
  const weights = hasSkin ? new Float32Array(4 * V) : null;
  const morph = Array.from({ length: T }, () => new Float32Array(3 * V));
  let offset = 0;
  for (const p of primitives) {
    position.set(p.position, 3 * offset);
    if (p.normal !== null) normal.set(p.normal, 3 * offset);
    else flat.fill(1, offset, offset + p.count);
    if (uv0 !== null && p.uv0 !== null) uv0.set(p.uv0, 2 * offset);
    if (uv1 !== null && p.uv1 !== null) uv1.set(p.uv1, 2 * offset);
    if (color !== null && p.color !== null) color.set(p.color, 4 * offset);
    if (joints !== null && p.joints !== null) joints.set(p.joints, 4 * offset);
    if (weights !== null && p.weights !== null) weights.set(p.weights, 4 * offset);
    p.targets.forEach((target, t) => {
      if (target.position !== null) (morph[t] as Float32Array).set(target.position, 3 * offset);
    });
    offset += p.count;
  }

  // Weld key: position bits, joints, weight bits, every morph delta's bits; −0 counts as +0 (exporters write
  // centre-line vertices as −0 on one side, which must not crack the mesh along the seam).
  const K = 3 + (hasSkin ? 8 : 0) + 3 * T;
  const keys = new Uint32Array(K * V);
  const positionBits = new Uint32Array(position.buffer);
  const weightBits = weights === null ? null : new Uint32Array(weights.buffer);
  const morphBits = morph.map((m) => new Uint32Array(m.buffer));
  for (let v = 0; v < V; v++) {
    let o = K * v;
    keys[o++] = floatKey(positionBits[3 * v] as number);
    keys[o++] = floatKey(positionBits[3 * v + 1] as number);
    keys[o++] = floatKey(positionBits[3 * v + 2] as number);
    if (joints !== null && weightBits !== null) {
      for (let i = 0; i < 4; i++) keys[o++] = joints[4 * v + i] as number;
      for (let i = 0; i < 4; i++) keys[o++] = floatKey(weightBits[4 * v + i] as number);
    }
    for (const bits of morphBits) {
      keys[o++] = floatKey(bits[3 * v] as number);
      keys[o++] = floatKey(bits[3 * v + 1] as number);
      keys[o++] = floatKey(bits[3 * v + 2] as number);
    }
  }
  const rep = new Int32Array(V);
  const chain = new Int32Array(V).fill(-1);
  const heads = new Map<number, number>();
  for (let v = 0; v < V; v++) {
    let h = 0x811c9dc5;
    for (let i = K * v; i < K * (v + 1); i++) h = Math.imul(h ^ (keys[i] as number), 0x01000193);
    let u = heads.get(h) ?? -1;
    rep[v] = v;
    while (u !== -1) {
      if (sameKey(keys, K, u, v)) {
        rep[v] = u;
        break;
      }
      u = chain[u] as number;
    }
    if (rep[v] === v) {
      chain[v] = heads.get(h) ?? -1;
      heads.set(h, v);
    }
  }

  // Faces (triangles of ≥ 3 distinct points) and their glTF corner vertices.
  let triangles = 0;
  for (const p of primitives) triangles += p.triangles.length / 3;
  const faceVerts = new Uint32Array(3 * triangles);
  const faceMaterial: number[] = [];
  let F = 0;
  let degenerate = 0;
  offset = 0;
  primitives.forEach((p, k) => {
    for (let i = 0; i < p.triangles.length; i += 3) {
      const a = offset + (p.triangles[i] as number);
      const b = offset + (p.triangles[i + 1] as number);
      const c = offset + (p.triangles[i + 2] as number);
      const ra = rep[a] as number;
      const rb = rep[b] as number;
      const rc = rep[c] as number;
      if (ra === rb || rb === rc || ra === rc) {
        degenerate++;
        continue;
      }
      faceVerts[3 * F] = a;
      faceVerts[3 * F + 1] = b;
      faceVerts[3 * F + 2] = c;
      faceMaterial.push(k);
      F++;
    }
    offset += p.count;
  });
  const C = 3 * F;

  // Points: used representatives in vertex order.
  const used = new Uint8Array(V);
  for (let c = 0; c < C; c++) used[rep[faceVerts[c] as number] as number] = 1;
  const pointOf = new Int32Array(V).fill(-1);
  let P = 0;
  for (let v = 0; v < V; v++) if (rep[v] === v && used[v] === 1) pointOf[v] = P++;
  const pointVertex = new Uint32Array(P);
  for (let v = 0; v < V; v++) {
    const point = pointOf[rep[v] as number] as number;
    pointOf[v] = point;
    if (point !== -1 && rep[v] === v) pointVertex[point] = v;
  }

  const outPosition = new Float32Array(3 * P);
  for (let p = 0; p < P; p++)
    outPosition.set(position.subarray(3 * (pointVertex[p] as number), 3 * (pointVertex[p] as number) + 3), 3 * p);
  const cornerVert = new Uint32Array(C);
  const cornerNext = new Uint32Array(C);
  const faceCorner = new Uint32Array(F);
  for (let f = 0; f < F; f++) {
    faceCorner[f] = 3 * f;
    for (let i = 0; i < 3; i++) {
      cornerVert[3 * f + i] = pointOf[faceVerts[3 * f + i] as number] as number;
      cornerNext[3 * f + i] = 3 * f + ((i + 1) % 3);
    }
  }

  // Edges in first-use order; hard where the faces' corner normals differ at either endpoint.
  const edgeIndex = new Map<number, number>();
  const edgeVerts: number[] = [];
  /** glTF vertex of the first face at the edge's endpoint 0 and 1. */
  const firstAt: number[] = [];
  const hard: number[] = [];
  const sameNormal = (g: number, h: number): boolean => {
    if (flat[g] === 1 || flat[h] === 1) return false;
    const dot =
      (normal[3 * g] as number) * (normal[3 * h] as number) +
      (normal[3 * g + 1] as number) * (normal[3 * h + 1] as number) +
      (normal[3 * g + 2] as number) * (normal[3 * h + 2] as number);
    const lg = Math.hypot(normal[3 * g] as number, normal[3 * g + 1] as number, normal[3 * g + 2] as number);
    const lh = Math.hypot(normal[3 * h] as number, normal[3 * h + 1] as number, normal[3 * h + 2] as number);
    if (lg === 0 || lh === 0) return lg === lh;
    return dot / (lg * lh) >= NORMAL_DOT_SAME;
  };
  for (let c = 0; c < C; c++) {
    const n = cornerNext[c] as number;
    const a = cornerVert[c] as number;
    const b = cornerVert[n] as number;
    const ga = faceVerts[c] as number;
    const gb = faceVerts[n] as number;
    const key = a < b ? a * P + b : b * P + a;
    const e = edgeIndex.get(key);
    if (e === undefined) {
      edgeIndex.set(key, edgeVerts.length / 2);
      edgeVerts.push(a, b);
      firstAt.push(ga, gb);
      hard.push(flat[ga] === 1 ? 1 : 0);
      continue;
    }
    if (hard[e] === 1) continue;
    // The first face's glTF vertices at the edge's stored endpoints 0 and 1.
    const g0 = firstAt[2 * e] as number;
    const g1 = firstAt[2 * e + 1] as number;
    const at0 = edgeVerts[2 * e] === a ? ga : gb;
    const at1 = edgeVerts[2 * e] === a ? gb : ga;
    if (!sameNormal(g0, at0) || !sameNormal(g1, at1)) hard[e] = 1;
  }
  const E = edgeVerts.length / 2;
  const edgeFlags = new Uint8Array(E);
  let hardEdges = 0;
  for (let e = 0; e < E; e++) {
    if (hard[e] === 1) {
      edgeFlags[e] = EDGE_HARD;
      hardEdges++;
    }
  }

  // Layers.
  const layers = new Map<string, { readonly def: LayerDef; readonly data: Float32Array | Uint16Array }>();
  const cornerLayer = (def: LayerDef, source: Float32Array, comps: number): void => {
    const data = new Float32Array(C * comps);
    for (let c = 0; c < C; c++) {
      const g = faceVerts[c] as number;
      for (let k = 0; k < comps; k++) data[c * comps + k] = source[g * comps + k] as number;
    }
    layers.set(def.name, { def, data });
  };
  if (uv0 !== null) cornerLayer(BUILTIN_LAYERS.uv0, uv0, 2);
  if (uv1 !== null) cornerLayer(BUILTIN_LAYERS.uv1, uv1, 2);
  if (color !== null) cornerLayer(BUILTIN_LAYERS.color0, color, 4);
  if (hasNormal) cornerLayer(BUILTIN_LAYERS.normalCustom, normal, 3);
  if (joints !== null && weights !== null) {
    const j = new Uint16Array(4 * P);
    const w = new Float32Array(4 * P);
    for (let p = 0; p < P; p++) {
      const v = pointVertex[p] as number;
      for (let i = 0; i < 4; i++) {
        j[4 * p + i] = joints[4 * v + i] as number;
        w[4 * p + i] = weights[4 * v + i] as number;
      }
    }
    const meta = skin?.meta ?? { joints: [] };
    layers.set(BUILTIN_LAYERS.skinJoints.name, { def: { ...BUILTIN_LAYERS.skinJoints, meta }, data: j });
    layers.set(BUILTIN_LAYERS.skinWeights.name, { def: BUILTIN_LAYERS.skinWeights, data: w });
  }
  names.forEach((name, t) => {
    const def = morphLayer(name);
    const data = new Float32Array(3 * P);
    const deltas = morph[t] as Float32Array;
    for (let p = 0; p < P; p++)
      data.set(deltas.subarray(3 * (pointVertex[p] as number), 3 * (pointVertex[p] as number) + 3), 3 * p);
    layers.set(def.name, { def, data });
  });

  return {
    data: {
      counts: Object.freeze({ points: P, edges: E, faces: F, corners: C }),
      position: outPosition,
      edgeVerts: Uint32Array.from(edgeVerts),
      edgeFlags,
      cornerVert,
      cornerNext,
      faceCorner,
      faceMaterial: Uint16Array.from(faceMaterial),
      faceFlags: new Uint8Array(F),
      layers,
    },
    degenerate,
    hardEdges,
  };
}

/** The weld key of a float32's bits: the bits themselves, except −0 (0x80000000), which keys as +0. */
const NEGATIVE_ZERO_BITS = 0x80000000;
function floatKey(bits: number): number {
  return bits === NEGATIVE_ZERO_BITS ? 0 : bits;
}

function sameKey(keys: Uint32Array, K: number, u: number, v: number): boolean {
  for (let i = 0; i < K; i++) if (keys[K * u + i] !== keys[K * v + i]) return false;
  return true;
}
