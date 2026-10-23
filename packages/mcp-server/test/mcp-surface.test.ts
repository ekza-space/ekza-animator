// MCP-SPEC §5.20 (B1): the MCP surface in both protocol eras (a 2025-11-25 `initialize` client and a 2026-07-28
// client over the same stdio entry): tools/list in catalogue order with schemas whose `required` leaves out defaulted
// fields and the profile `_meta`; `isError` envelopes without structuredContent (an unknown key included); resources
// (guides, templates, reads, an unknown project as a JSON-RPC error); prompts/get; progress notifications and
// cancellation through the request's signal.
import { buildManifest, PROMPTS } from '@ekza-studio/agent-tools';
import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Era, type Session, tempWorkspace } from './support';

let session: Session | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

describe.each<Era>(['legacy', 'modern'])('the %s era', (era) => {
  it('negotiates its era and lists the manifest’s tools in catalogue order with the profile _meta', async () => {
    session = await connect({ workspace: tempWorkspace() }, era);
    expect(session.client.getProtocolEra()).toBe(era);
    const { tools } = await session.client.listTools();
    const manifest = buildManifest();
    expect(tools.map((tool) => tool.name)).toEqual(manifest.tools.map((tool) => tool.name));
    for (const tool of tools) {
      const entry = manifest.tools.find((candidate) => candidate.name === tool.name);
      expect(tool.inputSchema).toEqual(entry?.inputSchema);
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
      expect(tool._meta?.['anthropic/alwaysLoad'] === true).toBe(entry?.alwaysLoad === true);
      // defaulted fields are never required (§5.20.1)
      const props = (tool.inputSchema.properties ?? {}) as Record<string, { default?: unknown }>;
      for (const name of (tool.inputSchema.required ?? []) as string[]) {
        expect([tool.name, name, props[name]?.default]).toEqual([tool.name, name, undefined]);
      }
    }
    const save = tools.find((tool) => tool.name === 'project_save');
    expect(save?.inputSchema.required ?? []).not.toContain('overwrite');
  });

  it('answers errors as isError text envelopes, unknown tools as protocol errors', async () => {
    session = await connect({ workspace: tempWorkspace() }, era);
    const raw = await session.client.callTool({ name: 'project_open', arguments: { sample: 'polybot', x: 1 } });
    expect(raw.isError).toBe(true);
    expect(raw.structuredContent).toBeUndefined();
    expect(JSON.parse((raw.content as { text: string }[])[0]?.text ?? '')).toMatchObject({
      ok: false,
      error: { code: 'invalid_args', detail: { path: 'x' } },
    });
    await expect(session.client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow(/not found/);
    const opened = await session.client.callTool({ name: 'project_open', arguments: { sample: 'polybot' } });
    expect(opened.isError).not.toBe(true);
    expect(opened.structuredContent).toMatchObject({ ok: true, data: { project: expect.stringMatching(/^prj_/) } });
  });

  it('serves the guides, the templates and project reads; an unknown project is a JSON-RPC error', async () => {
    session = await connect({ workspace: tempWorkspace() }, era);
    const { resources } = await session.client.listResources();
    expect(resources.map((resource) => resource.uri)).toHaveLength(3);
    const guide = await session.client.readResource({ uri: 'ekza://guide/conventions' });
    expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    const { resourceTemplates } = await session.client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      'ekza://projects/{project}/summary',
      'ekza://projects/{project}/selection',
      'ekza://projects/{project}/time',
      'ekza://projects/{project}/rig/{character}',
    ]);
    const { project } = await session.ok<{ project: string }>('project_open', { sample: 'polybot' });
    const read = async (uri: string) =>
      JSON.parse(((await session?.client.readResource({ uri }))?.contents[0] as { text: string }).text) as Record<
        string,
        unknown
      >;
    expect(await read(`ekza://projects/${project}/summary`)).toMatchObject({ characters: [{ name: 'Polybot' }] });
    expect(await read(`ekza://projects/${project}/selection`)).toMatchObject({ controls: [], keys: [] });
    expect(await read(`ekza://projects/${project}/time`)).toMatchObject({ frame: null, playing: false });
    expect(await read(`ekza://projects/${project}/rig/Polybot`)).toMatchObject({ character: 'Polybot' });
    await expect(session.client.readResource({ uri: 'ekza://projects/prj_000000000000/summary' })).rejects.toThrow(
      /not open|closed/,
    );
    await expect(session.client.readResource({ uri: 'ekza://nope' })).rejects.toThrow(/Unknown resource/);
  });

  it('lists the written prompts and renders a plan with safe single-word arguments', async () => {
    session = await connect({ workspace: tempWorkspace() }, era);
    const { prompts } = await session.client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(
      PROMPTS.filter((prompt) => prompt.plan !== null).map((prompt) => prompt.name),
    );
    const wave = await session.client.getPrompt({ name: 'wave', arguments: { side: 'R', times: '2' } });
    const text = (wave.messages[0]?.content as { text: string }).text;
    expect(wave.messages[0]?.role).toBe('user');
    expect(text).toContain('right hand 2 times');
    await expect(session.client.getPrompt({ name: 'nope' })).rejects.toThrow(/not found/);
  });

  it('turns ctx.progress into notifications/progress and MCP cancellation into an aborted signal', async () => {
    session = await connect({ workspace: tempWorkspace() }, era);
    const { hub } = session.server;
    let seen: AbortSignal | null = null;
    (hub as { callTool: typeof hub.callTool }).callTool = (_name, _args, opts) => {
      seen = opts.signal;
      opts.progress?.(1, 2, 'half way');
      return new Promise((resolve) => {
        opts.signal.addEventListener('abort', () =>
          resolve({
            ok: false,
            error: { code: 'cancelled', message: 'cancelled', hint: 'nothing changed', retryable: true },
          }),
        );
      });
    };
    const progress: { progress: number; total?: number; message?: string }[] = [];
    const controller = new AbortController();
    const pending = session.client.callTool({ name: 'scene_summary', arguments: {} }, {
      signal: controller.signal,
      onprogress: (update) => {
        progress.push(update);
        controller.abort();
      },
    });
    await expect(pending).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(progress).toEqual([{ progress: 1, total: 2, message: 'half way' }]);
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
  });
});
