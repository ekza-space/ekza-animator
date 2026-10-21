// `app.library` (M6B-SPEC §0.5; C0 shell, then C12): loads the lazy clip-library chunk once per app and forwards the
// service's calls to the chunk's service (the manifest and the bytes load the chunk first). Eager and tiny.
import type { Disposer } from '@ekza-studio/anim-core';
import type { StarterPackManifest } from '@ekza-studio/io';
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
  let detach: Disposer | null = null;
  const listeners = new Set<() => void>();
  const load = (): Promise<void> => {
    loading ??= import('../../library').then((chunk) => {
      const attached = chunk.attachClipLibrary(app());
      loaded = attached.service;
      detach = attached.dispose;
      for (const listener of Array.from(listeners)) listener();
    });
    return loading;
  };
  const service: ClipLibraryService = {
    manifest: (): Promise<StarterPackManifest> => load().then(() => (loaded as ClipLibraryService).manifest()),
    bytes: (clip: string): Promise<Uint8Array> => load().then(() => (loaded as ClipLibraryService).bytes(clip)),
    get preview() {
      return loaded?.preview ?? null;
    },
    subscribe(listener: () => void): Disposer {
      listeners.add(listener);
      const inner = loaded?.subscribe(listener) ?? null;
      return () => {
        listeners.delete(listener);
        inner?.();
      };
    },
  };
  return {
    service,
    load,
    get loaded() {
      return loaded !== null;
    },
    dispose(): void {
      detach?.();
      listeners.clear();
    },
  };
}
