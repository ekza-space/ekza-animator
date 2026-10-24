// The shell's side of autosave and crash recovery (M2A-SPEC §5.20): starts the kernel's autosave controller when the
// host provides an autosave store (`EditorServices.autosave` present: the browser services) and removes this page's
// snapshot on `beforeunload` while the project is not dirty (best effort). The Recovery prompt — once per page load,
// when orphaned slots exist, after the first-run dialog — is a host registration since STUDIO-TOUCH-SPEC T3
// (`host/registrations/recovery.ts`): the page's host watches for it and the mounted shell provides how it offers the
// slots (Pro its Recovery dialog, Halo Home › Continue, Auto-Rig its own card). `promptRecovery` is both halves at
// once (a harness without a host).
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, type OperatorResult, startAutosave } from '@ekza-studio/editor-core';
import { provideRecoveryHook, watchRecovery } from '../host/registrations/recovery';

export interface ShellAutosaveOptions {
  readonly app: EditorApp;
  /** The window to listen on for `beforeunload` (default: the global one, when there is one). */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/**
 * Opens the Recovery dialog once per page load when orphaned slots exist (after the first-run dialog); "Later" (or
 * Esc) keeps the slots for File › Recover…. `skip` marks the page as prompted without asking (a handoff page).
 * `firstRun: false`: this page opens no first-run dialog (a `from=autorig` page, AR-D8-6), so the prompt does not
 * wait for it (AR-D9-2: a reload after a hand-over still offers the autosave).
 */
export function promptRecovery(opts: {
  readonly app: EditorApp;
  readonly runFromUi: (op: string, args?: unknown) => Promise<OperatorResult<unknown>>;
  readonly skip?: boolean;
  readonly firstRun?: boolean;
}): Disposer {
  const { app } = opts;
  if (app.services.autosave === undefined) return () => {};
  const withdraw = provideRecoveryHook(app, {
    firstRun: opts.firstRun !== false,
    offer: () => void opts.runFromUi('ui.open', { dialog: 'recovery' }),
  });
  const stop = watchRecovery(app, opts.skip === true);
  return () => {
    stop();
    withdraw();
  };
}

export function startShellAutosave(opts: ShellAutosaveOptions): Disposer {
  const { app } = opts;
  // Fakes and Node hosts leave the field out: no autosave, no "storage blocked" notice.
  if (app.services.autosave === undefined) return () => {};
  const controller = startAutosave(app);
  const disposers: Disposer[] = [() => controller.dispose()];

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
