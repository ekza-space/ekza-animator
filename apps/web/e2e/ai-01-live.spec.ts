import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { pressOverPane } from './helpers/g3-input';
import {
  type AgentServer,
  agentState,
  callTool,
  callToolRaw,
  pair,
  startAgentServer,
  type ToolEnvelope,
} from './helpers/ai';
import { call, lastExport, openEditor } from './helpers/test-api';
import { clipsOrNone } from './helpers/ai';

// MCP-SPEC §0.4.6 MVP-AC-2 (E2E-AI-01 steps 1–7 and 10 over the real bridge, INT): the built server and the production
// editor. The page connects at start (`?e2e=1&agentPort=`), the Agent panel shows the server's code, the agent claims
// it with editor_connect and the user allows in the grants dialog (B3); the agent imports Polybot and runs the wave
// script; the toast's [Show] switches to the agent's clip; the user's Mod+Z / Shift+Z undo and redo the last AI step;
// view_capture renders the user's view and a front sheet without moving any pane camera or the playhead; the VRMA
// export downloads after the user allows the confirm card; Revert all AI changes restores the document as it was
// before the first AI step; Disconnect ends the pairing.

let server: AgentServer | null = null;
test.afterEach(async () => {
  await server?.close();
  server = null;
});

const ok = async (name: string, args: Record<string, unknown> = {}): Promise<ToolEnvelope> => {
  const result = (await callTool(server as AgentServer, name, args)) as ToolEnvelope;
  expect([name, result.ok ? 'ok' : JSON.stringify(result.error)]).toEqual([name, 'ok']);
  return result;
};

test('MVP-AC-2: pair in the panel, wave, Show, undo/redo, capture, VRMA export, Revert all, Disconnect', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  // (1) the server lists its tools; without a pairing a tool answers not_connected
  server = await startAgentServer();
  const listed = await server.client.listTools();
  expect(listed.tools.map((tool) => tool.name)).toContain('editor_connect');
  const lonely = (await callTool(server, 'scene_summary')) as ToolEnvelope;
  expect(lonely.error?.code).toBe('not_connected');

  // (2) the page offers a code in the Agent panel (opened by ?agentPort=)
  await openEditor(page, `&platform=mac&agentPort=${String(server.bridgePort)}`);
  await expect(page.getByTestId('agent-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('agent-code')).toHaveText(/^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/, {
    timeout: 15_000,
  });
  const before = { counts: await call(page, 'counts'), clips: await clipsOrNone(page) };
  const userSteps = await call(page, 'historySteps');

  // (3) pair through the grants dialog: Files on, Allow
  const connected = (await pair(page, server, { files: true })) as ToolEnvelope<{
    project: string;
    origin: string;
    grants: Record<string, boolean>;
  }>;
  expect(connected.ok).toBe(true);
  expect(connected.data?.project).toMatch(/^tab_[0-9A-Za-z]{12}$/);
  expect(connected.data?.origin).toBe(new URL(page.url()).origin);
  expect(connected.data?.grants).toMatchObject({ read: true, edit: true, files: true, view: false, workspace: false });
  expect(await agentState(page)).toMatchObject({ status: 'paired', port: server.bridgePort, code: null });
  await expect(page.getByTestId('status-agent')).toHaveText('AI connected');
  const listedProjects = (await callTool(server, 'projects_list')) as ToolEnvelope<{ projects: { kind: string }[] }>;
  expect(listedProjects.data?.projects.map((row) => row.kind)).toEqual(['tab']);

  // (4) the agent imports Polybot into the empty scene: it becomes the active character
  const imported = await ok('project_import', { sample: 'polybot' });
  const character = (imported.data as { character: string }).character;
  expect(await call(page, 'characters')).toHaveLength(1);
  const userState = await call(page, 'state');
  const panes = await call(page, 'panes');
  // the import frames the new character (a short camera move): record the cameras once they rest
  const camerasNow = () => Promise.all(panes.map((pane) => call(page, 'cameraOf', pane.id)));
  let cameras = await camerasNow();
  await expect
    .poll(async () => {
      const previous = JSON.stringify(cameras);
      cameras = await camerasNow();
      return JSON.stringify(cameras) === previous;
    })
    .toBe(true);

  // (5) the wave script (agent-evals/src/scripts/wave.ts): a checkpoint, a new clip and seven pose_aim calls
  await ok('history_checkpoint', { label: 'Wave left hand ×3' });
  await ok('clip_create', { character, name: 'wave', fps: 30, durationSeconds: 2 });
  let last: ToolEnvelope = { ok: true };
  for (let i = 0; i <= 6; i++) {
    last = await ok('pose_aim', {
      character,
      clip: 'wave',
      frame: 10 * i,
      aims: [
        { bone: 'leftUpperArm', direction: [0.8, 0.6, 0] },
        { bone: 'leftLowerArm', direction: i % 2 === 0 ? [0.55, 0.83, 0.1] : [-0.25, 0.97, 0.1] },
      ],
      intent: 'Wave',
    });
  }
  const aiSteps = (await call(page, 'historySteps')).slice(userSteps.length);
  expect(aiSteps.length).toBeGreaterThanOrEqual(9);
  expect(aiSteps.filter((step) => !step.label.startsWith('AI: '))).toEqual([]);
  expect(aiSteps.filter((step) => step.actor === 'user')).toEqual([]);
  const afterWave = await call(page, 'state');
  expect([afterWave.activeClip, afterWave.clipFrame, afterWave.sceneFrame]).toEqual([
    userState.activeClip,
    userState.clipFrame,
    userState.sceneFrame,
  ]);
  expect(await Promise.all(panes.map((pane) => call(page, 'cameraOf', pane.id)))).toEqual(cameras);
  const audit = (await agentState(page))?.audit ?? [];
  expect(audit.filter((row) => row.tool === 'pose_aim' && row.status === 'ok')).toHaveLength(7);

  // (6) the toast's [Show] switches the user to the agent's clip
  const toast = page.getByTestId('toast').filter({ hasText: 'AI is working on clip "wave"' });
  await expect(toast).toBeVisible();
  await toast.getByTestId('toast-action').click();
  const wave = (await call(page, 'clips')).find((clip) => clip.name === 'wave');
  await expect.poll(async () => (await call(page, 'state')).activeClip).toBe(wave?.id);

  // (7) the user's Mod+Z takes the last AI step back, Shift+Z redoes it
  const lastStep = last.undo?.step;
  await pressOverPane(page, 'Meta+KeyZ');
  await expect
    .poll(async () => (await call(page, 'historySteps')).find((step) => step.id === lastStep)?.undone)
    .toBe(true);
  await pressOverPane(page, 'Shift+KeyZ');
  await expect
    .poll(async () => (await call(page, 'historySteps')).find((step) => step.id === lastStep)?.undone)
    .toBe(false);

  // view_capture (live): the user's view, then a front sheet of frames 0, 30, 60; nothing the user sees moves
  const shown = await call(page, 'state');
  const camerasShown = await Promise.all(panes.map((pane) => call(page, 'cameraOf', pane.id)));
  const still = await callToolRaw(server, 'view_capture', { character, clip: 'wave', frames: [30], views: ['user'] });
  expect(still.envelope.ok).toBe(true);
  expect((still.envelope.data as { fidelity: string }).fidelity).toBe('shaded');
  expect(still.images).toHaveLength(1);
  expect(still.images[0]?.mimeType).toBe('image/png');
  const sheet = await callToolRaw(server, 'view_capture', {
    character,
    clip: 'wave',
    frames: [0, 30, 60],
    views: ['front'],
  });
  expect(sheet.envelope.ok).toBe(true);
  expect(sheet.images).toHaveLength(1);
  const png = Buffer.from(sheet.images[0]?.data ?? '', 'base64');
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(Math.max(png.readUInt32BE(16), png.readUInt32BE(20))).toBeLessThanOrEqual(1_024);
  writeFileSync(testInfo.outputPath('wave-front-sheet.png'), png);
  expect(await Promise.all(panes.map((pane) => call(page, 'cameraOf', pane.id)))).toEqual(camerasShown);
  expect((await call(page, 'state')).clipFrame).toBe(shown.clipFrame);

  // (10) the VRMA export asks the user first; Allow downloads wave.vrma
  const exporting = callTool(server, 'project_export', {
    character,
    clips: ['wave'],
    kind: 'vrma',
    fileName: 'wave',
  }) as Promise<ToolEnvelope>;
  await expect(page.getByTestId('agent-confirm')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('agent-confirm-allow').click();
  const exported = await exporting;
  expect(exported.ok).toBe(true);
  await expect.poll(async () => (await lastExport(page))?.fileName).toBe('wave.vrma');
  await page.getByTestId('agent-panel').screenshot({ path: testInfo.outputPath('agent-panel.png') });

  // Revert all AI changes: the document equals the one before the first AI step, the user's steps stay
  await page.getByTestId('agent-revert-all').click();
  await expect(page.getByTestId('agent-revert-all-question')).toBeVisible();
  await page.getByTestId('agent-revert-all-confirm').click();
  await expect.poll(async () => call(page, 'counts')).toEqual(before.counts);
  expect(await clipsOrNone(page)).toEqual(before.clips);
  const steps = await call(page, 'historySteps');
  expect(steps.slice(0, userSteps.length)).toEqual(userSteps);

  // Disconnect ends the pairing: the session is off and the handle expires
  await page.getByTestId('agent-disconnect').click();
  await expect.poll(async () => (await agentState(page))?.status).toBe('off');
  await expect(page.getByTestId('status-agent')).toHaveText('AI');
  await expect
    .poll(
      async () =>
        ((await callTool(server as AgentServer, 'scene_summary', { project: connected.data?.project })) as ToolEnvelope)
          .error?.code,
    )
    .toBe('expired_handle');
});
