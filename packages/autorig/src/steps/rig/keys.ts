// ③'s own keys (AUTORIG-SPEC §8.1; D4; lazy with the view): `Space` plays / pauses the motion test in review while the
// focus is on no control (a focused button keeps `Space`), and is prevented, so Studio's keymap never maximizes a pane
// in Auto-Rig. Not a row of the frame's table: the frame would prevent `Space` on every control of ③ (see
// `keymap/steps/rig.ts`). `Esc` stops the preview (the frame's rule) and, in review, turns the motion test off with it,
// so the toggle reads "off" and one click starts it again (AR-D10-5); an `Esc` that closes a menu does neither.
import type { Disposer } from '@ekza-studio/anim-core';
import type { WizardContext } from '../../shell/context';

const CONTROL = 'button, input, select, textarea, a[href], [contenteditable="true"], [role="button"], summary';

export function installRigKeys(ctx: WizardContext, toggle: () => void): Disposer {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      const session = ctx.session.getState();
      const target = e.target as { closest?: (selector: string) => unknown } | null;
      const inMenu = typeof target?.closest === 'function' && target.closest('[role="menu"]') !== null;
      if (inMenu || session.step !== 'rig' || session.rig.sub !== 'review' || !session.rig.motionTest) return;
      if (ctx.app.session.getState().dialog !== null || ctx.host.ui.getState().confirm !== null) return;
      ctx.session.patch('rig', { motionTest: false });
      return;
    }
    if (e.code !== 'Space' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const session = ctx.session.getState();
    if (session.step !== 'rig' || session.busy !== null || session.rig.sub !== 'review') return;
    if (ctx.app.session.getState().dialog !== null || ctx.host.ui.getState().confirm !== null) return;
    const target = e.target as { closest?: (selector: string) => unknown } | null;
    if (typeof target?.closest === 'function' && target.closest(CONTROL) !== null) return;
    e.preventDefault();
    toggle();
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
}
