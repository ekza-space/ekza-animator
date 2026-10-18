// Argument types of the shell's own operators. Their OperatorMap entries (`prefs.set`, `workspace.reset`,
// `workspace.showPanel`, `view.selectionMask`) are part of the editor-core contract since the v0.3 integration
// (MVP-SPEC §4.5, WP-8 R-1); extensions still add entries by declaration merging (ADR 0008).
import type { PanelKind, Prefs, SelectionMask } from '@ekza-animator/editor-core';

/** Argument types of the shell's own operators. */
export interface ShellOperatorArgs {
  readonly 'prefs.set': { readonly patch: Partial<Omit<Prefs, 'version'>> };
  readonly 'workspace.showPanel': { readonly panel: PanelKind };
  readonly 'view.selectionMask': { readonly mask: Partial<SelectionMask> };
}
