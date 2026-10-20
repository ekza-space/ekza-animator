// Template guides, the eager half (M6A-SPEC §5.16; B13): loads the drawing chunk (`./draw`) once a humanoid or
// handheld template group exists and the Model workspace is open; projects without templates never load it. A failed
// chunk load is reported once and tried again on the next template or workspace change.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp } from '@ekza-animator/editor-core';
import type * as DrawChunk from './draw';
import type { GuideLayer, GuideTarget } from './draw';

export type { GuideTarget } from './draw';
export { GUIDE_LEVELS, GUIDE_LINES, humanoidGuideLevels } from './levels';

const hasTemplates = (app: EditorApp): boolean =>
  app.session.getState().workspace === 'model' &&
  app.store.list('groups').some((group) => group.template?.kind === 'humanoid' || group.template?.kind === 'handheld');

/** The app's guide layer once loaded (tests and the e2e probe). */
const layers = new WeakMap<EditorApp, GuideLayer>();

export function guideLayerOf(app: EditorApp): GuideLayer | null {
  return layers.get(app) ?? null;
}

export function attachGuides(
  app: EditorApp,
  target: GuideTarget,
  opts?: { readonly importDraw?: () => Promise<typeof DrawChunk> },
): Disposer {
  let layer: GuideLayer | null = null;
  let loading = false;
  let disposed = false;
  let reported = false;
  const importDraw = opts?.importDraw ?? (() => import('./draw'));
  const load = (): void => {
    if (layer !== null || loading || disposed || !hasTemplates(app)) return;
    loading = true;
    importDraw().then(
      (module) => {
        loading = false;
        if (disposed) return;
        layer = new module.GuideLayer(app, target);
        layers.set(app, layer);
      },
      (error: unknown) => {
        loading = false;
        if (reported || disposed) return;
        reported = true;
        app.services.notify.toast({
          kind: 'error',
          text: `Template guides could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        });
      },
    );
  };
  const disposers = [
    app.store.subscribe((batch) => {
      if (layer === null && batch.changes.some((change) => change.table === 'groups')) load();
    }),
    app.session.subscribe((state, previous) => {
      if (layer === null && state.workspace !== previous.workspace) load();
    }),
  ];
  load();
  return () => {
    disposed = true;
    for (const dispose of disposers) dispose();
    layer?.dispose();
    if (layer !== null && layers.get(app) === layer) layers.delete(app);
    layer = null;
  };
}
