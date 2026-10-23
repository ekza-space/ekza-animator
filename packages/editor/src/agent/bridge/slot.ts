// The agent session of a page (MCP-SPEC §4.9): one per EditorApp, created on first use by whoever opens it first (the
// Agent panel's Connect, the status pill, or the e2e test API with `?agentPort=`). This module is tiny and imports
// nothing at runtime, so the test API and the panel can read the slot without pulling the session code; the session
// itself loads through `loadAgentSession` (a dynamic import: its own chunk, never part of /editor or /autorig's first
// visit).
import type { EditorApp } from '@ekza-studio/editor-core';
import type { AgentSession, AgentSessionDeps } from '../session';

const SESSIONS = new WeakMap<EditorApp, AgentSession>();
const LISTENERS = new WeakMap<EditorApp, Set<(session: AgentSession | null) => void>>();

/** The page's agent session, or null while none was created (the agent module may not even be loaded). */
export function agentSessionOf(app: EditorApp): AgentSession | null {
  return SESSIONS.get(app) ?? null;
}

/** Called when the session of `app` is created or disposed. */
export function onAgentSession(app: EditorApp, listener: (session: AgentSession | null) => void): () => void {
  let set = LISTENERS.get(app);
  if (set === undefined) {
    set = new Set();
    LISTENERS.set(app, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

/** Session module internals: registers (or clears) the page's session. */
export function setAgentSession(app: EditorApp, session: AgentSession | null): void {
  if (session === null) SESSIONS.delete(app);
  else SESSIONS.set(app, session);
  for (const listener of LISTENERS.get(app) ?? []) listener(session);
}

/**
 * Loads the session chunk and returns the page's session, creating it with `deps` when none exists yet (a later
 * caller's `deps` are ignored).
 */
export async function loadAgentSession(app: EditorApp, deps: AgentSessionDeps): Promise<AgentSession> {
  const existing = SESSIONS.get(app);
  if (existing !== undefined) return existing;
  const { createAgentSession } = await import('../session');
  return SESSIONS.get(app) ?? createAgentSession(app, deps);
}
