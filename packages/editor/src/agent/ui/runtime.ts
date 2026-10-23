// The agent module's runtime in the tab (MCP-SPEC §4.9, §7; B3): one per EditorApp, created when the lazy agent
// module loads (the Agent panel opens or `?agentPort=` is present). It holds the agent session (B2's
// `createAgentSession`, or a session a test installs), attaches the live `view_capture` service, registers the
// user-only `agent.show` operator, and keeps what the panel adds on top of the frozen D0 session state: which AI steps
// the user reverted from the panel and which clips already raised the "AI is working on clip …" toast.
import { attachViewCapture, type Grants } from '@ekza-studio/agent-tools';
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { viewportManagerOf } from '@ekza-studio/viewport';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { parseAgentParams } from '../../test-api/params';
import { createLiveViewCapture } from '../capture/service';
import { type AgentSession, type AgentSessionDeps, createAgentSession } from '../session';
import { registerAgentShow } from './show';

/**
 * What the panel asks of the session beyond the frozen D0 `AgentSession` (connect, disconnect, dispose). B2's session
 * implements these (DECISIONS-OPEN M-AI-B3-1); a control the session lacks is shown disabled.
 */
export interface AgentSessionControls {
  /** Grant toggles apply at once (`grants` message, §5.9). Read stays on. */
  setGrants?(grants: Omit<Grants, 'read'>): void;
  pause?(): void;
  resume?(): void;
  /** The grants dialog after `pair.claimed` (§7.3): Allow with the chosen grants, or Deny. */
  answerPairing?(answer: 'allow' | 'deny', grants?: Omit<Grants, 'read'>): void;
  /** The confirm card (§7.4). */
  answerConfirm?(id: string, answer: 'allow' | 'deny'): void;
  /** Cancel discovery or the offered code. */
  cancel?(): void;
  /** Pick a server in the chooser (status `choosing`). */
  choose?(port: number): void;
}
export type AgentSessionHandle = AgentSession & AgentSessionControls;
export type AgentSessionFactory = (app: EditorApp, deps: AgentSessionDeps) => AgentSessionHandle;

export interface AgentRuntimeState {
  /** The session, or null when this build cannot create one (`unavailable` says why). */
  readonly session: AgentSessionHandle | null;
  readonly unavailable: string | null;
  /** AI step id → the step that reverted it from the panel (Revert, Revert all). */
  readonly revertedBy: ReadonlyMap<number, number>;
  /** Clips that already raised the "AI is working on clip …" toast in this pairing. */
  readonly toasted: ReadonlySet<string>;
}

export interface AgentRuntime {
  readonly app: EditorApp;
  readonly store: StoreApi<AgentRuntimeState>;
  /** Replaces the session (tests and the e2e hook install a fake one); the previous one is disposed. */
  install(session: AgentSessionHandle | null, unavailable?: string | null): void;
  markReverted(steps: readonly number[], by: number): void;
  markToasted(clip: string): boolean;
  dispose(): void;
}

let factory: AgentSessionFactory = (app, deps) => createAgentSession(app, deps);

/** Tests replace B2's session factory (null restores it). */
export function setAgentSessionFactory(next: AgentSessionFactory | null): void {
  factory = next ?? ((app, deps) => createAgentSession(app, deps));
}

const runtimes = new WeakMap<EditorApp, AgentRuntime>();

function e2eBuild(): boolean {
  return (
    typeof window !== 'undefined' && (window as { __EKZA_STUDIO_TEST__?: unknown }).__EKZA_STUDIO_TEST__ !== undefined
  );
}

function createRuntime(app: EditorApp): AgentRuntime {
  const disposers: Disposer[] = [];
  disposers.push(
    attachViewCapture(
      app,
      createLiveViewCapture(app, () => viewportManagerOf(app)),
    ),
  );
  disposers.push(registerAgentShow(app));
  const search = typeof location === 'undefined' ? '' : location.search;
  const params = parseAgentParams(search, e2eBuild());
  const deps: AgentSessionDeps = {
    viewport: () => viewportManagerOf(app),
    params: {
      agentPorts: params.agentPorts,
      ...(params.gestureWaitMs === null ? {} : { gestureWaitMs: params.gestureWaitMs }),
      ...(params.confirmTimeoutMs === null ? {} : { confirmTimeoutMs: params.confirmTimeoutMs }),
    },
  };
  let session: AgentSessionHandle | null = null;
  let unavailable: string | null = null;
  try {
    session = factory(app, deps);
  } catch {
    unavailable = 'The agent bridge is not available in this build.';
  }
  const store = createStore<AgentRuntimeState>(() => ({
    session,
    unavailable,
    revertedBy: new Map(),
    toasted: new Set(),
  }));
  // A new pairing starts with a fresh toast memory (§5.11: once per clip per pairing).
  let pairedActor: string | null = null;
  let offSession: (() => void) | null = null;
  const watch = (next: AgentSessionHandle | null): void => {
    offSession?.();
    offSession =
      next === null
        ? null
        : next.store.subscribe((state) => {
            const actor = state.actor?.id ?? null;
            if (actor !== null && actor !== pairedActor) {
              pairedActor = actor;
              store.setState({ toasted: new Set(), revertedBy: new Map() });
            }
          });
  };
  watch(session);
  if (session !== null && params.connectAtStart) void session.connect();

  const runtime: AgentRuntime = {
    app,
    store,
    install(next, why = null) {
      const previous = store.getState().session;
      if (previous !== null && previous !== next) previous.dispose();
      pairedActor = null;
      watch(next);
      store.setState({
        session: next,
        unavailable: next === null ? why : null,
        revertedBy: new Map(),
        toasted: new Set(),
      });
    },
    markReverted(steps, by) {
      const map = new Map(store.getState().revertedBy);
      for (const step of steps) map.set(step, by);
      store.setState({ revertedBy: map });
    },
    markToasted(clip) {
      const toasted = store.getState().toasted;
      if (toasted.has(clip)) return false;
      store.setState({ toasted: new Set([...toasted, clip]) });
      return true;
    },
    dispose() {
      offSession?.();
      store.getState().session?.dispose();
      for (const dispose of disposers.splice(0)) dispose();
      runtimes.delete(app);
    },
  };
  // e2e builds: the hook that installs a fake paired session (a separate chunk, never on a user's page).
  if (e2eBuild()) {
    void import('./e2e').then(({ installAgentE2eHook }) => {
      if (runtimes.get(app) === runtime) disposers.push(installAgentE2eHook(runtime));
    });
  }
  return runtime;
}

/** The agent runtime of an app, created on first use. */
export function agentRuntimeOf(app: EditorApp): AgentRuntime {
  let runtime = runtimes.get(app);
  if (runtime === undefined) {
    runtime = createRuntime(app);
    runtimes.set(app, runtime);
  }
  return runtime;
}

/** The runtime if it exists (no creation). */
export function existingAgentRuntime(app: EditorApp): AgentRuntime | null {
  return runtimes.get(app) ?? null;
}
