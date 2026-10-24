// The lazy loaders of T6b's sheets (STUDIO-TOUCH-SPEC §20.6: every sheet is its own chunk; the shell prefetches them
// at idle after boot and on `online`, S23). The frame (T6a) renders `SHEET_LOADERS[id]` for the open sheet; the other
// packages add their sheets' loaders beside these when they land.
import type { ComponentType } from 'react';
import type { HaloSheetProps, T6bSheetId } from './sheets';

export type SheetModule = { readonly default: ComponentType<HaloSheetProps> };

export const SHEET_LOADERS: Readonly<Record<T6bSheetId, () => Promise<SheetModule>>> = {
  more: () => import('../sheets/more'),
  numbers: () => import('../sheets/numbers'),
  scene: () => import('../sheets/scene'),
  view: () => import('../sheets/view'),
  settings: () => import('../sheets/settings'),
  health: () => import('../sheets/health'),
  help: () => import('../sheets/help'),
  about: () => import('../sheets/about'),
};

/** Prefetches every T6b sheet chunk (the shell calls it at idle and on `online`, S23); failures are retried later. */
export function prefetchSheets(): Promise<void> {
  return Promise.all(Object.values(SHEET_LOADERS).map((load) => load().catch(() => undefined))).then(() => undefined);
}
