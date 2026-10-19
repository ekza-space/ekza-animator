// Attribute layer definitions and typed-array helpers (M6A-SPEC §4.3). Part of B0a's reference kernel; B1 replaces it
// (same contracts) and switches the barrel lines.
import { kernelError } from '../kernel';
import type { Domain, LayerDef, LayerType, MeshCounts } from '../types';

export type LayerArray = Float32Array | Uint8Array | Uint16Array | Uint32Array;

const def = (layer: LayerDef): LayerDef => Object.freeze({ ...layer, default: Object.freeze([...layer.default]) });

export const BUILTIN_LAYERS: {
  readonly uv0: LayerDef;
  readonly uv1: LayerDef;
  readonly color0: LayerDef;
  readonly normalCustom: LayerDef;
  readonly skinJoints: LayerDef;
  readonly skinWeights: LayerDef;
  readonly paint: LayerDef;
  readonly crease: LayerDef;
} = Object.freeze({
  uv0: def({
    name: 'uv0',
    domain: 'corner',
    type: 'f32',
    comps: 2,
    interp: 'linear',
    mirror: 'flip-u',
    default: [0, 0],
  }),
  uv1: def({
    name: 'uv1',
    domain: 'corner',
    type: 'f32',
    comps: 2,
    interp: 'linear',
    mirror: 'flip-u',
    default: [0, 0],
  }),
  color0: def({
    name: 'color0',
    domain: 'corner',
    type: 'f32',
    comps: 4,
    interp: 'linear',
    mirror: 'none',
    default: [1, 1, 1, 1],
  }),
  normalCustom: def({
    name: 'normal.custom',
    domain: 'corner',
    type: 'f32',
    comps: 3,
    interp: 'clear',
    mirror: 'negate-axis',
    default: [0, 0, 0],
  }),
  skinJoints: def({
    name: 'skin.joints',
    domain: 'point',
    type: 'u16',
    comps: 4,
    interp: 'skin',
    mirror: 'swap-side',
    default: [0, 0, 0, 0],
  }),
  skinWeights: def({
    name: 'skin.weights',
    domain: 'point',
    type: 'f32',
    comps: 4,
    interp: 'skin',
    mirror: 'swap-side',
    default: [0, 0, 0, 0],
  }),
  paint: def({ name: 'paint', domain: 'face', type: 'u16', comps: 1, interp: 'copy', mirror: 'none', default: [0] }),
  crease: def({ name: 'crease', domain: 'edge', type: 'f32', comps: 1, interp: 'copy', mirror: 'none', default: [0] }),
});

/** A morph target's position deltas: point f32×3, linear, negate-axis (L/R targets swap by name when mirrored). */
export function morphLayer(name: string): LayerDef {
  if (typeof name !== 'string' || name.length === 0) throw kernelError('invalid-layer', 'morphLayer: empty name');
  return def({
    name: `morph:${name}`,
    domain: 'point',
    type: 'f32',
    comps: 3,
    interp: 'linear',
    mirror: 'negate-axis',
    default: [0, 0, 0],
  });
}

/** A component group: 'bit' = u8 membership (`or`), 'weight' = f32 (`linear`). */
export function groupLayer(name: string, domain: Domain, kind: 'bit' | 'weight'): LayerDef {
  if (typeof name !== 'string' || name.length === 0) throw kernelError('invalid-layer', 'groupLayer: empty name');
  return kind === 'bit'
    ? def({ name: `group:${name}`, domain, type: 'u8', comps: 1, interp: 'or', mirror: 'none', default: [0] })
    : def({ name: `group:${name}`, domain, type: 'f32', comps: 1, interp: 'linear', mirror: 'none', default: [0] });
}

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

/** A layer array of `count` elements filled with the def's default values. */
export function defaultLayerData(layer: LayerDef, count: number): LayerArray {
  const data = allocLayer(layer.type, count * layer.comps);
  if (layer.default.some((value) => value !== 0)) {
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < layer.comps; k++) data[i * layer.comps + k] = layer.default[k] ?? 0;
    }
  }
  return data;
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
