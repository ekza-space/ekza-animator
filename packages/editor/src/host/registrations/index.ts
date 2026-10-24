// The host's registrations (STUDIO-TOUCH-SPEC §20.3 items 7 and 12, §16.1; T3): what every shell needs from the page
// and only the Studio shell registered before Halo — so it exists with Pro unmounted (on `/app`, on `/autorig`, and
// after a switch away from Pro on the same page). Registered once per app (idempotent: ids already registered are left
// alone) and kept until the host goes, never with a shell. The eager part is this file and `./recovery`; the rest is
// one lazy chunk loaded at once (`./parts`): the view operators (`view.selectionMask`, `view.toggleFullscreen`), the UI
// wrappers at idle, and per workspace on its first entry Model's marking-menu definitions (modes, convert, options,
// spaces, tools, primitives, merge) and Rig & Skin's menu items, `rig.modes`, `rig.snap.projectedCenter` and
// `rig.jointSize.set`. The Recovery prompt's timing is the host's too (`./recovery`); each shell provides how it
// offers the slots. Pro-only UI (pane overlays, status-line groups, dock tabs, the Rig & Skin view-only rule
// `watchRigViewOnly`) stays in the Studio shell.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { EditorParams } from '../../test-api/params';
import { watchRecovery } from './recovery';

export { provideRecoveryHook, type RecoveryHook } from './recovery';

/** Starts the host's registrations of `app`; the disposer removes everything registered and stops the prompt. */
export function startHostRegistrations(app: EditorApp, params: Pick<EditorParams, 'handoff'>): Disposer {
  // A page that received a handoff record never offers its autosave slots (the document came from another tab).
  const stopRecovery = watchRecovery(app, params.handoff !== null);
  let stop: Disposer | null = null;
  let loading = false;
  let disposed = false;
  const load = (): void => {
    if (loading || stop !== null) return;
    loading = true;
    import('./parts').then(
      (parts) => {
        if (!disposed) stop = parts.start(app);
      },
      // Offline after a redeploy: tried again at the next session change.
      () => {
        loading = false;
      },
    );
  };
  load();
  const off = app.session.subscribe(load);
  return () => {
    disposed = true;
    off();
    stop?.();
    stopRecovery();
  };
}
