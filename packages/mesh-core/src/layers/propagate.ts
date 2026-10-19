// Attribute propagation (M6A-SPEC §5.2, research 13 §3.4): the layer rules applied when an element arises. The Euler
// operators call them (a split edge interpolates point and corner layers, a split face's halves keep their face
// layers, a new face copies its example), and every op package uses them where its new elements come from more than
// one source (duplicating, merging, filling, mirroring) instead of writing layers by hand.
//
// Rules by `LayerDef.interp`:
//   linear  split: lerp · merge: average (group weights 'group:*': maximum) · duplicate: copy
//   copy    split: the nearer source (t ≤ 0.5 → a) · merge: the target's (or the first source's) · duplicate: copy
//   skin    the 'skin.joints' + 'skin.weights' pair: blend both ends' weights over the union of joints, keep the top 4
//           (ties to the smaller joint index), renormalize; merge: target's or the blended average
//   unit    lerp, then normalize (a zero result keeps a's value)
//   or      bit or (u8 group bits); float layers take the maximum
//   clear   the default value ('normal.custom': cleared on new and touched corners)
//   other   copy (§5.2: an unknown rule copies)
// Writes go through the mesh's `AttrLayer.set`, so they are logged like every write.
import { kernelError } from '../kernel';
import type { AttrLayer, Domain, EditMesh } from '../types';
import { NORMAL_CUSTOM, SKIN_JOINTS, SKIN_WEIGHTS } from './builtin';

const A = new Float64Array(4);
const B = new Float64Array(4);
const OUT = new Float64Array(4);

function layersOn(m: EditMesh, domain: Domain): readonly AttrLayer[] {
  const out: AttrLayer[] = [];
  for (const layer of m.layers()) if (layer.def.domain === domain) out.push(layer);
  return out;
}

function isInteger(layer: AttrLayer): boolean {
  return layer.def.type !== 'f32';
}

function write(layer: AttrLayer, index: number, values: Float64Array): void {
  const comps = layer.def.comps;
  const integer = isInteger(layer);
  for (let k = 0; k < comps; k++) {
    const value = values[k] as number;
    layer.set(index, k, integer ? Math.round(value) : value);
  }
}

function writeDefault(layer: AttrLayer, index: number): void {
  const def = layer.def;
  for (let k = 0; k < def.comps; k++) layer.set(index, k, def.default[k] ?? 0);
}

function copyValue(layer: AttrLayer, src: number, dst: number): void {
  if (src === dst) return;
  layer.read(src, A);
  write(layer, dst, A);
}

/** The value of `layer` interpolated between elements a (t = 0) and b (t = 1) by its rule (skin handled apart). */
function interpValue(layer: AttrLayer, a: number, b: number, t: number, dst: number): void {
  const def = layer.def;
  const comps = def.comps;
  switch (def.interp) {
    case 'clear':
      writeDefault(layer, dst);
      return;
    case 'linear':
    case 'unit': {
      layer.read(a, A);
      layer.read(b, B);
      for (let k = 0; k < comps; k++) OUT[k] = (A[k] as number) + ((B[k] as number) - (A[k] as number)) * t;
      if (def.interp === 'unit') {
        let length = 0;
        for (let k = 0; k < comps; k++) length += (OUT[k] as number) * (OUT[k] as number);
        length = Math.sqrt(length);
        if (length > 0 && Number.isFinite(length)) for (let k = 0; k < comps; k++) OUT[k] = (OUT[k] as number) / length;
        else for (let k = 0; k < comps; k++) OUT[k] = A[k] as number;
      }
      write(layer, dst, OUT);
      return;
    }
    case 'or': {
      layer.read(a, A);
      layer.read(b, B);
      for (let k = 0; k < comps; k++) {
        OUT[k] = isInteger(layer) ? (A[k] as number) | (B[k] as number) : Math.max(A[k] as number, B[k] as number);
      }
      write(layer, dst, OUT);
      return;
    }
    case 'copy':
    case 'skin':
    default:
      copyValue(layer, t <= 0.5 ? a : b, dst);
  }
}

// ---------- skin ----------

/** Joints and weights of point `v` accumulated into `acc` (joint → weight) with factor `w`. */
function accumulateSkin(joints: AttrLayer, weights: AttrLayer, v: number, w: number, acc: Map<number, number>): void {
  joints.read(v, A);
  weights.read(v, B);
  for (let k = 0; k < 4; k++) {
    const weight = (B[k] as number) * w;
    if (weight === 0) continue;
    const joint = A[k] as number;
    acc.set(joint, (acc.get(joint) ?? 0) + weight);
  }
}

/** Writes the top 4 influences of `acc` (ties to the smaller joint index), renormalized, into point `dst`. */
function writeSkin(
  joints: AttrLayer,
  weights: AttrLayer,
  acc: Map<number, number>,
  fallback: number,
  dst: number,
): void {
  const entries = [...acc.entries()]
    .filter(([, weight]) => weight > 0 && Number.isFinite(weight))
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .slice(0, 4);
  let total = 0;
  for (const [, weight] of entries) total += weight;
  if (entries.length === 0 || !(total > 0)) {
    copyValue(joints, fallback, dst);
    copyValue(weights, fallback, dst);
    return;
  }
  for (let k = 0; k < 4; k++) {
    const entry = entries[k];
    OUT[k] = entry === undefined ? 0 : entry[0];
  }
  write(joints, dst, OUT);
  // Normalize in float32 so the stored weights sum to 1 within float32 rounding (invariant 7: ± 1e-6).
  for (let k = 0; k < 4; k++) {
    const entry = entries[k];
    OUT[k] = entry === undefined ? 0 : Math.fround(entry[1] / total);
  }
  let sum = 0;
  for (let k = 0; k < 4; k++) sum += OUT[k] as number;
  OUT[0] = Math.fround((OUT[0] as number) + (1 - sum));
  write(weights, dst, OUT);
}

interface SkinPair {
  readonly joints: AttrLayer;
  readonly weights: AttrLayer;
}

function skinPair(m: EditMesh): SkinPair | null {
  const joints = m.layer(SKIN_JOINTS);
  const weights = m.layer(SKIN_WEIGHTS);
  if (joints === undefined || weights === undefined) return null;
  if (joints.def.domain !== 'point' || weights.def.domain !== 'point' || joints.def.comps !== 4) return null;
  if (weights.def.comps !== 4) return null;
  return { joints, weights };
}

function isSkinLayer(layer: AttrLayer, pair: SkinPair | null): boolean {
  return pair !== null && (layer === pair.joints || layer === pair.weights);
}

// ---------- points ----------

/** §5.2 duplicating a vertex: every point layer of `dst` copies `src`. */
export function copyPointAttributes(m: EditMesh, src: number, dst: number): void {
  for (const layer of layersOn(m, 'point')) copyValue(layer, src, dst);
}

/** §5.2 splitting an edge at `t`: point layers of `dst` interpolated from a (t = 0) to b (t = 1) by their rules. */
export function interpolatePointAttributes(m: EditMesh, a: number, b: number, t: number, dst: number): void {
  const pair = skinPair(m);
  for (const layer of layersOn(m, 'point')) {
    if (isSkinLayer(layer, pair)) continue;
    interpValue(layer, a, b, t, dst);
  }
  if (pair !== null) {
    const acc = new Map<number, number>();
    accumulateSkin(pair.joints, pair.weights, a, 1 - t, acc);
    accumulateSkin(pair.joints, pair.weights, b, t, acc);
    writeSkin(pair.joints, pair.weights, acc, t <= 0.5 ? a : b, dst);
  }
}

/**
 * §5.2 merging vertices into `dst`: `'target'` copies the target's values (weld); `'average'` averages by each rule
 * (merge, collapse: linear layers average, group weights take the maximum, bits or, skin blends the union and keeps
 * the top 4, copy layers take the first source's value).
 */
export function mergePointAttributes(
  m: EditMesh,
  sources: ArrayLike<number>,
  dst: number,
  mode: 'target' | 'average',
  target?: number,
): void {
  if (sources.length === 0) return;
  const first = sources[0] as number;
  if (mode === 'target') {
    copyPointAttributes(m, target ?? first, dst);
    return;
  }
  const pair = skinPair(m);
  const n = sources.length;
  for (const layer of layersOn(m, 'point')) {
    if (isSkinLayer(layer, pair)) continue;
    const def = layer.def;
    const comps = def.comps;
    if (def.interp === 'clear') {
      writeDefault(layer, dst);
      continue;
    }
    const maximum = def.interp === 'linear' && def.name.startsWith('group:');
    if (def.interp === 'linear' || def.interp === 'unit' || def.interp === 'or') {
      const or = def.interp === 'or';
      const bitwise = or && isInteger(layer);
      for (let k = 0; k < comps; k++) OUT[k] = bitwise ? 0 : or || maximum ? -Infinity : 0;
      for (let s = 0; s < n; s++) {
        layer.read(sources[s] as number, A);
        for (let k = 0; k < comps; k++) {
          const value = A[k] as number;
          if (bitwise) OUT[k] = (OUT[k] as number) | value;
          else if (or || maximum) OUT[k] = Math.max(OUT[k] as number, value);
          else OUT[k] = (OUT[k] as number) + value / n;
        }
      }
      if (def.interp === 'unit') {
        let length = 0;
        for (let k = 0; k < comps; k++) length += (OUT[k] as number) * (OUT[k] as number);
        length = Math.sqrt(length);
        if (length > 0 && Number.isFinite(length)) for (let k = 0; k < comps; k++) OUT[k] = (OUT[k] as number) / length;
        else layer.read(first, OUT);
      }
      write(layer, dst, OUT);
      continue;
    }
    copyValue(layer, first, dst);
  }
  if (pair !== null) {
    const acc = new Map<number, number>();
    for (let s = 0; s < n; s++) accumulateSkin(pair.joints, pair.weights, sources[s] as number, 1 / n, acc);
    writeSkin(pair.joints, pair.weights, acc, first, dst);
  }
}

// ---------- corners ----------

/** §5.2 duplicating: every corner layer of `dst` copies `src`; 'clear' layers are cleared on `dst`. */
export function copyCornerAttributes(m: EditMesh, src: number, dst: number): void {
  for (const layer of layersOn(m, 'corner')) {
    if (layer.def.interp === 'clear') writeDefault(layer, dst);
    else copyValue(layer, src, dst);
  }
}

/** §5.2 splitting an edge inside one face side: corner layers of `dst` between corners ca (t = 0) and cb (t = 1). */
export function interpolateCornerAttributes(m: EditMesh, ca: number, cb: number, t: number, dst: number): void {
  for (const layer of layersOn(m, 'corner')) interpValue(layer, ca, cb, t, dst);
}

/** §5.2 new face from a fill: corner layers of `dst` = the average of `corners` (linear rules; others: the first). */
export function averageCornerAttributes(m: EditMesh, corners: ArrayLike<number>, dst: number): void {
  if (corners.length === 0) return;
  const n = corners.length;
  for (const layer of layersOn(m, 'corner')) {
    const def = layer.def;
    if (def.interp === 'clear') {
      writeDefault(layer, dst);
      continue;
    }
    if (def.interp !== 'linear' && def.interp !== 'unit') {
      copyValue(layer, corners[0] as number, dst);
      continue;
    }
    OUT.fill(0);
    for (let s = 0; s < n; s++) {
      layer.read(corners[s] as number, A);
      for (let k = 0; k < def.comps; k++) OUT[k] = (OUT[k] as number) + (A[k] as number) / n;
    }
    write(layer, dst, OUT);
  }
}

/** Clears the 'clear'-rule corner layers ('normal.custom') on touched corners (§5.2 "cleared on touched corners"). */
export function clearCornerAttributes(m: EditMesh, corners: ArrayLike<number>): void {
  for (const layer of layersOn(m, 'corner')) {
    if (layer.def.interp !== 'clear' && layer.def.name !== NORMAL_CUSTOM) continue;
    for (let i = 0; i < corners.length; i++) writeDefault(layer, corners[i] as number);
  }
}

// ---------- faces, edges ----------

/** A new face takes its source's face layers and material slot (flags are the op's: they describe one face). */
export function copyFaceAttributes(m: EditMesh, src: number, dst: number): void {
  for (const layer of layersOn(m, 'face')) copyValue(layer, src, dst);
  if (src !== dst) m.setFaceMaterial(dst, m.faceMaterial(src));
}

/** A new edge takes its source's edge layers (flags follow §5.3, `hard.ts`). */
export function copyEdgeAttributes(m: EditMesh, src: number, dst: number): void {
  for (const layer of layersOn(m, 'edge')) copyValue(layer, src, dst);
}

/** Writes every layer of `domain` at `index` to its default value (a new element with no source). */
export function defaultAttributes(m: EditMesh, domain: Domain, index: number): void {
  for (const layer of layersOn(m, domain)) writeDefault(layer, index);
}

// ---------- mirroring ----------

const SIDE_TOKENS: readonly (readonly [RegExp, string, string])[] = [
  [/([._\- ])L$/, 'L', 'R'],
  [/([._\- ])R$/, 'R', 'L'],
  [/([._\- ])l$/, 'l', 'r'],
  [/([._\- ])r$/, 'r', 'l'],
];
const SIDE_WORDS: readonly (readonly [string, string])[] = [
  ['left', 'right'],
  ['right', 'left'],
  ['Left', 'Right'],
  ['Right', 'Left'],
  ['LEFT', 'RIGHT'],
  ['RIGHT', 'LEFT'],
];

/**
 * The mirror partner of a side-specific name (§5.2 mirroring: `.L`/`.R`, `_L`/`_R` suffixes and VRM-style
 * `left*`/`right*` words, e.g. `morph:Blink_L` ↔ `morph:Blink_R`, `leftUpperArm` ↔ `rightUpperArm`), or null when the
 * name names no side.
 */
export function mirrorName(name: string): string | null {
  for (const [pattern, from, to] of SIDE_TOKENS) {
    if (pattern.test(name)) return `${name.slice(0, name.length - from.length)}${to}`;
  }
  for (const [from, to] of SIDE_WORDS) {
    const at = name.indexOf(from);
    if (at !== -1) return `${name.slice(0, at)}${to}${name.slice(at + from.length)}`;
  }
  return null;
}

/** For each joint of a palette, the index of its mirror partner by name (itself when it has none). */
export function jointMirrorMap(names: readonly string[]): Int32Array {
  const index = new Map<string, number>();
  names.forEach((name, i) => {
    if (!index.has(name)) index.set(name, i);
  });
  const out = new Int32Array(names.length);
  names.forEach((name, i) => {
    const partner = mirrorName(name);
    out[i] = partner === null ? i : (index.get(partner) ?? i);
  });
  return out;
}

/** Joint names of a skin layer's palette (`meta.joints[].id`), or null. */
function paletteNames(layer: AttrLayer): readonly string[] | null {
  const joints = (layer.def.meta as { readonly joints?: unknown } | undefined)?.joints;
  if (!Array.isArray(joints)) return null;
  return joints.map((joint) => {
    const id = (joint as { readonly id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : '';
  });
}

function axisIndex(axis: 'x' | 'y' | 'z' | 0 | 1 | 2): number {
  if (axis === 'x' || axis === 0) return 0;
  if (axis === 'y' || axis === 1) return 1;
  if (axis === 'z' || axis === 2) return 2;
  throw kernelError('invalid-argument', `mirror axis must be x, y or z, not ${String(axis)}`);
}

/** The layer a mirrored value goes to: the side partner by name when it exists ('swap-side', morph `_L`/`_R`). */
function partnerLayer(m: EditMesh, layer: AttrLayer): AttrLayer {
  if (layer.def.mirror !== 'swap-side' && !layer.def.name.startsWith('morph:')) return layer;
  const partner = mirrorName(layer.def.name);
  if (partner === null) return layer;
  const other = m.layer(partner);
  return other !== undefined && other.def.domain === layer.def.domain && other.def.comps === layer.def.comps
    ? other
    : layer;
}

/**
 * §5.2 mirroring a vertex: point layers of `dst` from `src` reflected across `axis` — 'negate-axis' layers (morph
 * deltas) negate that component and `_L`/`_R` targets swap by name; skin joints go through the palette's mirror pairs
 * (unknown pairs keep the joint); group layers swap by `.L`/`.R` name; others copy.
 */
export function mirrorPointAttributes(m: EditMesh, src: number, dst: number, axis: 'x' | 'y' | 'z'): void {
  const k0 = axisIndex(axis);
  const layers = layersOn(m, 'point');
  // Read every source value first: a swap writes the partner layer, which may be read later for the same src.
  const values = layers.map((layer) => {
    const out = new Float64Array(layer.def.comps);
    layer.read(src, out);
    return out;
  });
  layers.forEach((layer, i) => {
    const value = values[i] as Float64Array;
    const def = layer.def;
    if (def.name === SKIN_JOINTS) {
      const names = paletteNames(layer);
      if (names !== null) {
        const map = jointMirrorMap(names);
        for (let k = 0; k < def.comps; k++) {
          const joint = value[k] as number;
          value[k] = joint >= 0 && joint < map.length ? (map[joint] as number) : joint;
        }
      }
      write(layer, dst, value);
      return;
    }
    if (def.mirror === 'negate-axis' && def.comps >= 3) value[k0] = -(value[k0] as number);
    const target = partnerLayer(m, layer);
    for (let k = 0; k < def.comps; k++)
      target.set(dst, k, isInteger(target) ? Math.round(value[k] as number) : (value[k] as number));
  });
}

/**
 * §5.2 mirroring a corner: corner layers of `dst` from `src` — uv layers flip U (u ↦ 1 − u) when `flipUVs`,
 * 'negate-axis' layers ('normal.custom') negate the axis component, others copy.
 */
export function mirrorCornerAttributes(
  m: EditMesh,
  src: number,
  dst: number,
  axis: 'x' | 'y' | 'z',
  opts: { readonly flipUVs?: boolean } = {},
): void {
  const k0 = axisIndex(axis);
  for (const layer of layersOn(m, 'corner')) {
    const def = layer.def;
    layer.read(src, A);
    if (def.mirror === 'flip-u' && opts.flipUVs === true) A[0] = 1 - (A[0] as number);
    if (def.mirror === 'negate-axis' && def.comps >= 3) A[k0] = -(A[k0] as number);
    write(layer, dst, A);
  }
}
