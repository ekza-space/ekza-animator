// The agent module's runtime in the tab (MCP-SPEC §4.9, §7; B3): one per EditorApp, created when the lazy agent
// module loads (the Agent panel opens or `?agentPort=` is present). It follows the page's agent session (B2's slot:
// `agentSessionOf` / `onAgentSession`, created through `loadAgentSession` when none exists yet; or a session a test
// installs), attaches the live `view_capture` service, registers the
// user-only `agent.show` operator, and keeps what the panel adds on top of the frozen D0 session state: which AI steps
// the user reverted from the panel and which clips already raised the "AI is working on clip …" toast.
import { attachViewCapture, type Grants } from '@ekza-studio/agent-tools';
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { viewportManagerOf } from '@ekza-studio/viewport';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { parseAgentParams } from '../../test-api/agentParams';
import { agentSessionOf, loadAgentSession, onAgentSession } from '../bridge/slot';
import { createLiveViewCapture } from '../capture/service';
import type { AgentSession, AgentSessionDeps, AgentSessionExtra } from '../session';
import { registerAgentShow } from './show';

/** B2's `AgentSessionExtra` (M-AI-B2-2): the claim the grants dialog shows and the preselected ports. */
export type AgentSessionExtraView = AgentSessionExtra;

/**
 * The actions the panel calls besides the D0 `AgentSession` (connect, disconnect, dispose) — B2's additions
 * (M-AI-B2-2), optional here so the UI works with any session; a control the session lacks is drawn disabled.
 */
export interface AgentSessionControls {
  readonly extra?: StoreApi<AgentSessionExtraView>;
  /** `choosing`: pair with the server on `port`. */
  select?(port: number): void;
  /** Stop discovery or the offered code (back to `off`). */
  cancel?(): void;
  /** The grants dialog's [Allow] (§7.3). */
  accept?(grants: Grants): void;
  /** The grants dialog's [Deny] (also Esc). */
  deny?(): void;
  /** The panel's grant toggles, applied at once (§5.9). */
  setGrants?(grants: Grants): void;
  setPaused?(on: boolean): void;
  /** The confirm card (§7.4). */
  answerConfirm?(id: string, answer: 'allow' | 'deny'): void;
}
export type AgentSessionHandle = AgentSession & AgentSessionControls;
export type AgentSessionFactory = (app: EditorApp, deps: AgentSessionDeps) => AgentSessionHandle;
const UNAVAILABLE = 'The agent bridge is not available in this build.';

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

let factory: AgentSessionFactory | null = null;

/** Tests create their own session instead of the page's (null restores the page's session). */
export function setAgentSessionFactory(next: AgentSessionFactory | null): void {
  factory = next;
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
  if (factory !== null) {
    try {
      session = factory(app, deps);
    } catch {
      unavailable = UNAVAILABLE;
    }
  } else {
    session = agentSessionOf(app);
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
  // A session installed by hand (tests, the e2e hook) stays until it is replaced by hand.
  let pinned = factory !== null;
  const adopt = (next: AgentSessionHandle | null): void => {
    if (pinned || store.getState().session === next) return;
    pairedActor = null;
    watch(next);
    store.setState({ session: next, unavailable: null, revertedBy: new Map(), toasted: new Set() });
  };
  if (factory === null) {
    disposers.push(onAgentSession(app, adopt));
    // The page's session (B2) is created on first use; the e2e test API connects it at start with `?agentPort=`.
    if (session === null) {
      loadAgentSession(app, deps).then(adopt, () => {
        if (!pinned && store.getState().session === null) store.setState({ unavailable: UNAVAILABLE });
      });
    }
  }

  const runtime: AgentRuntime = {
    app,
    store,
    install(next, why = null) {
      const previous = store.getState().session;
      pinned = true;
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
      if (pinned) store.getState().session?.dispose();
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
