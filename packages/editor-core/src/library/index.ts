// The clip-library chunk's entry (M6B-SPEC §0.4.7, §0.4.9; C0 stub, C12): the library operators, the
// `ClipLibraryService` (manifest, verified bytes, the preview and its stop rules) and the 'preview' channel source.
// `CLIP_LIBRARY_MARKER` is the check-size marker of the `clip-library` boundary (≤ 60 kB gzip, never in the initial
// route); io's readers load only through the shipped import chunk (`workflows/importLoader`), never statically from
// here (`library/convert.ts`).
import type { Disposer } from '@ekza-studio/anim-core';
import { LIBRARY_OPERATORS } from '../operators/builtin/library';
import type { ClipLibraryService, EditorApp } from '../types';
import { ClipLibrary, type ClipLibraryOptions } from './service';

export { CHECKSUM_FAILED, ClipLibrary, clipLibraryOf, NO_PREVIEW } from './service';

/** `check-size` marker of the clip-library chunk (§0.4.9). */
export const CLIP_LIBRARY_MARKER = 'ekza-clip-library' as const;

/** The app's clip library service (one per app; the chunk's `attachClipLibrary` creates it). */
export function createClipLibraryService(app: EditorApp, opts?: ClipLibraryOptions): ClipLibraryService {
  return new ClipLibrary(app, opts);
}

/** Registers the chunk's operators this app does not have yet; returns the chunk's service for the app. */
export function attachClipLibrary(
  app: EditorApp,
  opts?: ClipLibraryOptions,
): {
  readonly service: ClipLibraryService;
  readonly dispose: Disposer;
} {
  if (typeof CLIP_LIBRARY_MARKER !== 'string') throw new Error('clip-library chunk without its marker');
  const disposers: Disposer[] = [];
  for (const def of LIBRARY_OPERATORS) {
    if (app.operators.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'operator', def }));
  }
  const library = new ClipLibrary(app, opts);
  return {
    service: library,
    dispose: () => {
      library.dispose();
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}
