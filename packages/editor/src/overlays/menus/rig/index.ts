// The Rig & Skin marking menus (M6B-SPEC §8.5; C7): the MVP has `rig.modes` only (the tools, skin-joint, paint-ops,
// pick-mask and options menus arrive after the MVP, §0.3). Owners of later menus add one line each.
import type { MarkingMenuDef } from '@ekza-studio/editor-core';
import { RIG_MODES_MENU } from './modes';

export const RIG_MARKING_MENUS: readonly MarkingMenuDef[] = [RIG_MODES_MENU];
