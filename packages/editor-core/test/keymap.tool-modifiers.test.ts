// STUDIO-TOUCH-SPEC §5.5, §20.3 item 20 (T1): the tool-modifier rows document every hold a tool observes and the
// drag modifiers the touch shell's Thumb key stands in for (its `modifierMap` rows are tested against these tools).
import { describe, expect, it } from 'vitest';
import { HOLD_CODES, TOOL_HOLD_CODES, TOOL_MODIFIERS, toolModifierKeys } from '../src/keymap/toolModifiers';

const keyCodes = (keys: (typeof TOOL_MODIFIERS)[number]['keys']): string[] =>
  keys.flatMap((part) => (typeof part === 'object' && 'code' in part ? [part.code] : []));

describe('tool modifiers (§5.5)', () => {
  it('every hold code (the Model viewport’s and the skin brush’s) has a documented row', () => {
    expect(HOLD_CODES).toEqual(expect.arrayContaining([...TOOL_HOLD_CODES]));
    expect([...HOLD_CODES].sort()).toEqual(['KeyB', 'KeyD', 'KeyI', 'KeyJ', 'KeyM', 'KeyN', 'KeyV', 'KeyX']);
    const documented = new Set(TOOL_MODIFIERS.flatMap((row) => keyCodes(row.keys)));
    for (const code of HOLD_CODES) expect([code, documented.has(code)]).toEqual([code, true]);
  });

  it('has the rows the touch shell needs: joint D, Quick Rig X, the skin holds, Graph and time-slider modifiers', () => {
    const rows = TOOL_MODIFIERS.map((row) => `${row.tool}: ${toolModifierKeys(row, 'other')}`);
    expect(rows).toEqual(
      expect.arrayContaining([
        'Joints (Rig & Skin): D + drag',
        'Joints and Quick Rig markers: X + drag',
        'Paint Skin Weights: B + drag',
        'Paint Skin Weights: M + drag',
        'Paint Skin Weights: N + drag',
        'Paint Skin Weights: I + click',
        'Graph Editor: Shift + drag',
        'Time slider: Shift + drag',
        'Time slider: Ctrl + drag the range',
      ]),
    );
  });
});
