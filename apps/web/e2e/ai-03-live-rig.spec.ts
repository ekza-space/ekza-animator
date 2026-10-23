import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { type AgentServer, agentState, callTool, pair, startAgentServer, type ToolEnvelope } from './helpers/ai';
import { call, openEditor } from './helpers/test-api';
import { clipsOrNone } from './helpers/ai';

// MCP-SPEC §0.4.6 MVP-AC-4 (INT): MVP-AC-3 in the paired tab. The agent imports the Cube Lad sample, inspects and
// fixes it, rigs it (rig_create needs Edit + View and the user's Allow on the confirm card), adds the library walk and
// exports a VRM into the server's workspace folder. Every inner step is an `AI: …` History step and an audit row;
// Revert all AI changes restores the document as it was before the agent.

let server: AgentServer | null = null;
test.afterEach(async () => {
  await server?.close();
  server = null;
});

/** Runs a tool; while it waits, allows every confirm card the editor shows. Returns the envelope and the cards. */
async function withAllow(
  page: Page,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: ToolEnvelope; confirms: string[] }> {
  const confirms: string[] = [];
  let done = false;
  const pending = (callTool(server as AgentServer, name, args) as Promise<ToolEnvelope>).finally(() => {
    done = true;
  });
  const card = page.getByTestId('agent-confirm');
  while (!done) {
    if (await card.isVisible().catch(() => false)) {
      confirms.push((await card.textContent()) ?? '');
      await page.getByTestId('agent-confirm-allow').click();
      await expect(card).toBeHidden();
    }
    await page.waitForTimeout(100);
  }
  const result = await pending;
  expect([name, result.ok ? 'ok' : JSON.stringify(result.error)]).toEqual([name, 'ok']);
  return { result, confirms };
}

test('MVP-AC-4: the agent rigs Cube Lad live, adds a walk and exports a VRM; Revert all restores', async ({ page }) => {
  test.setTimeout(240_000);
  server = await startAgentServer();
  await openEditor(page, `&agentPort=${String(server.bridgePort)}`);
  await expect(page.getByTestId('agent-code')).toHaveText(/^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/, {
    timeout: 20_000,
  });
  const before = { counts: await call(page, 'counts'), clips: await clipsOrNone(page) };
  const userSteps = await call(page, 'historySteps');
  const connected = (await pair(page, server, { files: true, workspace: true, view: true })) as ToolEnvelope<{
    grants: Record<string, boolean>;
  }>;
  expect(connected.data?.grants).toMatchObject({ edit: true, files: true, workspace: true, view: true });

  // import a static model (the scene is empty: no confirm), inspect and fix it
  const imported = await withAllow(page, 'project_import', { sample: 'cube_lad' });
  const model = (imported.result.data as { model: { fixes: { fix: string }[]; meshes: string[] } | null }).model;
  expect(model?.meshes.length).toBeGreaterThan(0);
  const report = (await withAllow(page, 'model_inspect', {})).result.data as { fixes: { fix: string }[] };
  for (const { fix } of report.fixes) {
    await withAllow(page, 'model_fix', fix === 'scale' ? { fix, heightM: 1.7 } : { fix });
  }
  const userState = await call(page, 'state');

  // rig_create asks the user first (Edit + View); Allow rigs the model
  const rigged = await withAllow(page, 'rig_create', {});
  expect(rigged.confirms).toHaveLength(1);
  expect(rigged.confirms[0]).toMatch(/AI wants to rig/);
  const rig = rigged.result.data as { character: string; joints: number };
  expect(rig.joints).toBeGreaterThanOrEqual(15);
  expect(await call(page, 'characters')).toHaveLength(1);

  // the library walk on the new character
  const library = (await withAllow(page, 'library_list', {})).result.data as { clips: { id: string }[] };
  expect(library.clips.map((clip) => clip.id)).toContain('walk');
  const walk = (await withAllow(page, 'library_use', { character: rig.character, clip: 'walk' })).result.data as {
    clip: string;
  };
  expect((await call(page, 'clips')).map((clip) => clip.name)).toContain(walk.clip);

  // the VRM goes into the server's workspace folder (Files + Workspace)
  const exported = (
    await withAllow(page, 'project_export', {
      character: rig.character,
      kind: 'vrm',
      meta: { authors: ['Ekza Studio e2e'], license: 'cc0' },
      delivery: 'workspace',
    })
  ).result.data as { artifacts: { fileName: string; path: string | null; delivered: string }[] };
  expect(exported.artifacts[0]).toMatchObject({ delivered: 'workspace' });
  const files = readdirSync(join(server.workspace, 'exports')).filter((file) => file.endsWith('.vrm'));
  expect(files).toHaveLength(1);
  const vrm = readFileSync(join(server.workspace, 'exports', files[0] as string));
  expect(vrm.subarray(0, 4).toString('latin1')).toBe('glTF');

  // every step the agent made is an AI step; the audit log lists every call
  const aiSteps = (await call(page, 'historySteps')).slice(userSteps.length);
  expect(aiSteps.length).toBeGreaterThanOrEqual(5);
  expect(aiSteps.filter((step) => !step.label.startsWith('AI: '))).toEqual([]);
  const audit = (await agentState(page))?.audit ?? [];
  for (const tool of ['project_import', 'model_inspect', 'rig_create', 'library_use', 'project_export']) {
    expect([tool, audit.some((row) => row.tool === tool && row.status === 'ok')]).toEqual([tool, true]);
  }
  // the user's playhead stayed where it was
  expect((await call(page, 'state')).sceneFrame).toBe(userState.sceneFrame);

  // Revert all AI changes: the document as it was before the agent (the pill brings the Agent panel back after the
  // rig moved the user to Rig & Skin)
  if (!(await page.getByTestId('agent-revert-all').isVisible())) await page.getByTestId('status-agent').click();
  await page.getByTestId('agent-revert-all').click();
  await expect(page.getByTestId('agent-revert-all-question')).toBeVisible();
  await page.getByTestId('agent-revert-all-confirm').click();
  await expect.poll(async () => call(page, 'counts')).toEqual(before.counts);
  expect(await clipsOrNone(page)).toEqual(before.clips);

  await page.getByTestId('agent-disconnect').click();
  await expect.poll(async () => (await agentState(page))?.status).toBe('off');
});
