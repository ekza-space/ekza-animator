// The eager side of the M-AI explicit-target operators (MCP-SPEC §4.10): their definitions, the §5.5 bounds and the
// loader of their implementation. Everything else — the deep argument checks of their polls, the applies and the
// goal, loop, retime and adjust workflows (`agentImpl.ts` and the modules it imports) — loads on first use, so the
// editor's first visit does not carry it (§9.2 `check:size`).
//
// Polls answer in two phases. Before the implementation has loaded, a cheap shape check (an editable document and
// an existing `clip`) that also starts the load; once it has loaded, the full check. The runner polls again after
// `prepare`, which awaits the load, so a run's outcome (finished, or refused with the full reason) never depends on
// whether the chunk was already there; only a bare `poll` before the first load answers the shape check alone.
import type { ClipRecord, ReadView } from '@ekza-animator/doc';
import {
  type ApplyContext,
  type EditorApp,
  GLOBAL_SCOPE,
  type OperatorArgs,
  type OperatorCategory,
  type OperatorReturn,
  type PollResult,
} from '../../types';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';
import { pollEditable } from './polls';
import type * as AgentImplModule from './agentImpl';

export type AgentImpl = typeof AgentImplModule;
/** The operators whose polls and applies live in the implementation. */
export type AgentOperatorId = keyof AgentImpl['AGENT_POLLS'];

/** Frames of every frame argument lie in −100,000…100,000 (MCP-SPEC §5.5). */
export const AGENT_FRAME_LIMIT = 100_000;
/** An agent-grown clip range, and the frame span an operator loops over under an actor, stay ≤ 100,000 frames. */
export const AGENT_SPAN_LIMIT = 100_000;
/** Key records one call writes or deletes at most (§5.5). */
export const AGENT_WRITE_LIMIT = 50_000;

/** Why a frame value is not a frame of §5.5 (finite, −100,000…100,000), or null. */
export function frameProblem(value: unknown, name: string): string | null {
  if (!isFiniteNumber(value)) return `${name} must be a finite frame`;
  return Math.abs(value) > AGENT_FRAME_LIMIT ? `${name} must lie within ±${AGENT_FRAME_LIMIT} frames` : null;
}

/** Why a list of frames is malformed (empty, too long, a bad frame), or null. */
export function framesProblem(value: unknown, name: string, max = AGENT_WRITE_LIMIT): string | null {
  if (!Array.isArray(value)) return `${name} must be a list of frames`;
  const list = value as readonly unknown[];
  if (list.length === 0) return `${name} is empty`;
  if (list.length > max) return `${name} has more than ${max} frames`;
  for (const frame of list) {
    const problem = frameProblem(frame, name);
    if (problem !== null) return problem;
  }
  return null;
}

/** The `label` argument the tool layer sets (≤ 80 characters after the runner's prefix), else `fallback`. */
export function labelOf(args: unknown, fallback: string): string {
  const label = isRecord(args) ? args['label'] : undefined;
  return typeof label === 'string' && label.trim().length > 0 ? label : fallback;
}

/** The clip a record argument names (`clip` by default), when it exists. */
export function clipArg(view: ReadView, args: unknown, field = 'clip'): ClipRecord | undefined {
  if (!isRecord(args) || typeof args[field] !== 'string') return undefined;
  return view.get('clips', args[field] as ClipRecord['id']);
}

/** Editable document and an existing clip in `args.clip`. */
export function pollAgentClip(app: EditorApp, args: unknown): PollResult {
  if (!isRecord(args) || typeof args['clip'] !== 'string') return fail('expects { clip, … }');
  const editable = pollEditable(app);
  if (editable !== true) return editable;
  return clipArg(app.store, args) === undefined ? fail('The clip does not exist') : OK;
}

let loading: Promise<AgentImpl> | null = null;
let loaded: AgentImpl | null = null;

/** Loads the implementation once; a failed load is retried by the next call. Hosts may call it to prefetch. */
export function loadAgentImpl(): Promise<AgentImpl> {
  if (loading === null) {
    loading = import('./agentImpl').then((impl) => {
      loaded = impl;
      return impl;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** The implementation once it has loaded, else null. */
export function loadedAgentImpl(): AgentImpl | null {
  return loaded;
}

/**
 * An explicit-target operator (undoable, internal, global): its poll is the implementation's full check once loaded
 * (the shape check before, which starts the load), its `prepare` loads the implementation for `apply`.
 */
export function agentOperator<K extends AgentOperatorId>(def: {
  readonly id: K;
  readonly label: string;
  readonly description: string;
  readonly category: OperatorCategory;
  readonly undoLabel?: (args: OperatorArgs<K>) => string;
  readonly apply: (ctx: ApplyContext, args: OperatorArgs<K>, impl: AgentImpl) => OperatorReturn<K>;
}): AnyOperator {
  const { id, label } = def;
  return defineOperator<K, AgentImpl>({
    ...def,
    scope: GLOBAL_SCOPE,
    flags: { undo: true, internal: true },
    undoLabel: def.undoLabel ?? ((args) => labelOf(args, label)),
    poll(ctx, raw) {
      if (loaded !== null) return loaded.AGENT_POLLS[id](ctx, raw);
      void loadAgentImpl();
      return pollAgentClip(ctx.app, raw);
    },
    prepare: () => loadAgentImpl(),
  });
}
