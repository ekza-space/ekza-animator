// The Recovery prompt as a host registration (M2A-SPEC §5.20; STUDIO-TOUCH-SPEC §20.3 item 12, J10; T3). The host
// decides *when* — once per page load, when orphaned autosave slots exist, no dialog is open, and after the first-run
// dialog of a shell that opens one; never on a page that received a handoff record — and the mounted shell decides
// *how*, through the hook it provides: Pro opens its Recovery dialog, Halo offers the slots on Home › Continue
// (no dialog, §17), Auto-Rig provides none and keeps its own card (AUTORIG-SPEC §4.4). While no shell provides a hook,
// nothing is offered; the slots stay for File › Recover… and a later shell's hook.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';

export interface RecoveryHook {
  /** This shell opens a first-run dialog on this page: the offer waits until it is done (`prefs.firstRunDone`). */
  readonly firstRun: boolean;
  /** Offers the orphaned slots (`session.recovery`): Pro opens the Recovery dialog; Halo shows Home › Continue. */
  offer(): void;
}

/** Apps whose page has offered its slots (or decided not to): once per page load, whichever shell is mounted. */
const prompted = new WeakSet<EditorApp>();
const hooks = new WeakMap<EditorApp, RecoveryHook>();
/** The host's check of each app (re-run when a shell provides its hook). */
const checks = new WeakMap<EditorApp, () => void>();

/** The mounted shell's hook (the latest one provided wins); the disposer withdraws it while it is still current. */
export function provideRecoveryHook(app: EditorApp, hook: RecoveryHook): Disposer {
  hooks.set(app, hook);
  checks.get(app)?.();
  return () => {
    if (hooks.get(app) === hook) hooks.delete(app);
  };
}

/**
 * The host's side, started once per page (`startHostRegistrations`): offers the slots through the current hook once
 * the conditions hold. `skip` marks the page as offered without asking (a page that received a handoff record: its
 * document came from another tab, not from a crash). Browser services only: a host without an autosave store (fakes,
 * Node) watches nothing.
 */
export function watchRecovery(app: EditorApp, skip: boolean): Disposer {
  if (app.services.autosave === undefined) return () => {};
  if (skip) prompted.add(app);
  const check = (): void => {
    const hook = hooks.get(app);
    if (hook === undefined || prompted.has(app)) return;
    const session = app.session.getState();
    if (session.recovery.length === 0 || session.dialog !== null) return;
    if (hook.firstRun && !app.prefs.getState().firstRunDone) return;
    prompted.add(app);
    hook.offer();
  };
  checks.set(app, check);
  const offSession = app.session.subscribe((state, previous) => {
    if (state.recovery !== previous.recovery || state.dialog !== previous.dialog) check();
  });
  const offPrefs = app.prefs.subscribe((state, previous) => {
    if (state.firstRunDone !== previous.firstRunDone) check();
  });
  check();
  return () => {
    offSession();
    offPrefs();
    if (checks.get(app) === check) checks.delete(app);
  };
}
