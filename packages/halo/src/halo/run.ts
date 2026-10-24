// Running a verb (STUDIO-TOUCH-SPEC §5.6, §6.1, D5): a petal, a ring slot or a More row. A stage verb switches the stage
// (committing, §7.1). An operator with a pre-run form (Halo-only form data, `@ekza-studio/editor-core/forms`, or the
// ParamDefs of an operator that cannot be adjusted after the run) opens its chips first, filled with the defaults,
// with ✓ to run. Anything else runs at once; an adjustable run then shows its Echo chips (`edit.adjustLast`), and after
// a face operation a reduced Halo stays beside them so the next face verb is one tap away. A ring closes into the arc.
import type { HaloStage, OperatorId } from '@ekza-studio/editor-core';
import type * as Forms from '@ekza-studio/editor-core/forms';
import type { ShellContext } from '../shell/context';
import type { Verb } from './verbSource';

/** §6.1: after these the reduced Halo (Pull again · Bevel · Inset) stays beside the Echo chips. */
export const FACE_OPS: ReadonlySet<string> = new Set<OperatorId>(['mesh.extrude', 'mesh.inset', 'mesh.bevel']);

export interface RunnerDeps {
  enterStage(stage: HaloStage): Promise<void>;
  openSheet(sheet: string): void;
}

/** §6.4: the verb waits for a tap on its target (the subject is the selection when it was chosen). */
export function startTarget(ctx: ShellContext, label: string, op: OperatorId): void {
  ctx.store.set({
    target: { label, op, subject: [...ctx.app.session.getState().selection.objects] },
    halo: null,
    focus: null,
  });
}

type FormsModule = typeof Forms;
let forms: Promise<FormsModule> | null = null;
/** The forms chunk (Halo-only, lazy; prefetched at idle). */
export function loadForms(): Promise<FormsModule> {
  forms ??= import('@ekza-studio/editor-core/forms').catch((error: unknown) => {
    forms = null;
    throw error;
  });
  return forms;
}

export function createVerbRunner(
  ctx: ShellContext,
  deps: RunnerDeps,
): (verb: Verb, from: 'petal' | 'ring' | 'more') => void {
  const { app, store } = ctx;
  return (verb, from) => {
    store.set((s) => ({ touches: s.touches + 1, loupe: null }));
    if (from === 'more') store.set({ sheet: null });
    if ('stage' in verb.run) {
      void deps.enterStage(verb.run.stage);
      return;
    }
    if ('sheet' in verb.run) {
      deps.openSheet(verb.run.sheet);
      return;
    }
    const { op, args } = verb.run;
    if (verb.target === true) {
      // §6.4: "now tap the target" — the next tap's object becomes the verb's `parent`
      startTarget(ctx, verb.label, op);
      return;
    }
    const anchor = store.get().halo?.at ?? store.get().anchor;
    void (async () => {
      const def = app.operators.get(op);
      let form = null;
      try {
        form = (await loadForms()).formOf(op, def);
      } catch {
        form = null; // offline after a redeploy: the operator runs with its defaults
      }
      if (form !== null) {
        store.set({ form: { op, ...(args === undefined ? {} : { args }) }, halo: null });
        return;
      }
      const result = await ctx.run(op, args);
      if (result.status !== 'finished') return;
      if (FACE_OPS.has(op) && app.session.getState().lastRun?.id === op) {
        store.set({ halo: { mode: 'arc', at: anchor, reduced: true } });
        return;
      }
      const halo = store.get().halo;
      // a ring was transient: the Halo stays as the arc beside what is selected (a run may have changed it)
      if (halo !== null && halo.mode === 'ring') store.set({ halo: { mode: 'arc', at: anchor } });
    })();
  };
}
