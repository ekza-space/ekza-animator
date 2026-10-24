// ① Model actions (AUTORIG-SPEC §5.2, §6.1, §6.2; D3): load a file or a sample, take the report into the session, use a
// Studio hand-over, continue or discard an autosave slot. The orchestration — the New question then `file.new`, the
// intake (`autorig.intake` / `autorig.sample` in Rig & Skin), its routing (the subject, the start pose recorded once
// per subject, the default parts, the report of the ticked parts) and `autorig.inspect` — is editor-core's
// `autorigFlow` (T5b), shared with Halo; this module keeps ①'s transient state, the footer and the step changes. Every
// document change is an operator run; the session is U state. A lazy chunk (AR-D3-4): the first ① action loads it
// (`./ui` keeps the transient state the drop zone reads before).
import type { MeshId } from '@ekza-studio/doc';
import {
  type AutoRigIntakeOp,
  type AutoRigSampleId,
  continueFromSlot,
  discardSlot as discardFlowSlot,
  freshDocument,
  type IntakeReport,
  intakeModel,
  liveSubjectMeshes,
  reinspectSubject,
} from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';
import { flowHost } from './flowHost';
import { modelUi } from './ui';

export { modelUi };

/** The live scene meshes of the subject (the fixes and the inspection work on them). */
export function subjectMeshes(ctx: WizardContext): MeshId[] {
  return liveSubjectMeshes(ctx.app, ctx.session.getState().subject);
}

/** The document already holds something: the shipped New confirm, then `file.new` (§5.2). False when declined. */
function startFresh(ctx: WizardContext): Promise<boolean> {
  return freshDocument(flowHost(ctx), () =>
    ctx.host.confirm({
      title: messages().frame.menuNew,
      text: messages().frame.newConfirm,
      confirmLabel: messages().frame.menuNew,
    }),
  );
}

/** What ① shows once a report gave the subject: nothing loading, no failure, no waiting file, a fresh footer. */
function subjectTaken(ctx: WizardContext): () => void {
  return () => {
    modelUi(ctx).set({ loading: null, error: null, rerig: null, choose: null });
    ctx.setFooter({});
  };
}

export async function runIntake(
  ctx: WizardContext,
  label: string,
  op: AutoRigIntakeOp,
  args: unknown,
  fresh = true,
  keepStep = false,
): Promise<IntakeReport | null> {
  const ui = modelUi(ctx);
  if (ui.get().loading !== null) return null;
  if (fresh && !(await startFresh(ctx))) return null;
  // A new model starts at ① with fresh checks (AR-R4-1): a step the reload restored for the previous model (the
  // mirror's ②, waiting for its document) is dropped, so a file chosen instead of *Continue* never skips ①. The
  // arrival's own `?sample=` keeps its `?step=` (asked for together in the URL).
  if (!keepStep) {
    ctx.ui.set((current) => (current.pendingStep === null ? current : { ...current, pendingStep: null }));
    if (ctx.session.getState().step !== 'model') ctx.session.set({ step: 'model' });
  }
  ui.set((current) => ({ ...current, loading: label, error: null, rerig: null, choose: null }));
  ctx.setFooter({ status: messages().model.loading(label), tone: 'info' });
  try {
    // ① works in Rig & Skin (§4.2): the flow switches there, which loads the rig-workspace chunk with the first model
    const outcome = await intakeModel(flowHost(ctx), op, args, subjectTaken(ctx));
    if (outcome.status !== 'finished') {
      ui.set((current) => ({ ...current, loading: null, error: outcome.error }));
      return null;
    }
    const { route } = outcome;
    if (route.kind === 'animations') ctx.go('animations');
    else if (route.kind === 'choose') ui.set({ loading: null, error: null, rerig: null, choose: route.characters });
    return outcome.report;
  } finally {
    ui.set((current) => (current.loading === null ? current : { ...current, loading: null }));
  }
}

/** Loads a file (the first of a drop or a pick); a skinned file the importer cannot map waits for Re-rig. */
export async function loadFiles(ctx: WizardContext, files: readonly File[]): Promise<void> {
  const file = files[0];
  if (file === undefined) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const report = await runIntake(ctx, file.name, 'autorig.intake', { bytes, name: file.name });
  if (report?.kind === 'rigged-other')
    modelUi(ctx).set((current) => ({ ...current, rerig: { name: file.name, bytes } }));
}

/** §5.2 samples (`autorig.sample`). */
export async function loadSample(ctx: WizardContext, sample: AutoRigSampleId, fromUrl = false): Promise<void> {
  await runIntake(ctx, sample, 'autorig.sample', { sample }, true, fromUrl);
}

/** A fresh report of the subject's scene meshes (after a fix or an edit elsewhere); the file name is kept. */
export function reinspect(ctx: WizardContext): Promise<IntakeReport | null> {
  return reinspectSubject(flowHost(ctx));
}

/** §4.4 Continue where you left off: the slot opens (`file.recover`); the mirror's step follows once reachable. */
export async function continueSlot(ctx: WizardContext, slot: string): Promise<void> {
  await continueFromSlot(flowHost(ctx), slot);
}

/** §4.4 Start over: the slot is discarded (`file.discardRecovery`). */
export async function discardSlot(ctx: WizardContext, slot: string): Promise<void> {
  await discardFlowSlot(flowHost(ctx), slot);
}
