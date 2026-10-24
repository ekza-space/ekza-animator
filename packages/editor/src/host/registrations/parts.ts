// The lazy body of the host's registrations (STUDIO-TOUCH-SPEC §20.3 items 7 and 12; T3): one chunk the host loads at
// once on every route (`./index.ts`). It registers the view operators now, Ekza Studio's public UI wrappers when the
// page is idle (T5a's `loadUiWrappers`, §20.3 item 7: Pro's search and Halo's surfaces list them; agents are denied
// them), and each workspace's part on its first entry — Model's marking menus (`./model`), Rig & Skin's menus, marking menu and settings (`./rig`) — each a chunk of
// its own. Everything is registered once per app and stays until the host goes.
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, loadUiWrappers } from '@ekza-studio/editor-core';
import { registerOnce } from './once';
import { viewOperatorDefs } from './view';

type WorkspacePart = 'model' | 'rig';

const WORKSPACE_PARTS: Readonly<Record<WorkspacePart, () => Promise<{ register(app: EditorApp): Disposer }>>> = {
  model: () => import('./model'),
  rig: () => import('./rig'),
};

/** Runs `run` when the page is idle (after a short timeout where `requestIdleCallback` is missing: Safari). */
function whenIdle(run: () => void): Disposer {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 3000 });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, 200);
  return () => clearTimeout(timer);
}

export function start(app: EditorApp): Disposer {
  let disposed = false;
  const disposers: Disposer[] = [
    registerOnce(
      app,
      viewOperatorDefs(app).map((def) => ({ kind: 'operator', def }) as const),
    ),
    // Registered once per app for good (T5a); a failed load is tried again by the next caller (Halo's prefetch).
    whenIdle(() => void loadUiWrappers(app).catch(() => {})),
  ];
  const started = new Set<WorkspacePart>();
  const load = (part: WorkspacePart): void => {
    if (started.has(part)) return;
    started.add(part);
    WORKSPACE_PARTS[part]().then(
      (module) => {
        if (!disposed) disposers.push(module.register(app));
      },
      // Offline after a redeploy: the part is missing until the next session change tries again.
      () => started.delete(part),
    );
  };
  const follow = (): void => {
    const { workspace } = app.session.getState();
    if (workspace === 'model') load('model');
    else if (workspace === 'rig') load('rig');
  };
  follow();
  disposers.push(app.session.subscribe(follow));
  return () => {
    disposed = true;
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
