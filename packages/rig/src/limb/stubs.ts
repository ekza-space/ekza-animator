// M2A-SPEC §8 A1 public API: contract stubs landed by A0 (§3 rule 1). Each throws EkzaError('not-implemented') until
// A1 replaces it; nothing in M1 code paths calls them. `registerBuiltinRigOps`, `readAttr` and `writeAttr` are A0's
// working baselines and live in `kernel/ops.ts` and `sampler/channels.ts`.
import { EkzaError, type Frame, type Mat4, type SplineSet } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, ControlRecord, SolverRecord } from '@ekza-animator/doc';
import type {
  ChannelBuffer,
  ClipSampler,
  FootRollParams,
  LimbDesc,
  LimbId,
  PoseBuffers,
  RigDefinition,
  RigProgram,
  SkeletonDesc,
  TrackKey,
} from '../types';

function notImplemented(symbol: string): EkzaError {
  return new EkzaError('not-implemented', `rig.${symbol}`);
}

/** §5.2: the IK controls and `ik2` solver records of the requested limbs (A1). */
export function limbIkRecords(
  _def: RigDefinition,
  _skeleton: SkeletonDesc,
  _opts: { readonly limbs: readonly LimbId[]; readonly ikFkDefault: 'by-limb' | 0 },
): {
  readonly controls: readonly ControlRecord[];
  readonly solvers: readonly SolverRecord[];
  readonly warnings: readonly string[];
} {
  throw notImplemented('limbIkRecords');
}

/** §5.2.3: checks a rig.setFootParams patch; returns the merged params or the reason it is refused (A1). */
export function validateFootParams(
  _current: FootRollParams,
  _patch: Partial<FootRollParams>,
): FootRollParams | { readonly error: string } {
  throw notImplemented('validateFootParams');
}

/** The IK control's `custom` footprint shape for the given params (rewritten by rig.setFootParams) (A1). */
export function footprintShape(_params: FootRollParams): SplineSet {
  throw notImplemented('footprintShape');
}

/** The limb a control belongs to (A1). */
export function limbOfControl(_program: RigProgram, _control: ControlId): LimbDesc | null {
  throw notImplemented('limbOfControl');
}

/** Copies `ch`, sets the limb's ikFk to `ikFk`, evaluates into `out` (side buffers for matching) (A1). */
export function evaluateWithLimbMode(
  _program: RigProgram,
  _ch: ChannelBuffer,
  _limb: LimbId,
  _ikFk: number,
  _scratch: ChannelBuffer,
  _out: PoseBuffers,
): void {
  throw notImplemented('evaluateWithLimbMode');
}

/** §5.6 match FK to IK (A1). */
export function matchFkToIk(
  _program: RigProgram,
  _ikPose: PoseBuffers,
  _limb: LimbId,
  _reference: ReadonlyMap<ControlId, ChannelValues>,
): Map<ControlId, ChannelValues> {
  throw notImplemented('matchFkToIk');
}

/** §5.6 match pole rule; endErrorM / midErrorM: end and mid joint position errors of the IK result vs `fkPose` (A1). */
export function matchIkToFk(
  _program: RigProgram,
  _fkPose: PoseBuffers,
  _ch: ChannelBuffer,
  _limb: LimbId,
  _reference: ReadonlyMap<ControlId, ChannelValues>,
): {
  readonly values: Map<ControlId, ChannelValues>;
  readonly endErrorM: number;
  readonly midErrorM: number;
  readonly maxRotationErrorRad: number;
} {
  throw notImplemented('matchIkToFk');
}

/** IK control channels that put the limb's end bone at `endWorld` (Plant Feet on IK legs, §5.8) (A1). */
export function ikControlForEndWorld(
  _program: RigProgram,
  _pose: PoseBuffers,
  _ch: ChannelBuffer,
  _limb: LimbId,
  _endWorld: Mat4,
  _reference: ChannelValues,
): ChannelValues {
  throw notImplemented('ikControlForEndWorld');
}

/** World positions of a leg's foot-roll pivots (§5.3.1) (A1). */
export function footPivotWorlds(
  _program: RigProgram,
  _pose: PoseBuffers,
  _ch: ChannelBuffer,
  _limb: LimbId,
): {
  readonly heel: Float64Array;
  readonly ball: Float64Array;
  readonly toe: Float64Array;
  readonly inner: Float64Array;
  readonly outer: Float64Array;
} | null {
  throw notImplemented('footPivotWorlds');
}

/** Key times of every track's influencing curves (§5.8 definition) inside the range (A1). */
export function computeInfluenceKeyTimes(
  _program: RigProgram,
  _sampler: ClipSampler,
  _range: { readonly start: Frame; readonly end: Frame },
  _target: 'raw' | 'humanoid',
): ReadonlyMap<TrackKey, readonly Frame[]> {
  throw notImplemented('computeInfluenceKeyTimes');
}
