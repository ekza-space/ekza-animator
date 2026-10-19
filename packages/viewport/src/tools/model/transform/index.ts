// Model's transform runtime, eager part (M6A-SPEC §5.15; B12a): it loads, once per viewport, the lazy runtime
// (`./runtime`: component and object drags, the MMB rule, Tweak, snapping, pivots, the soft-select radius and overlay)
// when the Model workspace is entered. Until it has loaded the move/rotate/scale tools behave as in Animate (presses
// select; no component manipulator shows).
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp } from '@ekza-animator/editor-core';
import type { ViewportManager } from '../../../manager/ViewportManager';
import type { ModelTransformRuntime } from './runtime';

export type { ModelTransformBehaviour, ModelTransformRuntime, TransformToolId } from './runtime';

/** The codes the transform tools always receive first (§4.6 `ToolDef.keys`): `X`, `V`, `J`, `D`, `B`. */
export const TRANSFORM_TOOL_KEYS: readonly string[] = ['KeyX', 'KeyV', 'KeyJ', 'KeyD', 'KeyB'];

const runtimes = new WeakMap<EditorApp, ModelTransformRuntime>();
const waiting = new WeakMap<EditorApp, Set<(runtime: ModelTransformRuntime | null) => void>>();

/** The app's loaded transform runtime, or null (not in Model yet, or still loading). */
export function modelTransformOf(app: EditorApp): ModelTransformRuntime | null {
  return runtimes.get(app) ?? null;
}

/** Calls `listener` when the app's runtime loads or goes away; the disposer stops listening. */
export function subscribeModelTransform(
  app: EditorApp,
  listener: (runtime: ModelTransformRuntime | null) => void,
): Disposer {
  let set = waiting.get(app);
  if (set === undefined) {
    set = new Set();
    waiting.set(app, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function announce(app: EditorApp, runtime: ModelTransformRuntime | null): void {
  for (const listener of Array.from(waiting.get(app) ?? [])) listener(runtime);
}

/**
 * Attaches the runtime to a viewport (called where the viewport registers its tools): it loads when the Model
 * workspace is entered; a failed load is retried on the next entry.
 */
export function attachModelTransform(app: EditorApp, vm: ViewportManager): Disposer {
  let disposed = false;
  let runtime: ModelTransformRuntime | null = null;
  let loading = false;
  const load = (): void => {
    if (disposed || loading || runtime !== null || app.session.getState().workspace !== 'model') return;
    loading = true;
    import('./runtime')
      .then((module) => module.createModelTransformRuntime(app, vm))
      .then(
        (loaded) => {
          loading = false;
          if (disposed) {
            loaded.dispose();
            return;
          }
          runtime = loaded;
          runtimes.set(app, loaded);
          announce(app, loaded);
        },
        (error: unknown) => {
          loading = false;
          console.error('Ekza Animator: the Model transform runtime could not load', error);
        },
      );
  };
  const offSession = app.session.subscribe((state, previous) => {
    if (state.workspace !== previous.workspace) load();
  });
  load();
  return () => {
    disposed = true;
    offSession();
    if (runtime !== null) {
      runtime.dispose();
      if (runtimes.get(app) === runtime) runtimes.delete(app);
      announce(app, null);
    }
    runtime = null;
  };
}
