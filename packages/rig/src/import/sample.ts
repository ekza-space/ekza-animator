// glTF animation sampler evaluation (glTF 2.0 Appendix C, as three.js GLTFLoader plays it): LINEAR lerps
// translations/scales and slerps rotations along the shortest path, STEP holds the previous key, CUBICSPLINE is a
// Hermite spline over [in-tangent, value, out-tangent] triplets (tangents scaled by the key span) with rotations
// normalized afterwards. Times outside the key range clamp to the first or last value.

export type Interpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

export interface SampledTrack {
  readonly times: Float32Array;
  readonly values: Float32Array;
  readonly interpolation: Interpolation;
}

/** Index of the last key with time ≤ t (−1 before the first key). */
function segmentIndex(times: Float32Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (t < (times[0] as number)) return -1;
  if (t >= (times[hi] as number)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Value of key k into out[0..components). */
function keyValue(track: SampledTrack, k: number, components: number, out: number[]): void {
  const cubic = track.interpolation === 'CUBICSPLINE';
  const base = cubic ? (3 * k + 1) * components : k * components;
  for (let c = 0; c < components; c++) out[c] = track.values[base + c] as number;
}

/** Samples a track with `components` values per key (3: translation/scale, 4: rotation) at time `t` (seconds). */
export function sampleTrack(track: SampledTrack, components: number, t: number, out: number[]): void {
  const times = track.times;
  const count = times.length;
  if (count === 0) return;
  const k = segmentIndex(times, t);
  if (k < 0) {
    keyValue(track, 0, components, out);
    return;
  }
  if (k >= count - 1 || track.interpolation === 'STEP') {
    keyValue(track, Math.min(k, count - 1), components, out);
    return;
  }
  const t0 = times[k] as number;
  const t1 = times[k + 1] as number;
  const span = t1 - t0;
  const s = span > 0 ? (t - t0) / span : 0;
  const v = track.values;
  if (track.interpolation === 'LINEAR') {
    const a = k * components;
    const b = (k + 1) * components;
    if (components === 4) {
      slerp(v, a, b, s, out);
      return;
    }
    for (let c = 0; c < components; c++)
      out[c] = (v[a + c] as number) + ((v[b + c] as number) - (v[a + c] as number)) * s;
    return;
  }
  // CUBICSPLINE: key k = [a_k (in), v_k, b_k (out)], each `components` long.
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const v0 = (3 * k + 1) * components;
  const b0 = (3 * k + 2) * components;
  const a1 = 3 * (k + 1) * components;
  const v1 = (3 * (k + 1) + 1) * components;
  for (let c = 0; c < components; c++) {
    out[c] =
      h00 * (v[v0 + c] as number) +
      h10 * span * (v[b0 + c] as number) +
      h01 * (v[v1 + c] as number) +
      h11 * span * (v[a1 + c] as number);
  }
  if (components === 4) {
    const len = Math.hypot(out[0] as number, out[1] as number, out[2] as number, out[3] as number);
    if (len > 0) for (let c = 0; c < 4; c++) out[c] = (out[c] as number) / len;
  }
}

/** Shortest-path slerp between the quaternions at v[a..a+3] and v[b..b+3] (three.js `Quaternion.slerpFlat`). */
function slerp(v: Float32Array, a: number, b: number, s: number, out: number[]): void {
  const x0 = v[a] as number;
  const y0 = v[a + 1] as number;
  const z0 = v[a + 2] as number;
  const w0 = v[a + 3] as number;
  let x1 = v[b] as number;
  let y1 = v[b + 1] as number;
  let z1 = v[b + 2] as number;
  let w1 = v[b + 3] as number;
  let cos = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
  if (cos < 0) {
    x1 = -x1;
    y1 = -y1;
    z1 = -z1;
    w1 = -w1;
    cos = -cos;
  }
  let k0 = 1 - s;
  let k1 = s;
  const sinSq = 1 - cos * cos;
  if (sinSq > Number.EPSILON) {
    const sin = Math.sqrt(sinSq);
    const angle = Math.atan2(sin, cos);
    k0 = Math.sin((1 - s) * angle) / sin;
    k1 = Math.sin(s * angle) / sin;
  }
  const x = k0 * x0 + k1 * x1;
  const y = k0 * y0 + k1 * y1;
  const z = k0 * z0 + k1 * z1;
  const w = k0 * w0 + k1 * w1;
  const len = Math.hypot(x, y, z, w);
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  out[3] = w / len;
}

/** Number of keys of a track (CUBICSPLINE stores three entries per key). */
export function trackKeyCount(track: SampledTrack, components: number): number {
  const perKey = track.interpolation === 'CUBICSPLINE' ? 3 * components : components;
  return Math.min(track.times.length, Math.floor(track.values.length / perKey));
}
