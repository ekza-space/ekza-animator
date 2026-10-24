// The Thread's focused band source (STUDIO-TOUCH-SPEC §10.3, §20.3 item 18; T7): a lazy chunk that provides the Thread
// to the curve editor's band-source seam, so `time.selectBand` and the `timeline.context.*` items are registered on
// `/app` as Studio Pro's time slider registers them on `/editor` — Halo runs the same operators as Pro. The strip
// redraws on every session change anyway; the source's `redraw` asks nothing more.
import { provideBandSource } from '@ekza-studio/curve-editor';
import type { EditorApp } from '@ekza-studio/editor-core';

export function provideThreadBandSource(app: EditorApp): { dispose(): void } {
  const handle = provideBandSource(app, { redraw: () => undefined });
  return { dispose: () => handle.dispose() };
}
