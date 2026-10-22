// The rig's controls hidden while Auto-Rig shows a character (AR-D8-4, AR-D9-8; D8, D9; lazy with ② to ④): after
// Auto-rig the IK rings and pole targets covered the markers (②), the joints (③ *Adjust joints*) and the character
// whose deformation ③'s review and ④'s previews show. While a step holds them, `autorig.controls {hidden: true}` keeps
// every control in the session's per-user hidden set (no pane flags: nothing stays behind in the panes'
// per-workspace memory when the shell unmounts or a step changes the workspace); the controls it hid are given back
// when the last hold ends (a tick later, so a step change does not flash them), and Studio draws them again.
import type { EditorApp } from '@ekza-studio/editor-core';
import { useEffect } from 'react';
import type { WizardContext } from '../../shell/context';

interface Hold {
  count: number;
  release: ReturnType<typeof setTimeout> | null;
}

const holds = new WeakMap<EditorApp, Hold>();

/** Hides every control while `active` (the third argument is the callers' layout key; unused since AR-D9-8). */
export function useHiddenControls(ctx: WizardContext, active: boolean, _layout?: string): void {
  useEffect(() => {
    if (!active) return undefined;
    const { app } = ctx;
    let hold = holds.get(app);
    if (hold === undefined) {
      hold = { count: 0, release: null };
      holds.set(app, hold);
    }
    const current = hold;
    if (current.release !== null) {
      clearTimeout(current.release);
      current.release = null;
    }
    current.count += 1;
    if (current.count === 1) void app.runUntyped('autorig.controls', { hidden: true });
    return () => {
      current.count -= 1;
      if (current.count > 0) return;
      current.release = setTimeout(() => {
        current.release = null;
        if (current.count === 0) void app.runUntyped('autorig.controls', { hidden: false });
      }, 0);
    };
  }, [ctx, active]);
}
