// Bounds for F / A (research 09 §4.7): frame selection = the selected keys, or whole curves when no key is selected;
// frame all = every visible curve's keys plus the drawn curve between them (overshooting spline segments included).
import { Segment } from '@ekza-studio/anim-core';
import type { ViewBounds } from '../view/transform';
import { type CurveEntry, drawnOf } from './curveSet';
import { segmentKind, segmentValueAt } from './geometry';

/** Samples per Hermite/Bézier segment when measuring a curve's value range. */
const SAMPLES = 8;

class Accumulator {
  f0 = Number.POSITIVE_INFINITY;
  f1 = Number.NEGATIVE_INFINITY;
  v0 = Number.POSITIVE_INFINITY;
  v1 = Number.NEGATIVE_INFINITY;

  add(frame: number, value: number): void {
    if (!Number.isFinite(frame) || !Number.isFinite(value)) return;
    if (frame < this.f0) this.f0 = frame;
    if (frame > this.f1) this.f1 = frame;
    if (value < this.v0) this.v0 = value;
    if (value > this.v1) this.v1 = value;
  }

  result(): ViewBounds | null {
    return this.f0 <= this.f1 ? { f0: this.f0, f1: this.f1, v0: this.v0, v1: this.v1 } : null;
  }
}

/** Display-value bounds of whole curves (keys and the drawn segments between them). */
export function curvesBounds(entries: readonly CurveEntry[]): ViewBounds | null {
  const acc = new Accumulator();
  const scratch = new Float64Array(8);
  for (const entry of entries) {
    const c = entry.compiled;
    for (let i = 0; i < c.keyCount; i++) {
      acc.add(c.t[i] as number, drawnOf(entry, c.v[i] as number));
      if (i + 1 >= c.keyCount) continue;
      const kind = segmentKind(c, i);
      if (kind !== Segment.Hermite && kind !== Segment.Bezier) continue;
      const t0 = c.t[i] as number;
      const t1 = c.t[i + 1] as number;
      for (let s = 1; s < SAMPLES; s++) {
        const frame = t0 + ((t1 - t0) * s) / SAMPLES;
        acc.add(frame, drawnOf(entry, segmentValueAt(c, i, frame, scratch)));
      }
    }
  }
  return acc.result();
}

/** Display-value bounds of the given keys (entry, index pairs). */
export function keysBounds(keys: readonly { readonly entry: CurveEntry; readonly index: number }[]): ViewBounds | null {
  const acc = new Accumulator();
  for (const { entry, index } of keys) {
    acc.add(entry.compiled.t[index] as number, drawnOf(entry, entry.compiled.v[index] as number));
  }
  return acc.result();
}
