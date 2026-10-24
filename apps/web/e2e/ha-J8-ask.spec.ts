import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { centreOf, loadSample, touches } from './helpers/halo-animate';
import { halo, openHalo } from './helpers/halo';
import { call } from './helpers/test-api';
import { fingerHold, fingerTap } from './helpers/touch';

// ha-J8 Ask the AI agent, then review or undo its steps (STUDIO-TOUCH-SPEC §9 J8, §14, §6.2 "History step"; T10 exit
// test), `chrome-touch`, with a fake agent session (the agent module's e2e hook, M-AI-INT-8: real tool calls, no
// bridge): search (1) › type *make him wave twice* (1) › *Ask AI* (1) → the agent claims the pairing code → the pairing
// card's plain grants › *Allow* (1) → the agent keys a wave in five steps → one group *"AI · Make him wave twice · 5
// steps"* › *Undo all* (1): at most 5 touches, and the project is as before. Then *Revert this* on one step of a second
// run, from the History ribbon (↶'s long-press), and *Undo all* there.

interface History {
  readonly rows: readonly (
    | {
        readonly kind: 'step';
        readonly id: number;
        readonly label: string;
        readonly side: string;
        readonly ai: boolean;
      }
    | {
        readonly kind: 'ai';
        readonly id: number;
        readonly title: string;
        readonly text: string;
        readonly steps: readonly number[];
      }
  )[];
}

interface ToolResult {
  readonly ok: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

// `window.__EKZA_AGENT_E2E__` is declared once for the e2e project (ai-02-agent-panel.spec.ts)

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

async function tool(page: Page, name: string, args: unknown): Promise<void> {
  const result = (await page.evaluate(([n, a]) => window.__EKZA_AGENT_E2E__?.call(n as string, a), [name, args])) as
    | ToolResult
    | undefined;
  expect([name, result?.ok === true ? 'ok' : JSON.stringify(result?.error)]).toEqual([name, 'ok']);
}

/** The agent's wave: a new animation and four poses of the right forearm (five undoable steps). */
async function agentWaves(page: Page, name: string): Promise<void> {
  await tool(page, 'clip_create', { name, durationFrames: 60 });
  for (const [frame, z] of [
    [0, 0],
    [15, 40],
    [30, 0],
    [45, 40],
  ] as const) {
    await tool(page, 'pose_set', { clip: name, frame, set: [{ control: 'fk.lowerArm.R', rotateDeg: { z } }] });
  }
}

async function history(page: Page): Promise<History | null> {
  return (await halo(page)).slices['history'] as History | null;
}

test('ha-J8: ask the AI, allow it, see its steps as one group and undo them all in ≤ 5 touches', async ({
  page,
}, testInfo) => {
  touchOnly(testInfo);
  test.setTimeout(150_000);
  await openHalo(page);
  await loadSample(page, 'seed-san');
  const before = { counts: await call(page, 'counts'), clips: await call(page, 'clips') };
  const base = await touches(page);

  // search (1) › the request (1) › Ask AI (1)
  await fingerTap(page, await centreOf(page, 'halo-search'));
  await expect(page.getByTestId('halo-palette')).toBeVisible();
  await page.getByTestId('halo-palette-input').pressSequentially('make him wave twice');
  await expect(page.getByTestId('halo-ask-ai')).toBeVisible();
  await fingerTap(page, await centreOf(page, 'halo-ask-ai'));
  await expect.poll(async () => (await halo(page)).sheet).toBe('ask');
  await expect(page.getByTestId('halo-ask-request')).toContainText('make him wave twice');

  // the agent claims the code it was given (a fake session in the claimed state); the pairing card › Allow (1)
  await page.waitForFunction(() => window.__EKZA_AGENT_E2E__ !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__EKZA_AGENT_E2E__?.installFake({ status: 'claimed', client: 'Claude Code' }));
  await expect(page.getByTestId('halo-ask-pairing')).toBeVisible();
  await expect(page.getByTestId('halo-ask-pairing')).toContainText('Claude Code');
  // the plain grants: change my animation on, the rest off
  await expect(page.getByTestId('halo-ask-grant-edit')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('halo-ask-grant-files')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('halo-ask-grant-view')).toHaveAttribute('aria-pressed', 'false');
  await fingerTap(page, await centreOf(page, 'halo-ask-allow'));
  await expect.poll(() => page.evaluate(() => window.__EKZA_AGENT_E2E__?.status() ?? null)).toBe('paired');
  await expect(page.getByTestId('halo-ask-connected')).toBeVisible();

  // the agent works: five steps, one group titled with the request
  await agentWaves(page, 'wave');
  const group = page.locator('[data-testid^="halo-history-ai-title-"]').first();
  await expect(group).toHaveText('AI · Make him wave twice · 5 steps');
  expect((await call(page, 'clips')).some((clip) => clip.name === 'wave')).toBe(true);

  // Undo all (1): the project is as before the AI
  await fingerTap(
    page,
    await centreOf(
      page,
      (await page.locator('[data-testid^="halo-history-undo-all-"]').first().getAttribute('data-testid')) ?? '',
    ),
  );
  await expect.poll(async () => (await call(page, 'clips')).some((clip) => clip.name === 'wave')).toBe(false);
  expect(await call(page, 'counts')).toEqual(before.counts);
  expect(await call(page, 'clips')).toEqual(before.clips);
  const used = (await touches(page)) - base;
  testInfo.annotations.push({ type: 'touches', description: `J8: ${used} touches` });
  expect(used).toBeLessThanOrEqual(5);

  // a second run, reviewed in the History ribbon (↶'s long-press): Revert this on one step, then Undo all
  await agentWaves(page, 'wave2');
  await page.keyboard.press('Escape');
  await fingerHold(page, await centreOf(page, 'halo-undo'), 650);
  await expect.poll(async () => (await halo(page)).sheet).toBe('history');
  await expect.poll(async () => (await history(page))?.rows.find((row) => row.kind === 'ai') !== undefined).toBe(true);
  const rows = (await history(page))?.rows ?? [];
  const ai = rows.find((row): row is Extract<History['rows'][number], { kind: 'ai' }> => row.kind === 'ai');
  if (ai === undefined) throw new Error('no AI group');
  expect(ai.steps).toHaveLength(5);
  expect(ai.text).toMatch(/^AI · .* · 5 steps$/);
  await fingerTap(page, await centreOf(page, `halo-history-steps-${ai.id}`));
  const third = ai.steps[3] as number; // the pose at frame 30
  await fingerTap(page, await centreOf(page, `halo-history-step-${third}`));
  await fingerTap(page, await centreOf(page, `halo-history-revert-${third}`));
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toMatch(/^Revert AI step: .*f30$/);
  const wave2 = (await call(page, 'clips')).find((clip) => clip.name === 'wave2');
  if (wave2 === undefined) throw new Error('no wave2');
  const forearm = (await call(page, 'controls')).find((c) => c.name === 'R Lower Arm')?.id ?? '';
  const frames = (await call(page, 'curves', wave2.id, forearm)).flatMap((curve) => curve.keys.map((k) => k.t));
  expect(frames).toContain(45);
  expect(frames).not.toContain(30);
  // Undo all on the group (its steps are no longer the top: one revert step)
  await fingerTap(page, await centreOf(page, `halo-history-undo-all-${ai.id}`));
  await expect.poll(async () => (await call(page, 'clips')).some((clip) => clip.name === 'wave2')).toBe(false);
  expect(await call(page, 'clips')).toEqual(before.clips);
});

test('ha-J8 on webkit-ipad: the Ask sheet says the assistant runs on a computer and offers the recipes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-ipad', 'webkit-ipad only');
  await openHalo(page);
  await loadSample(page, 'seed-san');
  await page.touchscreen.tap(...(Object.values(await centreOf(page, 'halo-search')) as [number, number]));
  await page.getByTestId('halo-palette-input').fill('make him wave twice');
  await page.touchscreen.tap(...(Object.values(await centreOf(page, 'halo-ask-ai')) as [number, number]));
  await expect(page.getByTestId('halo-ask-computer-only')).toBeVisible();
  await expect(page.getByTestId('halo-ask-computer-only')).toContainText('runs on your computer');
  // no broken Connect button
  await expect(page.getByTestId('halo-ask-connect')).toHaveCount(0);
});
