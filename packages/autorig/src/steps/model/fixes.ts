// ① Model actions loaded with the report panel (AUTORIG-SPEC §5.2, §6.1; D3): the one-click fixes (`autorig.fix`, one
// undo step each, then the report again), Re-rig from scratch, Open in Studio for a skeleton Auto-Rig does not rig, a
// Studio hand-over ("Use these") and the character of a multi-character project. The fixes, the hand-over and the
// character choice are editor-core's `autorigFlow` (T5b, shared with Halo); this module keeps ①'s transient state.
// A lazy chunk: none of it is needed before a model is loaded (the first-visit route stays the frame and the drop
// zone, §7.2).
import type { CharacterId } from '@ekza-studio/doc';
import {
  type AutoRigFix,
  type AutoRigSubject,
  applyFix as applyFlowFix,
  chooseFlowCharacter,
  reRigArgs,
  takeHandedSubject,
} from '@ekza-studio/editor-core';
import type { WizardContext } from '../../shell/context';
import { modelUi, runIntake, subjectMeshes } from './flow';
import { flowHost } from './flowHost';

/** §6.1 Re-rig from scratch: the waiting skinned file again with `dropSkin` (its meshes at the bind pose). */
export async function reRig(ctx: WizardContext): Promise<void> {
  const waiting = modelUi(ctx).get().rerig;
  if (waiting === null) return;
  await runIntake(ctx, waiting.name, 'autorig.intake', reRigArgs(waiting), false);
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
  if (subjectMeshes(ctx).length === 0) return;
  modelUi(ctx).set((current) => ({ ...current, error: null }));
  // measured on the ticked parts, applied to the whole model: an unticked part follows (AR-D10-2)
  const outcome = await applyFlowFix(flowHost(ctx), fix, height);
  if (outcome.status === 'failed') modelUi(ctx).set((current) => ({ ...current, error: outcome.error }));
}

/** §3.4, §5.2 From Studio: the handed subject becomes the wizard's ("Use these"); never replaces anything. */
export async function takeFromStudio(ctx: WizardContext, subject: AutoRigSubject): Promise<void> {
  await takeHandedSubject(flowHost(ctx), subject, () =>
    modelUi(ctx).set({ loading: null, error: null, rerig: null, choose: null }),
  );
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
  chooseFlowCharacter(flowHost(ctx), character);
  modelUi(ctx).set({ loading: null, error: null, rerig: null, choose: null });
}
