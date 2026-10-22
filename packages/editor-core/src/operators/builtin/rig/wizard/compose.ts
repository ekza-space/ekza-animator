// Shared by the Auto-Rig compositions (AUTORIG-SPEC §4.5; D0, used by every owner of a `wizard/` file): the stub of an
// `autorig.*` id until its owner lands it, and the composition runner every `autorig.*` operator runs its inner
// operators with — from its `prepare` (the runner refuses runs only inside `apply`, `nested-run`), one after the
// other, each recording its own undo step, stopping at the first failure and when the history changes under it
// (§4.5 "Exclusivity": an undo, a palette or MCP-bridge run between the inner runs).
import type { EditorApp } from '../../../../types';
import type { OperatorMap } from '../../../args';
import type { AnyOperator } from '../../define';
import { stubOperator } from '../../stub';

/** The poll reason of an `autorig.*` stub until its owner lands it. */
export const ARRIVES_WITH_AUTORIG = 'Arrives with Auto-Rig';

/** The message of a composition stopped by another change (§4.5). */
export const COMPOSITION_INTERRUPTED = 'Rigging was interrupted by another change';

/**
 * The stub of an `autorig.*` composition (§4.5): category `autorig`, scope global, every workspace, not undoable (the
 * inner operators record the steps), not repeatable, not adjustable, listed in the palette, poll-fails
 * "Arrives with Auto-Rig".
 */
export function wizardStub(id: keyof OperatorMap & `autorig.${string}`, label: string): AnyOperator {
  return stubOperator(id, label, {
    category: 'autorig',
    description: `${label} (AUTORIG-SPEC §4.5)`,
    reason: ARRIVES_WITH_AUTORIG,
  });
}

/** One inner run of a composition. */
export interface CompositionStep {
  readonly id: string;
  /** The args, or a function of the values the earlier steps returned (in order). */
  readonly args?: unknown;
  /** Awaited before the step runs (a progress update, a chunk); the interruption check follows it. */
  readonly before?: () => unknown;
}

export type CompositionOutcome =
  | { readonly status: 'finished'; readonly values: readonly unknown[] }
  /** A step was cancelled (poll) or failed: `step` is its index; the earlier steps stay (each is undoable). */
  | {
      readonly status: 'failed';
      readonly step: number;
      readonly id: string;
      readonly code: string;
      readonly message: string;
    }
  /** The history changed under the composition, or the subject is gone: nothing further ran. */
  | { readonly status: 'interrupted'; readonly step: number; readonly message: string };

const topId = (app: EditorApp): number | null => app.history.peekUndo()?.id ?? null;

/**
 * Runs `steps` in order through `app.runUntyped` (§4.5). Before each step (after its `before` hook) it checks that the
 * history top is still the step the last inner run left (captured after each run), that no `edit.undo` / `edit.redo`
 * ran since the composition started (the registry's `onBeforeDocumentRun` hook), and that `opts.alive()` holds (the
 * subject still exists); otherwise it stops with `interrupted`. A step that does not finish stops it with `failed`.
 * Never writes the store itself and records no history step of its own.
 */
export async function runComposition(
  app: EditorApp,
  steps: readonly CompositionStep[],
  opts: { readonly alive?: () => boolean } = {},
): Promise<CompositionOutcome> {
  let navigated = false;
  const off = app.operators.onBeforeDocumentRun((id) => {
    if (id === 'edit.undo' || id === 'edit.redo') navigated = true;
  });
  try {
    const values: unknown[] = [];
    let expected = topId(app);
    for (const [index, step] of steps.entries()) {
      if (step.before !== undefined) await step.before();
      if (navigated || topId(app) !== expected || opts.alive?.() === false) {
        return { status: 'interrupted', step: index, message: COMPOSITION_INTERRUPTED };
      }
      const args =
        typeof step.args === 'function' ? (step.args as (v: readonly unknown[]) => unknown)([...values]) : step.args;
      const result = await app.runUntyped(step.id, args);
      if (result.status === 'cancelled') {
        return { status: 'failed', step: index, id: step.id, code: 'cancelled', message: result.reason };
      }
      if (result.status === 'failed') {
        return { status: 'failed', step: index, id: step.id, code: result.error.code, message: result.error.message };
      }
      values.push(result.value);
      expected = topId(app);
    }
    if (navigated) return { status: 'interrupted', step: steps.length, message: COMPOSITION_INTERRUPTED };
    return { status: 'finished', values };
  } finally {
    off();
  }
}
