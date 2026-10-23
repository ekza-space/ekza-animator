// ① Model actions (AUTORIG-SPEC §5.2, §6.1, §6.2; D3): load a file or a sample through `autorig.intake` /
// `autorig.sample` (the shipped New confirm first when the document holds something), take the report into the
// session (subject, intake, the start pose recorded once per subject, the default parts), run the one-click fixes
// (`autorig.fix`, one undo step each, then a fresh `autorig.inspect`), use a Studio hand-over, continue or discard an
// autosave slot. Every document change is an operator run; the session is U state. A lazy chunk (AR-D3-4): the
// first ① action loads it (`./ui` keeps the transient state the drop zone reads before).
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import type { AutoRigSampleId, AutoRigSubject, IntakeReport } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';
import { enterWorkspace } from '../../shell/entry';
import { defaultParts } from './parts';
import { modelUi } from './ui';

export { modelUi };

/** The live scene meshes of the subject (the fixes and the inspection work on them). */
export function subjectMeshes(ctx: WizardContext): MeshId[] {
  return ctx.session.getState().subject.meshes.filter((id) => ctx.app.store.get('meshes', id) !== undefined);
}

/** The document already holds something: the shipped New confirm, then `file.new` (§5.2). False when declined. */
async function startFresh(ctx: WizardContext): Promise<boolean> {
  const { app, host } = ctx;
  if (app.store.list('characters').length === 0 && app.store.list('meshes').length === 0) return true;
  const ok = await host.confirm({
    title: messages().frame.menuNew,
    text: messages().frame.newConfirm,
    confirmLabel: messages().frame.menuNew,
  });
  if (!ok) return false;
  const result = await app.runUntyped('file.new');
  return result.status === 'finished';
}

/** Records a fresh subject from a report (§4.3: the start pose once per subject; §6.1: the default parts). */
function takeReport(ctx: WizardContext, report: IntakeReport, subject: AutoRigSubject): void {
  ctx.session.resetSubject(subject);
  ctx.session.set({ intake: report, startPose: report.pose });
  if (report.meshes.length > 1) {
    const parts = defaultParts(ctx.app, report.meshes);
    ctx.session.patch('model', { parts });
    ctx.session.set({ subject: { character: null, meshes: parts } });
  }
  modelUi(ctx).set({ loading: null, error: null, rerig: null, choose: null });
  ctx.setFooter({});
}

/** The characters an import added (an asset character from a VRM or a rigged humanoid). */
const newCharacters = (ctx: WizardContext, before: ReadonlySet<string>): CharacterId[] =>
  ctx.app.store
    .list('characters')
    .filter((character) => !before.has(character.id))
    .map((character) => character.id);

/** Applies the result of an intake or a sample (§5.2 table: static → ②, VRM / rigged humanoid → ④). */
async function afterIntake(ctx: WizardContext, report: IntakeReport, before: ReadonlySet<string>): Promise<void> {
  const ui = modelUi(ctx);
  switch (report.kind) {
    case 'static':
      takeReport(ctx, report, { character: null, meshes: report.meshes });
      // §6.1: the checks are the ticked parts' (a sword on the floor is not part of the body)
      if (report.meshes.length > 1) await reinspect(ctx);
      return;
    case 'vrm':
    case 'rigged-humanoid': {
      const character = newCharacters(ctx, before)[0] ?? null;
      takeReport(ctx, report, { character, meshes: [] });
      ctx.go('animations');
      return;
    }
    case 'rigged-other':
      ctx.session.resetSubject({ character: null, meshes: [] });
      ctx.session.set({ intake: report });
      return;
    case 'project': {
      const characters = ctx.app.store.list('characters').map((character) => character.id);
      if (characters.length > 1) {
        ctx.session.resetSubject({ character: null, meshes: [] });
        ctx.session.set({ intake: report });
        ui.set({ loading: null, error: null, rerig: null, choose: characters });
        return;
      }
      if (characters.length === 1) {
        takeReport(ctx, report, { character: characters[0] as CharacterId, meshes: [] });
        return;
      }
      const meshes = ctx.app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
      takeReport(ctx, report, { character: null, meshes: meshes.map((mesh) => mesh.id) });
      await reinspect(ctx);
      return;
    }
  }
}

export async function runIntake(
  ctx: WizardContext,
  label: string,
  op: 'autorig.intake' | 'autorig.sample',
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
    // ① works in Rig & Skin (§4.2): the switch loads the rig-workspace chunk with the first file or sample.
    await enterWorkspace(ctx.app, 'model');
    const before = new Set<string>(ctx.app.store.list('characters').map((character) => character.id));
    const result = await ctx.run(op, args);
    if (result.status !== 'finished') {
      const error = result.status === 'failed' ? result.error.message : result.reason;
      ui.set((current) => ({ ...current, loading: null, error }));
      return null;
    }
    const report = result.value as IntakeReport;
    await afterIntake(ctx, report, before);
    return report;
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
export async function reinspect(ctx: WizardContext): Promise<IntakeReport | null> {
  const meshes = subjectMeshes(ctx);
  if (meshes.length === 0) return null;
  const result = await ctx.app.runUntyped('autorig.inspect', { meshes });
  if (result.status !== 'finished') return null;
  const report = result.value as IntakeReport;
  const previous = ctx.session.getState().intake;
  const kept: IntakeReport =
    previous === null
      ? report
      : {
          ...report,
          kind: previous.kind,
          fileName: previous.fileName ?? report.fileName,
          bytes: previous.bytes ?? report.bytes,
          meshes: previous.meshes.length > 0 ? previous.meshes : report.meshes,
        };
  ctx.session.set({
    intake: kept,
    // the start pose is recorded once per subject: the first pose the checks let the guess see
    ...(ctx.session.getState().startPose === null && report.pose !== null ? { startPose: report.pose } : {}),
  });
  return kept;
}

/** §4.4 Continue where you left off: the slot opens (`file.recover`); the mirror's step follows once reachable. */
export async function continueSlot(ctx: WizardContext, slot: string): Promise<void> {
  const result = await ctx.run('file.recover', { slot });
  if (result.status !== 'finished') return;
  const subject = ctx.session.getState().subject;
  const live =
    (subject.character !== null && ctx.app.store.get('characters', subject.character) !== undefined) ||
    subject.meshes.some((id) => ctx.app.store.get('meshes', id) !== undefined);
  if (live) return;
  // a slot without this tab's wizard state (a Studio session): the subject from the document
  const characters = ctx.app.store.list('characters');
  if (characters.length === 1) ctx.session.resetSubject({ character: characters[0]?.id ?? null, meshes: [] });
  else {
    const meshes = ctx.app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
    if (meshes.length > 0) {
      ctx.session.resetSubject({ character: null, meshes: meshes.map((mesh) => mesh.id) });
      await enterWorkspace(ctx.app, 'model');
      await reinspect(ctx);
    }
  }
}

/** §4.4 Start over: the slot is discarded (`file.discardRecovery`). */
export async function discardSlot(ctx: WizardContext, slot: string): Promise<void> {
  await ctx.run('file.discardRecovery', { slot });
}
