// Built-in attribute layers and the layer constructors (M6A-SPEC §4.3, §5.2; research 13 §3.4). Each layer declares
// its interpolation rule (applied by the Euler operators and the propagation helpers of ./propagate) and its mirror
// rule (applied by the mirror helpers).
import { kernelError } from '../kernel';
import type { Domain, LayerDef } from '../types';

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

/** Layer names of the skin pair (joint indices and weights travel together, §5.2). */
export const SKIN_JOINTS = 'skin.joints';
export const SKIN_WEIGHTS = 'skin.weights';
export const NORMAL_CUSTOM = 'normal.custom';

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

/** A component group: 'bit' = u8 membership (`or`), 'weight' = f32 (`linear`; merges keep the maximum). */
export function groupLayer(name: string, domain: Domain, kind: 'bit' | 'weight'): LayerDef {
  if (typeof name !== 'string' || name.length === 0) throw kernelError('invalid-layer', 'groupLayer: empty name');
  return kind === 'bit'
    ? def({ name: `group:${name}`, domain, type: 'u8', comps: 1, interp: 'or', mirror: 'swap-side', default: [0] })
    : def({
        name: `group:${name}`,
        domain,
        type: 'f32',
        comps: 1,
        interp: 'linear',
        mirror: 'swap-side',
        default: [0],
      });
}
