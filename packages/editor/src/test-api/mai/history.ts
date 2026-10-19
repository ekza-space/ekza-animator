// M-AI test API slice (MCP-SPEC §4.9): `historySteps()` — the editor history's steps of both stacks, oldest first
// (the undone steps in the order they were made), with their actor: 'user' or the agent's reported name. D0 owns this
// file.
import type { EditorApp, HistoryStep } from '@ekza-animator/editor-core';
import type { EkzaAnimatorTestApi } from '../types';

function row(step: HistoryStep, undone: boolean): ReturnType<EkzaAnimatorTestApi['historySteps']>[number] {
  const actor = step.actor;
  return { id: step.id, label: step.label, actor: actor === undefined || actor === null ? 'user' : actor.name, undone };
}

export function historyStepsOf(app: EditorApp): ReturnType<EkzaAnimatorTestApi['historySteps']> {
  const { undo, redo } = app.history.entries();
  return [...undo.map((step) => row(step, false)), ...redo.map((step) => row(step, true))];
}
