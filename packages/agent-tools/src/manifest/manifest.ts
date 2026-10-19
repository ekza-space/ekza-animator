// The tool manifest (MCP-SPEC §4.4, §3 rule 7, §5.21): `tools.manifest.json` lists the ready tools in catalogue order
// with their JSON Schemas (draft 2020-12) and annotations, and the sha256 of its canonical JSON. CI regenerates it
// and fails when it differs from the committed file (test/manifest.test.ts; `pnpm --filter
// @ekza-animator/agent-tools manifest` rewrites it, refusing a changed tool list without a toolset version bump).
import { sha256HexSync } from '@ekza-animator/io';
import { z } from 'zod';
import { successEnvelope } from '../schemas/common';
import { allTools, readyTools } from '../tools/catalogue';
import { AGENT_TOOLSET_VERSION, type AgentToolDef, type ManifestTool, type ToolManifest } from '../types';

/** Canonical JSON: object keys sorted (UTF-16 code units), no whitespace, `undefined` members left out. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: ${String(value)} is not representable`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value))
        return `[${value.map((item: unknown) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
      const record = value as Readonly<Record<string, unknown>>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    case 'undefined':
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new Error(`canonicalJson: a ${typeof value} is not representable`);
  }
  throw new Error('canonicalJson: unreachable');
}

/** How the manifest states a tool's access: static, by argument, or by the operator's policy (operator_run). */
export function manifestAccess(tool: AgentToolDef): ManifestTool['access'] {
  if (typeof tool.access !== 'function') return tool.access;
  return tool.name === 'operator_run' ? 'by_operator' : 'by_argument';
}

/** The manifest entry of one tool definition (also the `tools/list` entry the MCP server derives). */
export function manifestToolOf(tool: AgentToolDef): ManifestTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    group: tool.group,
    access: manifestAccess(tool),
    hosts: [...tool.hosts],
    alwaysLoad: tool.alwaysLoad,
    requiresUserInteraction: tool.requiresUserInteraction === true,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
    outputSchema: z.toJSONSchema(successEnvelope(tool.output), { io: 'output' }),
    annotations: {
      readOnlyHint: tool.annotations.readOnly,
      destructiveHint: tool.annotations.destructive,
      idempotentHint: tool.annotations.idempotent,
      openWorldHint: false,
    },
  };
}

/** Synchronous: the hash uses io's pure-TypeScript `sha256HexSync`, never `node:crypto` or WebCrypto. */
export function buildManifest(tools: readonly AgentToolDef[] = allTools()): ToolManifest {
  const entries = readyTools(tools).map(manifestToolOf);
  const hash = sha256HexSync(new TextEncoder().encode(canonicalJson(entries)));
  return { toolset: AGENT_TOOLSET_VERSION, hash, tools: entries };
}

/** The committed file's text: the manifest as indented JSON with a trailing newline (keys in canonical order). */
export function manifestFileText(manifest: ToolManifest): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2)}\n`;
}
