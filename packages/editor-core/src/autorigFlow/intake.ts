// ① intake routing (AUTORIG-SPEC §5.2, §6.1, §4.4; moved from Auto-Rig ① by T5b): a file or a sample goes through
// `autorig.intake` / `autorig.sample` (in Rig & Skin, which loads the rig chunk with the first model), and its report
// decides where the subject goes — a static model stays on ① for its checks with its default parts (§6.1; the checks
// then measure the ticked parts), a VRM or a rigged humanoid is an asset character for ④, a skinned file the importer
// cannot map waits for *Re-rig from scratch* (`dropSkin`), a project names its only character, its scene meshes, or
// asks which character. A document that holds something gets the shell's New question first, then `file.new`. Also
// the report again after a change (`autorig.inspect`; the file's own fields kept), a Studio hand-over, the choice of a
// project's character, and *Continue where you left off* (`file.recover`, the subject from the document when the
// slot has no shell state). Every change is an operator run; the routing is U state.
import type { CharacterId } from '@ekza-studio/doc';
import type { AutoRigSampleId, AutoRigSubject, IntakeReport } from '../types';
import { type AutoRigFlowHost, enterRigWorkspace, runMessage } from './host';
import { defaultParts } from './parts';
import { characterIds, liveSubjectMeshes, newCharacters } from './subject';

/** Where an intake leaves the subject (§5.2 table). */
export type AutoRigIntakeRoute =
  /** A static model (its checks on ①), a project's only character or its scene meshes. */
  | { readonly kind: 'model' }
  /** A VRM or a rigged humanoid: an asset character, continued on ④. */
  | { readonly kind: 'animations' }
  /** A skinned file the importer does not map: *Re-rig from scratch* (`reRigArgs`) or *Open in Studio*. */
  | { readonly kind: 'rerig' }
  /** A project with several characters: the person chooses one (`chooseFlowCharacter`). */
  | { readonly kind: 'choose'; readonly characters: readonly CharacterId[] };

export type AutoRigIntakeOutcome =
  | { readonly status: 'finished'; readonly report: IntakeReport; readonly route: AutoRigIntakeRoute }
  | { readonly status: 'failed'; readonly error: string };

/** The operators that take a model in at ①. */
export type AutoRigIntakeOp = 'autorig.intake' | 'autorig.sample';

/** Called when the subject was taken from a report (the wizard clears ①'s loading state and footer there). */
export type OnSubjectTaken = () => void;

/**
 * A fresh document before an intake (§5.2): nothing to do in an empty one; else `ask` (the shell's New question,
 * "Start a new character? Unsaved work is kept in autosave"), then `file.new`. False when declined or refused.
 */
export async function freshDocument(host: AutoRigFlowHost, ask: () => Promise<boolean>): Promise<boolean> {
  const { app } = host;
  if (app.store.list('characters').length === 0 && app.store.list('meshes').length === 0) return true;
  if (!(await ask())) return false;
  return (await host.quiet('file.new')).status === 'finished';
}

/** Records a fresh subject from a report (§4.3: the start pose once per subject; §6.1: the default parts). */
export function takeIntakeReport(
  host: AutoRigFlowHost,
  report: IntakeReport,
  subject: AutoRigSubject,
  taken?: OnSubjectTaken,
): void {
  const { state } = host;
  state.resetSubject(subject);
  state.set({ intake: report, startPose: report.pose });
  if (report.meshes.length > 1) {
    const parts = defaultParts(host.app, report.meshes);
    state.set({ parts, subject: { character: null, meshes: parts } });
  }
  taken?.();
}

/**
 * Applies the result of an intake or a sample (§5.2 table: static → ① then ②, VRM / rigged humanoid → ④, rigged other
 * → *Re-rig*, a project → its character). `before`: the character ids before the run.
 */
export async function routeIntake(
  host: AutoRigFlowHost,
  report: IntakeReport,
  before: ReadonlySet<string>,
  taken?: OnSubjectTaken,
): Promise<AutoRigIntakeRoute> {
  const { app, state } = host;
  switch (report.kind) {
    case 'static':
      takeIntakeReport(host, report, { character: null, meshes: report.meshes }, taken);
      // §6.1: the checks are the ticked parts' (a sword on the floor is not part of the body)
      if (report.meshes.length > 1) await reinspectSubject(host);
      return { kind: 'model' };
    case 'vrm':
    case 'rigged-humanoid': {
      const character = newCharacters(app, before)[0] ?? null;
      takeIntakeReport(host, report, { character, meshes: [] }, taken);
      return { kind: 'animations' };
    }
    case 'rigged-other':
      state.resetSubject({ character: null, meshes: [] });
      state.set({ intake: report });
      return { kind: 'rerig' };
    case 'project': {
      const characters = app.store.list('characters').map((character) => character.id);
      if (characters.length > 1) {
        state.resetSubject({ character: null, meshes: [] });
        state.set({ intake: report });
        return { kind: 'choose', characters };
      }
      if (characters.length === 1) {
        takeIntakeReport(host, report, { character: characters[0] as CharacterId, meshes: [] }, taken);
        return { kind: 'model' };
      }
      const meshes = app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
      takeIntakeReport(host, report, { character: null, meshes: meshes.map((mesh) => mesh.id) }, taken);
      await reinspectSubject(host);
      return { kind: 'model' };
    }
  }
}

/**
 * Takes a model in (§5.2): Rig & Skin, then `op` with `args` (`autorig.intake {bytes, name, dropSkin?}` or
 * `autorig.sample {sample}`; the person's run), then the routing. A run that does not finish says why.
 */
export async function intakeModel(
  host: AutoRigFlowHost,
  op: AutoRigIntakeOp,
  args: unknown,
  taken?: OnSubjectTaken,
): Promise<AutoRigIntakeOutcome> {
  await enterRigWorkspace(host);
  const before = characterIds(host.app);
  const result = await host.run(op, args);
  if (result.status !== 'finished') return { status: 'failed', error: runMessage(result) };
  const report = result.value as IntakeReport;
  const route = await routeIntake(host, report, before, taken);
  return { status: 'finished', report, route };
}

/** `autorig.intake`'s arguments for a file. */
export const intakeFileArgs = (name: string, bytes: Uint8Array): { readonly bytes: Uint8Array; readonly name: string } => ({
  bytes,
  name,
});

/** `autorig.sample`'s arguments for a sample. */
export const intakeSampleArgs = (sample: AutoRigSampleId): { readonly sample: AutoRigSampleId } => ({ sample });

/** §6.1 *Re-rig from scratch*: the waiting skinned file again, its meshes at the bind pose without the skeleton. */
export const reRigArgs = (waiting: {
  readonly name: string;
  readonly bytes: Uint8Array;
}): { readonly bytes: Uint8Array; readonly name: string; readonly dropSkin: true } => ({
  bytes: waiting.bytes,
  name: waiting.name,
  dropSkin: true,
});

/** A fresh report of the subject's scene meshes (after a fix or an edit elsewhere); the file's own fields are kept. */
export async function reinspectSubject(host: AutoRigFlowHost): Promise<IntakeReport | null> {
  const { app, state } = host;
  const meshes = liveSubjectMeshes(app, state.get().subject);
  if (meshes.length === 0) return null;
  const result = await host.quiet('autorig.inspect', { meshes });
  if (result.status !== 'finished') return null;
  const report = result.value as IntakeReport;
  const previous = state.get().intake;
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
  state.set({
    intake: kept,
    // the start pose is recorded once per subject: the first pose the checks let the guess see
    ...(state.get().startPose === null && report.pose !== null ? { startPose: report.pose } : {}),
  });
  return kept;
}

/**
 * §3.4, §5.2 From Studio: the handed subject becomes the flow's (never replaces anything); scene meshes get their
 * report (the rig chunk first).
 */
export async function takeHandedSubject(
  host: AutoRigFlowHost,
  subject: AutoRigSubject,
  taken?: OnSubjectTaken,
): Promise<void> {
  host.state.resetSubject(subject);
  taken?.();
  await enterRigWorkspace(host);
  if (subject.character === null && subject.meshes.length > 0) {
    await host.app.rig.load();
    await reinspectSubject(host);
  }
}

/** A project with several characters: the chosen one becomes the subject (the project's report is kept). */
export function chooseFlowCharacter(host: AutoRigFlowHost, character: CharacterId): void {
  const report = host.state.get().intake;
  host.state.resetSubject({ character, meshes: [] });
  if (report !== null) host.state.set({ intake: report });
}

/**
 * §4.4 *Continue where you left off*: the slot opens (`file.recover`). A slot without this shell's state (a Studio
 * session) gives the subject from the document: its only character, else its scene meshes with their report.
 * False when the slot did not open.
 */
export async function continueFromSlot(host: AutoRigFlowHost, slot: string): Promise<boolean> {
  const { app, state } = host;
  const result = await host.run('file.recover', { slot });
  if (result.status !== 'finished') return false;
  const subject = state.get().subject;
  const live =
    (subject.character !== null && app.store.get('characters', subject.character) !== undefined) ||
    subject.meshes.some((id) => app.store.get('meshes', id) !== undefined);
  if (live) return true;
  const characters = app.store.list('characters');
  if (characters.length === 1) state.resetSubject({ character: characters[0]?.id ?? null, meshes: [] });
  else {
    const meshes = app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
    if (meshes.length > 0) {
      state.resetSubject({ character: null, meshes: meshes.map((mesh) => mesh.id) });
      await enterRigWorkspace(host);
      await reinspectSubject(host);
    }
  }
  return true;
}

/** §4.4 *Start over*: the slot is discarded. */
export async function discardSlot(host: AutoRigFlowHost, slot: string): Promise<void> {
  await host.run('file.discardRecovery', { slot });
}
