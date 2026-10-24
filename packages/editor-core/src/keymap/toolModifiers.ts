// Tool modifiers (M6A-SPEC §7 "Tool modifiers"): keys the active viewport tool reads through `ToolKeyEvent` (step 2 of
// the keyboard adapter order, §5.17), not keymap rows. The cheat sheet lists them; the keymap conformance test keeps
// their keys free in the Model viewport so a hold never also runs a binding. Only the cheat sheet (a lazy dialog)
// imports this module in the app; the adapter's reserved modal keys live in `scopes.ts`.
import type { Chord } from '../types';
import { keyLabel } from './labels';

/** Codes tools observe as holds in the Model viewport (`B` is also the soft-select tap). */
export const TOOL_HOLD_CODES: readonly string[] = ['KeyX', 'KeyV', 'KeyJ', 'KeyD', 'KeyB', 'KeyI'];

/**
 * Every code a tool observes as a hold, in any workspace: the Model viewport's, plus Paint Skin Weights' `M` and `N`
 * (STUDIO-TOUCH-SPEC §5.5: the codes a virtual hold may carry; each has a row below).
 */
export const HOLD_CODES: readonly string[] = [...TOOL_HOLD_CODES, 'KeyM', 'KeyN'];

/** A key, a modifier or a pointer word. */
export type ToolModifierPart = Chord | { readonly modifier: 'mod' | 'ctrl' | 'shift' | 'alt' } | string;

export interface ToolModifierDoc {
  readonly tool: string;
  readonly keys: readonly ToolModifierPart[];
  readonly text: string;
}

const K = (code: string): Chord => ({ code });
const MOD = { modifier: 'mod' } as const;
const CTRL = { modifier: 'ctrl' } as const;
const SHIFT = { modifier: 'shift' } as const;

export const TOOL_MODIFIERS: readonly ToolModifierDoc[] = [
  { tool: 'Move / Rotate / Scale', keys: [K('KeyX')], text: 'Snap to the grid while held' },
  { tool: 'Move / Rotate / Scale', keys: [K('KeyV')], text: 'Snap to vertices while held' },
  { tool: 'Move / Rotate / Scale', keys: [K('KeyJ')], text: 'Snap to increments while held' },
  { tool: 'Move / Rotate / Scale', keys: [K('KeyD')], text: 'Edit the pivot while held' },
  { tool: 'Move / Rotate / Scale', keys: [K('KeyB'), 'LMB drag'], text: 'Soft select radius (relative)' },
  { tool: 'Move / Rotate / Scale', keys: [K('KeyB'), 'MMB drag'], text: 'Soft select radius (from zero)' },
  { tool: 'Move / Rotate / Scale', keys: [SHIFT, 'drag a handle'], text: 'Smart extrude (Shift held at drag start)' },
  { tool: 'Any drag', keys: [SHIFT, 'during a drag'], text: 'Fine: ×0.1' },
  { tool: 'Any drag', keys: [MOD, 'during a drag'], text: 'Coarse: ×10' },
  { tool: 'Multi-Cut', keys: [CTRL, 'click'], text: 'Insert an edge loop' },
  { tool: 'Multi-Cut', keys: [CTRL, 'MMB click'], text: 'Insert a centred edge loop' },
  { tool: 'Multi-Cut', keys: [SHIFT, 'click'], text: 'Snap to the step' },
  { tool: 'Multi-Cut', keys: [K('Backspace')], text: 'Remove the last point' },
  { tool: 'Multi-Cut', keys: [K('Enter')], text: 'Complete the cut (or RMB)' },
  { tool: 'Active tool', keys: [K('PageUp'), K('PageDown')], text: 'Step the tool’s count' },
  { tool: 'Paint Colour', keys: [K('KeyI')], text: 'Eyedropper' },
  { tool: 'Paint Colour', keys: [K('Enter')], text: 'Apply the active swatch' },
  // STUDIO-TOUCH-SPEC §5.5, §20.3 item 20 (T1): the holds and drag modifiers of Rig & Skin and the animation editors
  {
    tool: 'Joints (Rig & Skin)',
    keys: [K('KeyD'), 'drag'],
    text: 'Move or orient the joint alone (its children stay)',
  },
  { tool: 'Joints and Quick Rig markers', keys: [K('KeyX'), 'drag'], text: 'Snap to the grid while held' },
  { tool: 'Paint Skin Weights', keys: [K('KeyB'), 'drag'], text: 'Brush radius' },
  { tool: 'Paint Skin Weights', keys: [K('KeyM'), 'drag'], text: 'Brush opacity' },
  { tool: 'Paint Skin Weights', keys: [K('KeyN'), 'drag'], text: 'Paint value' },
  {
    tool: 'Paint Skin Weights',
    keys: [K('KeyI'), 'click'],
    text: 'Sample the weight (Shift: pick the dominant joint)',
  },
  { tool: 'Graph Editor', keys: [SHIFT, 'drag'], text: 'Lock the drag to time or value' },
  { tool: 'Time slider', keys: [SHIFT, 'drag'], text: 'Select a key range' },
  { tool: 'Time slider', keys: [MOD, 'drag the range'], text: 'Copy the keys instead of moving them' },
];

const MODIFIER_LABEL = {
  mod: { mac: '⌘', other: 'Ctrl' },
  ctrl: { mac: '⌃', other: 'Ctrl' },
  shift: { mac: '⇧', other: 'Shift' },
  alt: { mac: '⌥', other: 'Alt' },
} as const;

/** 'B + LMB drag', '⌃ + click', 'PgUp / PgDn' (keys alone are alternatives, a modifier or word joins with '+'). */
export function toolModifierKeys(doc: ToolModifierDoc, platform: 'mac' | 'other'): string {
  const chordsOnly = doc.keys.every((part) => typeof part === 'object' && 'code' in part);
  const text = doc.keys.map((part) =>
    typeof part === 'string'
      ? part
      : 'code' in part
        ? keyLabel(part.code, platform)
        : MODIFIER_LABEL[part.modifier][platform],
  );
  return text.join(chordsOnly ? ' / ' : ' + ');
}
