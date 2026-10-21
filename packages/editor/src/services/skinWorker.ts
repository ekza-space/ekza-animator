// The host side of the skin worker `../workers/skin.worker.ts` (M6B-SPEC §2.1, §5.9; C4): tells `app.rig.skin` how to
// create the worker (`SkinWorkerHost.skinWorker`, read on the first bind). Eager and tiny: the worker's code is its own
// lazy entry, which only `new Worker(new URL(…))` references, so neither the solvers nor the rig-workspace chunk enter
// the route (and the worker's check-size marker never appears here).
import type { EditorApp, SkinWorkerHost, SkinWorkerPort } from '@ekza-studio/editor-core';

/** Lets the app's skin service run its binds in a module worker (when the browser has workers). */
export function installSkinWorker(app: EditorApp): void {
  if (typeof Worker === 'undefined') return;
  (app.rig as unknown as SkinWorkerHost).skinWorker = () =>
    new Worker(new URL('../workers/skin.worker.ts', import.meta.url), {
      type: 'module',
      name: 'skin',
    }) as unknown as SkinWorkerPort;
}
