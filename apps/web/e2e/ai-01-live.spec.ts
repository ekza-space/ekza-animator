import { expect, test } from '@playwright/test';
import { type AgentServer, agentState, callTool, pairViaTestApi, startAgentServer } from './helpers/ai';
import { seedSample } from './helpers/seed';
import { call, openEditor, runOk } from './helpers/test-api';

// MCP-SPEC §0.4.1 item 3 and §5.8–§5.10 (B2): the live leg end to end in the production editor and the built server —
// the page connects at start (`?e2e=1&agentPort=`), the server generates the code, the agent claims it with
// editor_connect, the user allows (the session's Allow; the grants dialog itself is B3's), a write tool runs in the
// tab through the same runtime headless uses, its step is labelled `AI: …` and attributed to the agent, and the user's
// undo takes it back. Disconnect ends the pairing and the tab handle expires.

let server: AgentServer | null = null;
test.afterEach(async () => {
  await server?.close();
  server = null;
});

test('E2E-AI-01 (live leg): pair, write, see the AI step, undo it', async ({ page }) => {
  server = await startAgentServer();
  await openEditor(page, `&agentPort=${String(server.bridgePort)}`);
  await seedSample(page, 'polybot');
  const before = await call(page, 'historySteps');

  const connected = (await pairViaTestApi(page, server)) as {
    ok: boolean;
    data: { project: string; origin: string; grants: { edit: boolean; files: boolean } };
  };
  expect(connected.ok).toBe(true);
  expect(connected.data.project).toMatch(/^tab_[0-9A-Za-z]{12}$/);
  expect(connected.data.origin).toBe(new URL(page.url()).origin);
  expect(connected.data.grants).toMatchObject({ edit: true, files: false });
  expect(await agentState(page)).toMatchObject({ status: 'paired', port: server.bridgePort, code: null });

  // a read and two writes through the bridge
  const summary = (await callTool(server, 'scene_summary')) as { ok: boolean };
  expect(summary.ok).toBe(true);
  const created = (await callTool(server, 'clip_create', { name: 'wave', durationSeconds: 2 })) as {
    ok: boolean;
    undo?: { step: number; label: string };
  };
  expect(created).toMatchObject({ ok: true, undo: { label: expect.stringMatching(/^AI: /) } });
  const keyed = (await callTool(server, 'keys_set', {
    clip: 'wave',
    keys: [{ control: 'fk.upperArm.L', channel: 'rz', frame: 10, value: 45 }],
  })) as { ok: boolean; undo?: { step: number; label: string } };
  expect(keyed).toMatchObject({ ok: true, undo: { label: expect.stringMatching(/^AI: /) } });

  const steps = await call(page, 'historySteps');
  expect(steps.length).toBe(before.length + 2);
  const last = steps.at(-1);
  expect(last).toMatchObject({ id: keyed.undo?.step, undone: false, label: keyed.undo?.label });
  expect(last?.actor).not.toBe('user');
  const audit = (await agentState(page))?.audit ?? [];
  expect(audit.map((row) => [row.tool, row.status])).toEqual([
    ['scene_summary', 'ok'],
    ['scene_summary', 'ok'],
    ['clip_create', 'ok'],
    ['keys_set', 'ok'],
  ]);
  expect(audit.at(-1)).toMatchObject({ step: keyed.undo?.step, label: keyed.undo?.label });

  // the user's undo takes the AI step back; redo brings it again
  await runOk(page, 'edit.undo');
  expect((await call(page, 'historySteps')).at(-1)).toMatchObject({ id: keyed.undo?.step, undone: true });
  await runOk(page, 'edit.redo');
  expect((await call(page, 'historySteps')).at(-1)).toMatchObject({ id: keyed.undo?.step, undone: false });

  // Disconnect ends the pairing: the handle expires, the session is off
  await page.evaluate(async () => window.__EKZA_STUDIO_TEST__?.agentAct('disconnect'));
  expect(await agentState(page)).toMatchObject({ status: 'off' });
  await expect
    .poll(
      async () =>
        (
          (await callTool(server as AgentServer, 'scene_summary', { project: connected.data.project })) as {
            error?: { code: string };
          }
        ).error?.code,
    )
    .toBe('expired_handle');
});
