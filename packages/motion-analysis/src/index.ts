// @ekza-animator/motion-analysis (MCP-SPEC §4.7): pure motion metrics over a pre-sampled clip. Positions are character
// space, metres; rotations are unit quaternions [x, y, z, w]; frames are clip frames. D0 lands the types and stubs
// (`EkzaError('not-implemented', 'motion-analysis.<symbol>')`); P4 implements them with the definitions of §5.16.
// The metric functions are synchronous: the tools pre-compute the samples in chunks that yield and check the call's
// signal (agent-tools/src/see/sampler.ts), so neither the tab nor the server's event loop blocks for long.
import { EkzaError } from '@ekza-animator/anim-core';

export interface MotionSampler {
  readonly fps: number;
  readonly rangeFrames: readonly [number, number];
  readonly loop: boolean;
  readonly heightM: number; // rest height of the character (bounds of joints)
  readonly floorY: number; // lowest foot point at rest
  bones(): readonly string[]; // VRM humanoid names where known, else node names
  /** World (character-space) position and rotation of a bone at a clip frame, written into `outPos` (3) and `outRot` (4). */
  sample(bone: string, frame: number, outPos: Float64Array, outRot: Float64Array): void;
  /** Stored value of a control channel at a clip frame (radians, metres or factor). */
  channel(control: string, channel: string, frame: number): number;
  channels(): readonly { readonly control: string; readonly channel: string; readonly cycleOffset: boolean }[];
}
export interface ContactOptions {
  readonly feet: readonly ('L' | 'R')[];
  readonly hands: boolean;
  readonly heightM?: number;
  readonly speedMps?: number;
  readonly rangeFrames?: readonly [number, number];
}
export interface ContactReport {
  readonly thresholds: { readonly heightM: number; readonly speedMps: number; readonly scaledForHeightM: number };
  readonly limbs: Readonly<
    Record<
      string,
      {
        readonly contacts: readonly (readonly [number, number])[];
        readonly slideCm: readonly number[];
        readonly maxSlideMps: number;
        readonly penetrationCm: number;
      }
    >
  >;
  readonly skatingRatio: number;
  readonly verdict: string;
}
export interface SeamReport {
  readonly verdict: 'seamless' | 'pops' | 'hitches' | 'not_a_loop';
  readonly worstChannels: readonly {
    readonly control: string;
    readonly channel: string;
    readonly c0: number;
    readonly c1PerFrame: number;
    readonly unit: 'deg' | 'm' | 'factor';
  }[];
  readonly worstBones: readonly {
    readonly bone: string;
    readonly positionMm: number;
    readonly rotationDeg: number;
    readonly velocityMmPerFrame: number;
  }[];
}
export interface OscillationReport {
  readonly cycles: number;
  readonly periodFrames: number | null;
  readonly amplitude: number;
  readonly axis: readonly [number, number, number] | null;
}
export interface PopsReport {
  readonly pops: readonly { readonly bone: string; readonly frame: number; readonly degPerFrame: number }[];
  readonly eulerFlips: readonly {
    readonly control: string;
    readonly channel: string;
    readonly frame: number;
    readonly jumpDeg: number;
  }[];
}
export interface SpacingReport {
  readonly segments: readonly {
    readonly fromFrame: number;
    readonly toFrame: number;
    readonly kind: 'ease_in' | 'ease_out' | 'even' | 'hold';
  }[];
  readonly perFrameMm?: readonly number[];
}
export interface ArcsReport {
  readonly pathLengthM: number;
  readonly spikes: readonly { readonly frame: number; readonly turnDeg: number }[]; // direction-change spikes (§5.16)
  readonly smoothness: number; // 1 − spikes per moving frame, 0…1
}
export type HoldSpan = { readonly fromFrame: number; readonly toFrame: number; readonly kind: 'dead' | 'moving' };
export type SpeedReport = { readonly maxMps: number; readonly meanMps: number; readonly atFrame: number };

/** Per call: frames × sampled bones; the tools refuse larger requests with `limit` (§5.5). */
export const ANALYSIS_LIMITS: { readonly maxFrames: 20_000; readonly maxBoneFrameSamples: 2_000_000 } = {
  maxFrames: 20_000,
  maxBoneFrameSamples: 2_000_000,
};

function notImplemented(symbol: string): never {
  throw new EkzaError('not-implemented', `motion-analysis.${symbol}`);
}

export function detectContacts(_s: MotionSampler, _opts: ContactOptions): ContactReport {
  return notImplemented('detectContacts');
}
export function seamReport(_s: MotionSampler, _opts?: { readonly worst?: number }): SeamReport {
  return notImplemented('seamReport');
}
export function oscillation(
  _s: MotionSampler,
  _target:
    | { readonly bone: string; readonly relativeTo?: string }
    | { readonly control: string; readonly channel: string },
  _opts?: { readonly rangeFrames?: readonly [number, number] },
): OscillationReport {
  return notImplemented('oscillation');
}
export function pops(
  _s: MotionSampler,
  _bones: readonly string[],
  _opts?: { readonly rangeFrames?: readonly [number, number] },
): PopsReport {
  return notImplemented('pops');
}
export function spacing(
  _s: MotionSampler,
  _bone: string,
  _opts?: {
    readonly keys?: readonly number[];
    readonly perFrame?: boolean;
    readonly rangeFrames?: readonly [number, number];
  },
): SpacingReport {
  return notImplemented('spacing');
}
export function holds(
  _s: MotionSampler,
  _bones: readonly string[],
  _opts?: { readonly rangeFrames?: readonly [number, number] },
): readonly HoldSpan[] {
  return notImplemented('holds');
}
export function speed(
  _s: MotionSampler,
  _bone: string,
  _opts?: { readonly rangeFrames?: readonly [number, number] },
): SpeedReport {
  return notImplemented('speed');
}
export function arcs(
  _s: MotionSampler,
  _bone: string,
  _opts?: { readonly rangeFrames?: readonly [number, number]; readonly relativeTo?: string },
): ArcsReport {
  return notImplemented('arcs');
}
