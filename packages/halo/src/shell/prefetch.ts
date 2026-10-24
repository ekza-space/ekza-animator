// Idle prefetch (STUDIO-TOUCH-SPEC §20.6, S23): all of Halo's small lazy chunks load at idle after boot and again when
// the network comes back, so a long-lived iPad tab never meets a chunk-load error on its first tap after a redeploy.
// Also the UI wrappers (`loadUiWrappers`, P-T3-4), so search and the petals list them in Halo as in Pro, and T6b's
// sheets (`prefetchSheets`, P-T6B-2).
import { type EditorApp, loadUiWrappers } from '@ekza-studio/editor-core';
import { prefetchSheets } from '../manifest/sheetLoaders';

/** Every lazy chunk of the shell (each loader is idempotent: the module cache keeps it). */
export const LAZY_CHUNKS: readonly (() => Promise<unknown>)[] = [
  () => import('../input/install'),
  () => import('../chips/FormChips'),
  () => import('../chips/NumpadPanel'),
  () => import('../palette/Palette'),
  () => import('../input/InputSettings'),
  () => import('../shell/ProjectMenu'),
  () => import('../dialogs/answers'),
  () => import('@ekza-studio/editor-core/forms'),
];

type Idle = (callback: () => void, options?: { timeout: number }) => number;

export function prefetchLazyChunks(app: EditorApp): () => void {
  if (typeof window === 'undefined') return () => {};
  let cancelled = false;
  const run = (): void => {
    if (cancelled) return;
    for (const load of LAZY_CHUNKS) void load().catch(() => {});
    void prefetchSheets();
    void loadUiWrappers(app).catch(() => {});
  };
  const idle = (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback;
  const handle = idle === undefined ? window.setTimeout(run, 1500) : idle(run, { timeout: 4000 });
  const online = (): void => run();
  window.addEventListener('online', online);
  return () => {
    cancelled = true;
    if (idle === undefined) window.clearTimeout(handle);
    else (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
    window.removeEventListener('online', online);
  };
}
