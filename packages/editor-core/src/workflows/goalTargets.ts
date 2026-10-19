// Goal targets of `pose.goals` (MCP-SPEC §4.10, P1): which node a bone name means, the FK control that drives it,
// the limb whose IK drives it and a limb's ikFk in a channel buffer. Small and eager (the operator's poll uses them);
// the solve itself (`goals.ts`) loads with the agent operators' implementation.
import type { ControlId } from '@ekza-animator/doc';
import { type ChannelBuffer, controlForNode, type LimbDesc, nodeForControl, type RigProgram } from '@ekza-animator/rig';
import type { CharacterRuntime } from '../types';

/** The humanoid bone a `split` aim distributes over its parent (§4.10 "split distributes a head aim"). */
export const SPLIT_BONE = 'head';
/** A limb counts as IK at a frame from this ikFk on (§5.5 rule 2: the viewport's and Attributes' threshold). */
export const IK_FROM = 0.999;
/** An IK goal within this distance counts as reached (MCP-SPEC §8 P1: "IK targets within 1 mm in reach"). */
export const REACHED_M = 1e-3;
/** Node index of a bone: a VRM humanoid name (own entries only), else an exact node name; −1 when absent. */
export function boneNode(runtime: CharacterRuntime, bone: string): number {
  const humanoid = runtime.skeleton.humanoid ?? {};
  if (Object.hasOwn(humanoid, bone)) {
    const index = (humanoid as Readonly<Record<string, number | undefined>>)[bone];
    if (index !== undefined) return index;
  }
  return runtime.skeleton.nodes.find((node) => node.name === bone)?.index ?? -1;
}

/** The control that drives exactly this node (its FK control), or null. */
export function drivingControl(program: RigProgram, node: number): ControlId | null {
  const control = controlForNode(program, node);
  return control !== null && nodeForControl(program, control) === node ? control : null;
}

/** The limb's ikFk in a channel buffer (0 when the IK control lacks the attribute). */
export function ikFkIn(limb: LimbDesc, ch: ChannelBuffer): number {
  const slot = limb.attrSlots.ikFk;
  return slot >= 0 ? (ch.attrs[slot] as number) : 0;
}

/** The limb whose IK chain (upper, mid, end) contains the node, or null. */
export function limbOfNode(program: RigProgram, node: number): LimbDesc | null {
  for (const limb of program.limbs) {
    const { upper, mid, end } = limb.nodes;
    if (node === upper || node === mid || node === end) return limb;
  }
  return null;
}
