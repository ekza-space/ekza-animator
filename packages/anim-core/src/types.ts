// Contract file: MVP-SPEC §4.1, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
// ---------- math ----------
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];            // x, y, z, w (glTF/three order)
export type ReadonlyVec3 = readonly [number, number, number];
export type ReadonlyQuat = readonly [number, number, number, number];
/** 4×4 matrix, column-major (three.js `Matrix4.elements` layout), length 16, float64. */
export type Mat4 = Float64Array;
/** Translation · Rotation · Scale. Humanoid rigs use uniform scale (s[0] === s[1] === s[2]). */
export interface Xf { t: Vec3; q: Quat; s: Vec3 }
export interface ReadonlyXf { readonly t: ReadonlyVec3; readonly q: ReadonlyQuat; readonly s: ReadonlyVec3 }
/** Returned by every register/subscribe call. */
export type Disposer = () => void;

/**
 * Rotate order in the common DCC semantics: the FIRST letter is applied FIRST.
 * 'xyz' ⇒ R = Rz·Ry·Rx (column vectors) ≡ three.js Euler order 'ZYX'.
 */
export type RotateOrder = 'xyz' | 'yzx' | 'zxy' | 'xzy' | 'yxz' | 'zyx';
export type ThreeEulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
/** Euler angles in radians indexed by axis: [rx, ry, rz], independent of the rotate order. */
export type Euler3 = Vec3;

// ---------- animation curves ----------
/** Time in frames (float64) of the owning clip's frame rate. Integer by default. */
export type Frame = number;
/** Rational frame rate, e.g. {num: 30, den: 1}, {num: 30000, den: 1001}. seconds = frame · den / num. */
export interface Fps { readonly num: number; readonly den: number }

export type TangentType =
  | 'auto' | 'autoEase' | 'autoMix'          // AnimX-exact, clamped (never overshoot); end keys flat
  | 'spline' | 'clamped' | 'plateau'         // documented approximations (research 01 §5.4); plateau is M1-stretch
  | 'linear' | 'flat'
  | 'step' | 'stepNext'                      // interpolation flags, read from the OUT side of a span's start key
  | 'fixed';                                 // user-edited handle, never recomputed
export type InfinityMode = 'constant' | 'linear' | 'cycle' | 'cycleOffset' | 'oscillate';

/** Offset of a tangent control point from its key, in (frames, value units). in: dt <= 0, out: dt >= 0. */
export interface Handle { readonly dt: number; readonly dv: number }

export interface KeyData {
  readonly t: Frame;
  readonly v: number;                         // metres | radians | unitless
  readonly inType: TangentType;
  readonly outType: TangentType;
  /** Used only when inType/outType === 'fixed'. Non-weighted curves use the direction only. */
  readonly inHandle: Handle;
  readonly outHandle: Handle;
  readonly broken: boolean;                   // false = unified (collinear when edited)
  readonly weightLocked: boolean;             // weighted curves: handle drags change angle only
  readonly breakdown?: boolean;               // V1; stored, ignored by MVP UI
}

export interface AnimCurve {
  readonly keys: readonly KeyData[];          // sorted by t, unique t
  readonly weighted: boolean;
  readonly pre: InfinityMode;
  readonly post: InfinityMode;
}

export const Segment = { Hermite: 0, Bezier: 1, Linear: 2, Step: 3, StepNext: 4 } as const;
export type SegmentKind = (typeof Segment)[keyof typeof Segment];

/** Compiled, evaluation-ready form. All arrays have length keyCount unless noted. */
export interface CompiledAnimCurve {
  readonly keyCount: number;
  readonly t: Float64Array;
  readonly v: Float64Array;
  /** Resolved tangent slopes in value units per frame (weighted: slope of the resolved handle). */
  readonly inSlope: Float64Array;
  readonly outSlope: Float64Array;
  /** Resolved handle offsets (frames, value) after tangent computation and, for weighted curves, the
   *  monotonic-X correction. Non-weighted: dt = ±(span to neighbour)/3. Used by painters and editors. */
  readonly inDt: Float64Array;
  readonly inDv: Float64Array;
  readonly outDt: Float64Array;
  readonly outDv: Float64Array;
  /** Length max(keyCount − 1, 0): kind of segment i (key i → key i+1). */
  readonly segment: Uint8Array;
  readonly weighted: boolean;
  readonly pre: InfinityMode;
  readonly post: InfinityMode;
}

/** Injectable engine so packages can test against fakes before WP-1 lands. */
export interface CurveEngine {
  compile(curve: AnimCurve): CompiledAnimCurve;
  evaluate(curve: CompiledAnimCurve, frame: Frame): number;
}

/** Error-bounded key reduction (Graph Editor Simplify, import). */
export interface ReduceOptions {
  /** Max |Δvalue| in curve units (radians or metres), checked at every ORIGINAL key time and at every
   *  integer frame between the first and last key. */
  readonly tolerance: number;
  /** Frames that must keep a key (step discontinuities, contact frames). First and last keys are always kept. */
  readonly keep?: readonly Frame[];
  /**
   * Compile the original and the reduced curve with cycle-aware auto tangents (`CurveOptions.cycleAwareAuto`,
   * M2A-SPEC §4.1, §5.23), so an editor that evaluates cyclic curves that way measures the shape it draws. Default
   * false (the M1 behaviour). It changes nothing for curves whose infinities do not both cycle.
   */
  readonly cycleAwareAuto?: boolean;
}
export interface ReduceResult { readonly keys: KeyData[]; readonly removed: number; readonly maxError: number }

/** Graph Editor numeric tangent fields in the DCC convention (x in seconds, display units). */
export interface TangentFields { readonly angleDeg: number; readonly weight: number }

// ---------- geometry (control shapes now, spline modeling later) ----------
export type SplineKind = 'poly' | 'bezier';                     // 'nurbs' reserved for M6
export interface Spline {
  readonly kind: SplineKind;
  readonly closed: boolean;
  readonly points: readonly ReadonlyVec3[];                     // local space
  readonly handlesIn?: readonly ReadonlyVec3[];                 // bezier only, absolute positions
  readonly handlesOut?: readonly ReadonlyVec3[];
}
export interface SplineSet { readonly v: 1; readonly splines: readonly Spline[] }
/** Open string: built-ins below, extensions register more through `registerControlShape`. */
export type ControlShapeKind = string;
export const BUILTIN_CONTROL_SHAPES = [
  'circle', 'halfCircle', 'square', 'cube', 'sphere', 'diamond', 'arrow4', 'star', 'cross', 'lollipop', 'custom',
] as const;
export type BuiltinControlShape = (typeof BUILTIN_CONTROL_SHAPES)[number];
