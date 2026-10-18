// The shell's side of autosave and crash recovery (M2A-SPEC §5.20): starts the kernel's autosave controller when the
// host provides an autosave store (`EditorServices.autosave` present: the browser services), opens the Recovery
// dialog once per page load when orphaned slots exist (after the first-run dialog), and removes this page's
// snapshot on `beforeunload` while the project is not dirty (best effort).
import type { Disposer } from '@ekza-animator/anim-core';
import { type EditorApp, type OperatorResult, startAutosave } from '@ekza-animator/editor-core';

export interface ShellAutosaveOptions {
  readonly app: EditorApp;
  readonly runFromUi: (op: string, args?: unknown) => Promise<OperatorResult<unknown>>;
  /** The window to listen on for `beforeunload` (default: the global one, when there is one). */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

export function startShellAutosave(opts: ShellAutosaveOptions): Disposer {
  const { app } = opts;
  // Fakes and Node hosts leave the field out: no autosave, no "storage blocked" notice.
  if (app.services.autosave === undefined) return () => {};
  const controller = startAutosave(app);
  const disposers: Disposer[] = [() => controller.dispose()];

  // The Recovery dialog opens by itself once per page load; "Later" (or Esc) keeps the slots for File › Recover….
  let prompted = false;
  const maybePrompt = (): void => {
    if (prompted) return;
    const session = app.session.getState();
    if (session.recovery.length === 0 || session.dialog !== null || !app.prefs.getState().firstRunDone) return;
    prompted = true;
    void opts.runFromUi('ui.open', { dialog: 'recovery' });
  };
  disposers.push(
    app.session.subscribe((state, previous) => {
      if (state.recovery !== previous.recovery || state.dialog !== previous.dialog) maybePrompt();
    }),
    app.prefs.subscribe((state, previous) => {
      if (state.firstRunDone !== previous.firstRunDone) maybePrompt();
    }),
  );

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
