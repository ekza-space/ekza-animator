// ① parts of a multi-mesh model (AUTORIG-SPEC §6.1 "Several meshes"; D3, AR-D10-1) and the `model` slice reducers.
// Which meshes are "Part of the character" by default (every mesh touching the body directly or through other parts;
// one touching none "Looks separate" and starts unticked) is editor-core's `autorigFlow` (T5b, shared with Halo), as
// is the list of the parts left out. Unticked meshes stay in the scene, follow ①'s fixes and are hidden while
// Auto-Rig shows the model (`autorig.parts`), and are left out of `subject.meshes`, so Quick Rig and Create Skeleton
// adopt only the ticked ones.
import type { MeshId } from '@ekza-studio/doc';
import { leftOutParts as flowLeftOutParts } from '@ekza-studio/editor-core';
import type { WizardContext } from '../../shell/context';

export { CONTACT_GRID, defaultParts, meshBounds, separateMeshes } from '@ekza-studio/editor-core';

/** Ticks or unticks a part: the `model` slice and the subject's meshes follow (in the intake's order). */
export function setPart(ctx: WizardContext, mesh: MeshId, ticked: boolean): void {
  const state = ctx.session.getState();
  const all = state.intake?.meshes ?? state.subject.meshes;
  const current = new Set(state.model.parts ?? all);
  if (ticked) current.add(mesh);
  else current.delete(mesh);
  setParts(
    ctx,
    all.filter((id) => current.has(id)),
  );
}

/** Ticks every part (*Tick all*). */
export function tickAll(ctx: WizardContext): void {
  const state = ctx.session.getState();
  setParts(ctx, [...(state.intake?.meshes ?? state.subject.meshes)]);
}

function setParts(ctx: WizardContext, parts: MeshId[]): void {
  const state = ctx.session.getState();
  ctx.session.patch('model', { parts });
  ctx.session.set({ subject: { ...state.subject, meshes: parts } });
}

/** The scene meshes of the loaded model left out of the character (the unticked parts that still exist). */
export function leftOutParts(ctx: WizardContext): MeshId[] {
  const state = ctx.session.getState();
  return flowLeftOutParts(ctx.app, { parts: state.model.parts, intake: state.intake });
}

/** The heavy-model question is asked once per subject (§6.2). */
export function confirmHeavy(ctx: WizardContext): void {
  ctx.session.patch('model', { heavyConfirmed: true });
}
