// Small helpers shared by the workflows and the built-in operators: untyped-input guards, frame-rate arithmetic,
// constant stand-in curves and raw-clip statistics.
import type { AnimCurve, Fps, KeyData } from '@ekza-studio/anim-core';
import type { DerivedFrom } from '@ekza-studio/doc';
import type { RawClip } from '@ekza-studio/rig';

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SHA256 = /^[0-9a-f]{64}$/;

/** Why a value is not a `DerivedFrom` provenance entry, or null (ADR 0010 §2). */
export function derivedFromProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'provenance sources are { title, author, license, sourceSha256 }';
  const { title, author, license, sourceSha256 } = value;
  if (typeof title !== 'string' || typeof author !== 'string' || typeof license !== 'string') {
    return 'provenance sources need a title, author and licence';
  }
  if (sourceSha256 !== null && (typeof sourceSha256 !== 'string' || !SHA256.test(sourceSha256))) {
    return 'sourceSha256 is a lowercase SHA-256 or null';
  }
  return null;
}

/** A validated copy of a `DerivedFrom` entry, or null. */
export function parseDerivedFrom(value: unknown): DerivedFrom | null {
  if (derivedFromProblem(value) !== null) return null;
  const { title, author, license, sourceSha256 } = value as DerivedFrom;
  return { title, author, license, sourceSha256 };
}

/** Frames per second as a number. */
export function fpsValue(fps: Fps): number {
  return fps.num / fps.den;
}

export function sameFps(a: Fps, b: Fps): boolean {
  return a.num * b.den === b.num * a.den;
}

/**
 * A curve standing for a channel without keys: one key holding its value at `t`. Callers pass a time that other
 * curves already key, so it adds no sample time of its own (Euler filter, rotate-order conversion).
 */
export function constantCurve(t: number, v: number): AnimCurve {
  const key: KeyData = {
    t,
    v,
    inType: 'flat',
    outType: 'flat',
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  };
  return { keys: [key], weighted: false, pre: 'constant', post: 'constant' };
}

/** The largest key count of any channel of a raw clip (key density for 'auto' reduction). */
export function maxChannelKeys(raw: RawClip): number {
  let max = 0;
  for (const channel of raw.channels) max = Math.max(max, channel.times.length);
  return max;
}
