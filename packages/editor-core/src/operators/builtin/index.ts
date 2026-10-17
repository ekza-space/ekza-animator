// WP-7b: built-in contributions (MVP-SPEC §7 WP-7b). Registration functions are no-ops until the operator catalog
// lands, so the app boots from day 1; the definition lists start empty.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, ExporterDef, ImporterDef, MenuItemDef } from '../../types';

export const BUILTIN_IMPORTERS: readonly ImporterDef[] = [];
export const BUILTIN_EXPORTERS: readonly ExporterDef[] = [];
export const BUILTIN_MENU_ITEMS: readonly MenuItemDef[] = [];

const noop: Disposer = () => {};

export function registerBuiltinOperators(_app: EditorApp): Disposer {
  return noop;
}

/** Operators, importers, exporters, BUILTIN_EXPORT_PROFILES, menu items and MAYA_KEYMAP. */
export function registerBuiltins(_app: EditorApp): Disposer {
  return noop;
}
