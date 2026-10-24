// The agent's UI hook for every shell (MCP-SPEC §7.1, §7.5; STUDIO-TOUCH-SPEC §14, §20.3 item 12; T3: moved out of
// Pro's status line). The live pill — state text, confirm card, grants dialog, toasts — is put in a page-wide slot by
// the lazy agent module (`agent/ui/slot.ts`) once it has loaded; a shell shows it where its agent entry sits (Pro: the
// status line; Halo: the Ask sheet and the search pill) and its own muted entry until then. `?agentPort=` opens the
// shell's agent surface once per page (Pro: the Agent panel; Halo: the Ask sheet), which applies the port rules.
import { type ReactElement, useEffect, useSyncExternalStore } from 'react';
import { agentPill, subscribeAgentPill } from '../../agent/ui/slot';

/** `?agentPort=` is handled once per page, whichever shell's surface handles it. */
let agentPortHandled = false;

/**
 * The live agent pill (null until the agent module has loaded). With `?agentPort=` it runs `open` once per page, as
 * soon as `ready()` (the shell can show its surface), or after 10 s regardless.
 */
export function useAgentPill(open: () => unknown, ready: () => boolean): ReactElement | null {
  const live = useSyncExternalStore(subscribeAgentPill, agentPill, agentPill);
  useEffect(() => {
    if (agentPortHandled || typeof location === 'undefined' || !/[?&]agentPort=/.test(location.search)) return;
    agentPortHandled = true;
    let tries = 0;
    const attempt = (): void => {
      if (ready() || ++tries >= 40) void open();
      else setTimeout(attempt, 250);
    };
    attempt();
  }, [open, ready]);
  return live;
}
