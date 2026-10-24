// The memory profile's preference patch in the `device` layer (STUDIO-TOUCH-SPEC S8, §16.4): a lazy chunk of
// `memoryProfile.ts`, so pages without a device override (every desktop) never load the override layer.
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, overridePrefs, type PrefsPatch } from '@ekza-studio/editor-core';

export function applyDeviceOverride(app: EditorApp, patch: PrefsPatch): Disposer {
  return overridePrefs(app.prefs, 'device', patch);
}
