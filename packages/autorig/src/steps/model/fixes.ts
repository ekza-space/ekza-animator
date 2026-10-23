// ① Model actions loaded with the report panel (AUTORIG-SPEC §5.2, §6.1; D3): the one-click fixes (`autorig.fix`, one
// undo step each, then the report again), Re-rig from scratch, Open in Studio for a skeleton Auto-Rig does not rig, a
// Studio hand-over ("Use these") and the character of a multi-character project. A lazy chunk: none of it is needed
// before a model is loaded (the first-visit route stays the frame and the drop zone, §7.2).
import type { CharacterId } from '@ekza-studio/doc';
import type { AutoRigFix, AutoRigSubject } from '@ekza-studio/editor-core';
import type { WizardContext } from '../../shell/context';
import { enterWorkspace } from '../../shell/entry';
import { modelUi, reinspect, runIntake, subjectMeshes } from './flow';
import { leftOutParts } from './parts';

/** §6.1 Re-rig from scratch: the waiting skinned file again with `dropSkin` (its meshes at the bind pose). */
export async function reRig(ctx: WizardContext): Promise<void> {
  const waiting = modelUi(ctx).get().rerig;
  if (waiting === null) return;
  await runIntake(
    ctx,
    waiting.name,
    'autorig.intake',
    { bytes: waiting.bytes, name: waiting.name, dropSkin: true },
    false,
  );
}

/** §6.1 Open in Studio for a skinned file the wizard does not rig: Studio's own import, then the switch. */
export async function openRiggedInStudio(ctx: WizardContext): Promise<void> {
  const waiting = modelUi(ctx).get().rerig;
  if (waiting === null) return;
  const result = await ctx.run('file.importModel', { bytes: waiting.bytes, name: waiting.name });
  if (result.status !== 'finished') return;
  modelUi(ctx).set((current) => ({ ...current, rerig: null }));
  await ctx.host.navigation.go({ to: 'studio', workspace: 'animate', from: 'autorig' });
}

/** A one-click fix (§5.2): one `autorig.fix` (one undo step), then the report again. */
export async function applyFix(ctx: WizardContext, fix: AutoRigFix, height?: number): Promise<void> {
  const meshes = subjectMeshes(ctx);
  if (meshes.length === 0) return;
  await enterWorkspace(ctx.app, 'model');
  modelUi(ctx).set((current) => ({ ...current, error: null }));
  // measured on the ticked parts, applied to the whole model: an unticked part follows (AR-D10-2)
  const others = leftOutParts(ctx);
  const result = await ctx.run('autorig.fix', {
    fix,
    meshes,
    ...(height === undefined ? {} : { height }),
    ...(others.length === 0 ? {} : { with: others }),
  });
  if (result.status === 'finished') await reinspect(ctx);
  else {
    const error = result.status === 'failed' ? result.error.message : result.reason;
    modelUi(ctx).set((current) => ({ ...current, error }));
  }
}

/** §3.4, §5.2 From Studio: the handed subject becomes the wizard's ("Use these"); never replaces anything. */
export async function takeFromStudio(ctx: WizardContext, subject: AutoRigSubject): Promise<void> {
  ctx.session.resetSubject(subject);
  modelUi(ctx).set({ loading: null, error: null, rerig: null, choose: null });
  await enterWorkspace(ctx.app, 'model');
  if (subject.character === null && subject.meshes.length > 0) {
    await ctx.app.rig.load();
    await reinspect(ctx);
  }
}

/**
 * "Use these" (the From Studio card and ①'s primary while it waits, AR-D8-7): the card closes; a character continues
 * on ④ once reachable (AS-AR-3, AR-D7-4); scene meshes stay on ① for their report.
 */
export async function acceptFromStudio(ctx: WizardContext, handed: AutoRigSubject): Promise<void> {
  ctx.ui.set((u) => ({
    ...u,
    fromStudio: null,
    pendingStep: handed.character === null ? u.pendingStep : 'animations',
  }));
  await takeFromStudio(ctx, handed);
}

/** A project with several characters: the chosen one becomes the subject. */
export function chooseCharacter(ctx: WizardContext, character: CharacterId): void {
  const intakeReport = ctx.session.getState().intake;
  ctx.session.resetSubject({ character, meshes: [] });
  if (intakeReport !== null) ctx.session.set({ intake: intakeReport });
  modelUi(ctx).set({ loading: null, error: null, rerig: null, choose: null });
}
