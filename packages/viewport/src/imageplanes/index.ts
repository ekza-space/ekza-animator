// Reference image planes, the eager half (M6A-SPEC §5.26; B13): a document subscription that loads the binding chunk
// (`./binding`: decode, hand the planes to the viewport) once the project has a plane. A project without reference
// images never loads it. A failed chunk load is reported once and tried again on the next plane change.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import type * as BindingChunk from './binding';
import type { ImageDecoder, ImagePlaneBinding, ImagePlaneTarget } from './binding';

export type { ImageDecoder, ImagePlaneTarget } from './binding';

export function attachImagePlanes(
  app: EditorApp,
  target: ImagePlaneTarget,
  opts?: {
    readonly decode?: ImageDecoder;
    readonly importBinding?: () => Promise<typeof BindingChunk>;
  },
): Disposer {
  let binding: ImagePlaneBinding | null = null;
  let loading = false;
  let disposed = false;
  let reported = false;
  const importBinding = opts?.importBinding ?? (() => import('./binding'));
  const load = (): void => {
    if (binding !== null || loading || disposed || app.store.list('imagePlanes').length === 0) return;
    loading = true;
    importBinding().then(
      (module) => {
        loading = false;
        if (disposed) return;
        binding = new module.ImagePlaneBinding(app, target, opts?.decode);
      },
      (error: unknown) => {
        loading = false;
        if (reported || disposed) return;
        reported = true;
        app.services.notify.toast({
          kind: 'error',
          text: `Reference images could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        });
      },
    );
  };
  const unsubscribe = app.store.subscribe((batch) => {
    if (binding === null && batch.changes.some((change) => change.table === 'imagePlanes')) load();
  });
  load();
  return () => {
    disposed = true;
    unsubscribe();
    binding?.dispose();
    binding = null;
  };
}
