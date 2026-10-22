// ① Model actions (AUTORIG-SPEC §5.2, §6.1, §6.2; D3): load a file or a sample through `autorig.intake` /
// `autorig.sample` (the shipped New confirm first when the document holds something), take the report into the
// session (subject, intake, the start pose recorded once per subject, the default parts), run the one-click fixes
// (`autorig.fix`, one undo step each, then a fresh `autorig.inspect`), use a Studio hand-over, continue or discard an
// autosave slot. Every document change is an operator run; the session is U state.
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import type { AutoRigFix, AutoRigSampleId, AutoRigSubject, IntakeReport } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';
import { enterWorkspace } from '../../shell/entry';
import { smallStore, type SmallStore } from '../../shell/store';
import { defaultParts } from './parts';

/** ①'s transient UI state (per wizard): what is loading, a skinned file waiting for Re-rig, a project's characters. */
export interface ModelUi {
  readonly loading: string | null;
  readonly rerig: { readonly name: string; readonly bytes: Uint8Array } | null;
  readonly choose: readonly CharacterId[] | null;
}

const uis = new WeakMap<WizardContext['session'], SmallStore<ModelUi>>();

export function modelUi(ctx: Pick<WizardContext, 'session'>): SmallStore<ModelUi> {
  let store = uis.get(ctx.session);
  if (store === undefined) {
    store = smallStore<ModelUi>({ loading: null, rerig: null, choose: null });
    uis.set(ctx.session, store);
  }
  return store;
}

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
  modelUi(ctx).set({ loading: null, rerig: null, choose: null });
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
        ui.set({ loading: null, rerig: null, choose: characters });
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

async function intake(
  ctx: WizardContext,
  label: string,
  op: 'autorig.intake' | 'autorig.sample',
  args: unknown,
  fresh = true,
): Promise<IntakeReport | null> {
  const ui = modelUi(ctx);
  if (ui.get().loading !== null) return null;
  if (fresh && !(await startFresh(ctx))) return null;
  ui.set((current) => ({ ...current, loading: label, rerig: null, choose: null }));
  ctx.setFooter({ status: messages().model.loading(label), tone: 'info' });
  try {
    // ① works in Rig & Skin (§4.2): the switch loads the rig-workspace chunk with the first file or sample.
    await enterWorkspace(ctx.app, 'model');
    const before = new Set<string>(ctx.app.store.list('characters').map((character) => character.id));
    const result = await ctx.run(op, args);
    if (result.status !== 'finished') {
      ui.set((current) => ({ ...current, loading: null }));
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
  const report = await intake(ctx, file.name, 'autorig.intake', { bytes, name: file.name });
  if (report?.kind === 'rigged-other')
    modelUi(ctx).set((current) => ({ ...current, rerig: { name: file.name, bytes } }));
}

/** §5.2 samples (`autorig.sample`). */
export async function loadSample(ctx: WizardContext, sample: AutoRigSampleId): Promise<void> {
  await intake(ctx, sample, 'autorig.sample', { sample });
}

/** §6.1 Re-rig from scratch: the waiting skinned file again with `dropSkin` (its meshes at the bind pose). */
export async function reRig(ctx: WizardContext): Promise<void> {
  const waiting = modelUi(ctx).get().rerig;
  if (waiting === null) return;
  await intake(
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
        };
  ctx.session.set({
    intake: kept,
    // the start pose is recorded once per subject: the first pose the checks let the guess see
    ...(ctx.session.getState().startPose === null && report.pose !== null ? { startPose: report.pose } : {}),
  });
  return kept;
}

/** A one-click fix (§5.2): one `autorig.fix` (one undo step), then the report again. */
export async function applyFix(ctx: WizardContext, fix: AutoRigFix, height?: number): Promise<void> {
  const meshes = subjectMeshes(ctx);
  if (meshes.length === 0) return;
  await enterWorkspace(ctx.app, 'model');
  const result = await ctx.run('autorig.fix', { fix, meshes, ...(height === undefined ? {} : { height }) });
  if (result.status === 'finished') await reinspect(ctx);
}

/** §3.4, §5.2 From Studio: the handed subject becomes the wizard's ("Use these"); never replaces anything. */
export async function takeFromStudio(ctx: WizardContext, subject: AutoRigSubject): Promise<void> {
  ctx.session.resetSubject(subject);
  modelUi(ctx).set({ loading: null, rerig: null, choose: null });
  await enterWorkspace(ctx.app, 'model');
  if (subject.character === null && subject.meshes.length > 0) {
    await ctx.app.rig.load();
    await reinspect(ctx);
  }
}

/** A project with several characters: the chosen one becomes the subject. */
export function chooseCharacter(ctx: WizardContext, character: CharacterId): void {
  const intakeReport = ctx.session.getState().intake;
  ctx.session.resetSubject({ character, meshes: [] });
  if (intakeReport !== null) ctx.session.set({ intake: intakeReport });
  modelUi(ctx).set({ loading: null, rerig: null, choose: null });
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
