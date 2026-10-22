// The shell's side of autosave and crash recovery (M2A-SPEC §5.20): starts the kernel's autosave controller when the
// host provides an autosave store (`EditorServices.autosave` present: the browser services), opens the Recovery
// dialog once per page load when orphaned slots exist (after the first-run dialog; on the shared `(studio)` page the
// Studio shell asks, `promptRecovery`, AUTORIG-SPEC §4.4), and removes this page's snapshot on `beforeunload` while
// the project is not dirty (best effort).
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, type OperatorResult, startAutosave } from '@ekza-studio/editor-core';

export interface ShellAutosaveOptions {
  readonly app: EditorApp;
  readonly runFromUi: (op: string, args?: unknown) => Promise<OperatorResult<unknown>>;
  /** The window to listen on for `beforeunload` (default: the global one, when there is one). */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** Opens the Recovery dialog by itself (default true). The page's host passes false: the prompt is the Studio
   *  shell's (`promptRecovery`), Auto-Rig shows its own card instead (AUTORIG-SPEC §4.4). */
  readonly prompt?: boolean;
}

/** Apps whose page has prompted (or decided not to): once per page load, whichever shell mounts first or again. */
const prompted = new WeakSet<EditorApp>();

/**
 * Opens the Recovery dialog once per page load when orphaned slots exist (after the first-run dialog); "Later" (or
 * Esc) keeps the slots for File › Recover…. `skip` marks the page as prompted without asking (a handoff page).
 * `firstRun: false`: this page opens no first-run dialog (a `from=autorig` page, AR-D8-6), so the prompt does not
 * wait for it (AR-D9-2: a reload after a hand-over still offers the autosave).
 */
export function promptRecovery(
  opts: Omit<ShellAutosaveOptions, 'target' | 'prompt'> & { readonly skip?: boolean; readonly firstRun?: boolean },
): Disposer {
  const { app } = opts;
  if (app.services.autosave === undefined) return () => {};
  if (opts.skip === true) prompted.add(app);
  const maybePrompt = (): void => {
    if (prompted.has(app)) return;
    const session = app.session.getState();
    if (session.recovery.length === 0 || session.dialog !== null) return;
    if (opts.firstRun !== false && !app.prefs.getState().firstRunDone) return;
    prompted.add(app);
    void opts.runFromUi('ui.open', { dialog: 'recovery' });
  };
  const offSession = app.session.subscribe((state, previous) => {
    if (state.recovery !== previous.recovery || state.dialog !== previous.dialog) maybePrompt();
  });
  const offPrefs = app.prefs.subscribe((state, previous) => {
    if (state.firstRunDone !== previous.firstRunDone) maybePrompt();
  });
  maybePrompt();
  return () => {
    offSession();
    offPrefs();
  };
}

export function startShellAutosave(opts: ShellAutosaveOptions): Disposer {
  const { app } = opts;
  // Fakes and Node hosts leave the field out: no autosave, no "storage blocked" notice.
  if (app.services.autosave === undefined) return () => {};
  const controller = startAutosave(app);
  const disposers: Disposer[] = [() => controller.dispose()];
  if (opts.prompt !== false) disposers.push(promptRecovery(opts));

  const target = opts.target === undefined ? (typeof window === 'undefined' ? null : window) : opts.target;
  if (target !== null) {
    const onBeforeUnload = (): void => {
      if (!app.session.getState().dirty) void controller.clean().catch(() => {});
    };
    target.addEventListener('beforeunload', onBeforeUnload);
    disposers.push(() => target.removeEventListener('beforeunload', onBeforeUnload));
  }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
