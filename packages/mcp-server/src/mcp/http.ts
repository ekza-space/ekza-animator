// `--http` (MCP-SPEC §4.6, §5.19): a lazily imported chunk serving Streamable HTTP on 127.0.0.1 through
// `toNodeHandler(createMcpHandler(factory))` with the Host, Origin and bearer checks. D0 stub; P6 implements.
import { EkzaError } from '@ekza-animator/anim-core';

export function startHttpServer(): Promise<{ readonly close: () => Promise<void> }> {
  return Promise.reject(new EkzaError('not-implemented', 'ekza-animator-mcp.startHttpServer'));
}
