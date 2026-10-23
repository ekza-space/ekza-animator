// The MCP adapter (MCP-SPEC §4.6, §5.20): a low-level SDK `Server` per request/connection, bound to the process-wide
// hub, with our own handlers: tools/list (the ready tools in catalogue order), tools/call (unknown → InvalidParams;
// validate → route → `toCallToolResult`, progress notifications when the client sent a token, cancellation through
// the request's signal), resources (three static guides, four project templates), prompts (the written plans).
import {
  AgentToolFailure,
  GUIDE_TEXT,
  PROMPTS,
  RESOURCE_TEMPLATES,
  SERVER_INSTRUCTIONS,
  STATIC_RESOURCES,
  sanitizeDeep,
} from '@ekza-studio/agent-tools';
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

/** The prompts whose plans are written (a prompt without a plan is not listed). */
export function listedPrompts() {
  return PROMPTS.filter((prompt) => prompt.plan !== null);
}

const PROJECT_URI = /^ekza:\/\/projects\/((?:tab|prj)_[A-Za-z0-9]{12})\/(summary|selection|time|rig\/([^/]{1,128}))$/;

/** Reads a resource URI (§5.20.3); a template of an unknown project answers a JSON-RPC error (no `isError`). */
export async function readResource(
  hub: AgentHub,
  uri: string,
): Promise<{ readonly mimeType: string; readonly text: string }> {
  const guide = GUIDE_TEXT[uri];
  if (guide !== undefined) return { mimeType: 'text/markdown', text: guide };
  const match = PROJECT_URI.exec(uri);
  if (match === null) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown resource');
  const [, project, kind, rigCharacter] = match as unknown as [string, string, string, string | undefined];
  const resource = kind.startsWith('rig/') ? 'rig' : (kind as 'summary' | 'selection' | 'time');
  let character: string | undefined;
  if (rigCharacter !== undefined) {
    try {
      character = decodeURIComponent(rigCharacter);
    } catch {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'The character name in the URI is not valid');
    }
  }
  try {
    const data = await hub.readProjectResource(project, resource, character);
    return { mimeType: 'application/json', text: JSON.stringify(sanitizeDeep(data, { maxChars: 2_000, kind: 'prose' })) };
  } catch (error) {
    const message =
      error instanceof AgentToolFailure ? `${error.message} ${error.hint}`.trim() : 'The resource could not be read';
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, message);
  }
}

export function createMcpServerFactory(hub: AgentHub): McpServerFactory {
  return () => {
    const server = new Server(
      { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
      { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
    );
    server.oninitialized = () => {
      const info = server.getClientVersion();
      if (info !== undefined) {
        hub.setClientInfo({
          name: String(info.name).slice(0, 64),
          version: String(info.version).slice(0, 32),
        });
      }
    };
    server.setRequestHandler('tools/list', () => ({ tools: listedTools(hub) }) as never);
    server.setRequestHandler('tools/call', async (request, ctx) => {
      const { name, arguments: args } = request.params;
      if (!hub.hasTool(name)) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Tool ${name} not found`);
      const token = ctx.mcpReq._meta?.progressToken;
      const progress =
        token === undefined
          ? undefined
          : (done: number, total: number | null, message?: string): void => {
              void ctx.mcpReq
                .notify({
                  method: 'notifications/progress',
                  params: {
                    progressToken: token,
                    progress: done,
                    ...(total === null ? {} : { total }),
                    ...(message === undefined ? {} : { message }),
                  },
                } as never)
                .catch(() => {});
            };
      const result = await hub.callTool(name, args ?? {}, {
        signal: ctx.mcpReq.signal,
        ...(progress === undefined ? {} : { progress }),
      });
      return toCallToolResult(result) as never;
    });
    server.setRequestHandler('resources/list', () => ({
      resources: STATIC_RESOURCES.filter((resource) => GUIDE_TEXT[resource.uri] !== undefined).map((resource) => ({
        ...resource,
      })),
    }));
    server.setRequestHandler('resources/templates/list', () => ({
      resourceTemplates: RESOURCE_TEMPLATES.map((template) => ({ ...template })),
    }));
    server.setRequestHandler('resources/read', async (request) => {
      const { uri } = request.params;
      const read = await readResource(hub, uri);
      return { contents: [{ uri, mimeType: read.mimeType, text: read.text }] };
    });
    server.setRequestHandler('prompts/list', () => ({
      prompts: listedPrompts().map((prompt) => ({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description,
        arguments: prompt.arguments.map((argument) => ({ ...argument })),
      })),
    }));
    server.setRequestHandler('prompts/get', (request) => {
      const prompt = listedPrompts().find((candidate) => candidate.name === request.params.name);
      if (prompt === undefined || prompt.plan === null) {
        throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Prompt ${request.params.name} not found`);
      }
      const args: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.params.arguments ?? {})) {
        if (typeof value === 'string') args[key] = value;
      }
      return {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.plan(args) } }],
      } as never;
    });
    return server;
  };
}
