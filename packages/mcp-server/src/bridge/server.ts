// The live bridge (MCP-SPEC §4.5, §5.10): WebSocket server on 127.0.0.1, upgrade checks (Origin, Host), discovery,
// server-generated pairing codes, tokens, resume, call relay, blobs. D0 stub; P7 implements.
import { EkzaError } from '@ekza-animator/anim-core';

export interface BridgeServer {
  readonly port: number;
  close(): Promise<void>;
}

export function startBridgeServer(): Promise<BridgeServer> {
  return Promise.reject(new EkzaError('not-implemented', 'ekza-animator-mcp.startBridgeServer'));
}
