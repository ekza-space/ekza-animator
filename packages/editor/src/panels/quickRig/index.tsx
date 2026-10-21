// The Quick Rig panel (M6B-SPEC §8; registered by C0, body by C3): the definition is eager, the body a lazy chunk
// (./View.tsx) that C3 replaces.
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import { lazyPanelDef } from '../lazyPanel';
import type { PanelRegistry } from '../types';

export function registerQuickRigPanel(registry: PanelRegistry): Disposer {
  return registry.register(lazyPanelDef(PANEL.quickRig, 'Quick Rig', () => import('./View')));
}
