// WP-3 stubs: final signatures (MVP-SPEC §7 WP-3); bodies throw until inverse solving lands.
import { EkzaError, type Mat4 } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import type { PoseBuffers, RigProgram } from '../types';

/** Channels (keyable t/r only) that place `control` at `desiredWorld` given the parents in `pose`; rotations via eulerNear(reference). */
export function solveControlChannels(
  _program: RigProgram,
  _pose: PoseBuffers,
  _control: ControlId,
  _desiredWorld: Mat4,
  _reference: ChannelValues,
): ChannelValues {
  throw new EkzaError('not-implemented', 'rig.solveControlChannels');
}

/** Top-down solve for desired bone worlds (node index → canonical world); re-evaluates parents between controls. */
export function solveBoneChannels(
  _program: RigProgram,
  _pose: PoseBuffers,
  _boneWorlds: ReadonlyMap<number, Mat4>,
  _reference: ReadonlyMap<ControlId, ChannelValues>,
): Map<ControlId, ChannelValues> {
  throw new EkzaError('not-implemented', 'rig.solveBoneChannels');
}

/** Nearest driving control up the hierarchy. */
export function controlForNode(_program: RigProgram, _node: number): ControlId | null {
  throw new EkzaError('not-implemented', 'rig.controlForNode');
}

/** −1 if it drives none. */
export function nodeForControl(_program: RigProgram, _control: ControlId): number {
  throw new EkzaError('not-implemented', 'rig.nodeForControl');
}

export function isHumanoidProgram(_program: RigProgram): boolean {
  throw new EkzaError('not-implemented', 'rig.isHumanoidProgram');
}
