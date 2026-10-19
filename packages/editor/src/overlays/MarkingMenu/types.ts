// The marking menu's shared shapes (M6A-SPEC §5.18; B9): eager and tiny, so the shell, the test API and the lazy
// controller agree without pulling the controller into the eager route.
import type { CompassSlot, MarkingMenuDef, RunContext } from '@ekza-animator/editor-core';

/** One drawn item: an operator run (with args), or a submenu; disabled with the poll's (or a static) reason. */
export interface MarkingMenuEntry {
  readonly label: string;
  readonly op: string | null;
  readonly args: unknown;
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly checked: boolean;
  readonly submenu: readonly MarkingMenuEntry[] | null;
}

export type MarkingMenuTarget =
  | { readonly kind: 'slot'; readonly slot: CompassSlot }
  | { readonly kind: 'item'; readonly index: number }
  | { readonly kind: 'sub'; readonly index: number };

export interface OpenMarkingMenu {
  readonly def: MarkingMenuDef;
  /** Centre (page CSS px). */
  readonly x: number;
  readonly y: number;
  readonly ctx: RunContext;
  readonly via: 'pointer' | 'key' | 'command';
  /** Drawn: after the flick window, or at once for a click-release or a key tap. */
  readonly visible: boolean;
  /** Open for a click (after a click-release or a key tap). */
  readonly sticky: boolean;
  readonly hover: MarkingMenuTarget | null;
  readonly slots: Partial<Record<CompassSlot, MarkingMenuEntry>>;
  readonly list: readonly MarkingMenuEntry[];
  /** The expanded submenu (its entry's target) and its items. */
  readonly expanded: { readonly from: MarkingMenuTarget; readonly items: readonly MarkingMenuEntry[] } | null;
}

export interface MarkingMenuState {
  readonly open: OpenMarkingMenu | null;
}
