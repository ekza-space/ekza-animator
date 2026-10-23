// ekza-studio-mcp (MCP-SPEC §4.6): the MCP server of Ekza Studio — CLI, MCP adapter, hub, headless host,
// workspace sandbox and bridge server. The published bin is dist/cli.mjs (rolldown, every runtime dependency inlined).
export { originWarnings, parseArgs, type ParsedArgs, parseOrigin, USAGE } from './args';
export { configWithDefaults, DEFAULT_ALLOWED_ORIGINS, DEFAULTS, type McpServerConfig } from './config';
export { type AgentHub, createAgentHub } from './hub/hub';
export { createLogger, type Logger } from './log';
export { type CallToolResultShape, toCallToolResult } from './mcp/results';
export { createMcpServerFactory, listedTools } from './mcp/server';
export {
  createInProcessServer,
  type RunningServer,
  type SimulatedUser,
  type StdioIo,
  startMcpServer,
} from './start';
export { SERVER_NAME, SERVER_TITLE, SERVER_VERSION } from './version';
// B2: the live bridge (MCP-SPEC §4.5, §5.10)
export { startHubBridge } from './bridge/attach';
export { checkUpgrade, HOSTED_EDITOR_ORIGIN, hostAllowed, originAllowed } from './bridge/checks';
export { displayPairingCode, generatePairingCode, normalizePairingCode, PAIRING_ALPHABET } from './bridge/codes';
export type { TabCallOptions, TabFileHooks, TabInfo, TabLink } from './bridge/link';
export { imageSize, revalidateTabResult, TAB_IMAGE_LIMITS } from './bridge/results';
export { BRIDGE_DEADLINES, type BridgeServer, type BridgeServerOptions, startBridgeServer } from './bridge/server';
