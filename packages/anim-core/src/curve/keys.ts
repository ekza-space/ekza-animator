import { EkzaError } from '../errors';
import type { Frame, Handle, InfinityMode, KeyData, TangentType } from '../types';

/** Two key times closer than this are the same frame (MVP-SPEC §4.11.1, §4.11.3). */
export const KEY_TIME_EPSILON = 1e-6;
/** Smallest |dt| of a non-weighted fixed handle: below it the direction is taken as (±1e-6, dv). */
export const MIN_HANDLE_DT = 1e-6;
/** AnimX's 1/3 (handles are a third of the span; computed as `span * ONE_THIRD` like AnimX). */
export const ONE_THIRD = 1.0 / 3.0;

const TANGENT_TYPES: ReadonlySet<string> = new Set<TangentType>([
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'plateau',
  'linear',
  'flat',
  'step',
  'stepNext',
  'fixed',
]);
const INFINITY_MODES: ReadonlySet<string> = new Set<InfinityMode>([
  'constant',
  'linear',
  'cycle',
  'cycleOffset',
  'oscillate',
]);

/** Unknown tangent types in document content (newer files) evaluate as the default type `auto`. */
export function tangentTypeOf(type: string): TangentType {
  return TANGENT_TYPES.has(type) ? (type as TangentType) : 'auto';
}

/** Unknown infinity modes in document content evaluate as `constant`. */
export function infinityModeOf(mode: string): InfinityMode {
  return INFINITY_MODES.has(mode) ? (mode as InfinityMode) : 'constant';
}

export function finiteOr(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Keys sorted by `t` with unique, finite `t` and finite `v`: the input array itself when it already satisfies the
 * `AnimCurve` invariants (the normal case), else a repaired copy (non-finite keys dropped, stable sort, the later
 * of two keys with the same `t` wins). Domain code repairs document content instead of throwing (MVP-SPEC §3.6).
 */
export function normalizeKeys(keys: readonly KeyData[]): readonly KeyData[] {
  let valid = true;
  let previous = Number.NEGATIVE_INFINITY;
  for (const key of keys) {
    if (!Number.isFinite(key.t) || !Number.isFinite(key.v) || key.t <= previous) {
      valid = false;
      break;
    }
    previous = key.t;
  }
  if (valid) return keys;
  const finite = keys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => Number.isFinite(key.t) && Number.isFinite(key.v));
  finite.sort((a, b) => a.key.t - b.key.t || a.index - b.index);
  const out: KeyData[] = [];
  for (const { key } of finite) {
    const last = out[out.length - 1];
    if (last !== undefined && last.t === key.t) out[out.length - 1] = key;
    else out.push(key);
  }
  return out;
}

const ZERO_HANDLE: Handle = Object.freeze({ dt: 0, dv: 0 });

/**
 * A new key with the given tangent types (default `auto`/`auto`), zero handles, unified (`broken: false`) and locked
 * weights, as `key.set` creates them (MVP-SPEC §4.11.1).
 */
export function makeKeyData(
  t: Frame,
  v: number,
  tangents?: { readonly in: TangentType; readonly out: TangentType },
): KeyData {
  if (!Number.isFinite(t) || !Number.isFinite(v)) {
    throw new EkzaError('invalid-record', `Key time and value must be finite (t=${t}, v=${v})`);
  }
  return {
    t,
    v,
    inType: tangents?.in ?? 'auto',
    outType: tangents?.out ?? 'auto',
    inHandle: ZERO_HANDLE,
    outHandle: ZERO_HANDLE,
    broken: false,
    weightLocked: true,
  };
}

/** Index of the first element of the sorted `t[0 … n)` that is ≥ `frame` (n when none). */
export function lowerBound(t: ArrayLike<number>, n: number, frame: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element of the sorted `t[0 … n)` that is > `frame` (n when none). */
export function upperBound(t: ArrayLike<number>, n: number, frame: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! <= frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
