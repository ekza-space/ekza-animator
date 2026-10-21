// The Validation panel (M6B-SPEC §8; registered by C0, body by C7): the definition is eager, the body a lazy chunk
// (./View.tsx) that C7 replaces.
import type { Disposer } from '@ekza-studio/anim-core';
import { PANEL } from '@ekza-studio/editor-core';
import { lazyPanelDef } from '../lazyPanel';
import type { PanelRegistry } from '../types';

export function registerValidationPanel(registry: PanelRegistry): Disposer {
  return registry.register(lazyPanelDef(PANEL.validation, 'Validation', () => import('./View')));
}
