// A naive FK PoseSource over a SkeletonDesc (shared test kit, MVP-SPEC §3 convention 12): bake, writer and surgeon
// tests run without the rig kernel (WP-3). Each node's local transform comes from a callback (rest when it returns
// null); worlds, raw locals, humanoid N_b (§4.11.9) and the hips position are filled like the kernel fills them.
import { mat4Compose, quatInvert, quatMultiply, type ReadonlyXf, type Xf, xfMultiply } from '@ekza-studio/anim-core';
import type { HumanBoneName, RigId } from '@ekza-studio/doc';
import {
  HUMAN_BONE_NAMES,
  HUMAN_BONE_PARENT,
  type PoseBuffers,
  type RigProgram,
  type SkeletonDesc,
} from '@ekza-studio/rig';
import type { PoseSource } from '../types';

export interface FkPoseSourceOptions {
  /** Nodes reported as `drivenNodes` (exported as animated). Default: the humanoid bones, else every joint. */
  readonly drivenNodes?: readonly number[];
  /** Local transform of a node at a clip frame (raw glTF node space); null keeps the rest local. */
  readonly pose?: (node: number, frame: number) => ReadonlyXf | null;
}

export function createFkPoseSource(skeleton: SkeletonDesc, opts: FkPoseSourceOptions = {}): PoseSource {
  const n = skeleton.nodes.length;
  const humanoid = skeleton.humanoid;
  const drivenNodes =
    opts.drivenNodes ??
    (humanoid !== null
      ? [...new Set(Object.values(humanoid))].sort((a, b) => a - b)
      : skeleton.nodes.filter((node) => node.isJoint).map((node) => node.index));
  const root: ReadonlyXf = { t: [0, 0, 0], q: skeleton.facing, s: [1, 1, 1] };
  const restWorlds: Xf[] = [];
  for (const node of skeleton.nodes) {
    restWorlds.push(xfMultiply(node.parent === -1 ? root : (restWorlds[node.parent] as Xf), node.restLocal));
  }
  const humanParent = new Map<HumanBoneName, HumanBoneName | null>();
  if (humanoid !== null) {
    for (const bone of HUMAN_BONE_NAMES) {
      if (humanoid[bone] === undefined) continue;
      let parent = HUMAN_BONE_PARENT[bone];
      while (parent !== null && humanoid[parent] === undefined) parent = HUMAN_BONE_PARENT[parent];
      humanParent.set(bone, parent);
    }
  }

  const evaluateAt = (frame: number, out: PoseBuffers): void => {
    const worlds: Xf[] = [];
    skeleton.nodes.forEach((node, i) => {
      const local = opts.pose?.(i, frame) ?? node.restLocal;
      out.boneLocal.set([...local.t, ...local.q, ...local.s], i * 10);
      const world = xfMultiply(node.parent === -1 ? root : (worlds[node.parent] as Xf), local);
      worlds.push(world);
      out.boneWorld.set(mat4Compose(world), i * 16);
    });
    out.humanLocal.fill(0);
    for (let k = 0; k < HUMAN_BONE_NAMES.length; k++) out.humanLocal[k * 4 + 3] = 1;
    out.hipsPosition.fill(0);
    if (humanoid !== null) {
      const delta = (bone: HumanBoneName): [number, number, number, number] => {
        const node = humanoid[bone] as number;
        return quatMultiply((worlds[node] as Xf).q, quatInvert((restWorlds[node] as Xf).q));
      };
      HUMAN_BONE_NAMES.forEach((bone, k) => {
        if (humanoid[bone] === undefined) return;
        const parent = humanParent.get(bone) ?? null;
        const d = delta(bone);
        const nb = parent === null ? d : quatMultiply(quatInvert(delta(parent)), d);
        out.humanLocal.set(nb, k * 4);
      });
      const hips = humanoid.hips;
      if (hips !== undefined) out.hipsPosition.set((worlds[hips] as Xf).t);
    }
    out.version++;
  };

  const program: RigProgram = {
    rigId: 'rig_FakeFkPoseSrc0' as RigId,
    skeleton,
    controlIds: [],
    controlIndex: new Map(),
    controls: [],
    nodeCount: n,
    drivenNodes,
    warnings: [],
    attrSlots: [],
    attrIndex: new Map(),
    limbs: [],
    allocChannels: () => ({ values: new Float64Array(0), attrs: new Float64Array(0) }),
    allocPose: () => ({
      boneLocal: new Float64Array(n * 10),
      boneWorld: new Float64Array(n * 16),
      controlWorld: new Float64Array(0),
      humanLocal: new Float64Array(HUMAN_BONE_NAMES.length * 4),
      hipsPosition: new Float64Array(3),
      version: 0,
    }),
    resetChannels: () => {},
    evaluate: (_channels, out) => evaluateAt(0, out),
  };
  return { program, evaluate: evaluateAt };
}
