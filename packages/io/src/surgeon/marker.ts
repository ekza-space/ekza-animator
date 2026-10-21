// The surgeon's baseline markers (MVP-SPEC §4.11.11, M6A-SPEC §5.22): `asset.extras.ekza_animator_bake_v1` records the
// counts and BIN hash of the file before the first bake, so a later bake can roll back to it; `ekza_animator_bake_v2`
// (written instead of v1 once a geometry step is applied) adds the original `primitives` JSON of every replaced mesh
// and the original extension lists, so a rollback restores geometry and clips together. Readers accept both; a file
// with both keys is read as v2 (its baseline is the earlier one).
import { isIndex, isRecord, stringList } from '../gltf/schema';
import { sha256Hex } from '../hash/sha256';
import type { EkzaBakeMarkerV1, EkzaBakeMarkerV2 } from '../types';

/** glTF extras keys: on-disk identifiers, kept unchanged by the Ekza Studio rename (DECISIONS-OPEN NAME-1). */
export const BAKE_MARKER_KEY = 'ekza_animator_bake_v1';
export const BAKE_MARKER_V2_KEY = 'ekza_animator_bake_v2';

export type MutableJson = Record<string, unknown>;

/** A marker of either version, normalized (v1: no replaced primitives, no extension lists). */
export interface BakeMarker {
  readonly version: 1 | 2;
  readonly baseAnimations: number;
  readonly baseAccessors: number;
  readonly baseBufferViews: number;
  readonly baseBinLength: number;
  readonly baseBinSha256: string;
  readonly baseSha256: string;
  readonly replaced: Readonly<Record<string, unknown>>;
  readonly replacedPrimitives: Readonly<Record<string, unknown>>;
  readonly originalExtensions: EkzaBakeMarkerV2['originalExtensions'];
  readonly generatorAdded?: true;
}

export type MutableMarker = Omit<BakeMarker, 'replaced' | 'replacedPrimitives' | 'version' | 'originalExtensions'> & {
  version: 1 | 2;
  replaced: Record<string, unknown>;
  replacedPrimitives: Record<string, unknown>;
  originalExtensions: EkzaBakeMarkerV2['originalExtensions'];
};

function extrasOf(json: MutableJson): Readonly<Record<string, unknown>> | undefined {
  const asset = json['asset'];
  const extras = isRecord(asset) ? asset['extras'] : undefined;
  return isRecord(extras) ? extras : undefined;
}

/** The file's marker (v2 first, then v1), or null when there is none or it is malformed. */
export function readMarker(json: MutableJson): BakeMarker | null {
  const extras = extrasOf(json);
  const v2 = extras?.[BAKE_MARKER_V2_KEY];
  if (isRecord(v2) && v2['version'] === 2) {
    const base = readBase(v2);
    if (base !== null) {
      const replacedPrimitives = isRecord(v2['replacedPrimitives']) ? v2['replacedPrimitives'] : {};
      const lists = v2['originalExtensions'];
      const originalExtensions = isRecord(lists)
        ? {
            used: Array.isArray(lists['used']) ? stringList(lists['used']) : null,
            required: Array.isArray(lists['required']) ? stringList(lists['required']) : null,
          }
        : null;
      return { ...base, version: 2, replacedPrimitives, originalExtensions };
    }
  }
  const v1 = extras?.[BAKE_MARKER_KEY];
  if (!isRecord(v1)) return null;
  const base = readBase(v1);
  return base === null ? null : { ...base, version: 1, replacedPrimitives: {}, originalExtensions: null };
}

function readBase(
  marker: Readonly<Record<string, unknown>>,
): Omit<BakeMarker, 'version' | 'replacedPrimitives' | 'originalExtensions'> | null {
  const counts = ['baseAnimations', 'baseAccessors', 'baseBufferViews', 'baseBinLength'] as const;
  if (!counts.every((key) => isIndex(marker[key]))) return null;
  if (typeof marker['baseBinSha256'] !== 'string' || typeof marker['baseSha256'] !== 'string') return null;
  const replaced = isRecord(marker['replaced']) ? marker['replaced'] : {};
  return {
    baseAnimations: marker['baseAnimations'] as number,
    baseAccessors: marker['baseAccessors'] as number,
    baseBufferViews: marker['baseBufferViews'] as number,
    baseBinLength: marker['baseBinLength'] as number,
    baseBinSha256: marker['baseBinSha256'],
    baseSha256: marker['baseSha256'],
    replaced,
    ...(marker['generatorAdded'] === true ? { generatorAdded: true as const } : {}),
  };
}

/** Why a rollback to the marker's baseline is not safe, or null when it is (§4.11.11 rule 7). */
export function rollbackBlocker(
  json: MutableJson,
  marker: BakeMarker,
  bin: Uint8Array | null,
  hash: (bytes: Uint8Array) => string,
): string | null {
  const structural = structuralBlocker(json, marker, bin);
  if (structural !== null) return structural;
  return hash(binPrefix(bin, marker.baseBinLength)) === marker.baseBinSha256 ? null : 'the original BIN bytes changed';
}

export async function rollbackBlockerAsync(
  json: MutableJson,
  marker: BakeMarker,
  bin: Uint8Array | null,
): Promise<string | null> {
  const structural = structuralBlocker(json, marker, bin);
  if (structural !== null) return structural;
  return (await sha256Hex(binPrefix(bin, marker.baseBinLength))) === marker.baseBinSha256
    ? null
    : 'the original BIN bytes changed';
}

function structuralBlocker(json: MutableJson, marker: BakeMarker, bin: Uint8Array | null): string | null {
  if (arrayOf(json, 'animations').length < marker.baseAnimations) return 'animations were removed';
  if (arrayOf(json, 'accessors').length < marker.baseAccessors) return 'accessors were removed';
  if (arrayOf(json, 'bufferViews').length < marker.baseBufferViews) return 'bufferViews were removed';
  if (binLength(json) < marker.baseBinLength || (bin?.length ?? 0) < marker.baseBinLength)
    return 'the BIN is shorter than the baseline';
  const animations = arrayOf(json, 'animations').length;
  for (const key of Object.keys(marker.replaced)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= Math.min(animations, marker.baseAnimations)) {
      return 'the marker lists a replaced animation that no longer exists';
    }
  }
  const meshes = arrayOf(json, 'meshes');
  for (const [key, primitives] of Object.entries(marker.replacedPrimitives)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= meshes.length || !isRecord(meshes[index])) {
      return 'the marker lists a replaced mesh that no longer exists';
    }
    if (!Array.isArray(primitives) || primitives.length === 0) return 'the marker holds malformed original primitives';
  }
  const extras = extrasOf(json);
  for (const [key, value] of Object.entries(extras ?? {})) {
    if (key === BAKE_MARKER_KEY || key === BAKE_MARKER_V2_KEY || !isRecord(value)) continue;
    const later =
      (isIndex(value['baseAnimations']) && value['baseAnimations'] > marker.baseAnimations) ||
      (isIndex(value['baseAccessors']) && value['baseAccessors'] > marker.baseAccessors) ||
      (isIndex(value['baseBufferViews']) && value['baseBufferViews'] > marker.baseBufferViews) ||
      (isIndex(value['baseBinLength']) && value['baseBinLength'] > marker.baseBinLength);
    if (later) return `another tool (${key}) appended after the previous bake`;
  }
  return null;
}

/**
 * Restores replaced primitives and extension lists (v2) and replaced animations, removes a generator the surgeon
 * added, then truncates animations, accessors, bufferViews and the BIN to the baseline.
 */
export function rollBack(json: MutableJson, marker: BakeMarker): void {
  const meshes = arrayOf(json, 'meshes');
  for (const [key, primitives] of Object.entries(marker.replacedPrimitives)) {
    const mesh = meshes[Number(key)];
    if (isRecord(mesh)) meshes[Number(key)] = { ...mesh, primitives: structuredClone(primitives) };
  }
  if (marker.originalExtensions !== null) {
    setList(json, 'extensionsUsed', marker.originalExtensions.used);
    setList(json, 'extensionsRequired', marker.originalExtensions.required);
  }
  const animations = arrayOf(json, 'animations');
  for (const [key, value] of Object.entries(marker.replaced)) animations[Number(key)] = structuredClone(value);
  if (marker.generatorAdded === true && isRecord(json['asset'])) {
    const { generator: _ours, ...asset } = json['asset'];
    json['asset'] = asset;
  }
  truncate(json, 'animations', marker.baseAnimations);
  truncate(json, 'accessors', marker.baseAccessors);
  truncate(json, 'bufferViews', marker.baseBufferViews);
  if (marker.baseBinLength === 0) {
    // buffers[0] was created by the first bake (a glTF buffer is never empty).
    const buffers = arrayOf(json, 'buffers');
    if (buffers.length > 0) buffers.shift();
    if (buffers.length === 0) delete json['buffers'];
    else json['buffers'] = buffers;
  } else {
    setBinLength(json, marker.baseBinLength);
  }
}

/** Sets or removes a root string list (a glTF list is never empty). */
export function setList(json: MutableJson, key: string, list: readonly string[] | null): void {
  if (list === null || list.length === 0) delete json[key];
  else json[key] = [...list];
}

function truncate(json: MutableJson, key: string, length: number): void {
  const list = arrayOf(json, key);
  if (length === 0) delete json[key];
  else json[key] = list.slice(0, length);
}

/** The marker's JSON as written into `asset.extras` (v1 shape for version 1, the v2 shape otherwise). */
export function markerJson(marker: MutableMarker): EkzaBakeMarkerV1 | EkzaBakeMarkerV2 {
  const base = {
    baseAnimations: marker.baseAnimations,
    baseAccessors: marker.baseAccessors,
    baseBufferViews: marker.baseBufferViews,
    baseBinLength: marker.baseBinLength,
    baseBinSha256: marker.baseBinSha256,
    baseSha256: marker.baseSha256,
    // Integer-like keys iterate in ascending order, so re-bakes serialize identically.
    replaced: { ...marker.replaced },
  };
  if (marker.version === 1) {
    return { ...base, ...(marker.generatorAdded === true ? { generatorAdded: true as const } : {}) };
  }
  return {
    version: 2,
    ...base,
    replacedPrimitives: { ...marker.replacedPrimitives },
    originalExtensions: marker.originalExtensions,
    ...(marker.generatorAdded === true ? { generatorAdded: true as const } : {}),
  };
}

/** Writes the marker under its version's key and removes the other version's key. */
export function writeMarker(extras: MutableJson, marker: MutableMarker): void {
  if (marker.version === 1) {
    extras[BAKE_MARKER_KEY] = markerJson(marker);
    delete extras[BAKE_MARKER_V2_KEY];
  } else {
    delete extras[BAKE_MARKER_KEY];
    extras[BAKE_MARKER_V2_KEY] = markerJson(marker);
  }
}

// ---------- shared JSON and BIN helpers ----------

export function arrayOf(json: MutableJson, key: string): unknown[] {
  const value = json[key];
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** buffers[0].byteLength (0 when there is no buffer). */
export function binLength(json: MutableJson): number {
  const buffer = arrayOf(json, 'buffers')[0];
  return isRecord(buffer) && isIndex(buffer['byteLength']) ? buffer['byteLength'] : 0;
}

export function setBinLength(json: MutableJson, length: number): void {
  const buffers = arrayOf(json, 'buffers');
  const buffer = buffers[0];
  if (isRecord(buffer)) buffers[0] = { ...buffer, byteLength: length };
  else buffers.unshift({ byteLength: length });
  json['buffers'] = buffers;
}

/** The first `length` bytes of the original BIN chunk (zero-padded if the chunk is shorter). */
export function binPrefix(bin: Uint8Array | null, length: number): Uint8Array {
  if (bin !== null && bin.length >= length) return bin.subarray(0, length);
  const out = new Uint8Array(length);
  if (bin !== null) out.set(bin);
  return out;
}

/** Whether `asset.generator` is present (any value counts: an existing key is never rewritten). */
export function hasGenerator(json: MutableJson): boolean {
  const asset = json['asset'];
  return isRecord(asset) && asset['generator'] !== undefined;
}
