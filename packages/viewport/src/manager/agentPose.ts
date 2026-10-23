// M-AI (MCP-SPEC §4.3): the agent host's temporary pose, a lazy chunk (`ViewportManager.agentHost()` loads it), so the
// editor's first visit does not carry it (§0.4, `check:size`).
import { EkzaError, mat4Compose, mat4Decompose, mat4Invert, mat4Multiply } from '@ekza-studio/anim-core';
import type { CharacterRuntime } from '@ekza-studio/editor-core';
import type { LoadedModel } from '@ekza-studio/io/three';
import type { Scene } from 'three';

/**
 * Poses a character's model from bone worlds in canonical character space for `draw`, then puts the current pose
 * back. Node locals: `W_parent⁻¹·W` (the facing cancels), roots `F⁻¹·W` with F the skeleton's facing
 * (model → canonical).
 */
export function withAgentPose<T>(
  scene: Scene,
  model: LoadedModel | null,
  runtime: CharacterRuntime | undefined,
  boneWorld: Float64Array,
  draw: () => T,
): T {
  if (model === null || runtime === undefined) return draw();
  const nodes = runtime.skeleton.nodes;
  if (boneWorld.length < nodes.length * 16) {
    throw new EkzaError('invalid-record', `withPose: ${nodes.length} bone worlds expected`);
  }
  const objects = model.nodeObjects;
  const saved = objects.map((object) =>
    object === null || object === undefined
      ? null
      : { p: object.position.clone(), q: object.quaternion.clone(), s: object.scale.clone() },
  );
  const facing = mat4Compose({ t: [0, 0, 0], q: runtime.skeleton.facing, s: [1, 1, 1] });
  const facingInverse = mat4Invert(facing) ?? facing;
  const world = new Float64Array(16);
  const parentInverse = new Float64Array(16);
  const local = new Float64Array(16);
  for (let i = 0; i < nodes.length; i++) {
    const object = objects[i];
    if (object === null || object === undefined) continue;
    world.set(boneWorld.subarray(i * 16, i * 16 + 16));
    const parent = (nodes[i] as { readonly parent: number }).parent;
    if (parent < 0) mat4Multiply(facingInverse, world, local);
    else {
      parentInverse.set(boneWorld.subarray(parent * 16, parent * 16 + 16));
      mat4Multiply(mat4Invert(parentInverse, parentInverse) ?? facingInverse, world, local);
    }
    const xf = mat4Decompose(local);
    object.position.set(xf.t[0], xf.t[1], xf.t[2]);
    object.quaternion.set(xf.q[0], xf.q[1], xf.q[2], xf.q[3]);
    object.scale.set(xf.s[0], xf.s[1], xf.s[2]);
  }
  scene.updateMatrixWorld();
  try {
    return draw();
  } finally {
    objects.forEach((object, i) => {
      const before = saved[i];
      if (object === null || object === undefined || before === null || before === undefined) return;
      object.position.copy(before.p);
      object.quaternion.copy(before.q);
      object.scale.copy(before.s);
    });
    scene.updateMatrixWorld();
  }
}
