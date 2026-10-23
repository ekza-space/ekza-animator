// Step entry (AUTORIG-SPEC §4.2; D3). Entering a step runs, in order: stop any library preview (`library.stop`), end
// any tool session (Quick Rig is cancelled unless the step is ②; the shipped Esc semantics, `edit.escape`),
// `workspace.set` when the workspace differs, `rig.mode` when the mode differs, then the step's own start (its
// package's `stepEnter`, e.g. ②'s `skel.quickRig.start`). Every run is U state (no undo step); leaving Rig & Skin
// drops test poses and closes Quick Rig, as in Studio. ① with no model yet stays where it is: the rig-workspace chunk
// loads with the first file or sample (§7.2 per-step loads), which switches to Rig & Skin first.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { AutoRigStep } from '../types';
import type { WizardContext } from './context';
import { STEP_MODE, STEP_WORKSPACE, stepModule } from './steps';

/** Runs an operator for the wizard's own bookkeeping: no toast, no help line; unregistered ids are skipped. */
export async function quiet(app: EditorApp, op: string, args?: unknown): Promise<boolean> {
  if (app.operators.get(op) === undefined) return false;
  try {
    return (await app.runUntyped(op, args)).status === 'finished';
  } catch {
    return false;
  }
}

/** Stops the library preview and ends the tool session (the leaving half of §4.2; also the shell's `leave()`). */
export async function endSessions(app: EditorApp, keepQuickRig: boolean): Promise<void> {
  if (app.library.loaded && app.library.service.preview !== null) await quiet(app, 'library.stop');
  if (!keepQuickRig && app.session.getState().rig.quickRig !== null) await quiet(app, 'skel.quickRig.cancel');
  await quiet(app, 'edit.escape');
}

/** Switches to the step's workspace (and loads the rig-workspace chunk with Rig & Skin). */
export async function enterWorkspace(app: EditorApp, step: AutoRigStep): Promise<void> {
  const workspace = STEP_WORKSPACE[step];
  if (app.session.getState().workspace !== workspace) await quiet(app, 'workspace.set', { workspace });
}

/**
 * §4.2's entry order for `step`; `hasModel` false keeps ① off the rig chunk until a model arrives. `current()` false
 * (a later step change superseded this entry) stops it before its next stage, so a superseded entry never runs its
 * workspace switch, mode or step start after the later step's.
 */
export async function enterStep(
  ctx: WizardContext,
  step: AutoRigStep,
  hasModel: boolean,
  current: () => boolean = () => true,
): Promise<void> {
  const { app } = ctx;
  await endSessions(app, step === 'markers');
  if (!current() || (step === 'model' && !hasModel)) return;
  await enterWorkspace(app, step);
  if (!current()) return;
  const mode = STEP_MODE[step];
  if (mode !== null && app.session.getState().workspace === 'rig' && app.session.getState().rig.mode !== mode) {
    await quiet(app, 'rig.mode', { mode });
  }
  if (!current()) return;
  await stepModule(step).stepEnter?.(ctx);
}

/**
 * Serializes step entries (§4.2): each entry runs after the previous one finished, and one superseded by a later
 * request before or while it runs stops at its next stage (`current()` false). Returns the request function; its
 * promise settles when that entry finished or was skipped (a failing entry does not block the next).
 */
export function entryQueue(): (run: (current: () => boolean) => Promise<void>) => Promise<void> {
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();
  return (run) => {
    generation += 1;
    const mine = generation;
    const current = (): boolean => mine === generation;
    tail = tail.then(() => (current() ? run(current) : undefined)).catch(() => {});
    return tail;
  };
}
