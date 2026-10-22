// The parts left out of the character hidden while Auto-Rig shows the model (AUTORIG-SPEC §6.1; AR-D10-1; lazy with
// ①'s report and ②–⑤): the views show what the VRM holds, and unticking a part in ① shows at once which mesh it is.
// While a step holds them, `autorig.parts {hidden}` keeps the unticked parts in the session's per-user hidden set; the
// ones it hid are given back when the last hold ends (a tick later, so a step change does not flash them), and Studio
// draws them again after a hand-over.
import type { EditorApp } from '@ekza-studio/editor-core';
import { useEffect } from 'react';
import { useDocument, useSession, type WizardContext } from '../../shell/context';
import type { AutoRigSession } from '../../types';
import { leftOutParts } from './parts';

interface Hold {
  count: number;
  release: ReturnType<typeof setTimeout> | null;
}

const holds = new WeakMap<EditorApp, Hold>();
const selectIntake = (s: AutoRigSession): AutoRigSession['intake'] => s.intake;
const selectParts = (s: AutoRigSession): AutoRigSession['model']['parts'] => s.model.parts;

/** Hides the unticked parts of the loaded model while the calling view is shown. */
export function useHiddenParts(ctx: WizardContext): void {
  // re-rendered by a change of the intake or the ticks (session) and of the document (a part deleted or restored)
  useSession(ctx.session, selectIntake);
  useSession(ctx.session, selectParts);
  const hidden = useDocument(ctx.app, () => leftOutParts(ctx).join(','));
  useEffect(() => {
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
    void app.runUntyped('autorig.parts', { hidden: hidden === '' ? [] : hidden.split(',') });
    return () => {
      current.count -= 1;
      if (current.count > 0) return;
      current.release = setTimeout(() => {
        current.release = null;
        if (current.count === 0) void app.runUntyped('autorig.parts', { hidden: [] });
      }, 0);
    };
  }, [ctx, hidden]);
}
