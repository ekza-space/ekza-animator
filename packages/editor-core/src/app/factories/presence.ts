// Factory of the kernel's presence registry (MCP-SPEC §4.1, §8.2: M6a's per-owner factory pattern for the closed
// `app/{createEditorApp,kernel}.ts`; the kernel wires it with one line).
import { createPresenceRegistry } from '../../presence/registry';
import type { PresenceRegistry } from '../../types';

export function createKernelPresence(opts: { readonly now: () => number }): PresenceRegistry {
  return createPresenceRegistry({ now: opts.now });
}
