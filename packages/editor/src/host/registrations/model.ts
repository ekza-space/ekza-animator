// Model's host registrations (STUDIO-TOUCH-SPEC §20.3 item 12; T3): the marking-menu definitions of the Model
// workspace (`overlays/menus`). A lazy chunk the host loads on the first Model entry on every route; before T3 the
// Studio shell registered them (B10 eagerly, B12a and B11 on the first Model entry).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { MODEL_MARKING_MENUS } from '../../overlays/menus';
import { registerOnce } from './once';

export function register(app: EditorApp): Disposer {
  return registerOnce(
    app,
    MODEL_MARKING_MENUS.map((def) => ({ kind: 'markingMenu', def }) as const),
  );
}
