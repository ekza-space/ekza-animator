// The marking-menu definitions as data (M6A-SPEC §8.4, M6B-SPEC §8.5; STUDIO-TOUCH-SPEC §20.3 item 12, T3). They are
// shell-neutral: the page's host registers them once per app (`host/registrations`, a lazy chunk per workspace), so
// they exist whichever shell is mounted — Pro draws them as marking menus (B9's controller), Halo reads the same data
// for its flick ring (§6.1). Owners of later menus add one line to their workspace's list.
import type { MarkingMenuDef } from '@ekza-studio/editor-core';
import { CONVERT_MENU } from './convert';
import { MODES_MENU } from './modes';
import { MOVE_SPACE_MENU, OPTIONS_MENU, OPTIONS_MENU_LMB, ROTATE_SPACE_MENU } from './options';
import { MODEL_OPS_MARKING_MENUS } from './tools';

export { RIG_MARKING_MENUS } from './rig';

/** Model's menus: B10's modes and convert, B12a's options and spaces, B11's tools, primitives and merge. */
export const MODEL_MARKING_MENUS: readonly MarkingMenuDef[] = [
  MODES_MENU,
  CONVERT_MENU,
  OPTIONS_MENU,
  OPTIONS_MENU_LMB,
  MOVE_SPACE_MENU,
  ROTATE_SPACE_MENU,
  ...MODEL_OPS_MARKING_MENUS,
];
