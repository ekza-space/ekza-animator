// Tool definitions (MCP-SPEC §4.4, §6): `defineTool` keeps a definition's input and output types together, and D0's
// stubs answer `unsupported` "not available yet" with `ready: false` (§3 rule 1) until their owner lands the tool.
import { z } from 'zod';
import { TRUNCATED_FIELD } from '../budget/budget';
import type { AgentToolDef, AgentToolResult } from '../types';
import { AgentToolFailure } from '../types';

/** The run of a tool that is not built yet (§3 rule 1). */
export function notAvailableYet(name: string): () => Promise<AgentToolResult<never>> {
  return () =>
    Promise.reject(
      new AgentToolFailure(
        'unsupported',
        `${name} is not available yet.`,
        'Use another tool; this one is not built yet.',
        {
          retryable: false,
        },
      ),
    );
}

/** Budgets of §5.5 by kind of result (tokens = default response, maxTokens = the hard cap). */
export const BUDGETS = {
  summary: { tokens: 600, maxTokens: 2_000 },
  read: { tokens: 1_500, maxTokens: 8_000 },
  rawKeys: { tokens: 2_000, maxTokens: 8_000 },
  write: { tokens: 400, maxTokens: 1_500 },
  image: { tokens: 600, maxTokens: 2_000, image: { maxEdgePx: 1_568 } },
} as const;

type Def<I extends z.ZodObject, O extends z.ZodType> = Omit<AgentToolDef<I, O>, 'run' | 'ready'> & {
  readonly ready?: boolean;
  readonly run?: AgentToolDef<I, O>['run'];
};

/**
 * The output with the `truncated` field every result may carry (§5.5): the runtime sets `truncated: true` when it cuts
 * a result to the hard cap, and the advertised `data` object is closed, so every output declares the field. An output
 * that declares its own `truncated` (keys_read, curves_summary, pose_read) keeps it.
 */
export function withTruncated<O extends z.ZodType>(output: O): z.ZodType {
  if (!(output instanceof z.ZodObject) || Object.hasOwn(output.shape, 'truncated')) return output;
  return output.extend({ truncated: TRUNCATED_FIELD });
}

/** A tool definition; without `run` it is a D0 stub (`ready: false`, answers `unsupported`). */
export function defineTool<I extends z.ZodObject, O extends z.ZodType>(def: Def<I, O>): AgentToolDef {
  const run = def.run ?? notAvailableYet(def.name);
  return { ...def, output: withTruncated(def.output), ready: def.ready ?? false, run } as unknown as AgentToolDef;
}
