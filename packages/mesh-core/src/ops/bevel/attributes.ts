// Weighted attribute blends for new elements that lie on no single edge (M6A-SPEC §5.2): bevel miter points and fan
// centres, the corner values of rebuilt faces, strips and corner patches, and the cleanup merges. The rules are the
// §5.2 split rules generalized to a weighted source list (weights ≥ 0 summing to 1):
//   linear  weighted sum · unit  weighted sum, normalized (a zero result keeps the heaviest source)
//   or      bit or / maximum over the sources with a weight > 0
//   clear   the default · copy, skin, unknown: the heaviest source (ties: the first)
//   skin    the 'skin.joints' + 'skin.weights' pair: the union of joints weighted, top 4 (ties to the smaller joint),
//           renormalized in float32 (invariant 7)
// Corner values are captured into plain float64 arrays (`CornerValues`) before the faces that own them are killed, so
// an op can rebuild faces and write the values back afterwards. Writes go through `AttrLayer.set` (logged).
import { kernelError } from '../../kernel';
import { SKIN_JOINTS, SKIN_WEIGHTS } from '../../layers/builtin';
import type { AttrLayer, Domain, EditMesh } from '../../types';

function layersOn(m: EditMesh, domain: Domain): AttrLayer[] {
  const out: AttrLayer[] = [];
  for (const layer of m.layers()) if (layer.def.domain === domain) out.push(layer);
  return out;
}

const isInteger = (layer: AttrLayer): boolean => layer.def.type !== 'f32';

/** Index of the heaviest weight (ties: the first). */
function heaviest(weights: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < weights.length; i++) if ((weights[i] as number) > (weights[best] as number)) best = i;
  return best;
}

/** Blends `comps` values per source (`values[s]`) by `layer`'s rule into `out`. */
function blendValues(
  def: AttrLayer['def'],
  values: readonly Float64Array[],
  weights: ArrayLike<number>,
  out: Float64Array,
): void {
  const comps = def.comps;
  const integer = def.type !== 'f32';
  switch (def.interp) {
    case 'clear':
      for (let k = 0; k < comps; k++) out[k] = def.default[k] ?? 0;
      return;
    case 'linear':
    case 'unit': {
      out.fill(0, 0, comps);
      for (let s = 0; s < values.length; s++) {
        const w = weights[s] as number;
        if (w === 0) continue;
        const v = values[s] as Float64Array;
        for (let k = 0; k < comps; k++) out[k] = (out[k] as number) + w * (v[k] as number);
      }
      if (def.interp === 'unit') {
        let length = 0;
        for (let k = 0; k < comps; k++) length += (out[k] as number) * (out[k] as number);
        length = Math.sqrt(length);
        const v = values[heaviest(weights)] as Float64Array;
        if (length > 0 && Number.isFinite(length)) for (let k = 0; k < comps; k++) out[k] = (out[k] as number) / length;
        else for (let k = 0; k < comps; k++) out[k] = v[k] as number;
      }
      if (integer) for (let k = 0; k < comps; k++) out[k] = Math.round(out[k] as number);
      return;
    }
    case 'or': {
      for (let k = 0; k < comps; k++) out[k] = integer ? 0 : -Infinity;
      for (let s = 0; s < values.length; s++) {
        if ((weights[s] as number) <= 0) continue;
        const v = values[s] as Float64Array;
        for (let k = 0; k < comps; k++) {
          out[k] = integer ? (out[k] as number) | (v[k] as number) : Math.max(out[k] as number, v[k] as number);
        }
      }
      for (let k = 0; k < comps; k++) if (!Number.isFinite(out[k])) out[k] = def.default[k] ?? 0;
      return;
    }
    case 'copy':
    case 'skin':
    default: {
      const v = values[heaviest(weights)] as Float64Array;
      for (let k = 0; k < comps; k++) out[k] = v[k] as number;
    }
  }
}

// ---------- points ----------

const SKIN_A = new Float64Array(4);
const SKIN_B = new Float64Array(4);

/**
 * Point layers of `dst` blended from `sources` with `weights` (§5.2, generalized). Used for the bevel miter points
 * (the vertex and its two neighbours along the bevelled edges) and fan centres.
 */
export function blendPointAttributes(
  m: EditMesh,
  sources: readonly number[],
  weights: readonly number[],
  dst: number,
): void {
  if (sources.length === 0 || sources.length !== weights.length) {
    throw kernelError('invalid-argument', 'blendPointAttributes: one weight per source');
  }
  const joints = m.layer(SKIN_JOINTS);
  const skinWeights = m.layer(SKIN_WEIGHTS);
  const skin =
    joints !== undefined &&
    skinWeights !== undefined &&
    joints.def.domain === 'point' &&
    skinWeights.def.domain === 'point' &&
    joints.def.comps === 4 &&
    skinWeights.def.comps === 4;
  for (const layer of layersOn(m, 'point')) {
    if (skin && (layer === joints || layer === skinWeights)) continue;
    const values = sources.map((v) => {
      const out = new Float64Array(layer.def.comps);
      layer.read(v, out);
      return out;
    });
    const out = new Float64Array(layer.def.comps);
    blendValues(layer.def, values, weights, out);
    for (let k = 0; k < layer.def.comps; k++) layer.set(dst, k, out[k] as number);
  }
  if (skin) blendSkin(joints, skinWeights, sources, weights, dst);
}

function blendSkin(
  joints: AttrLayer,
  weights: AttrLayer,
  sources: readonly number[],
  factors: readonly number[],
  dst: number,
): void {
  const acc = new Map<number, number>();
  for (let s = 0; s < sources.length; s++) {
    const factor = factors[s] as number;
    if (factor <= 0) continue;
    joints.read(sources[s] as number, SKIN_A);
    weights.read(sources[s] as number, SKIN_B);
    for (let k = 0; k < 4; k++) {
      const w = (SKIN_B[k] as number) * factor;
      if (w === 0) continue;
      const joint = SKIN_A[k] as number;
      acc.set(joint, (acc.get(joint) ?? 0) + w);
    }
  }
  const entries = [...acc.entries()]
    .filter(([, w]) => w > 0 && Number.isFinite(w))
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .slice(0, 4);
  let total = 0;
  for (const [, w] of entries) total += w;
  const source = sources[heaviest(factors)] as number;
  if (entries.length === 0 || !(total > 0)) {
    joints.read(source, SKIN_A);
    weights.read(source, SKIN_B);
    for (let k = 0; k < 4; k++) {
      joints.set(dst, k, SKIN_A[k] as number);
      weights.set(dst, k, SKIN_B[k] as number);
    }
    return;
  }
  const out = new Float64Array(4);
  for (let k = 0; k < 4; k++) {
    const entry = entries[k];
    joints.set(dst, k, entry === undefined ? 0 : entry[0]);
    out[k] = entry === undefined ? 0 : Math.fround(entry[1] / total);
  }
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += out[k] as number;
  out[0] = Math.fround((out[0] as number) + (1 - sum));
  for (let k = 0; k < 4; k++) weights.set(dst, k, out[k] as number);
}

// ---------- corners ----------

/**
 * The corner layers of a mesh as one float64 record per corner (all comps of every corner layer, in layer order), so
 * values survive the faces that own them. `capture` reads a corner; `blend` mixes records by the layer rules; `write`
 * stores a record on a corner.
 */
export class CornerValues {
  readonly layers: readonly AttrLayer[];
  readonly stride: number;
  readonly #scratch: Float64Array;

  constructor(m: EditMesh) {
    this.layers = layersOn(m, 'corner');
    let stride = 0;
    for (const layer of this.layers) stride += layer.def.comps;
    this.stride = stride;
    this.#scratch = new Float64Array(4);
  }

  /** The record of corner `c`. */
  capture(c: number): Float64Array {
    const out = new Float64Array(this.stride);
    let o = 0;
    for (const layer of this.layers) {
      layer.read(c, out, o);
      o += layer.def.comps;
    }
    return out;
  }

  /** A record blended from `records` with `weights` by each layer's rule. */
  blend(records: readonly Float64Array[], weights: ArrayLike<number>): Float64Array {
    const out = new Float64Array(this.stride);
    if (records.length === 1) {
      out.set(records[0] as Float64Array);
      return out;
    }
    let o = 0;
    for (const layer of this.layers) {
      const comps = layer.def.comps;
      const slices = records.map((r) => r.subarray(o, o + comps));
      blendValues(layer.def, slices, weights, this.#scratch);
      for (let k = 0; k < comps; k++) out[o + k] = this.#scratch[k] as number;
      o += comps;
    }
    return out;
  }

  /** Linear interpolation of two records at `t` (§5.2 split rule per layer). */
  lerp(a: Float64Array, b: Float64Array, t: number): Float64Array {
    return this.blend([a, b], [1 - t, t]);
  }

  /** Stores `record` on corner `c` ('clear' layers get their default). */
  write(c: number, record: Float64Array): void {
    let o = 0;
    for (const layer of this.layers) {
      const comps = layer.def.comps;
      const clear = layer.def.interp === 'clear';
      for (let k = 0; k < comps; k++) {
        const value = clear ? (layer.def.default[k] ?? 0) : (record[o + k] as number);
        layer.set(c, k, isInteger(layer) ? Math.round(value) : value);
      }
      o += comps;
    }
  }
}

/** Face layers of a mesh captured per face (material and flags are the caller's). */
export class FaceValues {
  readonly layers: readonly AttrLayer[];
  readonly stride: number;

  constructor(m: EditMesh) {
    this.layers = layersOn(m, 'face');
    let stride = 0;
    for (const layer of this.layers) stride += layer.def.comps;
    this.stride = stride;
  }

  capture(f: number): Float64Array {
    const out = new Float64Array(this.stride);
    let o = 0;
    for (const layer of this.layers) {
      layer.read(f, out, o);
      o += layer.def.comps;
    }
    return out;
  }

  write(f: number, record: Float64Array): void {
    let o = 0;
    for (const layer of this.layers) {
      for (let k = 0; k < layer.def.comps; k++) {
        const value = record[o + k] as number;
        layer.set(f, k, isInteger(layer) ? Math.round(value) : value);
      }
      o += layer.def.comps;
    }
  }
}
