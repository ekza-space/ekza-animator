// The clip-library chunk's entry (M6B-SPEC §0.4.7, §0.4.9; C0 stub, C12): the library operators, the
// `ClipLibraryService` (manifest, verified bytes, the preview and its stop rules) and the 'preview' channel source.
// `CLIP_LIBRARY_MARKER` is the check-size marker of the `clip-library` boundary (≤ 60 kB gzip, never in the initial
// route); io's readers load only through the shipped import chunk (`workflows/importLoader`), never statically from
// here (`library/convert.ts`).
import type { Disposer } from '@ekza-studio/anim-core';
import type { ChangeBatch, CharacterId, ClipId, DocumentStore } from '@ekza-studio/doc';
import { LIBRARY_OPERATORS } from '../operators/builtin/library';
import type { ClipLibraryService, EditorApp } from '../types';
import { ClipLibrary, type ClipLibraryOptions } from './service';

export { CHECKSUM_FAILED, ClipLibrary, clipLibraryOf, NO_PREVIEW } from './service';

/**
 * The clips a redo brought back, as the active clip of their character (the first in the character's clip order):
 * Use Clip activates its clip in `apply`, which redo does not run, and the session repair keeps whatever clip is still
 * valid, so redo left the earlier clip active (M6b acceptance fix M6B-AF-11). Watched while the clip-library chunk is
 * loaded, which every Use Clip loads.
 */
function revivedClips(store: DocumentStore, batch: ChangeBatch): Record<CharacterId, ClipId> | null {
  const revived = new Set<string>();
  for (const change of batch.changes) {
    if (change.table !== 'clips' || change.after === undefined || change.after.deleted !== null) continue;
    if (change.before === undefined || change.before.deleted !== null) revived.add(change.id);
  }
  if (revived.size === 0) return null;
  const out: Record<CharacterId, ClipId> = {};
  for (const id of revived) {
    const clip = store.get('clips', id as ClipId);
    if (clip === undefined || out[clip.character] !== undefined) continue;
    const first = store.query.clipsOfCharacter(clip.character).find((other) => revived.has(other.id));
    if (first !== undefined) out[clip.character] = first.id;
  }
  return Object.keys(out).length === 0 ? null : out;
}

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
  disposers.push(
    app.store.subscribe((batch) => {
      if (batch.origin !== 'redo') return;
      const revived = revivedClips(app.store, batch);
      if (revived !== null) app.session.setState({ activeClip: { ...app.session.getState().activeClip, ...revived } });
    }),
  );
  return {
    service: library,
    dispose: () => {
      library.dispose();
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}
