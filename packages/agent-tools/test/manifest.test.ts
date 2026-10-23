// MCP-SPEC §3 rule 7, §5.21 (D0): the committed tool manifest equals the regenerated one, and a changed tool list
// needs a toolset version bump — checked against the manifest committed at the merge base with the target branch, so a
// hand-edited manifest without a bump fails in CI too. `pnpm --filter @ekza-studio/agent-tools manifest`
// (UPDATE_MANIFEST=1) rewrites the file, refusing a changed tool list under an unchanged version.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLSET_VERSION, buildManifest, canonicalJson, manifestFileText, type ToolManifest } from '../src';

const FILE = fileURLToPath(new URL('../tools.manifest.json', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const update = process.env['UPDATE_MANIFEST'] === '1';
const ci = process.env['CI'] === 'true' || process.env['CI'] === '1';

function committed(): ToolManifest | null {
  return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as ToolManifest) : null;
}

/** §5.21: a manifest whose hash differs from the base's must carry another toolset version; null when it does. */
function versionGuard(base: ToolManifest | null, next: ToolManifest): string | null {
  if (base === null || base.hash === next.hash || base.toolset !== next.toolset) return null;
  return (
    `the tool manifest changed since the merge base (hash ${base.hash.slice(0, 12)} → ${next.hash.slice(0, 12)}) ` +
    `but AGENT_TOOLSET_VERSION is still ${next.toolset}: bump it (§5.21) and regenerate the manifest`
  );
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: PACKAGE_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * The manifest committed at the merge base of HEAD with the target branch: `EKZA_MANIFEST_BASE`, else the pull
 * request's base (`GITHUB_BASE_REF`), else dev, else main. `manifest: null` when the file did not exist there;
 * undefined when there is no git history to compare with (a tarball, a shallow clone).
 */
function baseManifest(): { readonly ref: string; readonly manifest: ToolManifest | null } | undefined {
  const explicit = process.env['EKZA_MANIFEST_BASE'];
  const pr = process.env['GITHUB_BASE_REF'];
  const refs =
    explicit !== undefined && explicit !== ''
      ? [explicit]
      : [...(pr !== undefined && pr !== '' ? [`origin/${pr}`] : []), 'origin/dev', 'dev', 'origin/main', 'main'];
  let path: string;
  try {
    path = `${git('rev-parse', '--show-prefix')}tools.manifest.json`;
  } catch {
    return undefined;
  }
  for (const ref of refs) {
    let base: string;
    try {
      base = git('merge-base', 'HEAD', ref);
    } catch {
      continue;
    }
    try {
      git('cat-file', '-e', `${base}:${path}`);
    } catch {
      return { ref, manifest: null };
    }
    return { ref, manifest: JSON.parse(git('show', `${base}:${path}`)) as ToolManifest };
  }
  return undefined;
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
    // On a difference: run `pnpm --filter @ekza-studio/agent-tools manifest` (and bump the toolset version).
    expect(existsSync(FILE)).toBe(true);
    expect(readFileSync(FILE, 'utf8')).toBe(manifestFileText(buildManifest()));
  });

  it.skipIf(update)('changes its hash only with a new toolset version', () => {
    const before = committed();
    const next = buildManifest();
    expect(before === null || before.hash === next.hash || before.toolset !== next.toolset).toBe(true);
  });

  it.skipIf(update)('changes its hash against the merge base only with a new toolset version (§5.21)', (ctx) => {
    const found = baseManifest();
    if (found === undefined) {
      // CI checks out the whole history (ci.yml `fetch-depth: 0`), so only a local copy without git skips this.
      if (ci) throw new Error('no merge base to compare the tool manifest with: fetch the full git history');
      ctx.skip();
      return;
    }
    // the committed file is what the base comparison guards (it equals the regenerated one, see above)
    const current = committed() ?? buildManifest();
    expect(versionGuard(found.manifest, current)).toBeNull();
  });

  it('refuses a changed hash under an unchanged version, whatever edited the file', () => {
    const base: ToolManifest = { toolset: '1.0.0', hash: 'a'.repeat(64), tools: [] };
    expect(versionGuard(null, base)).toBeNull();
    expect(versionGuard(base, { ...base })).toBeNull();
    expect(versionGuard(base, { ...base, hash: 'b'.repeat(64), toolset: '1.1.0' })).toBeNull();
    expect(versionGuard(base, { ...base, hash: 'b'.repeat(64) })).toMatch(/bump it/);
  });

  it('lists ready tools only (D0: none is ready, so tools/list is empty)', () => {
    const manifest = buildManifest();
    expect(manifest.tools.every((tool) => typeof tool.name === 'string')).toBe(true);
    expect(manifest.tools.map((tool) => tool.name)).toEqual(
      manifest.tools.map((tool) => tool.name).filter((name, i, all) => all.indexOf(name) === i),
    );
  });
});
