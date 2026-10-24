// The History ribbon as data (STUDIO-TOUCH-SPEC §6.2 "History step", §12.9, §14, §5.3 C9; T10): the kernel's history
// (`app.history.entries()`, the same steps ↶ and Pro's Undo walk) read newest first — the steps that can be redone on
// top, then *Now*, then the undo steps. Selection-only steps fold into the next document step (C9: the toast still
// names them on ↶); consecutive steps of one AI agent form one group, titled with the request the user asked for it in
// the Ask sheet (*"AI · Wave twice · 5 steps"*), else with the agent's name. Pure.
import type { HistoryStep } from '@ekza-studio/editor-core';

/** A request sent from the Ask sheet (§14): its words and when. */
export interface AskRequest {
  readonly text: string;
  readonly at: number;
}

export interface StepView {
  readonly id: number;
  readonly label: string;
  readonly at: number;
  readonly actor: { readonly id: string; readonly name: string } | null;
  /** It keeps a change record: `edit.revertSteps` can take it back on its own (an AI step). */
  readonly revertable: boolean;
}

export type HistoryRow =
  | {
      readonly kind: 'step';
      readonly side: 'undo' | 'redo';
      readonly step: StepView;
      /** Selection-only steps folded into this one (they come before it). */
      readonly folded: number;
      /** How many undos (from Now) or redos reach this step. */
      readonly depth: number;
    }
  | {
      readonly kind: 'ai';
      readonly side: 'undo';
      /** Oldest first. */
      readonly steps: readonly StepView[];
      readonly actor: { readonly id: string; readonly name: string };
      /** The request it answers, else the agent's name. */
      readonly title: string;
      readonly request: string | null;
      /** How many undos from Now take the whole group back. */
      readonly depth: number;
    };

const selectionOnly = (step: HistoryStep): boolean =>
  step.docTxId === null &&
  step.overrides === null &&
  (step.testPose ?? null) === null &&
  (step.selection ?? null) !== null &&
  (step.actor ?? null) === null;

function view(step: HistoryStep): StepView {
  return {
    id: step.id,
    label: step.label,
    at: step.at,
    actor: step.actor === undefined || step.actor === null ? null : { id: step.actor.id, name: step.actor.name },
    revertable: step.changes !== undefined && step.changes !== null,
  };
}

/** A request's words as a group title: the first letter up, at most 40 characters. */
export function requestTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  const short = clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** The rows, newest first: redo steps (the furthest first), then the undo side (the latest first). */
export function historyRows(
  entries: { readonly undo: readonly HistoryStep[]; readonly redo: readonly HistoryStep[] },
  requests: readonly AskRequest[] = [],
): readonly HistoryRow[] {
  const undo: HistoryRow[] = [];
  let group: { actor: { id: string; name: string }; steps: StepView[] } | null = null;
  let previousGroupEnd = Number.NEGATIVE_INFINITY;
  const closeGroup = (): void => {
    if (group === null) return;
    const first = group.steps[0] as StepView;
    // the latest request asked before the group began, and after the group before it
    const request = [...requests].reverse().find((r) => r.at <= first.at && r.at > previousGroupEnd)?.text ?? null;
    undo.push({
      kind: 'ai',
      side: 'undo',
      steps: group.steps,
      actor: group.actor,
      title: request === null ? group.actor.name : requestTitle(request),
      request,
      depth: 0,
    });
    previousGroupEnd = (group.steps.at(-1) as StepView).at;
    group = null;
  };
  // selection steps waiting for the next document step; ones that meet an AI group or the end stand on their own
  let waiting: HistoryStep[] = [];
  const flush = (): void => {
    for (const step of waiting) undo.push({ kind: 'step', side: 'undo', step: view(step), folded: 0, depth: 0 });
    waiting = [];
  };
  for (const step of entries.undo) {
    const actor = step.actor ?? null;
    if (actor !== null) {
      if (group !== null && group.actor.id !== actor.id) closeGroup();
      if (group === null) flush();
      group ??= { actor: { id: actor.id, name: actor.name }, steps: [] };
      group.steps.push(view(step));
      continue;
    }
    closeGroup();
    if (selectionOnly(step)) {
      waiting.push(step);
      continue;
    }
    undo.push({ kind: 'step', side: 'undo', step: view(step), folded: waiting.length, depth: 0 });
    waiting = [];
  }
  closeGroup();
  flush();
  // depths from Now: how many undos take a row back (a group: all its steps; a folded row: through its selections)
  const withDepth: HistoryRow[] = [];
  let depth = 0;
  for (let i = undo.length - 1; i >= 0; i--) {
    const row = undo[i] as HistoryRow;
    depth += row.kind === 'ai' ? row.steps.length : 1;
    withDepth.push({ ...row, depth });
    if (row.kind === 'step') depth += row.folded;
  }
  const redo: HistoryRow[] = entries.redo.map((step, index) => ({
    kind: 'step',
    side: 'redo',
    step: view(step),
    folded: 0,
    depth: index + 1,
  }));
  return [...redo.reverse(), ...withDepth];
}

/**
 * The undo steps an AI group spans when they are the top of the undo stack (nothing of the user's above them), oldest
 * first; null otherwise (M-AI-INT-7: such a group may be undone instead of reverted).
 */
export function topSuffix(
  undo: readonly HistoryStep[],
  ids: readonly number[],
): readonly { readonly id: number; readonly revertable: boolean }[] | null {
  const first = undo.findIndex((step) => step.id === ids[0]);
  if (first < 0) return null;
  const suffix = undo.slice(first);
  const own = new Set(ids);
  if (!suffix.every((step) => own.has(step.id))) return null;
  return suffix.map((step) => ({ id: step.id, revertable: step.changes !== undefined && step.changes !== null }));
}

/** The history as plain text (More › Copy as text), newest first. */
export function historyText(rows: readonly HistoryRow[]): string {
  return rows
    .map((row) =>
      row.kind === 'ai'
        ? `AI · ${row.title} · ${row.steps.length} steps: ${row.steps.map((s) => s.label).join(', ')}`
        : `${row.side === 'redo' ? '(redo) ' : ''}${row.step.label}`,
    )
    .join('\n');
}
