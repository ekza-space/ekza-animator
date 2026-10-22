// Contract of the Auto-Rig shell (AUTORIG-SPEC §4.3; D0, frozen when D0 merges): the wizard's U state (never in the
// document, never an undo step), one slice per step owned by that step's package, and the derived progress. The types
// the operator contract shares (`AutoRigStep`, `AutoRigSubject`, `IntakeReport`, `ClipParams`, the pose class) live
// in `editor-core` (`OperatorMap` rows need them; editor-core never imports this package) and are re-exported here.
import type { ClipId, MeshId } from '@ekza-studio/doc';
import type {
  AutoRigExportTarget,
  AutoRigPoseClass,
  AutoRigStep,
  AutoRigSubject,
  ClipParams,
  EditorApp,
  IntakeReport,
} from '@ekza-studio/editor-core';

export type { AutoRigExportTarget, AutoRigPoseClass, AutoRigStep, AutoRigSubject, ClipParams, IntakeReport };

/** `check-size` marker of the Auto-Rig shell entry (§7.2): the `autorig-shell` boundary on `/editor`, initial on `/autorig`. */
export const AUTORIG_SHELL_MARKER = 'ekza-autorig-shell' as const;

/** The wizard steps in order (§5). */
export const AUTORIG_STEPS: readonly AutoRigStep[] = ['model', 'markers', 'rig', 'animations', 'export'];

/** Stages of a running composition (§5.4 progress sheet). */
export type AutoRigStage = 'import' | 'skeleton' | 'skin' | 'straighten' | 'check' | 'export';

/** ① Model slice (D3): the ticked parts of a multi-mesh model (null = every visible mesh), the heavy-model confirm. */
export interface AutoRigModelSlice {
  readonly parts: readonly MeshId[] | null;
  readonly heavyConfirmed: boolean;
}
/** ② Markers slice (D4): the pane the keyboard nudges act in, and the last ortho pane used. */
export interface AutoRigMarkersSlice {
  readonly pane: 'front' | 'side' | 'persp';
  readonly lastOrtho: 'front' | 'side';
}
/** ③ Rig slice (D4). */
export interface AutoRigRigSlice {
  readonly sub: 'review' | 'adjust' | 'paint';
  readonly motionTest: boolean; // plays the motion test while true (default on)
  readonly motionClip: string; // library clip id or 'rom'
  /** Set (D4) when a `skin.weights.*` run finishes with a history step; cleared when a `skin.bind` does. Fed by the
   *  registry's `onBeforeDocumentRun` hook confirmed by the history's last step id changing; never derived from
   *  `session.lastRun`. Conservative: an undone stroke still counts. */
  readonly paintedSinceBind: boolean;
  /** AR-R4-5: *Separate parts move rigidly* — null until chosen: on for a multi-part subject, off for one mesh. */
  readonly rigidParts: boolean | null;
  /** AR-R4-3: the last *Straighten to T-Pose* of the subject: the straightened points' key and the longest edge's
   *  stretch; null before one. ③ warns while the stretch is over `STRETCH_LIMIT` and the points still have that key. */
  readonly straightened: { readonly key: string; readonly ratio: number } | null;
}
/** ④ Animations slice (D5). */
export interface AutoRigAnimationsSlice {
  readonly draft: Readonly<Record<string, ClipParams>>; // parameters per library clip id, before Add
  readonly skipped: boolean; // the user pressed Skip (④ done without clips)
  readonly editing: ClipId | null;
}
/** ⑤ Export slice (D6). */
export interface AutoRigExportSlice {
  readonly target: AutoRigExportTarget;
  readonly downloaded: boolean;
}

/** The slices by name: `session/` (D3) stores and mirrors them generically (`patch(slice, partial)`). */
export interface AutoRigSlices {
  readonly model: AutoRigModelSlice;
  readonly markers: AutoRigMarkersSlice;
  readonly rig: AutoRigRigSlice;
  readonly animations: AutoRigAnimationsSlice;
  readonly export: AutoRigExportSlice;
}
export type AutoRigSliceName = keyof AutoRigSlices;

export interface AutoRigSession extends AutoRigSlices {
  readonly step: AutoRigStep;
  readonly subject: AutoRigSubject;
  readonly intake: IntakeReport | null;
  /** The input's pose, recorded once per subject: from `intake.pose` (①), or — for a subject that skipped intake
   *  (From Studio) — from the guess's `armAngle` when ② starts Quick Rig. `autorig.rig` straightens only when this
   *  says 'a' (§4.5, AR-D3). Never recomputed from the rigged document. */
  readonly startPose: AutoRigPoseClass | null;
  /** Per-shell navigation override (§8.1): 'simple' while the Auto-Rig shell is mounted; the persisted `navProfile`
   *  preference is never written by Auto-Rig. */
  readonly nav: 'simple' | null;
  /** Stage of the running composition; `fraction` mirrors `session.busy.progress`, null = indeterminate. */
  readonly busy: { readonly stage: AutoRigStage; readonly fraction: number | null } | null;
}

export interface AutoRigProgress {
  // pure function of the document, the C7 checklist and the session
  readonly done: Readonly<Record<AutoRigStep, boolean>>;
  readonly reachable: Readonly<Record<AutoRigStep, boolean>>;
  readonly blocked: Readonly<Partial<Record<AutoRigStep, string>>>; // why a step is not reachable
}

/** `autoRigProgress(app, session)` (§4.3; implemented by D3 in `progress/`). */
export type AutoRigProgressFn = (app: EditorApp, session: AutoRigSession) => AutoRigProgress;

/** The `sessionStorage` key of the session mirror (§4.3; try/catch, skipped when storage is blocked). */
export const AUTORIG_SESSION_KEY = 'ekza-studio:autorig:v1';
