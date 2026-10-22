// Derived wizard progress (AUTORIG-SPEC §4.3; D3): `done`, `reachable` and `blocked` per step as a pure function of
// the document, the M6b checklist (`rigChecklist`, CR-AR-4) with the Validation rows of the subject character under
// `ekza/space-avatar-v1` (the rows need the rig-workspace chunk; before it loaded they are unknown and ③ is not done)
// and the session — never stored, so reloads, undo and Studio edits keep it right. The checklist is a lazy chunk of
// its own (`./checklist`, AR-D3-21): the shell loads it with the first model, and until it is there a subject
// character's skeleton and binding are unknown (② and ③ not done, "Checking…"), as the rows are before the rig chunk.
import { type CharacterRecord, derivedId, type MeshId, type ReadView } from '@ekza-studio/doc';
import type { EditorApp, RigValidationRow, rigChecklist } from '@ekza-studio/editor-core';
import { messages } from '../i18n';
import {
  AUTORIG_STEPS,
  type AutoRigProgress,
  type AutoRigProgressFn,
  type AutoRigStep,
  type AutoRigSubject,
} from '../types';

/** The Validation profile the wizard checks against (§4.3, the VRM / Ekza Space avatar). */
export const AUTORIG_PROFILE = 'ekza/space-avatar-v1';

/** The families whose error rows keep ③ from done (§4.3, M6B-INT-11: warnings and info rows are allowed). */
const BLOCKING = /^(skel|skin|xform)\./;

export interface ResolvedSubject {
  /** The live subject character (the session's, else the model character that adopted the subject meshes). */
  readonly character: CharacterRecord | null;
  /** The live scene meshes of the subject (before Create Skeleton). */
  readonly meshes: readonly MeshId[];
}

/**
 * The subject as the document has it now: a character id that was undone is dropped; scene meshes adopted by Create
 * Skeleton (C1's adoption soft-deletes them and writes `derivedId('mesh', 'char.adopt', [character, source])`) lead to
 * the model character that holds them, so a skeleton made in Studio still counts.
 */
export function resolveSubject(view: ReadView, subject: AutoRigSubject): ResolvedSubject {
  const meshes = subject.meshes.filter((id) => view.get('meshes', id) !== undefined);
  let character = subject.character === null ? null : (view.get('characters', subject.character) ?? null);
  if (character === null && meshes.length < subject.meshes.length) {
    const gone = subject.meshes.filter((id) => !meshes.includes(id));
    character =
      view
        .list('characters')
        .find(
          (record) =>
            record.source.kind === 'model' &&
            gone.some((source) => view.get('meshes', derivedId('mesh', 'char.adopt', [record.id, source], '', 0))),
        ) ?? null;
  }
  return { character, meshes };
}

export interface ProgressInput {
  readonly view: ReadView;
  readonly subject: AutoRigSubject;
  /** The subject character's Validation rows, or null while unknown (no character, or the rig chunk not loaded). */
  readonly rows: readonly RigValidationRow[] | null;
  readonly animationsSkipped: boolean;
  /** C7's `rigChecklist` (CR-AR-4), or null while its chunk is loading (skeleton and binding unknown). */
  readonly checklist: typeof rigChecklist | null;
}

const flags = (value: (step: AutoRigStep) => boolean): Record<AutoRigStep, boolean> =>
  Object.fromEntries(AUTORIG_STEPS.map((step) => [step, value(step)])) as Record<AutoRigStep, boolean>;

/** §4.3's table as a pure function of its inputs. */
export function progressOf(input: ProgressInput): AutoRigProgress {
  const t = messages().frame;
  const { view } = input;
  const subject = resolveSubject(view, input.subject);
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

  const done = flags((step) => {
    switch (step) {
      case 'model':
        return hasSubject;
      case 'markers':
        return !asset && skeleton;
      case 'rig':
        return rigDone;
      case 'animations':
        return hasSubject && (clips || input.animationsSkipped);
      case 'export':
        return false;
    }
  });
  const animationsReachable = rigDone || assetHumanoid;
  const reachable = flags((step) => {
    switch (step) {
      case 'model':
        return true;
      case 'markers':
        return hasSubject && !asset;
      case 'rig':
        return done.markers;
      case 'animations':
      case 'export':
        return animationsReachable;
    }
  });
  const blocked: Partial<Record<AutoRigStep, string>> = {};
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

/** The Validation rows of a character under the wizard's profile; null without the rig chunk or a model character. */
export function subjectRows(app: EditorApp, character: CharacterRecord | null): readonly RigValidationRow[] | null {
  if (character === null || character.source.kind !== 'model' || !app.rig.loaded) return null;
  try {
    return app.rig.validation.rows(character.id, AUTORIG_PROFILE);
  } catch {
    return null;
  }
}

let checklist: typeof rigChecklist | null = null;
let checklistLoad: Promise<void> | null = null;

/** Loads the checklist chunk once (a failed load is retried by the next call); resolves when it is there. */
export function loadChecklist(): Promise<void> {
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
export const checklistLoaded = (): boolean => checklist !== null;

/**
 * `autoRigProgress(app, session)` (§4.3): reads the document, the Validation rows and the session. Until
 * `loadChecklist()` resolved, a subject character's skeleton and binding read as unknown.
 */
export const autoRigProgress: AutoRigProgressFn = (app, session) => {
  const { character } = resolveSubject(app.store, session.subject);
  return progressOf({
    view: app.store,
    subject: session.subject,
    rows: subjectRows(app, character),
    animationsSkipped: session.animations.skipped,
    checklist,
  });
};

/** The step a request lands on: the step itself when reachable, else the furthest reachable one (§3.1 `?step=`). */
export function landingStep(progress: AutoRigProgress, requested: AutoRigStep): AutoRigStep {
  if (progress.reachable[requested]) return requested;
  let furthest: AutoRigStep = 'model';
  for (const step of AUTORIG_STEPS) if (progress.reachable[step]) furthest = step;
  return furthest;
}
