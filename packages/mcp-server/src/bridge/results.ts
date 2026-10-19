// Re-validation of tab results (MCP-SPEC §5.10 "Tab results"): the server's own output schema (unknown fields
// stripped), the sanitiser and budgets again, image checks, write targets derived from the call's own arguments.
// D0 stub; P7 implements.
import { EkzaError } from '@ekza-animator/anim-core';

export function revalidateTabResult(_tool: string, _result: unknown): never {
  throw new EkzaError('not-implemented', 'ekza-animator-mcp.revalidateTabResult');
}
