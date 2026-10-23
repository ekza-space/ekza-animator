// MCP-SPEC §4.6, §5.1, §5.17.1 (B1): the hub's routing (the only project by default, `ambiguous` with several,
// `not_connected` with none, `expired_handle` for closed and idle-closed handles), the project cap, the idle close on
// a fake clock, `project_close` of a dirty project, `projects_list`, and the TabLink contract the bridge
// implements (B2): calls with `project: tab_…` go to the tab, `editor_connect` to the bridge.
import { type AgentToolResult, type Grants, readyTools } from '@ekza-studio/agent-tools';
import { afterEach, describe, expect, it } from 'vitest';
import type { TabLink } from '../src';
import { connect, type Session, tempWorkspace } from './support';

let session: Session | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

const GRANTS: Grants = { read: true, edit: true, files: false, view: false, workspace: false };

const HANDLE = 'tab_AbCdEfGhIjKl';

/** The bridge as B2 exposes it (`TabLink`, bridge/link.ts) with one paired tab: records calls, answers canned envelopes. */
function fakeLink(): TabLink & { calls: { tool: string; args: unknown }[]; unpaired: string[]; paired: boolean } {
  const link = {
    port: 47821,
    paired: true,
    calls: [] as { tool: string; args: unknown }[],
    unpaired: [] as string[],
    status: () => (link.paired ? ('paired' as const) : ('listening' as const)),
    tab: () =>
      link.paired
        ? {
            handle: HANDLE,
            origin: 'http://localhost:3000',
            title: 'Ekza Studio',
            project: 'Tab project',
            grants: GRANTS,
            paused: false,
            toolset: '1.0.0-dev.b1',
            pairedAt: 0,
          }
        : null,
    claim: (code: string) => Promise.resolve({ ok: true, data: { project: HANDLE, code } } as AgentToolResult<unknown>),
    call(tool: { readonly name: string }, args: unknown) {
      link.calls.push({ tool: tool.name, args });
      return Promise.resolve({ ok: true, data: { from: 'tab', tool: tool.name } } as AgentToolResult<unknown>);
    },
    unpair(handle: string) {
      if (!link.paired || handle !== HANDLE) return false;
      link.unpaired.push(handle);
      link.paired = false;
      return true;
    },
    close: () => Promise.resolve(),
  };
  return link;
}

describe('routing (§5.1)', () => {
  it('answers not_connected with nothing open, routes to the only project, asks with several', async () => {
    session = await connect({ workspace: tempWorkspace() });
    expect((await session.call('scene_summary')).error).toMatchObject({ code: 'not_connected' });
    const first = await session.ok<{ project: string }>('project_open', { sample: 'polybot' });
    expect(first.project).toMatch(/^prj_[A-Za-z0-9]{12}$/);
    expect((await session.ok<{ characters: unknown[] }>('scene_summary')).characters).toHaveLength(1);
    const second = await session.ok<{ project: string }>('project_open', {});
    const ambiguous = await session.call('scene_summary');
    expect(ambiguous.error).toMatchObject({ code: 'ambiguous' });
    expect((ambiguous.error as unknown as { candidates: string[] }).candidates).toEqual([
      first.project,
      second.project,
    ]);
    expect(
      (await session.ok<{ characters: unknown[] }>('scene_summary', { project: second.project })).characters,
    ).toEqual([]);
    expect((await session.call('scene_summary', { project: 'prj_000000000000' })).error).toMatchObject({
      code: 'expired_handle',
    });
    expect((await session.call('scene_summary', { project: 'tab_000000000000' })).error).toMatchObject({
      code: 'expired_handle',
    });
  });

  it('validates arguments at the server before routing (invalid_args, unknown keys)', async () => {
    session = await connect({ workspace: tempWorkspace() });
    const unknown = await session.call('project_open', { sample: 'polybot', samlpe: 'x' });
    expect(unknown.error).toMatchObject({ code: 'invalid_args' });
    expect(unknown.error?.message).toContain('samlpe');
    expect((await session.call('project_open', { sample: 'polybot', path: 'x.vrm' })).error).toMatchObject({
      code: 'invalid_args',
    });
    expect(session.server.hub.projects.size).toBe(0);
  });
});

describe('headless projects (§5.17.1)', () => {
  it('keeps at most maxProjects open and frees a slot on close', async () => {
    session = await connect({ workspace: tempWorkspace(), maxProjects: 2 });
    const a = await session.ok<{ project: string }>('project_open', {});
    await session.ok('project_open', {});
    expect((await session.call('project_open', {})).error).toMatchObject({ code: 'limit' });
    expect(await session.ok('project_close', { project: a.project })).toEqual({ closed: a.project, discarded: false });
    expect((await session.call('scene_summary', { project: a.project })).error).toMatchObject({
      code: 'expired_handle',
    });
    await session.ok('project_open', {});
  });

  it('asks before closing unsaved changes (confirm_required, then discardChanges)', async () => {
    session = await connect({ workspace: tempWorkspace() });
    const { project } = await session.ok<{ project: string }>('project_open', { sample: 'polybot' });
    const refused = await session.call('project_close', { project });
    expect(refused.error).toMatchObject({ code: 'confirm_required' });
    expect(await session.ok('project_close', { project, discardChanges: true })).toEqual({
      closed: project,
      discarded: true,
    });
  });

  it('closes a project idle for projectIdleMs (fake clock); its handle says the changes were discarded', async () => {
    let now = 1_000_000;
    session = await connect({ workspace: tempWorkspace(), projectIdleMs: 60_000, now: () => now });
    const { project } = await session.ok<{ project: string }>('project_open', { sample: 'polybot' });
    now += 30_000;
    const rows = await session.ok<{ projects: { project: string; idleMs: number; dirty: boolean }[] }>('projects_list');
    expect(rows.projects).toEqual([expect.objectContaining({ project, idleMs: 30_000, dirty: true })]);
    await session.ok('scene_summary', { project }); // a call resets the idle time
    now += 59_000;
    await session.ok('scene_summary', { project });
    now += 60_000;
    const expired = await session.call('scene_summary', { project });
    expect(expired.error).toMatchObject({ code: 'expired_handle' });
    expect(expired.error?.message).toContain('unsaved changes were discarded');
    expect((await session.ok<{ projects: unknown[] }>('projects_list')).projects).toEqual([]);
  });

  it('limits a seeded server to one project', async () => {
    session = await connect({ workspace: tempWorkspace(), seed: 7 });
    await session.ok('project_open', {});
    expect((await session.call('project_open', {})).error).toMatchObject({ code: 'limit' });
  });
});

describe('the paired tab through TabLink (the B2 contract)', () => {
  // editor_connect is B2's tool: listed once its owner makes it ready
  it.skipIf(!readyTools().some((tool) => tool.name === 'editor_connect'))(
    'hands editor_connect to the bridge, or answers not_connected without one',
    async () => {
      session = await connect({ workspace: tempWorkspace() });
      expect((await session.call('editor_connect', { code: 'K7Q-M4P' })).error).toMatchObject({
        code: 'not_connected',
      });
      session.server.hub.attachTabLink(fakeLink());
      expect(await session.ok('editor_connect', { code: 'K7Q-M4P' })).toEqual({ project: HANDLE, code: 'K7Q-M4P' });
    },
  );

  it('routes tab_… calls to the tab, lists it and closes the pairing', async () => {
    session = await connect({ workspace: tempWorkspace() });
    const { hub } = session.server;
    const link = fakeLink();
    hub.attachTabLink(link);
    // the only project: the tab
    expect(await session.ok('scene_summary')).toEqual({ from: 'tab', tool: 'scene_summary' });
    expect(await session.ok('keys_read', { project: HANDLE, clip: 'walk', targets: { controls: ['cog'] } })).toEqual({
      from: 'tab',
      tool: 'keys_read',
    });
    expect(link.calls.at(-1)?.args).toMatchObject({ project: HANDLE, clip: 'walk' });
    // a headless project next to it: the default is ambiguous, both are listed
    const { project } = await session.ok<{ project: string }>('project_open', {});
    expect((await session.call('scene_summary')).error).toMatchObject({ code: 'ambiguous' });
    const list = await session.ok<{ bridge: unknown; projects: Record<string, unknown>[] }>('projects_list');
    expect(list.bridge).toEqual({ status: 'paired', port: 47821 });
    expect(list.projects).toEqual([
      expect.objectContaining({
        project: HANDLE,
        kind: 'tab',
        name: 'Tab project',
        origin: 'http://localhost:3000',
        idleMs: null,
      }),
      expect.objectContaining({ project, kind: 'headless', origin: null }),
    ]);
    // project_open {project: tab_…} replaces the tab's project (the tab confirms)
    await session.ok('project_open', { project: HANDLE, sample: 'polybot' });
    expect(link.calls.at(-1)).toEqual({ tool: 'project_open', args: { project: HANDLE, sample: 'polybot' } });
    expect((await session.call('project_open', { project })).error).toMatchObject({ code: 'invalid_args' });
    // closing the tab's handle ends the pairing
    expect(await session.ok('project_close', { project: HANDLE })).toEqual({ closed: HANDLE, discarded: false });
    expect(link.unpaired).toEqual([HANDLE]);
    expect((await session.call('scene_summary', { project: HANDLE })).error).toMatchObject({
      code: 'expired_handle',
    });
  });
});
