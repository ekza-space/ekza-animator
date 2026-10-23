// The agent session of the open tab (MCP-SPEC §4.9, §5.8–§5.11): discovery over the bridge ports, pairing with a
// server-generated code (the user reads it here, the agent claims it with editor_connect, the user picks the grants),
// the grants and Pause, the call queue and execution through the shared tool runtime (the same code headless runs),
// confirm cards, the audit log and the agent's checkpoints. A lazy chunk: loaded through `bridge/slot.ts` only when the
// user opens the agent (or an e2e page asks for it), never on the first visit of /editor or /autorig.
// Resume after an abnormal close is cut in the MVP (MCP-SPEC §0.4.2): any close ends the pairing; pair again.
import {
  type AgentImage,
  type AgentToolResult,
  type AgentToolRuntimeHandle,
  buildManifest,
  type BridgeMessage,
  type ClientInfo,
  type ConfirmPrompt,
  createAgentToolRuntime,
  type Grants,
  WAITING_FOR_CONFIRM,
  WAITING_FOR_DRAG,
  WAITING_FOR_REDO,
} from '@ekza-studio/agent-tools';
import { EDITOR_VERSION, type EditorApp, type RunActor } from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { discoverServers, lnaState, pageIsLoopback, type ProbeAnswer } from './bridge/discovery';
import { type ConfirmAnswer, createLiveHost } from './bridge/host';
import { setAgentSession } from './bridge/slot';
import type { TabSocket } from './bridge/socket';
import type { AgentAuditRow, AgentServerEntry, AgentSessionState } from './types';

export interface AgentSessionDeps {
  readonly viewport: () => ViewportManager | null;
  readonly params: {
    readonly agentPorts: readonly number[];
    readonly gestureWaitMs?: number;
    readonly confirmTimeoutMs?: number;
  }; // [] = probe 47821–47830
  /** B2 addition: what `hello` reports as the app build (default 'static'). */
  readonly build?: 'server' | 'static' | 'dev' | 'e2e';
}

/** B2 addition (M-AI-B2-2): what the grants dialog shows besides the frozen session state. */
export interface AgentSessionExtra {
  /** After `pair.claimed`: the client name as the agent reported it and the server's working folder name. */
  readonly claim: { readonly client: ClientInfo | null; readonly cwdName: string } | null;
  /** The ports of `?agentPort=` (preselected), or [] for the default range. */
  readonly ports: readonly number[];
}

export interface AgentSession {
  readonly store: StoreApi<AgentSessionState>;
  connect(): Promise<void>;
  disconnect(): void;
  dispose(): void;
  // ---------- B2 additions (M-AI-B2-2): the actions the Agent UI calls ----------
  readonly extra: StoreApi<AgentSessionExtra>;
  /** `choosing`: pairs with the server on `port`. */
  select(port: number): void;
  /** `offering`: stops offering the code (back to `off`). */
  cancel(): void;
  /** `claimed`: the grants dialog's [Allow] (Read is always on). */
  accept(grants: Grants): void;
  /** `claimed`: the grants dialog's [Deny] (also Esc and the dialog's timeout). */
  deny(): void;
  /** Paired: the panel's grant toggles (apply at once; a call in flight keeps the grants it started with). */
  setGrants(grants: Grants): void;
  setPaused(on: boolean): void;
  /** The confirm card's [Allow] / [Deny]. */
  answerConfirm(id: string, answer: 'allow' | 'deny'): void;
}

export const DEFAULT_GRANTS: Grants = { read: true, edit: true, files: false, view: false, workspace: false };
export const AUDIT_MAX = 500;
const DIGEST_MAX = 120;

const INITIAL: AgentSessionState = {
  status: 'off',
  servers: [],
  server: null,
  code: null,
  grants: DEFAULT_GRANTS,
  actor: null,
  queue: { running: null, waiting: 0, waitingFor: null },
  confirm: null,
  audit: [],
  checkpoints: [],
  beforeAgent: null,
  error: null,
};

const NO_SERVER =
  'No agent found on this computer. Start your agent (Claude Code, Claude Desktop, …) with ekza-studio-mcp configured — setup: docs/agents.md.';
const LNA_HINT =
  ' Chrome asks "Access other apps and services on this device" the first time — choose Allow. If you blocked it: Site settings › Local network access.';
const LNA_DENIED =
  'This page may not reach programs on this computer: Chrome’s Local network access is blocked for it. Allow it in Site settings › Local network access, then try again.';
const SAFARI =
  ' Safari does not let websites reach programs on this computer; use Chrome or Edge, or run the editor locally.';
const ORIGIN_HINT = (origin: string) => ` If the agent is running, start it with --allow-origin ${origin}.`;
const CLOSED = 'The connection to the agent server closed. Connect again and pair with a new code.';

interface InFlight {
  readonly id: string;
  readonly tool: string;
  readonly edit: boolean;
  readonly row: number;
  readonly started: number;
  waitingFor: AgentSessionState['queue']['waitingFor'];
}

function digestOf(tool: string, args: unknown): string {
  let text = tool;
  if (typeof args === 'object' && args !== null) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      if (key === 'project' || key === 'intent') continue;
      const shown =
        typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : Array.isArray(value)
            ? `[${value.length}]`
            : '{…}';
      parts.push(`${key}=${shown}`);
    }
    if (parts.length > 0) text += ` ${parts.join(' ')}`;
  }
  return text.length > DIGEST_MAX ? `${text.slice(0, DIGEST_MAX - 1)}…` : text;
}

function waitingOf(message: string | undefined): InFlight['waitingFor'] {
  if (message === WAITING_FOR_DRAG) return 'gesture';
  if (message === WAITING_FOR_REDO) return 'redo';
  if (message === WAITING_FOR_CONFIRM) return 'confirm';
  return null;
}

function download(fileName: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function createAgentSession(app: EditorApp, deps: AgentSessionDeps): AgentSession {
  const store = createStore<AgentSessionState>(() => INITIAL);
  const extra = createStore<AgentSessionExtra>(() => ({ claim: null, ports: deps.params.agentPorts }));
  const set = (patch: Partial<AgentSessionState>): void => store.setState(patch);
  const confirmTimeoutMs = deps.params.confirmTimeoutMs ?? 50_000;

  let candidates: ProbeAnswer[] = [];
  let socket: TabSocket | null = null;
  let runtime: AgentToolRuntimeHandle | null = null;
  let codeTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0; // bumps on every teardown: late callbacks of an old socket are ignored
  let disposed = false;
  const controllers = new Map<string, AbortController>();
  const inFlight = new Map<string, InFlight>();
  let group: string | null = null;
  // files of the running edit/files call (queued calls run one at a time, §5.8 3)
  const attached = new Map<string, Uint8Array>();
  let writes: { name: string; bytes: Uint8Array }[] = [];

  // ---------- confirm cards (§7.4): one at a time, queued ----------
  let confirmChain: Promise<unknown> = Promise.resolve();
  let confirmSeq = 0;
  let answerCard: ((id: string, answer: 'allow' | 'deny') => void) | null = null;
  const historyListeners = new Set<() => void>();
  const unsubscribeHistory = app.history.subscribe(() => {
    for (const listener of [...historyListeners]) listener();
    refreshReachability();
  });

  const showCard = (prompt: ConfirmPrompt, signal: AbortSignal, resolvedWhen?: () => boolean): Promise<ConfirmAnswer> =>
    new Promise<ConfirmAnswer>((resolve) => {
      if (signal.aborted) {
        resolve('deny');
        return;
      }
      if (resolvedWhen?.() === true) {
        resolve('resolved');
        return;
      }
      const id = `cf_${++confirmSeq}`;
      set({ confirm: { id, prompt, expiresAt: Date.now() + confirmTimeoutMs } });
      const finish = (answer: ConfirmAnswer): void => {
        signal.removeEventListener('abort', onAbort);
        historyListeners.delete(onHistory);
        if (answerCard === onAnswer) answerCard = null;
        if (store.getState().confirm?.id === id) set({ confirm: null });
        resolve(answer);
      };
      const onAbort = (): void => finish('deny');
      const onHistory = (): void => {
        if (resolvedWhen?.() === true) finish('resolved');
      };
      const onAnswer = (cardId: string, answer: 'allow' | 'deny'): void => {
        if (cardId === id) finish(answer);
      };
      answerCard = onAnswer;
      signal.addEventListener('abort', onAbort, { once: true });
      if (resolvedWhen !== undefined) historyListeners.add(onHistory);
    });

  const ask = (prompt: ConfirmPrompt, signal: AbortSignal, resolvedWhen?: () => boolean): Promise<ConfirmAnswer> => {
    const next = confirmChain.then(() => showCard(prompt, signal, resolvedWhen));
    confirmChain = next.catch(() => undefined);
    return next;
  };

  const host = createLiveHost({
    app,
    grants: () => store.getState().grants,
    paused: () => store.getState().status === 'paused',
    ask,
    currentFiles: () => ({ attached, writes }),
    download,
    capture: deps.viewport() !== null,
  });

  // ---------- audit and queue ----------
  const updateQueue = (): void => {
    const calls = [...inFlight.values()];
    const edits = calls.filter((call) => call.edit);
    const running = edits[0] ?? calls.at(-1) ?? null;
    set({
      queue: {
        running: running?.tool ?? null,
        waiting: Math.max(0, edits.length - 1),
        waitingFor: running?.waitingFor ?? null,
      },
    });
  };

  const patchRow = (n: number, patch: Partial<AgentAuditRow>): void => {
    const audit = store.getState().audit.map((row) => (row.n === n ? { ...row, ...patch } : row));
    set({ audit });
  };

  let rowSeq = 0;
  const pushRow = (tool: string, args: unknown): number => {
    const n = ++rowSeq;
    const row: AgentAuditRow = {
      n,
      at: Date.now(),
      tool,
      digest: digestOf(tool, args),
      status: 'running',
      code: null,
      ms: null,
      step: null,
      reverted: false,
      unreachable: false,
      group,
      show: null,
    };
    const audit = [...store.getState().audit, row];
    set({ audit: audit.length > AUDIT_MAX ? audit.slice(audit.length - AUDIT_MAX) : audit });
    return n;
  };

  /** A step that left both history stacks can no longer be undone (§5.13). */
  const refreshReachability = (): void => {
    const rows = store.getState().audit;
    if (!rows.some((row) => row.step !== null && !row.unreachable)) return;
    const { undo, redo } = app.history.entries();
    const live = new Set([...undo, ...redo].map((step) => step.id));
    let changed = false;
    const audit = rows.map((row) => {
      if (row.step === null || row.unreachable || live.has(row.step.id)) return row;
      changed = true;
      return { ...row, unreachable: true };
    });
    if (changed) set({ audit });
  };

  // ---------- calls (§5.8): run through the runtime, answer with the envelope ----------
  const runCall = async (
    gen: number,
    sock: TabSocket,
    message: Extract<BridgeMessage, { t: 'call' }>,
  ): Promise<void> => {
    const rt = runtime;
    if (rt === null) return;
    const tool = rt.tools.find((t) => t.name === message.tool);
    const edit = tool !== undefined && tool.kind !== 'read';
    const controller = new AbortController();
    controllers.set(message.id, controller);
    for (const file of message.files) {
      const bytes = sock.takeBlob(file.blob);
      if (bytes !== null) attached.set(file.path, bytes);
    }
    const row = pushRow(message.tool, message.args);
    const call: InFlight = { id: message.id, tool: message.tool, edit, row, started: Date.now(), waitingFor: null };
    inFlight.set(message.id, call);
    updateQueue();
    const progress = (done: number, total: number | null, text?: string): void => {
      const waiting = waitingOf(text);
      if (waiting !== call.waitingFor) {
        call.waitingFor = waiting;
        patchRow(row, { status: waiting === null ? 'running' : 'waiting' });
        updateQueue();
      }
      if (gen === generation) {
        sock.send({ t: 'progress', id: message.id, done, total, ...(text === undefined ? {} : { message: text }) });
      }
    };
    let result: AgentToolResult<unknown>;
    try {
      result = await rt.call(message.tool, message.args, { signal: controller.signal, progress });
    } catch {
      result = {
        ok: false,
        error: { code: 'internal', message: 'The tool failed unexpectedly.', hint: 'report this', retryable: false },
      };
    }
    controllers.delete(message.id);
    inFlight.delete(message.id);
    const ms = Date.now() - call.started;
    const peer =
      store.getState().actor === null ? undefined : app.presence.get((store.getState().actor as RunActor).id);
    const focus = peer?.focus ?? null;
    const show =
      focus !== null && focus.character !== null && focus.clip !== null
        ? { character: focus.character, clip: focus.clip, frame: focus.frame, controls: focus.controls }
        : null;
    if (result.ok) {
      patchRow(row, {
        status: 'ok',
        ms,
        step: result.undo === undefined ? null : { id: result.undo.step, label: result.undo.label },
        show,
      });
      if (message.tool === 'history_checkpoint') {
        const data = result.data as { readonly checkpoint?: unknown; readonly step?: unknown };
        const label = (message.args as { readonly label?: unknown } | null)?.label;
        if (typeof data.checkpoint === 'string' && typeof data.step === 'number') {
          group = data.checkpoint;
          set({
            checkpoints: [
              ...store.getState().checkpoints,
              {
                id: data.checkpoint,
                label: typeof label === 'string' ? label : null,
                at: Date.now(),
                stepId: data.step,
              },
            ],
          });
        }
      }
    } else {
      const code = result.error.code;
      patchRow(row, {
        status: code === 'cancelled' ? 'cancelled' : code === 'declined' || code === 'not_granted' ? 'denied' : 'error',
        code,
        ms,
        show,
      });
    }
    updateQueue();
    const takenWrites = edit ? writes : [];
    if (edit) {
      writes = [];
      attached.clear();
    }
    if (gen !== generation || !sock.open) return;
    // images and writes travel as blobs before the result (§4.5)
    const images: { blob: string; mime: AgentImage['mime']; width: number; height: number }[] = [];
    let envelope: unknown = result;
    if (result.ok && result.images !== undefined) {
      const { images: list, ...rest } = result;
      envelope = rest;
      for (const [index, image] of list.entries()) {
        const blob = `${message.id}_i${index}`;
        await sock.sendBlob(blob, image.bytes);
        images.push({ blob, mime: image.mime, width: image.width, height: image.height });
      }
    }
    const sent: { name: string; blob: string }[] = [];
    for (const [index, write] of takenWrites.entries()) {
      const blob = `${message.id}_w${index}`;
      await sock.sendBlob(blob, write.bytes);
      sent.push({ name: write.name, blob });
    }
    if (gen !== generation || !sock.open) return;
    sock.send({ t: 'result', id: message.id, result: envelope, images, writes: sent });
  };

  // ---------- pairing ----------
  const clearCodeTimer = (): void => {
    if (codeTimer !== null) {
      clearTimeout(codeTimer);
      codeTimer = null;
    }
  };

  const teardown = (status: AgentSessionState['status'], error: AgentSessionState['error']): void => {
    generation += 1;
    clearCodeTimer();
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    inFlight.clear();
    runtime?.dispose();
    runtime = null;
    const actor = store.getState().actor;
    if (actor !== null) app.presence.remove(actor.id);
    for (const candidate of candidates) if (candidate.kind === 'ok') candidate.socket.close();
    candidates = [];
    socket?.close(1000, 'bye');
    socket = null;
    answerCard = null;
    group = null;
    attached.clear();
    writes = [];
    extra.setState({ claim: null });
    set({
      status,
      error,
      code: null,
      actor: null,
      confirm: null,
      server: status === 'off' || status === 'error' ? null : store.getState().server,
      queue: { running: null, waiting: 0, waitingFor: null },
    });
  };

  const offer = (): void => {
    clearCodeTimer();
    socket?.send({ t: 'pair.offer' });
  };

  const onMessage = (gen: number, sock: TabSocket, message: BridgeMessage): void => {
    if (gen !== generation) return;
    switch (message.t) {
      case 'pair.code': {
        set({ code: { text: message.code, expiresAt: message.expiresAt } });
        clearCodeTimer();
        // §5.10: a new code when this one expires while the dialog is open
        codeTimer = setTimeout(
          () => {
            const status = store.getState().status;
            if (status === 'offering' || status === 'claimed') {
              extra.setState({ claim: null });
              set({ status: 'offering' });
              offer();
            }
          },
          Math.max(1_000, message.expiresAt - Date.now()),
        );
        return;
      }
      case 'pair.claimed':
        extra.setState({ claim: { client: message.client, cwdName: message.cwdName } });
        set({ status: 'claimed' });
        return;
      case 'pair.ok': {
        clearCodeTimer();
        runtime?.dispose();
        runtime = createAgentToolRuntime({
          app,
          host,
          actor: message.actor,
          ...(deps.params.gestureWaitMs === undefined ? {} : { gestureWaitMs: deps.params.gestureWaitMs }),
          confirmTimeoutMs,
        });
        rowSeq = 0;
        group = null;
        set({ status: 'paired', actor: message.actor, code: null, audit: [], checkpoints: [], error: null });
        sock.send({
          t: 'tab',
          title: (globalThis.document?.title ?? 'Ekza Studio').slice(0, 500),
          project: app.session.getState().projectName.slice(0, 500),
        });
        return;
      }
      case 'call':
        void runCall(gen, sock, message);
        return;
      case 'cancel':
        controllers.get(message.id)?.abort();
        return;
      case 'bye':
        teardown('error', { kind: 'closed', message: 'The agent server ended the connection. Connect again to pair.' });
        return;
      case 'error':
        if (
          message.code === 'busy' &&
          (store.getState().status === 'offering' || store.getState().status === 'probing')
        ) {
          teardown('error', { kind: 'closed', message: message.message });
        }
        return;
      default:
        return;
    }
  };

  const attach = (answer: Extract<ProbeAnswer, { kind: 'ok' }>): void => {
    const gen = generation;
    socket = answer.socket;
    const sock = answer.socket;
    sock.onMessage((message) => onMessage(gen, sock, message));
    sock.onClose(() => {
      if (gen !== generation) return;
      teardown('error', { kind: 'closed', message: CLOSED });
    });
  };

  const entryOf = (answer: Extract<ProbeAnswer, { kind: 'ok' }>): AgentServerEntry => ({
    port: answer.socket.port,
    server: answer.hello.server,
    client: answer.hello.client,
    toolset: answer.hello.toolset,
    busy: answer.hello.busy,
  });

  const select = (port: number): void => {
    const chosen = candidates.find(
      (c): c is Extract<ProbeAnswer, { kind: 'ok' }> => c.kind === 'ok' && c.socket.port === port,
    );
    if (chosen === undefined || chosen.hello.busy) return;
    for (const c of candidates) if (c !== chosen && c.kind === 'ok') c.socket.close();
    candidates = [];
    attach(chosen);
    set({ status: 'offering', server: entryOf(chosen), error: null });
    offer();
  };

  const onPageHide = (): void => {
    if (socket !== null) socket.send({ t: 'bye', reason: 'user' });
  };
  globalThis.addEventListener?.('pagehide', onPageHide);

  const session: AgentSession = {
    store,
    extra,
    async connect() {
      const status = store.getState().status;
      if (disposed || (status !== 'off' && status !== 'error')) return;
      teardown('probing', null);
      const gen = generation;
      const manifest = buildManifest();
      const answers = await discoverServers(deps.params.agentPorts, {
        t: 'hello',
        bridge: 1,
        toolset: { version: manifest.toolset, hash: manifest.hash },
        app: { version: EDITOR_VERSION, build: deps.build ?? 'static' },
      });
      if (gen !== generation || disposed) {
        for (const answer of answers) if (answer.kind === 'ok') answer.socket.close();
        return;
      }
      const ok = answers.filter((a): a is Extract<ProbeAnswer, { kind: 'ok' }> => a.kind === 'ok');
      if (ok.length === 0) {
        const refused = answers.find((a): a is Extract<ProbeAnswer, { kind: 'refused' }> => a.kind === 'refused');
        if (refused !== undefined) {
          set({ status: 'error', error: { kind: 'version', message: refused.message } });
          return;
        }
        const loopback = pageIsLoopback();
        const lna = loopback ? null : await lnaState();
        if (gen !== generation) return;
        const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(globalThis.navigator?.userAgent ?? '');
        const origin = globalThis.location?.origin ?? '';
        set({
          status: 'error',
          error:
            lna === 'denied'
              ? { kind: 'lna_denied', message: LNA_DENIED }
              : {
                  kind: 'no_server',
                  message: `${NO_SERVER}${loopback ? '' : safari ? SAFARI : LNA_HINT}${ORIGIN_HINT(origin)}`,
                },
        });
        return;
      }
      candidates = ok;
      set({ servers: ok.map(entryOf) });
      const free = ok.filter((a) => !a.hello.busy);
      const only = free[0];
      if (free.length === 1 && only !== undefined) select(only.socket.port);
      else set({ status: 'choosing' });
    },
    select,
    cancel() {
      const status = store.getState().status;
      if (status === 'offering' || status === 'choosing' || status === 'claimed') {
        if (status === 'claimed') socket?.send({ t: 'pair.deny' });
        teardown('off', null);
      }
    },
    accept(grants) {
      if (store.getState().status !== 'claimed' || socket === null) return;
      const clean: Grants = { ...grants, read: true, workspace: grants.files && grants.workspace };
      set({ grants: clean });
      socket.send({ t: 'pair.accept', grants: clean });
    },
    deny() {
      if (store.getState().status !== 'claimed') return;
      socket?.send({ t: 'pair.deny' });
      teardown('off', null);
    },
    setGrants(grants) {
      const clean: Grants = { ...grants, read: true, workspace: grants.files && grants.workspace };
      set({ grants: clean });
      const status = store.getState().status;
      if (status === 'paired' || status === 'paused') socket?.send({ t: 'grants', grants: clean });
    },
    setPaused(on) {
      const status = store.getState().status;
      if (status !== 'paired' && status !== 'paused') return;
      set({ status: on ? 'paused' : 'paired' });
      socket?.send({ t: 'paused', on });
    },
    answerConfirm(id, answer) {
      answerCard?.(id, answer);
    },
    disconnect() {
      socket?.send({ t: 'bye', reason: 'user' });
      teardown('off', null);
    },
    dispose() {
      if (disposed) return;
      session.disconnect();
      disposed = true;
      unsubscribeHistory();
      globalThis.removeEventListener?.('pagehide', onPageHide);
      setAgentSession(app, null);
    },
  };
  setAgentSession(app, session);
  return session;
}
