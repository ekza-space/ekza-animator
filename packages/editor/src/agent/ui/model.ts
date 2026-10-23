// Pure view model of the agent UI (MCP-SPEC §7.2, §7.5; B3): the status pill's text by session state, what each audit
// row offers (Undo when its step is the top of the undo stack, Revert otherwise, "undone", "reverted by step N",
// "can no longer be undone"), the steps "Revert all AI changes" takes back, and the [Show] toast trigger. No React.
import type { HistoryStep } from '@ekza-studio/editor-core';
import type { AgentAuditRow, AgentSessionState } from '../types';

export type PillTone = 'muted' | 'idle' | 'busy' | 'error';
export interface PillView {
  readonly text: string;
  readonly tone: PillTone;
}

/** Tools that only read (the pill says "AI is reading"). */
const READ_TOOLS: ReadonlySet<string> = new Set([
  'editor_connect',
  'projects_list',
  'scene_summary',
  'rig_describe',
  'keys_read',
  'curves_summary',
  'pose_read',
  'view_capture',
  'history_checkpoint',
  'model_inspect',
  'library_list',
]);

export interface PillContext {
  /** The clip the user is looking at for a character, or null. */
  readonly activeClipOf: (character: string) => string | null;
  readonly clipName: (clip: string) => string | null;
  /** The user's own steps on the redo stack (the redo wait, §5.12). */
  readonly userRedoSteps: number;
}

/** The running call's audit row (newest first), if any. */
export function runningRow(state: AgentSessionState): AgentAuditRow | null {
  for (let i = state.audit.length - 1; i >= 0; i--) {
    const row = state.audit[i] as AgentAuditRow;
    if (row.status === 'running' || row.status === 'waiting') return row;
  }
  return null;
}

/** The status-line pill (§7.5). Never colour alone: the text carries the state. */
export function pillView(state: AgentSessionState | null, ctx: PillContext): PillView {
  if (state === null) return { text: 'AI', tone: 'muted' };
  switch (state.status) {
    case 'off':
      return { text: 'AI', tone: 'muted' };
    case 'probing':
      return { text: 'AI: looking…', tone: 'busy' };
    case 'choosing':
      return { text: 'AI: choose a server', tone: 'busy' };
    case 'offering':
      return { text: state.code === null ? 'AI: pairing…' : `AI: code ${state.code.text}`, tone: 'busy' };
    case 'claimed':
      return { text: 'AI asks for access', tone: 'busy' };
    case 'paused':
      return { text: 'AI paused', tone: 'idle' };
    case 'error':
      return { text: 'AI: not connected', tone: 'error' };
    case 'paired':
      break;
  }
  if (state.confirm !== null) return { text: `AI asks: ${state.confirm.prompt.title}`, tone: 'busy' };
  if (state.queue.waitingFor === 'gesture') return { text: 'AI is waiting for your drag', tone: 'busy' };
  if (state.queue.waitingFor === 'redo') {
    const n = ctx.userRedoSteps;
    return { text: `AI is waiting: you have ${n} ${n === 1 ? 'step' : 'steps'} to redo`, tone: 'busy' };
  }
  const row = runningRow(state);
  const running = state.queue.running ?? row?.tool ?? null;
  if (running === null) return { text: 'AI connected', tone: 'idle' };
  if (row !== null && READ_TOOLS.has(row.tool)) return { text: 'AI is reading', tone: 'busy' };
  const label = row?.step?.label.replace(/^AI: /, '') ?? row?.digest ?? running;
  let where = '';
  if (row?.show !== null && row?.show !== undefined && ctx.activeClipOf(row.show.character) !== row.show.clip) {
    const name = ctx.clipName(row.show.clip);
    if (name !== null) where = ` (in "${name}")`;
  }
  return { text: `AI is editing: ${label}${where}`, tone: 'busy' };
}

export type RowAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'undo'; readonly step: number }
  | { readonly kind: 'revert'; readonly step: number }
  | { readonly kind: 'undone' }
  | { readonly kind: 'reverted'; readonly by: number | null }
  | { readonly kind: 'unreachable' };

export interface HistoryView {
  readonly undo: readonly HistoryStep[];
  readonly redo: readonly HistoryStep[];
}

/** What an audit row offers (§7.2). */
export function rowAction(
  row: AgentAuditRow,
  history: HistoryView,
  revertedBy: ReadonlyMap<number, number>,
): RowAction {
  const step = row.step;
  if (step === null) return { kind: 'none' };
  const by = revertedBy.get(step.id);
  if (by !== undefined) return { kind: 'reverted', by };
  if (row.reverted) return { kind: 'reverted', by: null };
  if (row.unreachable) return { kind: 'unreachable' };
  const index = history.undo.findIndex((entry) => entry.id === step.id);
  if (index >= 0) {
    if (index === history.undo.length - 1) return { kind: 'undo', step: step.id };
    const entry = history.undo[index] as HistoryStep;
    return entry.changes === undefined || entry.changes === null ? { kind: 'none' } : { kind: 'revert', step: step.id };
  }
  if (history.redo.some((entry) => entry.id === step.id)) return { kind: 'undone' };
  return { kind: 'unreachable' };
}

/** The AI steps "Revert all AI changes since pairing" takes back: still in the undo stack, not reverted (§5.11). */
export function revertAllSteps(
  audit: readonly AgentAuditRow[],
  history: HistoryView,
  revertedBy: ReadonlyMap<number, number>,
  /** The paired agent's actor id: its inner steps (rig_create, imports, library clips) count too (INT). */
  actorId: string | null = null,
): number[] {
  const out: number[] = [];
  for (const row of audit) {
    const action = rowAction(row, history, revertedBy);
    if ((action.kind === 'undo' || action.kind === 'revert') && !out.includes(action.step)) out.push(action.step);
  }
  if (actorId !== null) {
    // one tool call can make several steps (a composition's inner runs); the audit row names only the last one
    for (const entry of history.undo) {
      if (entry.actor?.id !== actorId || revertedBy.has(entry.id) || out.includes(entry.id)) continue;
      if (entry.changes === undefined || entry.changes === null) continue;
      out.push(entry.id);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * The first edit of a clip the user is not looking at raises `AI is working on clip "<name>"` with [Show] (§5.11).
 * Returns the row that should raise it now, or null.
 */
export function toastRow(
  audit: readonly AgentAuditRow[],
  toasted: ReadonlySet<string>,
  activeClipOf: (character: string) => string | null,
): AgentAuditRow | null {
  for (let i = audit.length - 1; i >= 0; i--) {
    const row = audit[i] as AgentAuditRow;
    if (row.step === null || row.show === null || row.status !== 'ok') continue;
    if (toasted.has(row.show.clip)) continue;
    if (activeClipOf(row.show.character) === row.show.clip) continue;
    return row;
  }
  return null;
}

/** `12:04:31` (local time). */
export function clockOf(at: number): string {
  const d = new Date(at);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
