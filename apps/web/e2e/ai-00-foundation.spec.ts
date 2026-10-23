import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { type AgentServer, startAgentServer } from './helpers/ai';
import { seedSample } from './helpers/seed';
import { call, openEditor } from './helpers/test-api';

// MCP-SPEC §8 D0 in the production editor and the built server: the bin lists exactly the committed manifest's ready
// tools; the status-line pill (`status-agent`) opens the Agent panel, a lazy chunk; the M-AI test API slices answer
// (`historySteps()` with actors, `agent()` null while no session exists). No E2E-AI scenario belongs to D0; this file
// guards its foundation for P7/P8.

const MANIFEST = new URL('../../../packages/agent-tools/tools.manifest.json', import.meta.url);

let server: AgentServer | null = null;
test.afterEach(async () => {
  await server?.close();
  server = null;
});

test('the built server lists the committed manifest’s tools and names itself', async () => {
  server = await startAgentServer({ bridgePort: null });
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    readonly tools: readonly { readonly name: string }[];
  };
  const { tools } = await server.client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual(manifest.tools.map((tool) => tool.name));
  expect(server.client.getServerVersion()).toMatchObject({ name: 'ekza-studio', title: 'Ekza Studio' });
  expect(server.client.getInstructions()).toContain('editor_connect');
});

test('the status pill opens the Agent panel; the M-AI test API slices answer', async ({ page }) => {
  await openEditor(page);
  const pill = page.getByTestId('status-agent');
  await expect(pill).toHaveText('AI');
  expect(await call(page, 'agent')).toBeNull();

  await seedSample(page, 'polybot');
  const steps = await call(page, 'historySteps');
  expect(steps.length).toBeGreaterThan(0);
  expect(steps.at(-1)).toMatchObject({ actor: 'user', undone: false });
  expect(steps.at(-1)?.label).toMatch(/^Import /);

  await expect(page.getByTestId('agent-panel')).toHaveCount(0);
  await pill.click();
  await expect(page.getByTestId('agent-panel')).toBeVisible();
  await expect(page.getByTestId('agent-panel')).toContainText('No agent connected');
});
