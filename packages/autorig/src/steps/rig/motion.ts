// The ③ motion test (AUTORIG-SPEC §5.4, L3, §8.2; D4; lazy with the view): as soon as the rig is checked the character
// plays a loop through C12's library preview (`library.preview {character, clip}`, channel source `preview`: no
// document write, no undo step) — Walk, Sword attack or Dance from the starter pack. C12 stops the preview on any
// document change; while the test is on, Auto-Rig starts it again once the change has committed (a committed batch,
// never a gesture's preview batches). Leaving review, turning the test off or unmounting stops it. With
// `prefers-reduced-motion` nothing plays until the user presses *Play motion test*. The Range test clip is D5's
// (`library.preview` with ROM bytes, §5.4.1; optional in v1) and is not offered here yet.
import type { CharacterId } from '@ekza-studio/doc';
import type { ClipPreviewState, EditorApp } from '@ekza-studio/editor-core';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { messages } from '../../i18n';

/**
 * What the library preview plays now, as `{character, clip}` (null while nothing plays or the library chunk is not
 * loaded). The service's `preview` is a fresh object with the clock on every read, so only its identity fields are
 * compared.
 */
export function usePreview(app: EditorApp): Pick<ClipPreviewState, 'character' | 'clip'> | null {
  const [loaded, setLoaded] = useState(app.library.loaded);
  useEffect(() => {
    if (app.library.loaded) return;
    let alive = true;
    void app.library.load().then(
      () => alive && setLoaded(true),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [app]);
  // re-subscribed once the chunk is there
  const subscribe = useCallback(
    (notify: () => void) => (loaded ? app.library.service.subscribe(notify) : () => {}),
    [app, loaded],
  );
  const get = useCallback((): string | null => {
    const preview = loaded ? app.library.service.preview : null;
    return preview === null ? null : `${preview.character}\u0000${preview.clip}`;
  }, [app, loaded]);
  const key = useSyncExternalStore(subscribe, get, get);
  if (key === null) return null;
  const [character, clip] = key.split('\u0000') as [CharacterId, string];
  return { character, clip };
}

/**
 * Plays `clip` on `character` while `active` (and restarts it after document changes); returns the failure to show
 * (the library unreachable), or null.
 */
export function useMotionTest(
  app: EditorApp,
  active: boolean,
  clip: string,
  character: CharacterId | null,
): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || character === null) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = async (): Promise<void> => {
      try {
        if (!app.library.loaded) await app.library.load();
      } catch {
        if (alive) setError(messages().rig.motionUnavailable);
        return;
      }
      if (!alive) return;
      const playing = app.library.service.preview;
      if (playing !== null && playing.character === character && playing.clip === clip) return;
      const result = await app.runUntyped('library.preview', { character, clip });
      if (!alive) return;
      if (result.status === 'finished') setError(null);
      else if (result.status === 'failed' && result.error.code !== 'cancelled') {
        setError(messages().rig.motionUnavailable);
      }
    };
    void start();
    const off = app.store.subscribe((batch) => {
      if (batch.origin === 'preview' || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (alive && (!app.library.loaded || app.library.service.preview === null)) void start();
      }, 0);
    });
    return () => {
      alive = false;
      off();
      if (timer !== null) clearTimeout(timer);
      if (app.library.loaded && app.library.service.preview?.character === character) {
        void app.runUntyped('library.stop');
      }
    };
  }, [app, active, clip, character]);
  return active ? error : null;
}
