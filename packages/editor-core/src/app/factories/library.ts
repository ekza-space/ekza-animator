// `app.library` (M6B-SPEC §0.5; C0 shell, then C12): loads the lazy clip-library chunk once per app and forwards the
// service's calls to the chunk's service. Eager and tiny (§0.4.9): the manifest, the bytes and a subscription load the
// chunk first; `preview` is null until it is loaded.
import type { Disposer } from '@ekza-studio/anim-core';
import type { ClipLibraryService, EditorApp } from '../../types';

export interface LibraryApi {
  readonly service: ClipLibraryService;
  load(): Promise<void>;
  readonly loaded: boolean;
  dispose(): void;
}

export function createLibrary(app: () => EditorApp): LibraryApi {
  let loaded: ClipLibraryService | null = null;
  let loading: Promise<void> | null = null;
  let detach: Disposer = () => {};
  const load = (): Promise<void> =>
    (loading ??= import('../../library').then((chunk) => {
      const attached = chunk.attachClipLibrary(app());
      loaded = attached.service;
      detach = attached.dispose;
    }));
  const later = <T>(call: (service: ClipLibraryService) => T | PromiseLike<T>): Promise<T> =>
    load().then(() => call(loaded as ClipLibraryService));
  return {
    service: {
      manifest: () => later((service) => service.manifest()),
      bytes: (clip) => later((service) => service.bytes(clip)),
      get preview() {
        return loaded?.preview ?? null;
      },
      subscribe(listener) {
        let off: Disposer | null = null;
        let live = true;
        void later((service) => {
          if (live) off = service.subscribe(listener);
        });
        return () => {
          live = false;
          off?.();
        };
      },
    },
    load,
    get loaded() {
      return loaded !== null;
    },
    dispose: () => detach(),
  };
}
