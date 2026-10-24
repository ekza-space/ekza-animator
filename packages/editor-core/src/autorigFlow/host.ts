// The host an Auto-Rig flow runs in (STUDIO-TOUCH-SPEC §20.3 item 10, T5b; AUTORIG-SPEC §4.1, §4.3). The flow is the
// orchestration both shells run — the Auto-Rig wizard and Halo's Rig recipes — so that they issue the same operator
// sequence for the same model (AS-ST-5): it never writes the document itself (every change is an operator run, ADR 0021
// rule 2), never shows anything (strings, dialogs and steps stay the shell's) and keeps its U state in a small store the
// shell provides (the wizard maps it onto its session and slices; Halo onto its own session, a test onto memory).
//
// Two funnels, because the shells show failures differently: `run` is an operator the person asked for (a file, a fix,
// a download: the wizard's `ctx.run` toasts its failure), `quiet` is the flow's bookkeeping (a workspace switch, Quick
// Rig, the bind of ③, a preview: no toast). Headless both are `app.runUntyped`. The operator log (`./log`) wraps both.
import type { MeshId } from '@ekza-studio/doc';
import type {
  AutoRigPoseClass,
  AutoRigSubject,
  EditorApp,
  IntakeReport,
  OperatorResult,
  WorkspaceId,
} from '../types';

/** One operator run through a funnel. */
export type AutoRigFlowRun = (op: string, args?: unknown) => Promise<OperatorResult<unknown>>;

/** AR-R4-3: the last *Straighten to T-Pose*: the straightened points' key and the torn length in heights. */
export interface AutoRigStraightened {
  readonly key: string;
  readonly ratio: number;
}

/**
 * The flow's U state (never in the document, never an undo step; AUTORIG-SPEC §4.3). The wizard keeps these fields in
 * its session (`subject`, `intake`, `startPose`), its `model` slice (`parts`), its `rig` slice (`rigidParts`,
 * `paintedSinceBind`, `straightened`) and ③'s view state (`boundKey`).
 */
export interface AutoRigFlowState {
  readonly subject: AutoRigSubject;
  readonly intake: IntakeReport | null;
  /** The input's pose, recorded once per subject (§4.3): `autorig.rig` straightens only when it says 'a'. */
  readonly startPose: AutoRigPoseClass | null;
  /** The ticked parts of a multi-mesh model (§6.1); null = every mesh of the intake. */
  readonly parts: readonly MeshId[] | null;
  /** AR-R4-5 *Separate parts move rigidly*: null until chosen (on for a multi-part subject). */
  readonly rigidParts: boolean | null;
  /** A `skin.weights.*` run finished since the last bind (`./painted`). */
  readonly paintedSinceBind: boolean;
  readonly straightened: AutoRigStraightened | null;
  /** AR-D8-8: the bound meshes' revisions the flow's own bind wrote (`weightsKey`), or null. */
  readonly boundKey: string | null;
}

/** Where the flow keeps its U state. */
export interface AutoRigFlowStore {
  get(): AutoRigFlowState;
  set(patch: Partial<AutoRigFlowState>): void;
  /** A new subject: every field back to its default, then `subject` (§4.3: the start pose once per subject). */
  resetSubject(subject: AutoRigSubject): void;
}

export interface AutoRigFlowHost {
  readonly app: EditorApp;
  readonly state: AutoRigFlowStore;
  /** An operator the person asked for: the shell shows its failure. */
  readonly run: AutoRigFlowRun;
  /** The flow's bookkeeping: no toast. */
  readonly quiet: AutoRigFlowRun;
}

/** A fresh flow state: no subject, no intake, no start pose, nothing chosen. */
export function defaultAutoRigFlowState(subject: AutoRigSubject = { character: null, meshes: [] }): AutoRigFlowState {
  return {
    subject,
    intake: null,
    startPose: null,
    parts: null,
    rigidParts: null,
    paintedSinceBind: false,
    straightened: null,
    boundKey: null,
  };
}

/** A flow store in memory (headless runs, tests; a shell without a session of its own). */
export function memoryAutoRigFlowStore(initial: AutoRigFlowState = defaultAutoRigFlowState()): AutoRigFlowStore {
  let state = initial;
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
    },
    resetSubject(subject) {
      state = defaultAutoRigFlowState(subject);
    },
  };
}

/** A host over an app: both funnels `app.runUntyped` unless the shell gives its own. */
export function autoRigFlowHost(
  app: EditorApp,
  state: AutoRigFlowStore = memoryAutoRigFlowStore(),
  runs: { readonly run?: AutoRigFlowRun; readonly quiet?: AutoRigFlowRun } = {},
): AutoRigFlowHost {
  const untyped: AutoRigFlowRun = (op, args) => app.runUntyped(op, args);
  return { app, state, run: runs.run ?? untyped, quiet: runs.quiet ?? untyped };
}

/** The message of a run that did not finish. */
export const runMessage = (result: Exclude<OperatorResult<unknown>, { status: 'finished' }>): string =>
  result.status === 'failed' ? result.error.message : result.reason;

/**
 * A bookkeeping run of an operator that may not be registered yet (it is skipped then); a throw counts as not
 * finished. The wizard's `quiet` (AUTORIG-SPEC §4.2).
 */
export async function quietRun(host: AutoRigFlowHost, op: string, args?: unknown): Promise<boolean> {
  if (host.app.operators.get(op) === undefined) return false;
  try {
    return (await host.quiet(op, args)).status === 'finished';
  } catch {
    return false;
  }
}

/** Switches to `workspace` when the app is elsewhere (Rig & Skin loads the rig-workspace chunk, §4.2). */
export async function enterFlowWorkspace(host: AutoRigFlowHost, workspace: WorkspaceId): Promise<void> {
  if (host.app.session.getState().workspace !== workspace) await quietRun(host, 'workspace.set', { workspace });
}

/** ①–③ and ⑤ work in Rig & Skin (§4.2): the first file or sample switches there and loads the rig chunk. */
export const enterRigWorkspace = (host: AutoRigFlowHost): Promise<void> => enterFlowWorkspace(host, 'rig');
