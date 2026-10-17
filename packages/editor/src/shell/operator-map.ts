// Operators the shell adds to the typed operator map (ADR 0008: extensions add entries by declaration merging).
// Imported by the package entry so every program that uses @ekza-animator/editor sees these entries.
import type { PanelKind, Prefs, SelectionMask } from '@ekza-animator/editor-core';

declare module '@ekza-animator/editor-core' {
  interface OperatorMap {
    /** Shell (WP-8): writes preference fields (P state). */
    'prefs.set': { args: { readonly patch: Partial<Omit<Prefs, 'version'>> }; result: void };
    /** Shell (WP-8): rebuilds the default Animate layout. */
    'workspace.reset': { args: void; result: void };
    /** Shell (WP-8): shows (and if needed re-opens) a dock panel. */
    'workspace.showPanel': { args: { readonly panel: PanelKind }; result: void };
    /** Shell (WP-8): which object kinds viewport picking selects (status line mask). */
    'view.selectionMask': { args: { readonly mask: Partial<SelectionMask> }; result: void };
  }
}

/** Argument types of the shell's own operators. */
export interface ShellOperatorArgs {
  readonly 'prefs.set': { readonly patch: Partial<Omit<Prefs, 'version'>> };
  readonly 'workspace.showPanel': { readonly panel: PanelKind };
  readonly 'view.selectionMask': { readonly mask: Partial<SelectionMask> };
}
