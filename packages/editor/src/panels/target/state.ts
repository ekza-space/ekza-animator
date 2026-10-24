// The Target panel's loaders (CHARACTER-CONTRACT-SPEC §8.4; C1): the target chunk (loaded when the panel mounts, never
// with the route) and the contracts it offers, and re-render triggers on document and library changes. Part of the
// panel's lazy chunk.
import type { EditorApp, TargetKit } from '@ekza-studio/editor-core';
import { loadTargetKit } from '@ekza-studio/editor-core';
import type { ContractModel, StarterPackManifest } from '@ekza-studio/io';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** The games Studio bundles a contract for (CHARACTER-CONTRACT-SPEC §8.1). */
export const BUNDLED_GAMES: readonly string[] = ['omoba'];

type Load<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | {
      readonly status: 'error';
      readonly error: string;
    };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The target chunk, attached to `app` (loads it on first use). */
export function useTargetKit(app: EditorApp): Load<TargetKit> {
  const [state, setState] = useState<Load<TargetKit>>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    loadTargetKit(app).then(
      (kit) => live && setState({ status: 'ready', value: kit }),
      (error: unknown) => live && setState({ status: 'error', error: message(error) }),
    );
    return () => {
      live = false;
    };
  }, [app]);
  return state;
}

/** The latest bundled contract of a game (for the picker). */
export function useLatestContract(app: EditorApp, kit: TargetKit | null, game: string): Load<ContractModel> {
  const [state, setState] = useState<Load<ContractModel>>({ status: 'loading' });
  useEffect(() => {
    if (kit === null) return undefined;
    let live = true;
    kit
      .contractsOf(app)
      .latest(game)
      .then(
        (loaded) => live && setState({ status: 'ready', value: loaded.model }),
        (error: unknown) => live && setState({ status: 'error', error: message(error) }),
      );
    return () => {
      live = false;
    };
  }, [app, kit, game]);
  return state;
}

/** The starter-pack manifest (for *From library*); null until loaded or when it cannot be. */
export function useLibraryManifest(app: EditorApp, enabled: boolean): StarterPackManifest | null {
  const [manifest, setManifest] = useState<StarterPackManifest | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    app.library.service.manifest().then(
      (value) => live && setManifest(value),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [app, enabled]);
  return manifest;
}

/** The document version (re-renders on every committed change). */
export function useStoreVersion(app: EditorApp): number {
  const subscribe = useCallback((listener: () => void) => app.store.subscribe(listener), [app]);
  const read = useCallback(() => app.store.version, [app]);
  return useSyncExternalStore(subscribe, read, read);
}

/** The library preview's clip on a character (re-renders when a preview starts or stops). */
export function usePreviewClip(app: EditorApp): string | null {
  const subscribe = useCallback((listener: () => void) => app.library.service.subscribe(listener), [app]);
  const read = useCallback(() => {
    const preview = app.library.loaded ? app.library.service.preview : null;
    return preview === null ? null : `${preview.character}\u0000${preview.clip}`;
  }, [app]);
  return useSyncExternalStore(subscribe, read, read);
}

/** The starter-pack clip that previews a default motion (same CC0 source; `pistol_shoot` → `pistol-shoot`), or null. */
export function libraryClipForDefault(manifest: StarterPackManifest | null, motion: string): string | null {
  const id = motion.replaceAll('_', '-');
  return manifest?.clips.some((clip) => clip.id === id) === true ? id : null;
}

/** The summary line: "4 yours · 4 game default · 1 to fix". */
export function summaryText(
  counts: Readonly<Record<'custom' | 'invalid' | 'default' | 'missing' | 'fixed', number>>,
): string {
  const parts = [`${counts.custom} yours`, `${counts.default} game default`];
  if (counts.invalid + counts.missing > 0) parts.push(`${counts.invalid + counts.missing} to fix`);
  if (counts.fixed > 0) parts.push(`${counts.fixed} fixed`);
  return parts.join(' · ');
}
