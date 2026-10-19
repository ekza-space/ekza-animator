// The MCP adapter (MCP-SPEC §4.6, §5.20): a low-level SDK `Server` per request/connection, bound to the process-wide
// hub, with our own handlers. D0: tools/list (the ready tools — none yet) and tools/call (unknown → InvalidParams),
// empty resources and prompts lists; P6 completes resources, prompts, progress and cancellation.
import { PROMPTS, SERVER_INSTRUCTIONS } from '@ekza-animator/agent-tools';
import { type McpServerFactory, ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import type { AgentHub } from '../hub/hub';
import { SERVER_NAME, SERVER_TITLE, SERVER_VERSION } from '../version';
import { toCallToolResult } from './results';

/** `tools/list` entries (§5.20.1): name, title, description, schemas, annotations, `_meta` of the profile. */
export function listedTools(hub: AgentHub) {
  return hub.listTools().map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    ...(tool.alwaysLoad || tool.requiresUserInteraction
      ? {
          _meta: {
            ...(tool.alwaysLoad ? { 'anthropic/alwaysLoad': true } : {}),
            ...(tool.requiresUserInteraction ? { 'anthropic/requiresUserInteraction': true } : {}),
          },
        }
      : {}),
  }));
}

export function createMcpServerFactory(hub: AgentHub): McpServerFactory {
  return () => {
    const server = new Server(
      { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
      { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
    );
    server.setRequestHandler('tools/list', () => ({ tools: listedTools(hub) }) as never);
    server.setRequestHandler('tools/call', async (request, ctx) => {
      const { name, arguments: args } = request.params;
      if (!hub.hasTool(name)) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Tool ${name} not found`);
      const result = await hub.callTool(name, args ?? {}, { signal: ctx.mcpReq.signal });
      return toCallToolResult(result) as never;
    });
    server.setRequestHandler('resources/list', () => ({ resources: [] }));
    server.setRequestHandler('resources/templates/list', () => ({ resourceTemplates: [] }));
    server.setRequestHandler('prompts/list', () => ({
      prompts: PROMPTS.filter((prompt) => prompt.plan !== null).map((prompt) => ({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: prompt.arguments.map((argument) => ({ ...argument })),
      })),
    }));
    return server;
  };
}
