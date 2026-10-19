// M-AI test API slice (MCP-SPEC §4.9): `agent()` — the agent session as plain data; null while the agent module is not
// loaded. D0 lands the stub (always null); P8 fills it from the agent session store.
import type { EkzaAnimatorTestApi } from '../types';

export function agentStateOf(): ReturnType<EkzaAnimatorTestApi['agent']> {
  return null;
}
