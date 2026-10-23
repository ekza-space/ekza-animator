// MCP-SPEC §6.10, §5.17, §5.18, §0.4.4 (B1): the file and project tools through the MCP client (their envelopes are
// checked against the advertised outputSchema in agent-evals' test/files-envelopes.test.ts, where Ajv is allowed):
// opens of .ekzanim/.vrm/samples, imports of .vrma clips (static models are the setup hook's), saves with the
// overwrite rule and the trash, exports into exports/ under derived names, the file tools off for an unsafe default workspace, and the
// user's session left alone by the file tools (the simulated user, §5.7).
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Session, tempWorkspace, waveScript } from './support';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const fixture = (path: string): string => join(FIXTURES, path);

let session: Session | null = null;
afterEach(async () => {
  await session?.close();
  session = null;
});

describe('project_open', () => {
  it('opens a model, a project file, a sample or nothing; refuses a .vrma', async () => {
    const workspace = tempWorkspace();
    copyFileSync(fixture('models/polybot.vrm'), join(workspace, 'bot.vrm'));
    session = await connect({ workspace });
    const model = await session.ok<{ project: string; summary: { project: { name: string } } }>('project_open', {
      path: 'bot.vrm',
    });
    expect(model.summary.project.name).toBe('bot');
    const summary = await session.ok<{ characters: { name: string; heightM: number }[] }>('scene_summary', {
      project: model.project,
    });
    expect(summary.characters[0]?.heightM).toBeGreaterThan(0.5); // the runtime was ready when the open returned
    await session.ok('project_save', { project: model.project, path: 'bot.ekzanim' });
    const reopened = await session.ok<{ readOnly: boolean; migratedFrom: number | null; summary: unknown }>(
      'project_open',
      { path: 'bot.ekzanim' },
    );
    expect(reopened).toMatchObject({ readOnly: false, migratedFrom: null });
    expect((await session.call('project_open', { path: 'walk.vrma' })).error).toMatchObject({
      code: 'invalid_args',
    });
    expect((await session.call('project_open', { path: 'missing.vrm' })).error).toMatchObject({ code: 'not_found' });
    expect((await session.call('project_open', { path: '../bot.vrm' })).error).toMatchObject({ code: 'sandbox' });
    // a failed open leaves no project behind
    expect(session.server.hub.projects.size).toBe(2);
  });

  it('answers unsupported for a sample that is not bundled, and finds it with --samples-dir', async () => {
    session = await connect({ workspace: tempWorkspace() });
    const missing = await session.call('project_open', { sample: 'quaternius-ual' });
    expect(missing.error).toMatchObject({ code: 'unsupported' });
    expect(missing.error?.hint).toContain('--samples-dir');
    await session.close();
    session = await connect({ workspace: tempWorkspace(), samplesDir: FIXTURES });
    const opened = await session.ok<{ summary: { characters: unknown[] } }>('project_open', {
      sample: 'quaternius-ual',
    });
    expect(opened.summary.characters).toHaveLength(1);
  });

  it('keeps the file tools off when the default workspace is the home folder; samples still open', async () => {
    session = await connect({ workspace: homedir(), workspaceSource: 'cwd' });
    expect(session.server.hub.sandbox.enabled).toBe(false);
    const refused = await session.call('project_open', { path: 'bot.vrm' });
    expect(refused.error).toMatchObject({ code: 'sandbox' });
    expect(refused.error?.hint).toContain('--workspace');
    const { project } = await session.ok<{ project: string }>('project_open', { sample: 'polybot' });
    expect((await session.call('project_save', { project })).error).toMatchObject({ code: 'sandbox' });
  });
});

describe('project_import', () => {
  it('adds a .vrma clip onto the character and refuses a project file', async () => {
    const workspace = tempWorkspace();
    session = await connect({ workspace });
    const { project } = await session.ok<{ project: string }>('project_open', { sample: 'polybot' });
    await waveScript(session, project);
    const exported = await session.ok<{ artifacts: { path: string }[] }>('project_export', {
      kind: 'vrma',
      clips: ['wave'],
    });
    expect(exported.artifacts[0]?.path).toBe('exports/wave.vrma');
    const imported = await session.call('project_import', { path: 'exports/wave.vrma', character: 'Polybot' });
    expect(imported).toMatchObject({ ok: true, data: { character: 'Polybot' } });
    expect(imported.undo?.label.startsWith('AI: ')).toBe(true);
    expect(imported.data?.['clips']).toHaveLength(1);
    // the static-model kinds go to the character setup module's hook (B4, registered by the catalogue since INT)
    const model = await session.call('project_import', { sample: 'polybot_apose' });
    expect(model).toMatchObject({
      ok: true,
      data: { character: null, model: { readyToRig: expect.any(Boolean) as unknown } },
    });
    await session.ok('project_save', { path: 'scene.ekzanim' });
    expect((await session.call('project_import', { path: 'scene.ekzanim' })).error).toMatchObject({
      code: 'invalid_args',
    });
  });
});

describe('project_save and project_export', () => {
  it('replace only with overwrite, keep backups, and derive export names', async () => {
    const workspace = tempWorkspace();
    session = await connect({ workspace });
    await session.ok('project_open', { sample: 'polybot', name: 'My Walk' });
    const saved = await session.ok<{ fileName: string; path: string; backup: null }>('project_save', {});
    expect(saved).toMatchObject({
      fileName: 'My Walk.ekzanim',
      path: 'My Walk.ekzanim',
      backup: null,
      delivered: 'workspace',
    });
    expect((await session.call('project_save', {})).error).toMatchObject({ code: 'exists' });
    const again = await session.ok<{ backup: string }>('project_save', { overwrite: true });
    expect(again.backup).toMatch(/^\.ekza-trash\//);
    expect(existsSync(join(workspace, again.backup))).toBe(true);
    const json = await session.ok<{ path: string }>('project_save', { path: 'debug.ekzanim.json' });
    expect(JSON.parse(readFileSync(join(workspace, json.path), 'utf8'))).toBeTruthy();
    expect((await session.call('project_save', { path: 'x.vrm' })).error).toMatchObject({ code: 'sandbox' });
    const download = await session.call('project_save', { path: 'other.ekzanim', delivery: 'download' });
    expect(download).toMatchObject({ ok: true, warnings: [expect.stringContaining('workspace')] });

    await waveScript(session);
    const glb = await session.ok<{ artifacts: { path: string; readBack: { ok: boolean } }[] }>('project_export', {
      kind: 'animation_glb',
      clips: ['wave'],
      fileName: 'wave clip',
    });
    expect(glb.artifacts).toEqual([expect.objectContaining({ path: 'exports/wave_clip.glb' })]);
    const baked = await session.ok<{ artifacts: { path: string; readBack: { ok: boolean } }[] }>('project_export', {
      kind: 'bake_into_model',
      clips: ['wave'],
    });
    expect(baked.artifacts).toEqual([expect.objectContaining({ path: 'exports/Polybot-baked.vrm' })]);
    expect(
      (await session.call('project_export', { kind: 'vrma', clips: ['wave'], fileName: '../../x' })).error,
    ).toMatchObject({
      code: 'invalid_args',
    });
    expect((await session.call('project_export', { kind: 'vrma', clips: ['wave'], fileName: 'CON' })).ok).toBe(true);
    expect(existsSync(join(workspace, 'exports', '_CON.vrma'))).toBe(true);
    expect(
      (await session.call('project_export', { kind: 'vrma', clips: ['wave'], fileName: 'CON' })).error,
    ).toMatchObject({
      code: 'exists',
    });
  });
});

describe('the user session (simulated user, §5.7)', () => {
  it('file tools leave the user’s active character, clip, selection and frame alone', async () => {
    const workspace = tempWorkspace();
    session = await connect({ workspace, simulatedUser: true });
    const user = session.server.user;
    if (user === null) throw new Error('no simulated user');
    const { project } = await session.ok<{ project: string }>('project_open', { sample: 'polybot' });
    const store = user.session(project);
    const before = store.getState();
    const character = before.activeCharacter;
    if (character === null) throw new Error('no active character');
    // the keeper gives a newly imported character an active clip of its own; the user's own entries stay
    const record = () => {
      const state = store.getState();
      return [state.activeCharacter, state.activeClip[character], state.selection, state.time, state.overrides];
    };
    const start = record();
    await session.ok('project_save', { path: 'u.ekzanim' });
    await session.ok('project_import', { sample: 'polybot', project });
    await session.ok('project_export', { kind: 'vrma', character: 'Polybot', clips: ['clip1'] });
    expect(record()).toEqual(start);
    expect(store.getState().activeCharacter).toBe(before.activeCharacter);
  });
});
