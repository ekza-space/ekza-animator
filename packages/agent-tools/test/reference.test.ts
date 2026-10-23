// MCP-SPEC §5.22 (docs/agents.md "a generated tool reference"; INT): docs/agent-tools-reference.md is generated from
// the tool manifest — names, one-line purpose, access, hosts and arguments. `pnpm --filter @ekza-studio/agent-tools
// docs` (UPDATE_REFERENCE=1) rewrites it; otherwise this test fails when the committed file differs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildManifest, type ToolManifest } from '../src';

const FILE = fileURLToPath(new URL('../../../docs/agent-tools-reference.md', import.meta.url));
const update = process.env['UPDATE_REFERENCE'] === '1';

interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly description?: string;
  readonly anyOf?: readonly JsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function firstSentence(text: string): string {
  const match = /^(.+?[.!?])(\s|$)/.exec(text);
  return (match?.[1] ?? text).trim();
}

function typeOf(schema: JsonSchema): string {
  if (schema.enum !== undefined) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.anyOf !== undefined) return schema.anyOf.map(typeOf).join(' | ');
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'any');
  if (type === 'array' && schema.items !== undefined) return `${typeOf(schema.items)}[]`;
  const range =
    schema.minimum !== undefined || schema.maximum !== undefined
      ? ` ${schema.minimum ?? '…'}…${schema.maximum ?? '…'}`
      : '';
  return `${type}${range}`;
}

function argumentsOf(schema: JsonSchema): string {
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) return '—';
  const required = new Set(schema.required ?? []);
  return properties
    .map(([name, property]) => `\`${name}${required.has(name) ? '' : '?'}\`: ${typeOf(property)}`)
    .join('; ');
}

export function referenceText(manifest: ToolManifest): string {
  const lines = [
    '# Ekza Studio agent tools — reference',
    '',
    `Generated from \`packages/agent-tools/tools.manifest.json\` (toolset \`${manifest.toolset}\`, ` +
      `${manifest.tools.length} tools) by \`pnpm --filter @ekza-studio/agent-tools docs\`. Do not edit by hand.`,
    'Setup and pairing: [agents.md](agents.md). Full contracts: [MCP-SPEC §6](MCP-SPEC.md#6-tool-catalogue-normative).',
    '',
    'Access: `read` needs the Read grant (always on), `edit` the Edit grant, `files` the Files grant, `view` the View',
    'grant; `arg` depends on the arguments. A `?` marks an optional argument. ★ = always loaded by clients with tool',
    'search.',
    '',
    '| Tool | Purpose | Access | Hosts | Arguments |',
    '|---|---|---|---|---|',
  ];
  for (const tool of manifest.tools) {
    const access = typeof tool.access === 'string' ? tool.access : 'arg';
    lines.push(
      `| \`${tool.name}\`${tool.alwaysLoad ? ' ★' : ''} | ${cell(firstSentence(tool.description))} | ${access} | ` +
        `${tool.hosts.join(', ')} | ${cell(argumentsOf(tool.inputSchema as JsonSchema))} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

describe('the generated tool reference (docs/agent-tools-reference.md)', () => {
  it.runIf(update)('rewrites the reference (UPDATE_REFERENCE=1)', () => {
    writeFileSync(FILE, referenceText(buildManifest()));
    expect(readFileSync(FILE, 'utf8')).toBe(referenceText(buildManifest()));
  });

  it.skipIf(update)('equals the committed reference', () => {
    // On a difference: run `pnpm --filter @ekza-studio/agent-tools docs`.
    expect(existsSync(FILE)).toBe(true);
    expect(readFileSync(FILE, 'utf8')).toBe(referenceText(buildManifest()));
  });
});
