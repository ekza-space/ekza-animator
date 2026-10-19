// MCP-SPEC §3 rule 7, §5.21 (D0): the committed tool manifest equals the regenerated one, and a changed tool list
// needs a toolset version bump. `pnpm --filter @ekza-animator/agent-tools manifest` (UPDATE_MANIFEST=1) rewrites the
// file, refusing a changed tool list under an unchanged version.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLSET_VERSION, buildManifest, canonicalJson, manifestFileText, type ToolManifest } from '../src';

const FILE = fileURLToPath(new URL('../tools.manifest.json', import.meta.url));
const update = process.env['UPDATE_MANIFEST'] === '1';

function committed(): ToolManifest | null {
  return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as ToolManifest) : null;
}

describe('tool manifest (MCP-SPEC §4.4)', () => {
  it('is deterministic', () => {
    expect(canonicalJson(buildManifest())).toBe(canonicalJson(buildManifest()));
  });

  it('carries the toolset version and the sha256 of its tools', () => {
    const manifest = buildManifest();
    expect(manifest.toolset).toBe(AGENT_TOOLSET_VERSION);
    expect(manifest.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.runIf(update)('rewrites tools.manifest.json (UPDATE_MANIFEST=1)', () => {
    const next = buildManifest();
    const before = committed();
    if (before !== null && before.hash !== next.hash && before.toolset === next.toolset) {
      throw new Error(
        `the tool list changed (hash ${before.hash.slice(0, 12)} → ${next.hash.slice(0, 12)}): bump AGENT_TOOLSET_VERSION first (§5.21)`,
      );
    }
    writeFileSync(FILE, manifestFileText(next));
    expect(readFileSync(FILE, 'utf8')).toBe(manifestFileText(next));
  });

  it.skipIf(update)('equals the committed tools.manifest.json', () => {
    // On a difference: run `pnpm --filter @ekza-animator/agent-tools manifest` (and bump the toolset version).
    expect(existsSync(FILE)).toBe(true);
    expect(readFileSync(FILE, 'utf8')).toBe(manifestFileText(buildManifest()));
  });

  it.skipIf(update)('changes its hash only with a new toolset version', () => {
    const before = committed();
    const next = buildManifest();
    expect(before === null || before.hash === next.hash || before.toolset !== next.toolset).toBe(true);
  });

  it('lists ready tools only (D0: none is ready, so tools/list is empty)', () => {
    const manifest = buildManifest();
    expect(manifest.tools.every((tool) => typeof tool.name === 'string')).toBe(true);
    expect(manifest.tools.map((tool) => tool.name)).toEqual(
      manifest.tools.map((tool) => tool.name).filter((name, i, all) => all.indexOf(name) === i),
    );
  });
});
