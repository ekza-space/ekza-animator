// Typed-array helpers of the kernel (M6A-SPEC §4.3, research 13 K-1): one typed array per stored array, edit link and
// attribute layer; capacity grows by amortized doubling; float layers store through `Math.fround`, unsigned layers by
// their width. Plain functions, no kernel state.
import { kernelError } from '../kernel';
import type { Domain, LayerDef, LayerType, MeshCounts } from '../types';

export type LayerArray = Float32Array | Uint8Array | Uint16Array | Uint32Array;
/** Every array the kernel keeps: stored arrays and layers (LayerArray) and the signed edit links (Int32Array). */
export type KernelArray = LayerArray | Int32Array;

export const BYTES_PER: Readonly<Record<LayerType, number>> = { f32: 4, u8: 1, u16: 2, u32: 4 };

/** A zero-filled typed array of the layer type. */
export function allocLayer(type: LayerType, length: number): LayerArray {
  switch (type) {
    case 'f32':
      return new Float32Array(length);
    case 'u8':
      return new Uint8Array(length);
    case 'u16':
      return new Uint16Array(length);
    case 'u32':
      return new Uint32Array(length);
  }
}

/** A new array of the same type as `array`, `length` long, holding `array`'s first `keep` values. */
export function grownCopy<T extends KernelArray>(array: T, length: number, keep: number): T {
  const out = new (array.constructor as new (n: number) => T)(length);
  out.set(array.subarray(0, Math.min(keep, array.length)));
  return out;
}

/** The capacity after growth: amortized doubling, at least `needed`, at least 16 elements. */
export function grownCapacity(current: number, needed: number): number {
  let next = Math.max(16, current);
  while (next < needed) next *= 2;
  return next;
}

/** Element count of a domain. */
export function domainCount(counts: MeshCounts, domain: Domain): number {
  switch (domain) {
    case 'point':
      return counts.points;
    case 'edge':
      return counts.edges;
    case 'face':
      return counts.faces;
    case 'corner':
      return counts.corners;
  }
}

/** Domain index used by the kernel's per-domain tables: point 0, edge 1, face 2, corner 3. */
export function domainIndex(domain: Domain): 0 | 1 | 2 | 3 {
  switch (domain) {
    case 'point':
      return 0;
    case 'edge':
      return 1;
    case 'face':
      return 2;
    case 'corner':
      return 3;
  }
}

export const DOMAINS: readonly Domain[] = ['point', 'edge', 'face', 'corner'];

/** A layer array of `count` elements filled with the def's default values. */
export function defaultLayerData(layer: LayerDef, count: number): LayerArray {
  const data = allocLayer(layer.type, count * layer.comps);
  fillDefault(data, layer, 0, count);
  return data;
}

/** Writes the def's default values into elements [from, to) of `data` (no logging: fresh arrays only). */
export function fillDefault(data: LayerArray, layer: LayerDef, from: number, to: number): void {
  const comps = layer.comps;
  if (!layer.default.some((value) => value !== 0)) {
    data.fill(0, from * comps, to * comps);
    return;
  }
  for (let i = from; i < to; i++) {
    for (let k = 0; k < comps; k++) data[i * comps + k] = storedValue(layer.type, layer.default[k] ?? 0);
  }
}

/** True when `type` names a layer type. */
export function isLayerType(value: unknown): value is LayerType {
  return value === 'f32' || value === 'u8' || value === 'u16' || value === 'u32';
}

/** True when `value` names a domain. */
export function isDomain(value: unknown): value is Domain {
  return value === 'point' || value === 'edge' || value === 'face' || value === 'corner';
}

/** The stored value of `value` in a layer of `type` (float32 rounding, unsigned integer truncation and range). */
export function storedValue(type: LayerType, value: number): number {
  switch (type) {
    case 'f32':
      return Math.fround(value);
    case 'u8':
      return value & 0xff;
    case 'u16':
      return value & 0xffff;
    case 'u32':
      return value >>> 0;
  }
}

const INTERPS: ReadonlySet<string> = new Set(['linear', 'copy', 'skin', 'unit', 'or', 'clear']);

/**
 * Checks a layer definition (name, domain, type, comps 1…4, a default of `comps` finite numbers); reserved names
 * start with '$' (the stored arrays of a revision). Unknown `interp`/`mirror` strings are kept (§5.2: an op that
 * cannot propagate an unknown rule copies the layer), so only their type is checked.
 */
export function checkLayerDef(def: LayerDef): void {
  const fail = (why: string): never => {
    throw kernelError('invalid-layer', `Layer ${String(def?.name)}: ${why}`);
  };
  if (typeof def !== 'object' || def === null) fail('expected a LayerDef');
  if (typeof def.name !== 'string' || def.name.length === 0) fail('the name must be a non-empty string');
  if (def.name.startsWith('$')) fail("names starting with '$' are reserved for the stored arrays");
  if (!isDomain(def.domain)) fail(`unknown domain '${String(def.domain)}'`);
  if (!isLayerType(def.type)) fail(`unknown type '${String(def.type)}'`);
  if (def.comps !== 1 && def.comps !== 2 && def.comps !== 3 && def.comps !== 4) fail('comps must be 1…4');
  if (typeof def.interp !== 'string' || typeof def.mirror !== 'string') fail('interp and mirror must be strings');
  if (
    !Array.isArray(def.default) ||
    def.default.length !== def.comps ||
    !def.default.every((x) => typeof x === 'number' && Number.isFinite(x))
  ) {
    fail(`default must hold ${def.comps} finite numbers`);
  }
}

/** True for an interpolation rule the kernel knows (others copy, §5.2). */
export function isKnownInterp(interp: string): boolean {
  return INTERPS.has(interp);
}
