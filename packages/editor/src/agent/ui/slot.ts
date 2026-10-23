// The status-line pill's slot (MCP-SPEC §7.1, §7.5; B3). Eager and tiny: the shell renders the muted "AI" pill until
// the lazy agent module loads and puts its live pill (state text, confirm card, grants dialog, toasts) here.
import type { ReactElement } from 'react';

let current: ReactElement | null = null;
const listeners = new Set<() => void>();

export function setAgentPill(element: ReactElement | null): void {
  current = element;
  for (const listener of listeners) listener();
}

export function agentPill(): ReactElement | null {
  return current;
}

export function subscribeAgentPill(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
