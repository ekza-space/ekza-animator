// The command palette's shared shapes (M6A-SPEC §5.18; B9): eager and tiny, so the shell, the test API and the lazy
// controller agree without pulling the controller into the eager route.
import type { ParamDef } from '@ekza-animator/anim-core';

export interface PaletteEntry {
  /** Unique within one opening. */
  readonly key: string;
  readonly op: string;
  readonly args: unknown;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly shortcut: string | null;
  readonly enabled: boolean;
  readonly reason: string | null;
  /** Value params the prompt asks for (primary first). */
  readonly params: readonly ParamDef[];
  /** `cmdk-item-<operatorId>`; variants add `:<variant>` (menu item id, workspace id). */
  readonly testId: string;
}

export interface PalettePrompt {
  readonly entry: PaletteEntry;
  readonly field: string;
  /** Typed text per param name. */
  readonly values: Readonly<Record<string, string>>;
  readonly error: string | null;
}

export interface PaletteState {
  readonly open: boolean;
  readonly query: string;
  /** Highlighted row of the filtered list. */
  readonly index: number;
  readonly entries: readonly PaletteEntry[];
  readonly prompt: PalettePrompt | null;
}
