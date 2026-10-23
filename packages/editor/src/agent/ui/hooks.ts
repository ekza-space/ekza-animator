// React bindings of the agent runtime (B3): the runtime of the app, the session's state (frozen D0
// `AgentSessionState`), the history's stacks (rows' Undo/Revert follow them) and a clock for countdowns.
import type { EditorApp } from '@ekza-studio/editor-core';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AgentSessionState } from '../types';
import type { HistoryView } from './model';
import { type AgentRuntime, type AgentRuntimeState, agentRuntimeOf } from './runtime';

export function useAgentRuntime(app: EditorApp): { readonly runtime: AgentRuntime; readonly state: AgentRuntimeState } {
  const runtime = agentRuntimeOf(app);
  const state = useSyncExternalStore(runtime.store.subscribe, runtime.store.getState, runtime.store.getState);
  return { runtime, state };
}

const noSubscribe = (): (() => void) => () => {};
const nullState = (): null => null;

/** The session's state, or null without a session. */
export function useAgentSessionState(session: AgentRuntimeState['session']): AgentSessionState | null {
  return useSyncExternalStore(
    session === null ? noSubscribe : session.store.subscribe,
    session === null ? nullState : session.store.getState,
    session === null ? nullState : session.store.getState,
  );
}

/** The history's undo and redo stacks (oldest first), re-read on every history change. */
export function useHistoryView(app: EditorApp): HistoryView {
  const cache = useRef<{ version: number; view: HistoryView } | null>(null);
  const version = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) =>
      app.history.subscribe(() => {
        version.current++;
        notify();
      }),
    [app],
  );
  const get = useCallback((): HistoryView => {
    if (cache.current === null || cache.current.version !== version.current) {
      cache.current = { version: version.current, view: app.history.entries() };
    }
    return cache.current.view;
  }, [app]);
  return useSyncExternalStore(subscribe, get, get);
}

/** `Date.now()` refreshed every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
