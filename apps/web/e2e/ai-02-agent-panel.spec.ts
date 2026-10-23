import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { seedSample } from './helpers/seed';
import { call, openEditor } from './helpers/test-api';

// MCP-SPEC §7, §5.11, §5.15 (MVP cut §0.4.1 items 4–5; B3) in the production editor: the Agent panel opened from the
// status pill with a fake paired session (the agent module's e2e hook; B2's ai-01 covers the real bridge), real
// tool calls through the shared tool runtime — audit rows newest first, the "AI is working on clip …" toast with
// [Show], a live view_capture of the user's view and a front sheet (≤ 1,024 px, PNG, no pane camera or playhead
// change) — then Undo of one AI step from its row and Revert all AI changes: the document equals the one before the
// first AI step, the user's own steps stay.

interface ToolResult {
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
  readonly images?: readonly {
    mime: string;
    width: number;
    height: number;
    byteLength: number;
    signature: number[];
    base64?: string;
  }[];
}

declare global {
  interface Window {
    __EKZA_AGENT_E2E__?: {
      installFake(opts?: Record<string, unknown>): void;
      call(tool: string, args: unknown, opts?: { withBytes?: boolean }): Promise<unknown>;
      status(): string | null;
    };
  }
}

async function tool(page: Page, name: string, args: unknown, withBytes = false): Promise<ToolResult> {
  const result = (await page.evaluate(
    ([n, a, b]) => window.__EKZA_AGENT_E2E__?.call(n as string, a, { withBytes: b as boolean }),
    [name, args, withBytes],
  )) as ToolResult;
  expect([name, result.ok ? 'ok' : JSON.stringify(result.error)]).toEqual([name, 'ok']);
  return result;
}

test('the Agent panel shows the AI’s steps; Undo one, Show the clip, Revert all; view_capture renders live', async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await seedSample(page, 'polybot');
  const before = { counts: await call(page, 'counts'), clips: await call(page, 'clips') };
  const userState = await call(page, 'state');
  const userSteps = await call(page, 'historySteps');

  const pill = page.getByTestId('status-agent');
  await expect(pill).toHaveText('AI');
  await pill.click();
  const panel = page.getByTestId('agent-panel');
  await expect(panel).toContainText('No agent connected');
  await page.waitForFunction(() => window.__EKZA_AGENT_E2E__ !== undefined);
  await page.evaluate(() => window.__EKZA_AGENT_E2E__?.installFake({ status: 'paired', client: 'Claude Code' }));
  await expect(page.getByTestId('agent-status')).toContainText('Connected');
  await expect(page.getByTestId('agent-status')).toContainText('Claude Code (reported)');
  await expect(pill).toHaveText('AI connected');
  await expect(page.getByTestId('agent-grant-read')).toBeChecked();
  await expect(page.getByTestId('agent-grant-read')).toBeDisabled();
  await expect(page.getByTestId('agent-grant-edit')).toBeChecked();

  // The agent works: a read, a new clip (not the user's), two poses on it.
  await tool(page, 'scene_summary', {});
  await tool(page, 'clip_create', { name: 'wave', durationFrames: 60 });
  await tool(page, 'pose_set', { clip: 'wave', frame: 10, set: [{ control: 'fk.upperArm.L', rotateDeg: { z: 40 } }] });
  await tool(page, 'pose_set', { clip: 'wave', frame: 30, set: [{ control: 'fk.lowerArm.L', rotateDeg: { z: 30 } }] });

  // view_capture (live): the user's view, then a front sheet of three frames; nothing the user sees moves.
  const panes = await call(page, 'panes');
  const cameras = await Promise.all(panes.map((pane) => call(page, 'cameraOf', pane.id)));
  const still = await tool(page, 'view_capture', { clip: 'wave', frames: [10], views: ['user'] });
  expect(still.data?.['fidelity']).toBe('shaded');
  const image = still.images?.[0];
  expect(image?.mime).toBe('image/png');
  expect(image?.signature.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(Math.max(image?.width ?? 0, image?.height ?? 0)).toBeLessThanOrEqual(1_024);
  const sheet = await tool(page, 'view_capture', { clip: 'wave', frames: [0, 30, 59], views: ['front', 'left'] }, true);
  writeFileSync(testInfo.outputPath('view-capture-sheet.png'), Buffer.from(sheet.images?.[0]?.base64 ?? '', 'base64'));
  expect(sheet.data?.['tiles']).toHaveLength(6);
  expect(Math.max(sheet.images?.[0]?.width ?? 0, sheet.images?.[0]?.height ?? 0)).toBeLessThanOrEqual(1_024);
  expect(await Promise.all(panes.map((pane) => call(page, 'cameraOf', pane.id)))).toEqual(cameras);
  const afterCapture = await call(page, 'state');
  expect([afterCapture.activeClip, afterCapture.clipFrame, afterCapture.sceneFrame]).toEqual([
    userState.activeClip,
    userState.clipFrame,
    userState.sceneFrame,
  ]);

  // The audit log: newest first, one row per call; the AI steps carry Undo (top) or Revert.
  const rows = page.locator('[data-testid^="agent-audit-row-"]');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toHaveAttribute('data-testid', 'agent-audit-row-6');
  await expect(page.getByTestId('agent-audit-row-4')).toHaveAttribute('data-action', 'undo');
  await expect(page.getByTestId('agent-audit-row-3')).toHaveAttribute('data-action', 'revert');
  await expect(page.getByTestId('agent-audit-row-2')).toHaveAttribute('data-action', 'revert');
  await expect(page.getByTestId('agent-audit-row-1')).toHaveAttribute('data-action', 'none');
  await expect(page.getByTestId('agent-audit-row-4')).toContainText('AI: ');
  await page.getByTestId('agent-panel').screenshot({ path: testInfo.outputPath('agent-panel.png') });

  // The first edit of a clip the user is not looking at raised the toast; [Show] switches to it.
  const toast = page.getByTestId('toast').filter({ hasText: 'AI is working on clip "wave"' });
  await expect(toast).toBeVisible();
  await toast.getByTestId('toast-action').click();
  const wave = (await call(page, 'clips')).find((clip) => clip.name === 'wave');
  await expect.poll(async () => (await call(page, 'state')).activeClip).toBe(wave?.id);
  await page.getByTestId('agent-audit-show-3').click();
  await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(10);
  // back to the user's clip (a user run; not a document step)
  await page.evaluate((clip) => window.__EKZA_STUDIO_TEST__?.run('clip.setActive', { clip }), userState.activeClip);

  // Undo the newest AI step from its row.
  await page.getByTestId('agent-audit-undo-4').click();
  await expect(page.getByTestId('agent-audit-row-4')).toHaveAttribute('data-action', 'undone');
  await expect(page.getByTestId('agent-audit-row-3')).toHaveAttribute('data-action', 'undo');

  // Revert all AI changes since pairing: asks once, then one step; the document is as before the first AI step.
  await page.getByTestId('agent-revert-all').click();
  await expect(page.getByTestId('agent-revert-all-question')).toHaveText('Revert 2 AI steps? Your own edits stay.');
  await page.getByTestId('agent-revert-all-confirm').click();
  await expect(page.getByTestId('agent-audit-row-3')).toHaveAttribute('data-action', 'reverted');
  await expect(page.getByTestId('agent-audit-row-2')).toHaveAttribute('data-action', 'reverted');
  await expect(page.getByTestId('agent-revert-all')).toBeDisabled();
  expect(await call(page, 'counts')).toEqual(before.counts);
  expect(await call(page, 'clips')).toEqual(before.clips);
  const steps = await call(page, 'historySteps');
  expect(steps.slice(0, userSteps.length)).toEqual(userSteps);
  expect(steps.at(-1)?.label).toMatch(/^Revert/);

  // Disconnect: the pill goes back to off.
  await page.getByTestId('agent-disconnect').click();
  await expect(pill).toHaveText('AI');
  await expect(panel).toContainText('No agent connected');
});
