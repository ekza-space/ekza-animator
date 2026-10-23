// A stand-in agent session for tests and the e2e hook (B3): the frozen D0 `AgentSessionState` in a store, the panel's
// controls (grants, pause, pairing and confirm answers), and `call(tool, args)` that runs the real tool runtime over the
// app as a paired agent would through the bridge, recording audit rows with the step and what [Show] switches to.
// It never opens a socket. B2's session replaces it in the product.
import {
  type AgentHost,
  type AgentToolResult,
  type AgentToolRuntimeHandle,
  type ConfirmPrompt,
  createAgentToolRuntime,
  type Grants,
} from '@ekza-studio/agent-tools';
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import type { EditorApp, RunActor } from '@ekza-studio/editor-core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AgentAuditRow, AgentSessionState, AgentStatus } from '../types';
import type { AgentSession } from '../session';
import type { AgentSessionControls, AgentSessionExtraView } from './runtime';

export interface FakeSessionOptions {
  readonly status?: AgentStatus;
  readonly client?: string;
  readonly grants?: Partial<Omit<Grants, 'read'>>;
  readonly code?: string;
  readonly actorId?: string;
  /** Confirm answers time out after this (ms). */
  readonly confirmTimeoutMs?: number;
}

export interface FakeAgentSession extends AgentSession, Required<AgentSessionControls> {
  readonly extra: StoreApi<AgentSessionExtraView>;
  /** Runs a tool as the paired agent (status must be `paired`). */
  call(tool: string, args: unknown): Promise<AgentToolResult<unknown>>;
  setState(patch: Partial<AgentSessionState>): void;
}

const AUDIT_MAX = 500;
const DIGEST_MAX = 120;

/** A short argument digest: names and numbers only (§5.11). */
export function digestOf(args: unknown): string {
  if (typeof args !== 'object' || args === null) return '';
  const parts: string[] = [];
  const record = args as Record<string, unknown>;
  for (const key of ['clip', 'name', 'character']) {
    const value = record[key];
    if (typeof value === 'string') parts.push(value);
  }
  if (typeof record['frame'] === 'number') parts.push(`f${record['frame']}`);
  if (Array.isArray(record['frames'])) parts.push(`f${(record['frames'] as unknown[]).join(',')}`);
  for (const key of ['set', 'keys', 'aims']) {
    const list = record[key];
    if (Array.isArray(list)) parts.push(`(${list.length} ${key})`);
  }
  return parts.join(' ').slice(0, DIGEST_MAX);
}

export function createFakeAgentSession(app: EditorApp, opts: FakeSessionOptions = {}): FakeAgentSession {
  const client = opts.client ?? 'Claude Code';
  const actor: RunActor = { kind: 'agent', id: opts.actorId ?? 'agt_FakeSession01', name: client };
  const status = opts.status ?? 'paired';
  const paired = status === 'paired' || status === 'paused';
  const store = createStore<AgentSessionState>(() => ({
    status,
    servers: [],
    server: {
      port: 47_821,
      server: { name: 'ekza-studio-mcp', version: '0.1.0', startedAt: Date.now() },
      client: { name: client, version: '1.0.0' },
      toolset: { version: 'fake', hash: 'fake' },
      busy: false,
    },
    code:
      status === 'offering' || status === 'claimed'
        ? { text: opts.code ?? 'K7Q-M4P', expiresAt: Date.now() + 120_000 }
        : null,
    grants: {
      read: true,
      edit: opts.grants?.edit ?? true,
      files: opts.grants?.files ?? false,
      view: opts.grants?.view ?? false,
      workspace: opts.grants?.workspace ?? false,
    },
    actor: paired ? actor : null,
    queue: { running: null, waiting: 0, waitingFor: null },
    confirm: null,
    audit: [],
    checkpoints: [],
    beforeAgent: null,
    error: null,
  }));
  const set = (patch: Partial<AgentSessionState>): void => store.setState(patch);
  const extra = createStore<AgentSessionExtraView>(() => ({
    claim: status === 'claimed' ? { client: { name: client }, cwdName: 'walk-project' } : null,
    ports: [],
  }));
  let pendingConfirm: { id: string; resolve: (answer: 'allow' | 'deny' | 'timeout') => void } | null = null;
  let confirmSeq = 0;

  const host: AgentHost = {
    mode: 'live',
    capabilities: new Set(['user', 'confirm', 'presence', 'view', 'capture.shaded']),
    grants: () => store.getState().grants,
    paused: () => store.getState().status === 'paused',
    waitForGesture: () => Promise.resolve(true),
    confirm(prompt: ConfirmPrompt, signal: AbortSignal) {
      const id = `cf_${++confirmSeq}`;
      const timeout = opts.confirmTimeoutMs ?? 50_000;
      return new Promise((resolve) => {
        const finish = (answer: 'allow' | 'deny' | 'timeout'): void => {
          clearTimeout(timer);
          pendingConfirm = null;
          set({ confirm: null, queue: { ...store.getState().queue, waitingFor: null } });
          resolve(answer);
        };
        const timer = setTimeout(() => finish('timeout'), timeout);
        signal.addEventListener('abort', () => finish('deny'), { once: true });
        pendingConfirm = { id, resolve: finish };
        set({
          confirm: { id, prompt, expiresAt: Date.now() + timeout },
          queue: { ...store.getState().queue, waitingFor: 'confirm' },
        });
      });
    },
    files: null,
  };
  let runtime: AgentToolRuntimeHandle | null = null;
  const runtimeOf = (): AgentToolRuntimeHandle => {
    runtime ??= createAgentToolRuntime({ app, host, actor });
    return runtime;
  };

  const updateRow = (n: number, patch: Partial<AgentAuditRow>): void => {
    set({ audit: store.getState().audit.map((row) => (row.n === n ? { ...row, ...patch } : row)) });
  };

  const showOf = (result: AgentToolResult<unknown>, args: unknown): AgentAuditRow['show'] => {
    if (!result.ok || result.clip === undefined) return null;
    const info = result.clip;
    const character = app.store
      .list('characters')
      .find((record) => record.name === info.character || record.id === info.character);
    if (character === undefined) return null;
    const clip = app.store.query.clipsOfCharacter(character.id).find((record) => record.name === info.name);
    if (clip === undefined) return null;
    const record = (args ?? {}) as Record<string, unknown>;
    const first: unknown = Array.isArray(record['frames']) ? record['frames'][0] : undefined;
    const frame = typeof record['frame'] === 'number' ? record['frame'] : typeof first === 'number' ? first : null;
    const ids: { character: CharacterId; clip: ClipId } = { character: character.id, clip: clip.id };
    return { ...ids, frame, controls: [] };
  };

  return {
    store,
    extra,
    setState: set,
    async connect() {
      set({
        status: 'offering',
        code: { text: opts.code ?? 'K7Q-M4P', expiresAt: Date.now() + 120_000 },
        error: null,
      });
    },
    disconnect() {
      pendingConfirm?.resolve('deny');
      runtime?.dispose();
      runtime = null;
      set({
        status: 'off',
        actor: null,
        code: null,
        confirm: null,
        queue: { running: null, waiting: 0, waitingFor: null },
      });
    },
    dispose() {
      runtime?.dispose();
      runtime = null;
    },
    setGrants(grants) {
      set({ grants: { ...grants, read: true, workspace: grants.files && grants.workspace } });
    },
    setPaused(on) {
      const now = store.getState().status;
      if (now === 'paired' || now === 'paused') set({ status: on ? 'paused' : 'paired' });
    },
    accept(grants) {
      if (store.getState().status !== 'claimed') return;
      extra.setState({ claim: null });
      set({ status: 'paired', code: null, actor, grants: { ...grants, read: true } });
    },
    deny() {
      extra.setState({ claim: null });
      set({ status: 'off', code: null, actor: null });
    },
    answerConfirm(id, answer) {
      if (pendingConfirm?.id === id) pendingConfirm.resolve(answer);
    },
    cancel() {
      set({ status: 'off', code: null });
    },
    select(port) {
      const entry = store.getState().servers.find((server) => server.port === port && !server.busy);
      if (entry !== undefined) {
        set({
          server: entry,
          status: 'offering',
          code: { text: opts.code ?? 'K7Q-M4P', expiresAt: Date.now() + 120_000 },
        });
      }
    },
    async call(tool, args) {
      const state = store.getState();
      const n = (state.audit.at(-1)?.n ?? 0) + 1;
      const row: AgentAuditRow = {
        n,
        at: Date.now(),
        tool,
        digest: `${tool} ${digestOf(args)}`.trim().slice(0, DIGEST_MAX),
        status: 'running',
        code: null,
        ms: null,
        step: null,
        reverted: false,
        unreachable: false,
        group: null,
        show: null,
      };
      set({ audit: [...state.audit, row].slice(-AUDIT_MAX), queue: { ...state.queue, running: tool } });
      const started = performance.now();
      let result: AgentToolResult<unknown>;
      if (state.status !== 'paired') {
        result = {
          ok: false,
          error: {
            code: state.status === 'paused' ? 'paused' : 'not_connected',
            message: 'The agent is not paired.',
            hint: 'pair first',
            retryable: false,
          },
        };
      } else {
        result = await runtimeOf().call(tool, args, { signal: new AbortController().signal });
      }
      updateRow(n, {
        status: result.ok ? 'ok' : result.error.code === 'declined' ? 'denied' : 'error',
        code: result.ok ? null : result.error.code,
        ms: performance.now() - started,
        step: result.ok && result.undo !== undefined ? { id: result.undo.step, label: result.undo.label } : null,
        show: showOf(result, args),
      });
      set({ queue: { ...store.getState().queue, running: null } });
      return result;
    },
  };
}
