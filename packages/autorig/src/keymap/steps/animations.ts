// Key bindings of the animations step (AUTORIG-SPEC §8.1; D5 owns the list): `/` focuses the search, `A` adds the
// focused (or selected) card. The frame's listener prevents these keys (so Studio's bindings never run); the step view
// performs the actions while it is mounted. `Space` (play / stop the preview; in Auto-Rig it never maximizes panes) is
// handled by the step view itself, not listed here: a keymap row would be prevented on every target, and a focused
// checkbox, slider or button must keep its own Space (§8.2). `Enter` on a focused card is the card's own button
// (preview); `Esc` stops the preview (the frame's fall-through).
import type { AutoRigKeyBinding } from '../index';

/** The shell actions of ④ (the step view handles them). */
export const ANIMATIONS_ACTIONS = {
  search: 'animations.search',
  add: 'animations.add',
} as const;

export const animationsKeys: readonly AutoRigKeyBinding[] = [
  { chord: { code: 'Slash' }, run: { action: ANIMATIONS_ACTIONS.search }, steps: ['animations'] },
  { chord: { code: 'KeyA' }, run: { action: ANIMATIONS_ACTIONS.add }, steps: ['animations'] },
];
