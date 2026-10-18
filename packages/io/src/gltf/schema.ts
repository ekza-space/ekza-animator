// Typed views of the loosely typed glTF JSON (§4.4 `GltfJson`). The JSON comes from untrusted files, so every
// accessor below checks shapes at runtime: arrays that are missing or malformed read as empty, scalars that are not
// numbers read as undefined. Structural validation with pointers lives in budget/check.ts.
import type { GltfJson } from '../types';

export interface GltfNodeDef {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly mesh?: number;
  readonly skin?: number;
  readonly camera?: number;
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly extras?: unknown;
}

export interface GltfSparseDef {
  readonly count: number;
  readonly indices: { readonly bufferView: number; readonly byteOffset?: number; readonly componentType: number };
  readonly values: { readonly bufferView: number; readonly byteOffset?: number };
}

export interface GltfAccessorDef {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly normalized?: boolean;
  readonly count: number;
  readonly type: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
  readonly sparse?: GltfSparseDef;
}

export interface GltfMeshoptViewDef {
  readonly buffer: number;
  readonly byteOffset?: number;
  readonly byteLength: number;
  readonly byteStride: number;
  readonly count: number;
  readonly mode: string;
  readonly filter?: string;
}

export interface GltfBufferViewDef {
  readonly buffer: number;
  readonly byteOffset?: number;
  readonly byteLength: number;
  readonly byteStride?: number;
  readonly target?: number;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface GltfBufferDef {
  readonly uri?: string;
  readonly byteLength: number;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface GltfSkinDef {
  readonly inverseBindMatrices?: number;
  readonly skeleton?: number;
  readonly joints: readonly number[];
}

export interface GltfPrimitiveDef {
  readonly attributes: Readonly<Record<string, number>>;
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
  readonly targets?: readonly Readonly<Record<string, number>>[];
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface GltfMeshDef {
  readonly name?: string;
  readonly primitives: readonly GltfPrimitiveDef[];
  readonly weights?: readonly number[];
}

export interface GltfChannelDef {
  readonly sampler: number;
  readonly target: {
    readonly node?: number;
    readonly path: string;
    readonly extensions?: Readonly<Record<string, unknown>>;
  };
}

export interface GltfSamplerDef {
  readonly input: number;
  readonly output: number;
  readonly interpolation?: string;
}

export interface GltfAnimationDef {
  readonly name?: string;
  readonly channels: readonly GltfChannelDef[];
  readonly samplers: readonly GltfSamplerDef[];
  readonly extras?: unknown;
}

export interface GltfSceneDef {
  readonly name?: string;
  readonly nodes?: readonly number[];
}

export type JsonRecord = Readonly<Record<string, unknown>>;

export const COMPONENT_SIZE: Readonly<Record<number, number>> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

export const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

export const MESHOPT_EXTENSIONS = ['EXT_meshopt_compression', 'KHR_meshopt_compression'] as const;
export const DRACO_EXTENSION = 'KHR_draco_mesh_compression';

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** A typed array field of untrusted JSON: the field itself, or [] when it is missing or not an array. */
export function listField<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

/** An untyped JSON value as a list of unknown entries ([] when it is not an array). */
export function unknownList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/** A string field of untrusted JSON, or '' when it is missing or not a string. */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Exactly `length` finite numbers, or null. */
export function numberTuple(value: unknown, length: number): number[] | null {
  const list = unknownList(value);
  if (list.length !== length) return null;
  const out: number[] = [];
  for (const entry of list) {
    const n = finite(entry);
    if (n === undefined) return null;
    out.push(n);
  }
  return out;
}

export function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `json[key]` as an array of records (non-record entries become empty records so indices stay stable). */
export function listOf<T>(json: GltfJson | JsonRecord, key: string): readonly T[] {
  const value = (json as JsonRecord)[key];
  if (!Array.isArray(value)) return [];
  return value.map((entry: unknown) => (isRecord(entry) ? entry : {})) as unknown as readonly T[];
}

type AnyJson = GltfJson | JsonRecord;
export const nodesOf = (json: AnyJson): readonly GltfNodeDef[] => listOf<GltfNodeDef>(json, 'nodes');
export const accessorsOf = (json: AnyJson): readonly GltfAccessorDef[] => listOf<GltfAccessorDef>(json, 'accessors');
export const bufferViewsOf = (json: AnyJson): readonly GltfBufferViewDef[] =>
  listOf<GltfBufferViewDef>(json, 'bufferViews');
export const buffersOf = (json: AnyJson): readonly GltfBufferDef[] => listOf<GltfBufferDef>(json, 'buffers');
export const skinsOf = (json: AnyJson): readonly GltfSkinDef[] => listOf<GltfSkinDef>(json, 'skins');
export const meshesOf = (json: AnyJson): readonly GltfMeshDef[] => listOf<GltfMeshDef>(json, 'meshes');
export const animationsOf = (json: AnyJson): readonly GltfAnimationDef[] =>
  listOf<GltfAnimationDef>(json, 'animations');
export const scenesOf = (json: AnyJson): readonly GltfSceneDef[] => listOf<GltfSceneDef>(json, 'scenes');

/** Root-level `extensions` object (empty when absent or malformed). */
export function rootExtensions(json: AnyJson): JsonRecord {
  const value = (json as JsonRecord)['extensions'];
  return isRecord(value) ? value : {};
}

export function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function extensionsUsed(json: AnyJson): readonly string[] {
  return stringList((json as JsonRecord)['extensionsUsed']);
}

export function extensionsRequired(json: AnyJson): readonly string[] {
  return stringList((json as JsonRecord)['extensionsRequired']);
}

/** The meshopt extension object of a bufferView, or null for plain views. */
export function meshoptOf(view: GltfBufferViewDef | undefined): GltfMeshoptViewDef | null {
  const extensions = view?.extensions;
  if (!isRecord(extensions)) return null;
  for (const name of MESHOPT_EXTENSIONS) {
    const ext = extensions[name];
    if (isRecord(ext)) return ext as unknown as GltfMeshoptViewDef;
  }
  return null;
}

/** JSON pointer segment escaping (RFC 6901). */
export function pointer(...segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/** Element size in bytes (components × component size), or undefined for unknown types. */
export function elementSize(accessor: GltfAccessorDef): number | undefined {
  const components = TYPE_COMPONENTS[accessor.type];
  const size = COMPONENT_SIZE[accessor.componentType];
  return components === undefined || size === undefined ? undefined : components * size;
}

/**
 * Byte length a single element occupies in its bufferView, including the column padding glTF requires for
 * MAT2/MAT3 with 1- and 2-byte components.
 */
export function packedElementSize(accessor: GltfAccessorDef): number | undefined {
  const size = COMPONENT_SIZE[accessor.componentType];
  if (size === undefined) return undefined;
  if (accessor.type === 'MAT2' && size === 1) return 8;
  if (accessor.type === 'MAT3' && size === 1) return 12;
  if (accessor.type === 'MAT3' && size === 2) return 24;
  return elementSize(accessor);
}
