// WP-1 stubs: final signatures (MVP-SPEC §7 WP-1); bodies throw until the AnimX port lands.
import { EkzaError } from '../errors';
import type {
  AnimCurve,
  CompiledAnimCurve,
  CurveEngine,
  Fps,
  Frame,
  Handle,
  KeyData,
  SegmentKind,
  TangentFields,
  TangentType,
} from '../types';

export function compileAnimCurve(_curve: AnimCurve, _opts?: { readonly cycleAwareAuto?: boolean }): CompiledAnimCurve {
  throw new EkzaError('not-implemented', 'anim-core.compileAnimCurve');
}

export function evaluateAnimCurve(_c: CompiledAnimCurve, _frame: Frame): number {
  throw new EkzaError('not-implemented', 'anim-core.evaluateAnimCurve');
}

/** Value per frame. */
export function evaluateAnimCurveSlope(_c: CompiledAnimCurve, _frame: Frame): number {
  throw new EkzaError('not-implemented', 'anim-core.evaluateAnimCurveSlope');
}

export function sampleAnimCurve(
  _c: CompiledAnimCurve,
  _start: Frame,
  _step: number,
  _count: number,
  _out: Float64Array,
): void {
  throw new EkzaError('not-implemented', 'anim-core.sampleAnimCurve');
}

/** Bézier control points of segment i in (frame, value): [t0, v0, t1, v1, t2, v2, t3, v3]. */
export function segmentControlPoints(_c: CompiledAnimCurve, _i: number, _out: Float64Array): void {
  throw new EkzaError('not-implemented', 'anim-core.segmentControlPoints');
}

/** null outside the key range. */
export function spanKindAt(_c: CompiledAnimCurve, _frame: Frame): SegmentKind | null {
  throw new EkzaError('not-implemented', 'anim-core.spanKindAt');
}

/** Maps a frame outside the key range to the in-range frame and value offset per the infinity mode. */
export function infinityMap(
  _c: CompiledAnimCurve,
  _frame: Frame,
): { readonly frame: Frame; readonly valueOffset: number; readonly mirrored: boolean } {
  throw new EkzaError('not-implemented', 'anim-core.infinityMap');
}

/** −1 if none. */
export function keyIndexAt(_c: CompiledAnimCurve, _frame: Frame, _epsilon?: number): number {
  throw new EkzaError('not-implemented', 'anim-core.keyIndexAt');
}

export function visibleKeyRange(_c: CompiledAnimCurve, _f0: Frame, _f1: Frame): readonly [lo: number, hi: number] {
  throw new EkzaError('not-implemented', 'anim-core.visibleKeyRange');
}

export function resolveKeyHandles(
  _curve: AnimCurve,
  _index: number,
): { readonly inHandle: Handle; readonly outHandle: Handle } {
  throw new EkzaError('not-implemented', 'anim-core.resolveKeyHandles');
}

/** §4.11.4 insert rule; `frozen` = indices (in the result) of keys whose computed sides became 'fixed'. */
export function insertKeyPreservingShape(
  _curve: AnimCurve,
  _frame: Frame,
): { readonly keys: KeyData[]; readonly index: number; readonly frozen: readonly number[] } {
  throw new EkzaError('not-implemented', 'anim-core.insertKeyPreservingShape');
}

export function tangentFields(_h: Handle, _side: 'in' | 'out', _fps: Fps, _displayScale: number): TangentFields {
  throw new EkzaError('not-implemented', 'anim-core.tangentFields');
}

export function handleFromFields(
  _fields: Partial<TangentFields>,
  _current: Handle,
  _side: 'in' | 'out',
  _fps: Fps,
  _displayScale: number,
): Handle {
  throw new EkzaError('not-implemented', 'anim-core.handleFromFields');
}

export function makeKeyData(
  _t: Frame,
  _v: number,
  _tangents?: { readonly in: TangentType; readonly out: TangentType },
): KeyData {
  throw new EkzaError('not-implemented', 'anim-core.makeKeyData');
}

export const curveEngine: CurveEngine = {
  compile: (curve) => compileAnimCurve(curve),
  evaluate: (curve, frame) => evaluateAnimCurve(curve, frame),
};
