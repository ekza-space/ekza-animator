// STUDIO-TOUCH-SPEC §5.4, ST-T1-5 (T6a): the manipulator's size by pointer type, with hysteresis — two presses in a row
// of the other kind switch it; one stray press does not.
import { describe, expect, it } from 'vitest';
import { createManipScale, MANIP_SCALE } from '../src/input/manipScale';

describe('manipulator scale (ST-T1-5)', () => {
  it('a finger needs two presses in a row to grow the handles; the mouse two to shrink them', () => {
    const scale = createManipScale('mouse');
    expect(scale.scale).toBe(1);
    expect(scale.press('touch')).toBe(1);
    expect(scale.press('mouse')).toBe(1); // a stray press is forgotten
    expect(scale.press('touch')).toBe(1);
    expect(scale.press('touch')).toBe(MANIP_SCALE.touch);
    expect(scale.press('mouse')).toBe(MANIP_SCALE.touch);
    expect(scale.press('mouse')).toBe(1);
  });

  it('starts at a coarse pointer’s size on a touch device; the Pencil is precise', () => {
    const scale = createManipScale('touch');
    expect(scale.scale).toBe(MANIP_SCALE.touch);
    scale.press('pen');
    expect(scale.press('pen')).toBe(MANIP_SCALE.pen);
    expect(MANIP_SCALE.pen).toBe(1);
  });
});
