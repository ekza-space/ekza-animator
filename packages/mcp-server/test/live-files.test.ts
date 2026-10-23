// MCP-SPEC §5.10 (4)–(5), §5.17.2, §5.19 T15 (B1): the workspace hooks the bridge uses for live calls (reads only of
// the call's own path, writes only to targets derived from the call's own arguments), and the server's fetch: the clip
// library's starter pack from disk, every other request refused (no network).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allTools, type AgentToolDef } from '@ekza-studio/agent-tools';
import { describe, expect, it } from 'vitest';
import { createLibraryFetch, createTabFileHooks, createWorkspaceSandbox, installLibraryFetch } from '../src';
import { tempWorkspace } from './support';

const tool = (name: string): AgentToolDef => {
  const found = allTools().find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('TabFileHooks (the live tab’s workspace transfers)', () => {
  it('attaches only the call’s own path, through the sandbox', async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, 'bot.vrm'), 'vrm');
    const hooks = createTabFileHooks(await createWorkspaceSandbox({ root, readOnlyRoots: [], source: 'flag' }));
    expect(await hooks.attach(tool('project_import'), { path: 'bot.vrm' })).toEqual([
      { path: 'bot.vrm', bytes: bytes('vrm') },
    ]);
    expect(await hooks.attach(tool('keys_read'), { path: 'bot.vrm' })).toEqual([]);
    await expect(hooks.attach(tool('project_open'), { path: '../x.vrm' })).rejects.toMatchObject({ code: 'sandbox' });
  });

  it('writes saves and exports where the call’s arguments say, never where the tab says', async () => {
    const root = tempWorkspace();
    const hooks = createTabFileHooks(await createWorkspaceSandbox({ root, readOnlyRoots: [], source: 'flag' }));
    expect(
      await hooks.write(tool('project_save'), { delivery: 'workspace', path: 'mine.ekzanim' }, [
        { name: '../../evil.ekzanim', bytes: bytes('p') },
      ]),
    ).toBeNull();
    expect(readFileSync(join(root, 'mine.ekzanim'), 'utf8')).toBe('p');
    await hooks.write(tool('project_export'), { delivery: 'workspace', kind: 'vrma' }, [
      { name: '../../x.sh', bytes: bytes('v') },
    ]);
    expect(existsSync(join(root, 'exports', 'x.sh.vrma'))).toBe(true);
    // an existing file without the agent's overwrite: the call's error
    const again = await hooks.write(tool('project_save'), { delivery: 'workspace', path: 'mine.ekzanim' }, [
      { name: 'mine.ekzanim', bytes: bytes('q') },
    ]);
    expect(again).toMatchObject({ ok: false, error: { code: 'exists' } });
    // a download writes nothing
    expect(
      await hooks.write(tool('project_save'), { path: 'dl.ekzanim' }, [{ name: 'dl.ekzanim', bytes: bytes('d') }]),
    ).toBeNull();
    expect(existsSync(join(root, 'dl.ekzanim'))).toBe(false);
  });
});

describe('the server’s fetch (the clip library, no network)', () => {
  it('serves the starter pack and refuses everything else', async () => {
    const fetch = createLibraryFetch();
    const manifest = await fetch('/library/animations/starter-pack.json');
    expect(manifest.status).toBe(200);
    expect(JSON.stringify(await manifest.json())).toContain('walk');
    expect((await fetch('/library/animations/walk.vrma')).status).toBe(200);
    expect((await fetch('/library/animations/../../package.json')).status).toBe(404);
    expect((await fetch('/samples/polybot.vrm')).status).toBe(404);
    await expect(fetch('https://example.org/x')).rejects.toThrow(/no network/);
    await expect(fetch('//example.org/x')).rejects.toThrow(/no network/);
  });

  it('is installed while a hub lives', async () => {
    const before = globalThis.fetch;
    const uninstall = installLibraryFetch();
    expect(globalThis.fetch).not.toBe(before);
    await expect(globalThis.fetch('http://127.0.0.1:1/')).rejects.toThrow(/no network/);
    uninstall();
    expect(globalThis.fetch).toBe(before);
  });
});
