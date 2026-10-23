// The eager side of the M-AI explicit-target operators (MCP-SPEC §4.10): their definitions, the §5.5 bounds and the
// loader of their implementation. Everything else — the deep argument checks of their polls, the applies and the
// goal, loop, retime and adjust workflows (`agentImpl.ts` and the modules it imports) — loads on first use, so the
// editor's first visit does not carry it (§9.2 `check:size`).
//
// Polls answer in two phases. Before the implementation has loaded, a cheap shape check (an editable document and
// an existing `clip`) that also starts the load; once it has loaded, the full check. The runner polls again after
// `prepare`, which awaits the load, so a run's outcome (finished, or refused with the full reason) never depends on
// whether the chunk was already there; only a bare `poll` before the first load answers the shape check alone.
import type { ClipRecord, ReadView } from '@ekza-studio/doc';
import {
  type ApplyContext,
  type EditorApp,
  GLOBAL_SCOPE,
  type OperatorArgs,
  type OperatorCategory,
  type OperatorReturn,
  type PollResult,
} from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { pollEditable } from './polls';
import { type AgentImpl, type AgentOperatorId, loadAgentImpl, loadedAgentImpl } from './agentBase';

export {
  AGENT_FRAME_LIMIT,
  AGENT_SPAN_LIMIT,
  AGENT_WRITE_LIMIT,
  type AgentImpl,
  type AgentOperatorId,
  frameProblem,
  framesProblem,
  loadAgentImpl,
  loadedAgentImpl,
} from './agentBase';

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
      const loaded = loadedAgentImpl();
      if (loaded !== null) return loaded.AGENT_POLLS[id](ctx, raw);
      void loadAgentImpl();
      return pollAgentClip(ctx.app, raw);
    },
    prepare: () => loadAgentImpl(),
  });
}
