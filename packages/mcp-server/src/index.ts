// ekza-animator-mcp (MCP-SPEC §4.6): the MCP server of Ekza Animator — CLI, MCP adapter, hub, headless host,
// workspace sandbox and bridge server. The published bin is dist/cli.mjs (rolldown, every runtime dependency inlined).
export { parseArgs, type ParsedArgs, USAGE } from './args';
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
