// Starts the live bridge for a hub (MCP-SPEC §4.6, §5.10) when the configuration enables it, and attaches it as the
// hub's tab link. Returns the bound port, or null when the bridge is off.
import { basename } from 'node:path';
import { buildManifest, readyTools } from '@ekza-studio/agent-tools';
import type { AgentHub } from '../hub/hub';
import { type BridgeServer, type BridgeServerOptions, startBridgeServer } from './server';

export async function startHubBridge(
  hub: AgentHub,
  extra?: Pick<BridgeServerOptions, 'files' | 'timing'>,
): Promise<number | null> {
  if (!hub.config.bridge.enabled) return null;
  const manifest = buildManifest();
  const bridge: BridgeServer | null = await startBridgeServer({
    config: hub.config.bridge,
    log: hub.log,
    toolset: { version: manifest.toolset, hash: manifest.hash },
    clientInfo: () => hub.clientInfo(),
    cwdName: basename(hub.config.workspace),
    tools: new Map(readyTools().map((tool) => [tool.name, tool])),
    ...extra,
  });
  hub.attachTabLink(bridge);
  return bridge?.port ?? null;
}
