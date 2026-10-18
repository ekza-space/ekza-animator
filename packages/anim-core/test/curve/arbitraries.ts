import fc from 'fast-check';
import type { AnimCurve, InfinityMode, KeyData, TangentType } from '../../src';

export const TANGENT_TYPES: readonly TangentType[] = [
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
];
export const COMPUTED_TYPES: readonly TangentType[] = [
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'plateau',
  'linear',
  'flat',
];
export const INFINITY_MODES: readonly InfinityMode[] = ['constant', 'linear', 'cycle', 'cycleOffset', 'oscillate'];

const finite = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

export interface CurveArbitraryOptions {
  readonly minKeys?: number;
  readonly maxKeys?: number;
  readonly types?: readonly TangentType[];
  readonly weighted?: boolean;
  readonly modes?: readonly InfinityMode[];
  /** Repeat the previous value with this probability (equal neighbours). */
  readonly equalValues?: boolean;
}

/**
 * Random valid curves: strictly increasing times (gaps 0.25…10 frames), values in ±10 (sometimes equal to the
 * previous key), any tangent types, fixed handles with valid signs and |dt| within (0.02, 1]× the span on that side.
 */
export function curveArbitrary(opts: CurveArbitraryOptions = {}): fc.Arbitrary<AnimCurve> {
  const types = opts.types ?? TANGENT_TYPES;
  const modes = opts.modes ?? INFINITY_MODES;
  const key = fc.record({
    gap: finite(0.25, 10),
    value: finite(-10, 10),
    repeat: opts.equalValues === false ? fc.constant(false) : fc.boolean(),
    inType: fc.constantFrom(...types),
    outType: fc.constantFrom(...types),
    inLength: finite(0.02, 1),
    outLength: finite(0.02, 1),
    inDv: finite(-8, 8),
    outDv: finite(-8, 8),
    broken: fc.boolean(),
    weightLocked: fc.boolean(),
  });
  return fc
    .record({
      start: finite(-50, 50),
      keys: fc.array(key, { minLength: opts.minKeys ?? 2, maxLength: opts.maxKeys ?? 8 }),
      weighted: opts.weighted === undefined ? fc.boolean() : fc.constant(opts.weighted),
      pre: fc.constantFrom(...modes),
      post: fc.constantFrom(...modes),
    })
    .map(({ start, keys, weighted, pre, post }) => {
      const times: number[] = [];
      let t = start;
      for (const k of keys) {
        times.push(t);
        t += k.gap;
      }
      const out: KeyData[] = [];
      keys.forEach((k, i) => {
        const prevValue = out[i - 1]?.v;
        const spanIn = i > 0 ? (times[i] as number) - (times[i - 1] as number) : k.gap;
        const spanOut = i < keys.length - 1 ? (times[i + 1] as number) - (times[i] as number) : k.gap;
        out.push({
          t: times[i] as number,
          v: k.repeat && prevValue !== undefined && i % 3 === 1 ? prevValue : k.value,
          inType: k.inType,
          outType: k.outType,
          inHandle: { dt: -k.inLength * spanIn, dv: k.inDv },
          outHandle: { dt: k.outLength * spanOut, dv: k.outDv },
          broken: k.broken,
          weightLocked: k.weightLocked,
        });
      });
      return { keys: out, weighted, pre, post };
    });
}

/** Key with the given types and zero handles. */
export function key(t: number, v: number, inType: TangentType = 'auto', outType: TangentType = inType): KeyData {
  return {
    t,
    v,
    inType,
    outType,
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  };
}

export function curve(keys: readonly KeyData[], opts: Partial<Omit<AnimCurve, 'keys'>> = {}): AnimCurve {
  return { keys, weighted: opts.weighted ?? false, pre: opts.pre ?? 'constant', post: opts.post ?? 'constant' };
}

export const DEG = Math.PI / 180;

/** The synthetic wave clip's rz curve: 30° / −30° / 30° at frames 0 / 15 / 30, `auto` tangents. */
export function waveCurve(type: TangentType = 'auto', opts: Partial<Omit<AnimCurve, 'keys'>> = {}): AnimCurve {
  return curve([key(0, 30 * DEG, type), key(15, -30 * DEG, type), key(30, 30 * DEG, type)], opts);
}
