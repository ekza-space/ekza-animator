// The Auto-Rig journey ①–⑤ headless (AUTORIG-SPEC §5; STUDIO-TOUCH-SPEC §20.7, AS-ST-5, T5b): the flow calls the
// wizard makes when a person takes a model through the five steps with the defaults — ① the model in (a New question
// answered yes), every first fix in order; ② Quick Rig with the One-Click guess (and the finger detail when asked);
// ③ *Auto-rig* (M6b's rebind question answered *Rebind*), the motion test until it plays; ④ the library clips added
// with identity parameters; ⑤ the first-entry preparation, the person's VRM meta, *Download*. Only `autorigFlow`
// functions run, through the host's funnels, so a recorded log (`./log`) is the operator sequence both shells issue.
// The wizard's own chrome (step entry: preview stop, Esc, rig mode; hidden parts and controls; framing) is not part of
// it. A step that cannot go on stops the journey with its reason.
import type { CharacterId, CharacterVrmMeta } from '@ekza-studio/doc';
import type { AutoRigExportResult, AutoRigExportTarget, AutoRigFix, AutoRigSampleId, IntakeReport } from '../types';
import { downloadExport, prepareExport } from './export';
import { AUTORIG_TARGET_HEIGHT, applyFix, nextFix } from './fixes';
import type { AutoRigFlowHost } from './host';
import { freshDocument, intakeFileArgs, intakeModel, intakeSampleArgs } from './intake';
import { addLibraryClip } from './library';
import { type AutoRigFingers, chooseFingers, openMarkers } from './markers';
import { type MotionTestState, startMotionTest } from './motion';
import { runRig } from './rig';

export interface AutoRigJourneyInput {
  /** ① a sample (`autorig.sample`), or a file (`autorig.intake`). */
  readonly model: { readonly sample: AutoRigSampleId } | { readonly name: string; readonly bytes: Uint8Array };
  /** ① the *Size* fix's target height (metres; default ①'s Set height field, 1.70 m). */
  readonly height?: number;
  /** ② the finger detail; absent = the guess's preset. */
  readonly fingers?: AutoRigFingers;
  /** ③ the motion test's clip (null: no motion test). */
  readonly motionClip?: string | null;
  /** ④ the library clips to add, in order. */
  readonly clips?: readonly string[];
  /** ⑤ the remembered author, and the person's VRM meta edits (licence…), one `char.setVrmMeta` each. */
  readonly author?: string | null;
  readonly meta?: readonly Partial<CharacterVrmMeta>[];
  /** ⑤ the target to download (default the Ekza avatar); null: no download. */
  readonly target?: AutoRigExportTarget | null;
}

export interface AutoRigJourneyResult {
  /** The step that stopped the journey, and why; null when it went through. */
  readonly stopped: { readonly step: 1 | 2 | 3 | 4 | 5; readonly reason: string } | null;
  readonly report: IntakeReport | null;
  readonly fixes: readonly AutoRigFix[];
  readonly character: CharacterId | null;
  readonly motion: MotionTestState | 'timeout' | null;
  readonly export: { readonly result: AutoRigExportResult; readonly saved: boolean } | null;
}

/** How long the journey waits for the motion test to play. */
const MOTION_WAIT_MS = 20_000;

/** The most fixes ① runs (each check has one; a fix that leaves its check failing stops the loop). */
const MAX_FIXES = 5;

/** Runs ①–⑤ (see the header). */
export async function runAutoRigJourney(
  host: AutoRigFlowHost,
  input: AutoRigJourneyInput,
): Promise<AutoRigJourneyResult> {
  const fixes: AutoRigFix[] = [];
  let report: IntakeReport | null = null;
  let character: CharacterId | null = null;
  let motion: AutoRigJourneyResult['motion'] = null;
  const stop = (step: 1 | 2 | 3 | 4 | 5, reason: string): AutoRigJourneyResult => ({
    stopped: { step, reason },
    report,
    fixes,
    character,
    motion,
    export: null,
  });

  // ① Model
  if (!(await freshDocument(host, () => Promise.resolve(true)))) return stop(1, 'the document was not cleared');
  const intake =
    'sample' in input.model
      ? await intakeModel(host, 'autorig.sample', intakeSampleArgs(input.model.sample))
      : await intakeModel(host, 'autorig.intake', intakeFileArgs(input.model.name, input.model.bytes));
  if (intake.status !== 'finished') return stop(1, intake.error);
  report = intake.report;
  if (intake.route.kind !== 'model') return stop(1, `the model is routed to ${intake.route.kind}`);
  for (let fix = nextFix(host); fix !== null; fix = nextFix(host)) {
    if (fixes.length >= MAX_FIXES || fixes.includes(fix)) return stop(1, `the ${fix} fix did not clear its check`);
    fixes.push(fix);
    const fixed = await applyFix(host, fix, fix === 'scale' ? (input.height ?? AUTORIG_TARGET_HEIGHT) : undefined);
    if (fixed.status === 'failed') return stop(1, fixed.error);
    report = host.state.get().intake;
  }

  // ② Markers
  const markers = await openMarkers(host);
  if (markers.status === 'failed') return stop(2, markers.reason);
  if (markers.status === 'none') return stop(2, 'nothing to place markers on');
  if (input.fingers !== undefined && !(await chooseFingers(host, input.fingers))) {
    return stop(2, `the ${input.fingers} finger detail was refused`);
  }

  // ③ Rig
  let rigged = await runRig(host);
  if (rigged.status === 'confirm-required') rigged = await runRig(host, { confirm: true });
  if (rigged.status !== 'finished') {
    return stop(3, 'message' in rigged ? rigged.message : rigged.status);
  }
  character = rigged.character;
  const motionClip = input.motionClip === undefined ? 'walk' : input.motionClip;
  if (motionClip !== null) {
    const rigCharacter = rigged.character;
    let test: { stop(): Promise<void> } | null = null;
    motion = await new Promise<AutoRigJourneyResult['motion']>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), MOTION_WAIT_MS);
      test = startMotionTest(host, rigCharacter, motionClip, (state) => {
        clearTimeout(timer);
        resolve(state);
      });
    });
    // the test stops when the person leaves ③ (the wizard's step entry stops the preview)
    await (test as { stop(): Promise<void> } | null)?.stop();
  }

  // ④ Animations
  for (const clip of input.clips ?? []) {
    const added = await addLibraryClip(host, character, clip);
    if (added.status !== 'finished') {
      return stop(4, added.status === 'failed' ? added.error.message : added.reason);
    }
  }

  // ⑤ Export
  const record = host.app.store.get('characters', character);
  if (record === undefined) return stop(5, 'the character is gone');
  await prepareExport(host, record, input.author ?? null);
  for (const patch of input.meta ?? []) {
    const edited = await host.run('char.setVrmMeta', { character, patch });
    if (edited.status !== 'finished') return stop(5, edited.status === 'failed' ? edited.error.message : edited.reason);
  }
  const target = input.target === undefined ? 'ekza-vrm' : input.target;
  const exported = target === null ? null : await downloadExport(host, character, target);
  if (target !== null && exported === null) return stop(5, `the ${target} export did not run`);
  return { stopped: null, report, fixes, character, motion, export: exported };
}
