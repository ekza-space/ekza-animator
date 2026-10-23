// Project routing (MCP-SPEC §4.6, §5.1): a project handle → the live tab or a headless project; `not_connected` and
// `expired_handle` errors. D0 stub; P6 implements.
import { EkzaError } from '@ekza-studio/anim-core';

export type ProjectTarget =
  | { readonly kind: 'tab'; readonly handle: string }
  | { readonly kind: 'headless'; readonly handle: string };

export function routeProject(_handle: string | undefined): ProjectTarget {
  throw new EkzaError('not-implemented', 'ekza-studio-mcp.routeProject');
}
