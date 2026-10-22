// The Rig & Skin skin runtime's eager part (M6B-SPEC §5.11, §5.12, §0.4.9; C6): the app → runtime map. The lazy
// runtime (./runtime.ts: the skinned display with the weight display, the Paint Skin Weights tool, the brush ring)
// starts with the viewport's skeleton runtime (rig/runtime.ts), which C3's eager hook (rig/joints/attach.ts) loads the
// first time the Rig & Skin workspace is entered (INT: one eager hook for both).
import type { EditorApp } from '@ekza-studio/editor-core';
import type { RigSkinRuntime } from './runtime';

export type { RigSkinRuntime } from './runtime';

/** Set and cleared by the viewport-rig chunk (rig/runtime.ts). */
export const rigSkinRuntimes = new WeakMap<EditorApp, RigSkinRuntime>();

/** The app's loaded Skin mode runtime (the test API and panels read it), or null before the first Rig & Skin entry. */
export function rigSkinOf(app: EditorApp): RigSkinRuntime | null {
  return rigSkinRuntimes.get(app) ?? null;
}
