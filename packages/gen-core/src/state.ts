// The job state machine (research 15 §5.6). The gateway applies every change through `canTransition`; the client uses
// `isTerminal` to stop watching.
import type { JobState } from './types.ts';

export const TERMINAL_STATES: readonly JobState[] = ['succeeded', 'failed', 'blocked', 'canceled', 'expired'];

const PROVIDER_OUTCOMES: readonly JobState[] = ['failed', 'blocked', 'canceled', 'expired'];

/**
 * Allowed transitions. A provider can report any later state at the next poll (a webhook may be missed), so `queued`
 * reaches `fetching` directly; Meshy may step a task back from running to pending (`running → queued`); a job of
 * several provider stages (Meshy's preview → refine) goes `running → submitting` for the next stage. `fetching` ends
 * in `succeeded`, or `failed`/`expired` when the downloads cannot be completed.
 */
const NEXT: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: ['queued', 'submitting', 'running', 'fetching', ...PROVIDER_OUTCOMES],
  submitting: ['queued', 'running', 'fetching', 'failed', 'blocked', 'canceled'],
  running: ['queued', 'submitting', 'running', 'fetching', ...PROVIDER_OUTCOMES],
  fetching: ['fetching', 'succeeded', 'failed', 'expired'],
  succeeded: [],
  failed: [],
  blocked: [],
  canceled: [],
  expired: [],
};

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: JobState, to: JobState): boolean {
  return NEXT[from].includes(to);
}

/** The states a cancel request may still act on: before the create request, or while the provider holds the task. */
export function isCancelable(state: JobState): boolean {
  return state === 'queued' || state === 'submitting' || state === 'running';
}
