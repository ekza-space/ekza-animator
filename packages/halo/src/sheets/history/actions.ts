// What the History ribbon's verbs run (STUDIO-TOUCH-SPEC §6.2 "History step", §14; T10), every one an operator run of
// the kernel's own: *Undo to here* / *Redo to here* walk `edit.undo` / `edit.redo`; *Compare* (hold) undoes back to
// before the row while held and redoes on release; *Revert this* is `edit.revertSteps` over one AI step; *Undo all*
// over an AI group follows M-AI-INT-7 — one `edit.revertSteps` over its steps, or, when they are the top of the undo
// stack and one keeps no change record (or the revert fails), undoes them one by one (the user's steps below stay,
// Redo brings the agent's work back).
import type { EditorApp, HistoryStep, OperatorResult } from '@ekza-studio/editor-core';
import { topSuffix } from './model';

export type Run = (op: string, args?: unknown) => Promise<OperatorResult<unknown>>;

/** Runs `op` `n` times in order; false when one did not finish. */
export async function repeat(run: Run, op: 'edit.undo' | 'edit.redo', n: number): Promise<boolean> {
  for (let i = 0; i < n; i++) {
    const result = await run(op);
    if (result.status !== 'finished') return false;
  }
  return true;
}

/** `edit.revertSteps` over the steps (one new, undoable step). */
export async function revertSteps(run: Run, steps: readonly number[]): Promise<boolean> {
  if (steps.length === 0) return false;
  const result = await run('edit.revertSteps', { steps: [...steps] });
  return result.status === 'finished';
}

/** *Undo all* over an AI group (M-AI-INT-7). */
export async function undoAll(app: EditorApp, run: Run, steps: readonly number[]): Promise<boolean> {
  const undo: readonly HistoryStep[] = app.history.entries().undo;
  const suffix = topSuffix(undo, steps);
  if (suffix !== null && suffix.some((step) => !step.revertable)) return repeat(run, 'edit.undo', suffix.length);
  if (await revertSteps(run, steps)) return true;
  return suffix === null ? false : repeat(run, 'edit.undo', suffix.length);
}

/**
 * *Compare* while held: undoes `depth` steps on press and redoes them on release, in order (a release before the
 * undos finished waits for them). Returns the release.
 */
export function holdCompare(run: Run, depth: number): () => Promise<void> {
  const undone = repeat(run, 'edit.undo', depth);
  return async () => {
    const ok = await undone;
    if (ok) await repeat(run, 'edit.redo', depth);
  };
}
