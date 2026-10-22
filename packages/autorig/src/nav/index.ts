// Simple navigation (AUTORIG-SPEC §8.1; D0 stub, D3 implements it): the per-shell arbitration installed through the
// ViewportManager's `setNavigationOverride` hook while the Auto-Rig shell is mounted — a left drag on empty space
// orbits the persp pane, a right or two-finger drag pans, ortho panes never orbit, a tool that claims the press wins.
// Not a `NavProfile` value and never a preference: the user's Studio `navProfile` is never written.
import type { Disposer } from '@ekza-studio/anim-core';
import { EkzaError } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';

/** Installs the Simple override for this app's viewports; the disposer removes it (shell unmount). */
export function installSimpleNavigation(_app: EditorApp): Disposer {
  throw new EkzaError('not-implemented', 'installSimpleNavigation (AUTORIG-SPEC §8.1, D3)');
}
