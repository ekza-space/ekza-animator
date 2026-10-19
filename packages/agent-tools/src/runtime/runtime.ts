// The minimal working tool runtime (MCP-SPEC §8 D0 item 6, §3 rule 1a): strict validation, host/needs/grant/pause
// gating, `ctx.run` wiring with `actor`, `runScope` and `access`, the envelope, error mapping, the one sanitiser and the
// budgets' hard cut, and the resolver. P2 adds the call queue, the gesture and redo waits, confirmations, deadlines,
// presence focus timing and the automatic stale check on top of this file.
import type { AgentAccess, RunContext } from '@ekza-animator/editor-core';
import type { z } from 'zod';
import { failureFrom } from '../envelope/errors';
import { finishResult } from '../envelope/envelope';
import { createResolver } from '../resolve/resolver';
import { sanitizeText } from '../sanitize/sanitize';
import { allTools, readyTools } from '../tools/catalogue';
import {
  AgentToolFailure,
  type AgentToolContext,
  type AgentToolDef,
  type AgentToolResult,
  type AgentToolRuntime,
  type AgentToolRuntimeOptions,
  type Grant,
  type OperatorRun,
  type ToolAccess,
} from '../types';
import { createRevisionTracker } from './revisions';

export const DEFAULT_GESTURE_WAIT_MS = 15_000;
export const DEFAULT_CONFIRM_TIMEOUT_MS = 50_000;
/** Labels (§5.6): `AI: <intent> · <tool label>`, at most 80 characters with the prefix. */
export const LABEL_MAX = 80;
const AI_PREFIX = 'AI: ';
const INTENT_SEPARATOR = ' · ';
export const INTENT_MAX_CHARS = 60;

/** The path of a zod issue as the agent writes it: `set[2].rotateDeg.x`. */
export function issuePath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out === '' ? '(root)' : out;
}

/** `invalid_args` for a schema-invalid call (§5.4): the failing path, what was expected, the other problems. */
export function invalidArgs(tool: AgentToolDef, error: z.ZodError): AgentToolFailure {
  const issues = error.issues.map((issue) => {
    const keys = issue.code === 'unrecognized_keys' ? (issue as { readonly keys: readonly string[] }).keys : [];
    const path = keys.length > 0 ? [...issue.path, keys[0] as string] : issue.path;
    const message = keys.length > 0 ? `unknown key ${keys.map((k) => `'${k}'`).join(', ')}` : issue.message;
    return { path: issuePath(path), message };
  });
  const first = issues[0] ?? { path: '(root)', message: 'invalid arguments' };
  return new AgentToolFailure(
    'invalid_args',
    `${tool.name}: ${first.path}: ${first.message}.`,
    `fix ${first.path} and call ${tool.name} again; its input schema lists every field with its unit`,
    { detail: { path: first.path, issues: issues.slice(0, 5) } },
  );
}

/** Cuts text at a word boundary to `max` characters (no ellipsis; the label's own part follows). */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * The operator label of an agent edit (§5.6): the tool's label with the call's intent in front, cut at a word
 * boundary so `AI: <intent> · <tool label>` fits 80 characters; the tool's own label always stays whole.
 */
export function composeLabel(toolLabel: string, intent: string | null): string {
  if (intent === null || intent === '') return toolLabel;
  const room = LABEL_MAX - AI_PREFIX.length - INTENT_SEPARATOR.length - toolLabel.length;
  if (room < 4) return toolLabel;
  const shown = cutAtWord(intent, room);
  return shown === '' ? toolLabel : `${shown}${INTENT_SEPARATOR}${toolLabel}`;
}

const GRANT_NAMES: Readonly<Record<Exclude<Grant, 'read'>, string>> = {
  edit: 'Edit',
  files: 'Files',
  view: 'View',
};

export function createAgentToolRuntime(opts: AgentToolRuntimeOptions): AgentToolRuntime {
  const { app, host, actor } = opts;
  const all = opts.tools ?? allTools();
  const byName = new Map(all.map((tool) => [tool.name, tool]));
  const tools = readyTools(all);
  const revisions = createRevisionTracker(app);

  const gate = (tool: AgentToolDef, access: ToolAccess): void => {
    if (!tool.hosts.includes(host.mode)) {
      throw new AgentToolFailure(
        'unsupported',
        `${tool.name} is not available in ${host.mode} mode.`,
        host.mode === 'headless'
          ? 'it needs the user’s editor: editor_connect'
          : 'use a headless project (project_open)',
        { retryable: false },
      );
    }
    for (const capability of tool.needs ?? []) {
      if (!host.capabilities.has(capability)) {
        throw new AgentToolFailure(
          'unsupported',
          `${tool.name} needs ${capability}, which this host lacks.`,
          'use another tool',
          {
            retryable: false,
          },
        );
      }
    }
    if (access === 'view' && !host.capabilities.has('view')) {
      throw new AgentToolFailure(
        'unsupported',
        'Changing what the user sees needs the user’s editor.',
        'leave the View change out, or ask the user to connect the editor',
        { retryable: false },
      );
    }
    if (access === 'edit' || access === 'files' || access === 'view') {
      if (!host.grants()[access]) {
        throw new AgentToolFailure(
          'not_granted',
          `${tool.name} needs the ${GRANT_NAMES[access]} grant.`,
          `only the user can give the ${GRANT_NAMES[access]} grant, in the Agent panel`,
          { retryable: false, detail: { grant: access } },
        );
      }
    }
    if (access !== 'pairing' && host.paused()) {
      throw new AgentToolFailure(
        'paused',
        'The user paused the agent.',
        'the user paused the agent: stop and wait until the user resumes it; do not retry',
        { retryable: false },
      );
    }
  };

  const context = (
    tool: AgentToolDef,
    signal: AbortSignal,
    intent: string | null,
    progress: ((done: number, total: number | null, message?: string) => void) | undefined,
  ): AgentToolContext => ({
    app,
    host,
    actor,
    signal,
    resolve: createResolver(app, { forEdit: tool.kind !== 'read', userSession: host.capabilities.has('user') }),
    revisions,
    async run(id, args, runOpts): Promise<OperatorRun> {
      const record =
        typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
      const label = record?.['label'];
      const labelled =
        record !== null && typeof label === 'string' ? { ...record, label: composeLabel(label, intent) } : args;
      const before = app.history.peekUndo()?.id ?? null;
      const access: AgentAccess = runOpts?.access ?? 'edit';
      const ctx: RunContext = {
        source: 'api',
        actor,
        signal,
        access,
        ...(runOpts?.runScope === undefined ? {} : { runScope: runOpts.runScope }),
      };
      const result = await app.runUntyped(id, labelled, ctx);
      const top = app.history.peekUndo();
      const step =
        top !== null && top.id !== before && top.actor?.id === actor.id ? { id: top.id, label: top.label } : null;
      return { result, step, warnings: [] };
    },
    progress(done, total, message) {
      progress?.(done, total, message);
    },
    focus(focus, activity) {
      if (!host.capabilities.has('presence')) return;
      app.presence.upsert({
        id: actor.id,
        kind: 'agent',
        name: actor.name,
        color: '--presence-agent',
        focus,
        activity: sanitizeText(activity, { maxChars: 120, kind: 'name' }),
      });
    },
  });

  return {
    tools,
    async call(name, rawArgs, callOpts): Promise<AgentToolResult<unknown>> {
      const tool = byName.get(name);
      try {
        if (tool === undefined) {
          throw new AgentToolFailure(
            'unsupported',
            `There is no tool ${sanitizeText(name, { maxChars: 40, kind: 'name' })}.`,
            'tools/list lists the tools',
            {
              retryable: false,
            },
          );
        }
        if (!tool.ready) {
          throw new AgentToolFailure('unsupported', `${tool.name} is not available yet.`, 'use another tool', {
            retryable: false,
          });
        }
        const parsed = tool.input.safeParse(rawArgs ?? {});
        if (!parsed.success) throw invalidArgs(tool, parsed.error);
        const args: Readonly<Record<string, unknown>> = parsed.data;
        const access = typeof tool.access === 'function' ? tool.access(args, host.mode) : tool.access;
        gate(tool, access);
        if (callOpts.signal.aborted) {
          throw new AgentToolFailure('cancelled', `${tool.name} was cancelled before it ran.`, 'nothing changed');
        }
        const intentArg = args['intent'];
        const intent =
          typeof intentArg === 'string' ? sanitizeText(intentArg, { maxChars: INTENT_MAX_CHARS, kind: 'name' }) : null;
        // Every result that carries a clip marks it seen (§4.4): P2, which knows the clip id behind ClipInfo.
        const result = await tool.run(context(tool, callOpts.signal, intent, callOpts.progress), args);
        return finishResult(result, tool.budget.maxTokens);
      } catch (error) {
        return finishResult({ ok: false, error: failureFrom(error).toError() }, null);
      }
    },
  };
}

/** Defaults the contract names (§4.4): exported for hosts that show them. */
export const RUNTIME_DEFAULTS = {
  gestureWaitMs: DEFAULT_GESTURE_WAIT_MS,
  confirmTimeoutMs: DEFAULT_CONFIRM_TIMEOUT_MS,
} as const;
