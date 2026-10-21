// The clip-library chunk's entry (M6B-SPEC §0.4.7, §0.4.9; C0 stub, then C12): the library operators, the
// `ClipLibraryService` and (C12) the preview provider. `CLIP_LIBRARY_MARKER` is the check-size marker of the
// `clip-library` boundary (≤ 60 kB gzip, never in the initial route); io's readers load only through the shipped import
// chunk (`workflows/importLoader`), never statically from here.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { StarterPackManifest } from '@ekza-studio/io';
import { LIBRARY_OPERATORS } from '../operators/builtin/library';
import type { ClipLibraryService, EditorApp } from '../types';

/** `check-size` marker of the clip-library chunk (§0.4.9). */
export const CLIP_LIBRARY_MARKER = 'ekza-clip-library' as const;

/** The service until C12 lands it: no manifest, no bytes, no preview. */
export function createClipLibraryService(_app: EditorApp): ClipLibraryService {
  return {
    manifest: (): Promise<StarterPackManifest> =>
      Promise.reject(new EkzaError('not-implemented', 'editor-core.ClipLibraryService.manifest')),
    bytes: (): Promise<Uint8Array> =>
      Promise.reject(new EkzaError('not-implemented', 'editor-core.ClipLibraryService.bytes')),
    preview: null,
    subscribe: (): Disposer => () => {},
  };
}

/** Registers the chunk's operators this app does not have yet; returns the chunk's service for the app. */
export function attachClipLibrary(app: EditorApp): {
  readonly service: ClipLibraryService;
  readonly dispose: Disposer;
} {
  if (typeof CLIP_LIBRARY_MARKER !== 'string') throw new Error('clip-library chunk without its marker');
  const disposers: Disposer[] = [];
  for (const def of LIBRARY_OPERATORS) {
    if (app.operators.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'operator', def }));
  }
  return {
    service: createClipLibraryService(app),
    dispose: () => {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}
