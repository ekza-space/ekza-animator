// Auto-Rig's derived progress (AUTORIG-SPEC §4.3; D3), moved here from `autorig/src/progress` (STUDIO-TOUCH-SPEC
// §20.3 item 10; T5c) so that the Auto-Rig wizard and Halo's readiness read one source: `done`, `reachable` and
// `blocked` per step as a pure function of the document, the M6b checklist (`rigChecklist`, CR-AR-4) with the
// Validation rows of the subject character under `ekza/space-avatar-v1` (the rows need the rig-workspace chunk; before
// it loaded they are unknown and ③ is not done) and the shell's U state — never stored, so reloads, undo and edits
// made in another shell keep it right. String-free: the shell passes its words for the blocked reasons (Auto-Rig its
// frame strings, Halo its own). The checklist is a lazy chunk of its own (`./checklist`, AR-D3-21): the shell loads it
// with the first model, and until it is there a subject character's skeleton and binding are unknown (② and ③ not
// done, "checking"), as the rows are before the rig chunk. The subject rule and the profile are the flow's
// (`autorigFlow/subject`, ST-T5B-8): one copy.
import type { CharacterRecord, ReadView } from '@ekza-studio/doc';
import { AUTORIG_FLOW_PROFILE, resolveAutoRigSubject } from '../autorigFlow/subject';
import type { rigChecklist } from '../rig/validation/checklist';
import type { AutoRigStep, AutoRigSubject, EditorApp, RigValidationRow } from '../types';

/** The steps in order (AUTORIG-SPEC §5; Auto-Rig's `AUTORIG_STEPS`). */
const STEPS: readonly AutoRigStep[] = ['model', 'markers', 'rig', 'animations', 'export'];

/** The families whose error rows keep ③ from done (§4.3, M6B-INT-11: warnings and info rows are allowed). */
const BLOCKING = /^(skel|skin|xform)\./;

/**
 * What a shell says for each reason a step is not reachable. The keys are Auto-Rig's frame strings, so the wizard
 * passes `messages().frame` as it is; Halo passes its own words (or codes).
 */
export interface AutoRigProgressWords<R = string> {
  /** No subject: nothing loaded yet. */
  readonly blockedNoModel: R;
  /** A subject without a skeleton (② not done). */
  readonly blockedNoSkeleton: R;
  /** A skeleton whose meshes are not all bound (③ not done). */
  readonly blockedNotBound: R;
  /** The checklist chunk or the Validation rows are not there yet. */
  readonly blockedChecking: R;
  /** An asset-sourced character (a VRM or rigged glTF): ② and ③ do not apply. */
  readonly alreadyRigged: R;
  /** An error row of `skel.*`, `skin.*` or `xform.*` keeps ③ from done (its message). */
  blockedRow(message: string): R;
}

/** The derived progress (Auto-Rig's `AutoRigProgress` with the shell's words for `blocked`). */
export interface AutoRigStepProgress<R = string> {
  readonly done: Readonly<Record<AutoRigStep, boolean>>;
  readonly reachable: Readonly<Record<AutoRigStep, boolean>>;
  /** Why a step is not reachable. */
  readonly blocked: Readonly<Partial<Record<AutoRigStep, R>>>;
}

export interface AutoRigProgressInput {
  readonly view: ReadView;
  readonly subject: AutoRigSubject;
  /** The subject character's Validation rows, or null while unknown (no character, or the rig chunk not loaded). */
  readonly rows: readonly RigValidationRow[] | null;
  /** ④ was skipped (Auto-Rig's Skip). */
  readonly animationsSkipped: boolean;
  /** C7's `rigChecklist` (CR-AR-4), or null while its chunk is loading (skeleton and binding unknown). */
  readonly checklist: typeof rigChecklist | null;
}

/** §4.3's table as a pure function of its inputs. */
export function autoRigProgressOf<R>(input: AutoRigProgressInput, t: AutoRigProgressWords<R>): AutoRigStepProgress<R> {
  const { view } = input;
  const subject = resolveAutoRigSubject(view, input.subject);
  const character = subject.character;
  const asset = character?.source.kind === 'asset';
  // An asset-sourced humanoid: the shipped importer maps the humanoid only from the VRM extensions (format vrm0/vrm1).
  const assetHumanoid = asset && character?.format !== 'gltf';
  const hasSubject = subject.meshes.length > 0 || character !== null;
  // unknown only for a character: without one the checklist is the empty one that starts at ①
  const unknown = character !== null && input.checklist === null;
  const checklist =
    input.checklist === null
      ? []
      : input.checklist({ store: view as EditorApp['store'] }, character?.id ?? null, {
          rows: input.rows ?? [],
          previewed: false,
        });
  const skeleton = checklist[0]?.glyph === 'done';
  const bound = checklist[2]?.glyph === 'done';
  const blocking = input.rows?.find((row) => row.severity === 'error' && BLOCKING.test(row.code)) ?? null;
  const rigDone = !asset && skeleton && bound && input.rows !== null && blocking === null;
  // "A clip exists" as the checklist counts it: brought in (Use Clip, an import) or a new clip with curves.
  const clips =
    character !== null &&
    view
      .list('clips')
      .some(
        (clip) =>
          clip.character === character.id &&
          (clip.source.kind === 'imported' ||
            clip.source.kind === 'embedded' ||
            (clip.source.kind === 'new' && view.list('curves').some((curve) => curve.clip === clip.id))),
      );

  const done = {
    model: hasSubject,
    markers: !asset && skeleton,
    rig: rigDone,
    animations: hasSubject && (clips || input.animationsSkipped),
    export: false,
  };
  const animationsReachable = rigDone || assetHumanoid;
  const reachable = {
    model: true,
    markers: hasSubject && !asset,
    rig: done.markers,
    animations: animationsReachable,
    export: animationsReachable,
  };
  const blocked: Partial<Record<AutoRigStep, R>> = {};
  if (!reachable.markers) blocked.markers = asset ? t.alreadyRigged : t.blockedNoModel;
  if (!reachable.rig) {
    blocked.rig = asset
      ? t.alreadyRigged
      : !hasSubject
        ? t.blockedNoModel
        : unknown
          ? t.blockedChecking
          : t.blockedNoSkeleton;
  }
  if (!animationsReachable) {
    const why = !hasSubject
      ? t.blockedNoModel
      : asset
        ? t.alreadyRigged
        : unknown
          ? t.blockedChecking
          : !skeleton
            ? t.blockedNoSkeleton
            : !bound
              ? t.blockedNotBound
              : blocking !== null
                ? t.blockedRow(blocking.message)
                : input.rows === null
                  ? t.blockedChecking
                  : t.blockedNotBound;
    blocked.animations = why;
    blocked.export = why;
  }
  return { done, reachable, blocked };
}

/** The Validation rows of a character under the flow's profile; null without the rig chunk or a model character. */
export function autoRigSubjectRows(
  app: EditorApp,
  character: CharacterRecord | null,
): readonly RigValidationRow[] | null {
  if (character === null || character.source.kind !== 'model' || !app.rig.loaded) return null;
  try {
    return app.rig.validation.rows(character.id, AUTORIG_FLOW_PROFILE);
  } catch {
    return null;
  }
}

let checklist: typeof rigChecklist | null = null;
let checklistLoad: Promise<void> | null = null;

/** Loads the checklist chunk once (a failed load is retried by the next call); resolves when it is there. */
export function loadAutoRigChecklist(): Promise<void> {
  checklistLoad ??= import('./checklist').then(
    (module) => {
      checklist = module.rigChecklist;
    },
    (error: unknown) => {
      checklistLoad = null;
      throw error;
    },
  );
  return checklistLoad;
}

/** True once the checklist chunk is there (progress then knows skeletons and binding). */
export const autoRigChecklistLoaded = (): boolean => checklist !== null;

/**
 * The progress of a subject now (§4.3): reads the document, the Validation rows and the shell's U state. Until
 * `loadAutoRigChecklist()` resolved, a subject character's skeleton and binding read as unknown.
 */
export function autoRigProgressNow<R>(
  app: EditorApp,
  subject: AutoRigSubject,
  animationsSkipped: boolean,
  words: AutoRigProgressWords<R>,
): AutoRigStepProgress<R> {
  const { character } = resolveAutoRigSubject(app.store, subject);
  return autoRigProgressOf(
    { view: app.store, subject, rows: autoRigSubjectRows(app, character), animationsSkipped, checklist },
    words,
  );
}

/** The step a request lands on: the step itself when reachable, else the furthest reachable one (§3.1 `?step=`). */
export function autoRigLandingStep(
  progress: Pick<AutoRigStepProgress<unknown>, 'reachable'>,
  requested: AutoRigStep,
): AutoRigStep {
  if (progress.reachable[requested]) return requested;
  let furthest: AutoRigStep = 'model';
  for (const step of STEPS) if (progress.reachable[step]) furthest = step;
  return furthest;
}
