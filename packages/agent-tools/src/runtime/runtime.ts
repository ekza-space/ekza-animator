// The tool runtime (MCP-SPEC §4.4, §5.8, §5.9, §5.11, §5.12). D0 landed the minimal path (strict validation,
// host/needs/grant/pause gating, `ctx.run` wiring with `actor`, `runScope` and `access`, the envelope, error mapping,
// the one sanitiser and the budgets' hard cut, the resolver); P2 adds the rest of the call path:
// - a rate limit (20 calls per second, bursts of 50) and a queue: `edit` and `files` calls run one at a time in
//   arrival order (tool order = history order), `read` calls run at once; at most 64 calls wait (`busy` beyond);
// - the gesture wait before every operator run (the user's drag, up to `gestureWaitMs`, `busy` after it), and the
//   redo wait with a user session (the user's own undone steps: the confirm card, resolved when the user redoes or
//   edits; `redo_pending` on Deny or timeout);
// - confirmations of consequential calls (live: the card, `declined` on Deny or after `confirmTimeoutMs`; headless:
//   `confirm: true`, else `confirm_required`), read-only projects, cooperative cancellation at every wait;
// - presence focus and activity (cleared 3 s after the call), progress throttled to 4 per second, toasts raised
//   during an operator run returned as warnings, and the actor's own steps and batches (revisions, history tools).
import type { CharacterId, ClipId, ControlId } from '@ekza-animator/doc';
import type { AgentAccess, Notifier, RunContext } from '@ekza-animator/editor-core';
import type { z } from 'zod';
import { outputJsonSchemaOf } from '../budget/budget';
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
  type ConfirmPrompt,
  type ExtraGrant,
  type OperatorRun,
  type RevisionTracker,
  type ToolAccess,
} from '../types';
import { type ActorRevisionTracker, createRevisionTracker } from './revisions';

export const DEFAULT_GESTURE_WAIT_MS = 15_000;
export const DEFAULT_CONFIRM_TIMEOUT_MS = 50_000;
/** Labels (§5.6): `AI: <intent> · <tool label>`, at most 80 characters with the prefix. */
export const LABEL_MAX = 80;
const AI_PREFIX = 'AI: ';
const INTENT_SEPARATOR = ' · ';
export const INTENT_MAX_CHARS = 60;
/** Progress messages (§5.3): prose, at most this many characters. */
export const PROGRESS_MAX_CHARS = 120;
/** §5.8: progress notifications at most 4 per second. */
export const PROGRESS_MIN_INTERVAL_MS = 250;
/** §5.8 2: per tab or project, 20 calls per second with bursts of 50; at most 64 waiting calls. */
export const RATE_PER_SECOND = 20;
export const RATE_BURST = 50;
export const QUEUE_MAX = 64;
/** §5.11: focus and activity are cleared this long after a call ends. */
export const FOCUS_LINGER_MS = 3_000;

/**
 * Progress messages of the waits (§5.8 4, 4a, 5): the host shows them, and a confirm or redo card that opens extends
 * the call's deadline once by `confirmTimeoutMs` (the bridge recognises `WAITING_FOR_CONFIRM` and `WAITING_FOR_REDO`).
 */
export const WAITING_FOR_DRAG = 'waiting for your drag to finish';
export const WAITING_FOR_CONFIRM = 'waiting for your confirmation';
export const WAITING_FOR_REDO = 'waiting: you have steps to redo';

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
  const example = tool.example;
  return new AgentToolFailure(
    'invalid_args',
    `${tool.name}: ${first.path}: ${first.message}.`,
    example === undefined
      ? `fix ${first.path} and call ${tool.name} again; its input schema lists every field with its unit`
      : `fix ${first.path} and call ${tool.name} again; detail.example is a minimal valid call`,
    { detail: { path: first.path, issues: issues.slice(0, 5), ...(example === undefined ? {} : { example }) } },
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

const GRANT_NAMES: Readonly<Record<ExtraGrant, string>> = {
  edit: 'Edit',
  files: 'Files',
  view: 'View',
};

/** `A`, `A and B`, `A, B and C`. */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** The envelope when even the error path fails (a failure whose detail cannot be sanitised): fixed text, no detail. */
const INTERNAL_FALLBACK: AgentToolResult<unknown> = {
  ok: false,
  error: {
    code: 'internal',
    message: 'The tool failed unexpectedly.',
    hint: 'report this; the document was rolled back',
    retryable: false,
  },
};

// ---------- per-runtime state the history tools and paged reads share (one runtime = one actor) ----------
export interface CheckpointRecord {
  readonly id: string;
  readonly label: string | null;
  /** Id of the newest undo step when it was taken, 0 when the undo stack was empty. */
  readonly stepId: number;
  readonly docVersion: number;
  readonly at: number;
}
export interface CursorRecord {
  readonly tool: string;
  /** What the cursor continues (the tool's own query key) and where. */
  readonly query: string;
  readonly offset: number;
}
/** State of one runtime that tools reach through `runtimeStateOf(ctx)`. */
export interface RuntimeState {
  readonly checkpoints: Map<string, CheckpointRecord>;
  readonly cursors: Map<string, CursorRecord>;
  /** History step ids this actor recorded, oldest first (`history_revert`'s `unreachable`). */
  readonly ownSteps: number[];
  /** How long an edit waits for the user's drag (§5.8 4); tools that navigate the history wait as long. */
  readonly gestureWaitMs: number;
  /** Random handle bodies (`cp_`, `cur_` + 12 base62 characters). */
  handle(prefix: 'cp' | 'cur'): string;
}
/** Cursors kept per runtime (oldest dropped: the agent repeats the read, §5.1). */
export const CURSOR_MAX = 64;
/** Own step ids remembered per runtime. */
const OWN_STEPS_MAX = 5_000;

const STATES = new WeakMap<RevisionTracker, RuntimeState>();

/** The per-runtime state behind a tool context (checkpoints, cursors, the actor's own steps). */
export function runtimeStateOf(ctx: Pick<AgentToolContext, 'revisions'>): RuntimeState {
  const state = STATES.get(ctx.revisions);
  if (state === undefined) throw new Error('runtimeStateOf: the context does not belong to an agent tool runtime');
  return state;
}

/** The actor revision tracker behind a tool context (own-batch marking). */
export function actorRevisionsOf(ctx: Pick<AgentToolContext, 'revisions'>): ActorRevisionTracker {
  return ctx.revisions as ActorRevisionTracker;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 12 random base62 characters (crypto.getRandomValues, rejection sampling). */
export function randomBase62(length = 12): string {
  const out: string[] = [];
  const bytes = new Uint8Array(length * 2);
  while (out.length < length) {
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= 248) continue; // 248 = 4 × 62: unbiased
      out.push(BASE62[byte % 62] as string);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

function createState(gestureWaitMs: number): RuntimeState {
  return {
    checkpoints: new Map(),
    cursors: new Map(),
    ownSteps: [],
    gestureWaitMs,
    handle: (prefix) => `${prefix}_${randomBase62()}`,
  };
}

/** A runtime that also releases its subscriptions and timers. */
export interface AgentToolRuntimeHandle extends AgentToolRuntime {
  dispose(): void;
}

/** Resolves after `ms`, or rejects `cancelled` when the signal aborts first. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelledFailure());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(cancelledFailure());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function cancelledFailure(): AgentToolFailure {
  return new AgentToolFailure('cancelled', 'The call was cancelled before the edit applied.', 'nothing changed');
}

/** A timer that never keeps a Node process alive (no `node:*` import: `unref` when the host has it). */
function softTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms);
  (timer as unknown as { unref?: () => void }).unref?.();
  return timer;
}

export function createAgentToolRuntime(opts: AgentToolRuntimeOptions): AgentToolRuntimeHandle {
  const { app, host, actor } = opts;
  const gestureWaitMs = opts.gestureWaitMs ?? DEFAULT_GESTURE_WAIT_MS;
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const all = opts.tools ?? allTools();
  const byName = new Map(all.map((tool) => [tool.name, tool]));
  const tools = readyTools(all);
  const revisions = createRevisionTracker(app);
  const state = createState(gestureWaitMs);
  STATES.set(revisions, state);
  const presence = host.capabilities.has('presence');

  // ---------- rate limit (token bucket) and the queue ----------
  let tokens = RATE_BURST;
  let refilledAt = Date.now();
  const takeToken = (): boolean => {
    const now = Date.now();
    tokens = Math.min(RATE_BURST, tokens + ((now - refilledAt) / 1_000) * RATE_PER_SECOND);
    refilledAt = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
  let tail: Promise<void> = Promise.resolve();
  let waiting = 0;

  // ---------- presence (§5.11) ----------
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFocus: {
    readonly character: CharacterId | null;
    readonly clip: ClipId | null;
    readonly controls: readonly ControlId[];
    readonly frame: number | null;
  } | null = null;
  const setPresence = (
    focus: {
      readonly character: CharacterId | null;
      readonly clip: ClipId | null;
      readonly controls: readonly ControlId[];
      readonly frame: number | null;
    } | null,
    activity: string | null,
  ): void => {
    if (!presence) return;
    if (focusTimer !== null) {
      clearTimeout(focusTimer);
      focusTimer = null;
    }
    lastFocus = focus;
    app.presence.upsert({
      id: actor.id,
      kind: 'agent',
      name: actor.name,
      color: '--presence-agent',
      focus: focus === null ? null : { ...focus, controls: focus.controls.slice(0, 64) },
      activity: activity === null ? null : sanitizeText(activity, { maxChars: 120, kind: 'name' }),
    });
  };
  const lingerThenClear = (): void => {
    if (!presence) return;
    if (focusTimer !== null) clearTimeout(focusTimer);
    focusTimer = softTimeout(() => {
      focusTimer = null;
      setPresence(null, null);
    }, FOCUS_LINGER_MS);
  };

  const gate = (tool: AgentToolDef, access: ToolAccess, extra: readonly ExtraGrant[]): void => {
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
    // The grants this call needs: its access, then the extra ones (§5.9, Q-AI-38), each once.
    const needed: ExtraGrant[] = [];
    for (const grant of [access, ...extra]) {
      if ((grant === 'edit' || grant === 'files' || grant === 'view') && !needed.includes(grant)) needed.push(grant);
    }
    if (needed.includes('view') && !host.capabilities.has('view')) {
      throw new AgentToolFailure(
        'unsupported',
        'Changing what the user sees needs the user’s editor.',
        'leave the View change out, or ask the user to connect the editor',
        { retryable: false },
      );
    }
    const grants = host.grants();
    const missing = needed.filter((grant) => !grants[grant]);
    const first = missing[0];
    if (first !== undefined) {
      const names = listed(missing.map((grant) => GRANT_NAMES[grant]));
      const plural = missing.length === 1 ? 'grant' : 'grants';
      throw new AgentToolFailure(
        'not_granted',
        `${tool.name} needs the ${names} ${plural}.`,
        `only the user can give the ${names} ${plural}, in the Agent panel`,
        { retryable: false, detail: { grant: first, ...(missing.length === 1 ? {} : { grants: missing }) } },
      );
    }
    checkPaused(access);
  };

  const checkPaused = (access: ToolAccess): void => {
    if (access !== 'pairing' && host.paused()) {
      throw new AgentToolFailure(
        'paused',
        'The user paused the agent.',
        'the user paused the agent: stop and wait until the user resumes it; do not retry',
        { retryable: false },
      );
    }
  };

  /** Asks the user (live) with the confirmation timeout; `resolved` only with `resolvedWhen`. */
  const ask = async (
    prompt: ConfirmPrompt,
    signal: AbortSignal,
    resolvedWhen?: () => boolean,
  ): Promise<'allow' | 'deny' | 'timeout' | 'resolved'> => {
    const card = new AbortController();
    const onAbort = (): void => card.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = softTimeout(() => {
        card.abort();
        resolve('timeout');
      }, confirmTimeoutMs);
    });
    try {
      const answer = await Promise.race([
        host.confirm(prompt, card.signal, resolvedWhen === undefined ? undefined : { resolvedWhen }),
        timeout,
      ]);
      if (signal.aborted) throw cancelledFailure();
      return answer;
    } finally {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      card.abort();
    }
  };

  /** §5.9: a consequential call is confirmed by the user (live) or carries `confirm: true` (headless). */
  const confirmCall = async (
    tool: AgentToolDef,
    ctx: AgentToolContext,
    args: Readonly<Record<string, unknown>>,
    progress: (message: string) => void,
  ): Promise<void> => {
    const prompt = tool.confirm?.(ctx, args) ?? null;
    if (prompt === null) return;
    if (!host.capabilities.has('confirm')) {
      if (args['confirm'] === true) return;
      throw new AgentToolFailure(
        'confirm_required',
        `${prompt.title} ${prompt.detail}`,
        'this call is consequential: pass confirm: true to go ahead',
        { detail: { title: prompt.title, lost: prompt.detail } },
      );
    }
    progress(WAITING_FOR_CONFIRM);
    const answer = await ask(prompt, ctx.signal);
    if (answer === 'allow') return;
    throw new AgentToolFailure(
      'declined',
      answer === 'timeout'
        ? `The user did not answer "${prompt.title}" in time.`
        : `The user declined: "${prompt.title}"`,
      'do not retry without asking the user',
      { retryable: false },
    );
  };

  /** Steps of the user's own (no actor) on the redo stack: an edit would destroy them (§5.8 4a). */
  const userRedoSteps = (): number =>
    app.history.entries().redo.filter((step) => step.actor === null || step.actor === undefined).length;

  const context = (
    tool: AgentToolDef,
    signal: AbortSignal,
    intent: string | null,
    dryRun: boolean,
    progress: (done: number, total: number | null, message?: string) => void,
    warnings: string[],
  ): AgentToolContext => {
    const waitForGesture = async (): Promise<void> => {
      if (signal.aborted) throw cancelledFailure();
      const previewing = app.store.preview?.active === true;
      if (previewing) {
        progress(0, null, WAITING_FOR_DRAG);
        if (presence) setPresence(lastFocus, 'waiting for your drag');
      }
      const done = await abortable(host.waitForGesture(signal, gestureWaitMs), signal);
      if (!done) {
        throw new AgentToolFailure('busy', 'The user kept dragging; the edit did not run.', 'retry in a moment', {
          retryable: true,
        });
      }
    };
    const waitForRedo = async (): Promise<void> => {
      if (dryRun || !host.capabilities.has('user')) return;
      const count = userRedoSteps();
      if (count === 0) return;
      const prompt: ConfirmPrompt = {
        title: `AI edit will clear your redo (${count} step${count === 1 ? '' : 's'})`,
        detail: 'Redo your steps first to keep them, or allow the AI edit to clear them.',
        danger: false,
      };
      if (!host.capabilities.has('confirm')) {
        throw redoPending(count);
      }
      progress(0, null, WAITING_FOR_REDO);
      if (presence) setPresence(lastFocus, `waiting: you have ${count} step${count === 1 ? '' : 's'} to redo`);
      const answer = await ask(prompt, signal, () => userRedoSteps() === 0);
      if (answer === 'allow' || answer === 'resolved') return;
      throw redoPending(count);
    };
    return {
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
        await waitForGesture();
        await waitForRedo();
        // The user may have started a drag while the card was open.
        await waitForGesture();
        if (signal.aborted) throw cancelledFailure();
        const before = app.history.peekUndo()?.id ?? null;
        const access: AgentAccess = runOpts?.access ?? 'edit';
        const ctx: RunContext = {
          source: 'api',
          actor,
          signal,
          access,
          ...(runOpts?.runScope === undefined ? {} : { runScope: runOpts.runScope }),
        };
        const toasts: string[] = [];
        const restore = captureToasts(app.services.notify, toasts);
        let result;
        try {
          result = await app.runUntyped(id, labelled, ctx);
        } finally {
          restore();
        }
        const top = app.history.peekUndo();
        const own = top !== null && top.id !== before && top.actor?.id === actor.id;
        if (own) {
          if (top.docTxId !== null) revisions.markOwn(top.docTxId);
          state.ownSteps.push(top.id);
          if (state.ownSteps.length > OWN_STEPS_MAX) state.ownSteps.splice(0, state.ownSteps.length - OWN_STEPS_MAX);
        }
        warnings.push(...toasts);
        return { result, step: own ? { id: top.id, label: top.label } : null, warnings: toasts };
      },
      progress,
      focus(focus, activity) {
        if (!presence) return;
        setPresence(focus, activity);
      },
    };
  };

  /** Runs a call that passed validation and the gate: confirmation, the tool, the envelope. */
  const execute = async (
    tool: AgentToolDef,
    args: Readonly<Record<string, unknown>>,
    access: ToolAccess,
    callOpts: Parameters<AgentToolRuntime['call']>[2],
  ): Promise<AgentToolResult<unknown>> => {
    const { signal } = callOpts;
    if (signal.aborted) {
      throw new AgentToolFailure('cancelled', `${tool.name} was cancelled before it ran.`, 'nothing changed');
    }
    // §5.9: Pause holds nothing — a call that waited in the queue meets the pause too.
    checkPaused(access);
    if (tool.kind === 'edit' && app.store.readOnly) {
      throw new AgentToolFailure(
        'read_only',
        'This project opened read-only.',
        'this project was saved by a newer editor; ask the user',
        { retryable: false },
      );
    }
    const intentArg = args['intent'];
    const intent =
      typeof intentArg === 'string' ? sanitizeText(intentArg, { maxChars: INTENT_MAX_CHARS, kind: 'name' }) : null;
    let lastProgress = 0;
    const progress = (done: number, total: number | null, message?: string): void => {
      const report = callOpts.progress;
      if (report === undefined) return;
      const now = Date.now();
      const final = total !== null && done >= total;
      const wait = message === WAITING_FOR_CONFIRM || message === WAITING_FOR_REDO || message === WAITING_FOR_DRAG;
      if (!final && !wait && now - lastProgress < PROGRESS_MIN_INTERVAL_MS) return;
      lastProgress = now;
      // §5.3: progress text can name document things (clips, files); it goes through the one sanitiser.
      if (message === undefined) report(done, total);
      else report(done, total, sanitizeText(message, { maxChars: PROGRESS_MAX_CHARS, kind: 'prose' }));
    };
    const warnings: string[] = [];
    const ctx = context(tool, signal, intent, args['dryRun'] === true, progress, warnings);
    await confirmCall(tool, ctx, args, (message) => progress(0, null, message));
    const result = await tool.run(ctx, args);
    const merged: AgentToolResult<unknown> =
      result.ok && warnings.length > 0
        ? {
            ...result,
            warnings: [...(result.warnings ?? []), ...warnings.filter((w) => !result.warnings?.includes(w))],
          }
        : result;
    return finishResult(merged, { maxTokens: tool.budget.maxTokens, schema: outputJsonSchemaOf(tool.output) });
  };

  /** Edit and files calls: one at a time, in arrival order (§5.8 3). */
  const enqueue = <T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> => {
    if (waiting >= QUEUE_MAX) {
      return Promise.reject(
        new AgentToolFailure('busy', `${QUEUE_MAX} calls are already waiting.`, 'retry in a moment', {
          retryable: true,
        }),
      );
    }
    waiting++;
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const turn = previous.then(() => {
      waiting--;
    });
    return abortable(turn, signal)
      .then(task)
      .finally(() => {
        // An aborted call leaves its place only after its predecessor ran (order is kept for the rest).
        void turn.then(release);
      });
  };

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
        gate(tool, access, tool.extraGrants?.(args, host.mode) ?? []);
        if (!takeToken()) {
          throw new AgentToolFailure('busy', 'Too many calls in a short time.', 'retry in a moment', {
            retryable: true,
          });
        }
        if (callOpts.signal.aborted) {
          throw new AgentToolFailure('cancelled', `${tool.name} was cancelled before it ran.`, 'nothing changed');
        }
        try {
          if (tool.kind === 'read') return await execute(tool, args, access, callOpts);
          return await enqueue(callOpts.signal, () => execute(tool, args, access, callOpts));
        } finally {
          lingerThenClear();
        }
      } catch (error) {
        // The error path itself must not throw (a failure whose detail is cyclic or too deep for the sanitiser):
        // the MCP layer always gets an envelope, never a rejected call.
        try {
          return finishResult({ ok: false, error: failureFrom(error).toError() }, null);
        } catch {
          return INTERNAL_FALLBACK;
        }
      }
    },
    dispose() {
      revisions.dispose();
      if (focusTimer !== null) clearTimeout(focusTimer);
      focusTimer = null;
    },
  };
}

function redoPending(count: number): AgentToolFailure {
  return new AgentToolFailure(
    'redo_pending',
    `The user has ${count} step${count === 1 ? '' : 's'} to redo and wants to keep them.`,
    `the user has ${count} step${count === 1 ? '' : 's'} to redo and wants to keep them; ask the user before editing`,
    { retryable: false, detail: { redoSteps: count } },
  );
}

/**
 * Captures the toasts an operator run raises (`OperatorRun.warnings`, §4.4): the notifier still shows them; the run
 * also returns their text. A notifier that cannot be wrapped (frozen) is left alone.
 */
function captureToasts(notify: Notifier, into: string[]): () => void {
  const target: { toast: Notifier['toast'] } = notify;
  const original = target.toast;
  const wrapped: Notifier['toast'] = (toast) => {
    if (toast.kind === 'warning' || toast.kind === 'error' || toast.kind === 'info') into.push(toast.text);
    original.call(notify, toast);
  };
  try {
    target.toast = wrapped;
  } catch {
    return () => undefined;
  }
  if (target.toast !== wrapped) return () => undefined;
  return () => {
    if (target.toast === wrapped) target.toast = original;
  };
}

/** Defaults the contract names (§4.4): exported for hosts that show them. */
export const RUNTIME_DEFAULTS = {
  gestureWaitMs: DEFAULT_GESTURE_WAIT_MS,
  confirmTimeoutMs: DEFAULT_CONFIRM_TIMEOUT_MS,
} as const;
