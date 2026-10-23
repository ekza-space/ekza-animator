// MCP-SPEC §7 (B3): the agent UI over a fake paired session — the status pill's text by state (§7.5), what audit rows
// offer (Undo at the top of the undo stack, Revert below it, undone / reverted / unreachable), Revert all AI changes,
// the [Show] toast trigger, the grants dialog and confirm card answers, and the Agent panel driving real history
// steps: Undo one AI step, Revert an older one, Revert all — the user's own step stays.
import type { ClipId, DocSnapshot } from '@ekza-studio/doc';
import { type EditorApp, loadAgentOperators, type RunActor } from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorAppProvider } from '../src';
import AgentPanel from '../src/agent/panel/AgentPanel';
import type { AgentAuditRow, AgentSessionState } from '../src/agent/types';
import { ConfirmCard } from '../src/agent/ui/ConfirmCard';
import { createFakeAgentSession, digestOf, type FakeAgentSession } from '../src/agent/ui/fakeSession';
import { GrantsDialog } from '../src/agent/ui/GrantsDialog';
import { pillView, revertAllSteps, rowAction, toastRow } from '../src/agent/ui/model';
import { agentRuntimeOf, setAgentSessionFactory } from '../src/agent/ui/runtime';
import { AGENT_SHOW, showDiscardsOverrides } from '../src/agent/ui/show';
import { agentPill } from '../src/agent/ui/slot';
import { byTestId, type Rendered, readSynthetic, render, update } from './render';

const AGENT: RunActor = { kind: 'agent', id: 'agt_FakeSession01', name: 'Claude Code' };

async function waveApp(): Promise<EditorApp> {
  const app = createFakeEditorApp({
    snapshot: (await readSynthetic('wave-doc.json')) as DocSnapshot,
    skeleton: (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc,
  });
  const clip = app.store.list('clips')[0]?.id as ClipId;
  app.operators.register<{ readonly name: string }, void, void>({
    id: 'test.rename',
    label: 'Rename',
    category: 'test',
    scope: 'global',
    flags: { undo: true },
    undoLabel: (args) => `Rename ${args.name}`,
    apply: (ctx, args) => ctx.tx?.patch('clips', clip, { name: args.name }),
  });
  app.operators.register<{ readonly table: string; readonly id: string; readonly patch: object }, void, void>({
    id: 'test.patch',
    label: 'Patch',
    category: 'test',
    scope: 'global',
    flags: { undo: true },
    apply: (ctx, args) => ctx.tx?.patch(args.table as 'clips', args.id as ClipId, args.patch),
  });
  // The fake app has no builtins: the editor's Undo (a plain history undo) is all the panel needs here.
  app.operators.register<void, unknown, void>({
    id: 'edit.undo',
    label: 'Undo',
    category: 'edit',
    scope: 'global',
    apply: () => app.history.undo(),
  });
  return app;
}

function row(n: number, patch: Partial<AgentAuditRow> = {}): AgentAuditRow {
  return {
    n,
    at: Date.UTC(2026, 9, 23, 12, 4, 30 + n),
    tool: 'pose_set',
    digest: `pose_set wave f${n}`,
    status: 'ok',
    code: null,
    ms: 12,
    step: null,
    reverted: false,
    unreachable: false,
    group: null,
    show: null,
    ...patch,
  };
}

function baseState(patch: Partial<AgentSessionState> = {}): AgentSessionState {
  return {
    status: 'paired',
    servers: [],
    server: null,
    code: null,
    grants: { read: true, edit: true, files: false, view: false, workspace: false },
    actor: AGENT,
    queue: { running: null, waiting: 0, waitingFor: null },
    confirm: null,
    audit: [],
    checkpoints: [],
    beforeAgent: null,
    error: null,
    ...patch,
  };
}

/** Waits (inside act) until `ready()` holds; operator runs from the panel are async. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ready(); i++) await update(() => new Promise((r) => setTimeout(r, 10)));
  expect(ready()).toBe(true);
}

const NO_CTX = { activeClipOf: () => null, clipName: () => 'wave', userRedoSteps: 0 };

describe('agent UI model (MCP-SPEC §7.2, §7.5)', () => {
  it('says the state in the pill text, never by colour alone', () => {
    expect(pillView(null, NO_CTX)).toEqual({ text: 'AI', tone: 'muted' });
    expect(pillView(baseState({ status: 'probing' }), NO_CTX).text).toBe('AI: looking…');
    expect(pillView(baseState({ status: 'offering', code: { text: 'K7Q-M4P', expiresAt: 0 } }), NO_CTX).text).toBe(
      'AI: code K7Q-M4P',
    );
    expect(pillView(baseState(), NO_CTX)).toEqual({ text: 'AI connected', tone: 'idle' });
    expect(pillView(baseState({ status: 'paused' }), NO_CTX).text).toBe('AI paused');
    expect(pillView(baseState({ status: 'error' }), NO_CTX).text).toBe('AI: not connected');
    expect(
      pillView(
        baseState({
          confirm: { id: 'c', prompt: { title: 'Delete clip "walk"?', detail: '', danger: true }, expiresAt: 0 },
        }),
        NO_CTX,
      ).text,
    ).toBe('AI asks: Delete clip "walk"?');
    expect(
      pillView(baseState({ queue: { running: 'pose_set', waiting: 0, waitingFor: 'gesture' } }), NO_CTX).text,
    ).toBe('AI is waiting for your drag');
    expect(
      pillView(baseState({ queue: { running: 'keys_set', waiting: 0, waitingFor: 'redo' } }), {
        ...NO_CTX,
        userRedoSteps: 5,
      }).text,
    ).toBe('AI is waiting: you have 5 steps to redo');
    const editing = baseState({
      queue: { running: 'pose_set', waiting: 0, waitingFor: null },
      audit: [
        row(1, {
          status: 'running',
          digest: 'pose_set wave f12 (3 controls)',
          show: { character: 'chr_a' as never, clip: 'clp_wave' as never, frame: 12, controls: [] },
        }),
      ],
    });
    expect(pillView(editing, { ...NO_CTX, activeClipOf: () => 'clp_other' }).text).toBe(
      'AI is editing: pose_set wave f12 (3 controls) (in "wave")',
    );
    expect(pillView(editing, { ...NO_CTX, activeClipOf: () => 'clp_wave' }).text).toBe(
      'AI is editing: pose_set wave f12 (3 controls)',
    );
    expect(
      pillView(
        baseState({
          queue: { running: 'pose_read', waiting: 0, waitingFor: null },
          audit: [row(1, { tool: 'pose_read', status: 'running' })],
        }),
        NO_CTX,
      ).text,
    ).toBe('AI is reading');
  });

  it('offers Undo at the top of the undo stack, Revert below, and names undone, reverted and unreachable steps', () => {
    const step = (id: number, changes = true) => ({
      id,
      label: `AI: s${id}`,
      docTxId: null,
      overrides: null,
      at: 0,
      actor: AGENT,
      changes: changes ? [] : null,
    });
    const history = { undo: [step(1), step(2), step(3, false), step(4)], redo: [step(5)] };
    const rows = [1, 2, 3, 4, 5, 6].map((id) => row(id, { step: { id, label: `AI: s${id}` } }));
    const reverted = new Map([[2, 9]]);
    expect(rows.map((r) => rowAction(r, history, reverted).kind)).toEqual([
      'revert',
      'reverted',
      'none',
      'undo',
      'undone',
      'unreachable',
    ]);
    expect(rowAction(row(7), history, reverted).kind).toBe('none');
    expect(revertAllSteps(rows, history, reverted)).toEqual([1, 4]);
  });

  it('raises the [Show] toast for the first edit of a clip the user is not looking at, once per clip', () => {
    const show = { character: 'chr_a' as never, clip: 'clp_wave' as never, frame: 3, controls: [] };
    const audit = [row(1, { step: { id: 1, label: 'AI: x' }, show })];
    expect(toastRow(audit, new Set(), () => 'clp_other')?.n).toBe(1);
    expect(toastRow(audit, new Set(['clp_wave']), () => 'clp_other')).toBeNull();
    expect(toastRow(audit, new Set(), () => 'clp_wave')).toBeNull();
    expect(digestOf({ clip: 'wave', frame: 12, set: [1, 2, 3] })).toBe('wave f12 (3 set)');
  });
});

describe('Agent panel over a fake session (MCP-SPEC §7.2)', () => {
  let rendered: Rendered | null = null;
  afterEach(async () => {
    await rendered?.unmount();
    rendered = null;
    setAgentSessionFactory(null);
  });

  async function setup(): Promise<{
    app: EditorApp;
    fake: FakeAgentSession;
    steps: number[];
    user: number;
    clip0Tags: unknown;
    characterName: string | undefined;
  }> {
    const app = await waveApp();
    await loadAgentOperators(app);
    let fake: FakeAgentSession | null = null;
    setAgentSessionFactory((a) => {
      fake = createFakeAgentSession(a);
      return fake;
    });
    agentRuntimeOf(app);
    if (fake === null) throw new Error('no fake');
    const session: FakeAgentSession = fake;
    await app.runUntyped('test.rename', { name: 'user' });
    const user = app.history.peekUndo()?.id ?? -1;
    const clip0Tags = app.store.list('clips')[0]?.tags;
    const characterName = app.store.list('characters')[0]?.name;
    const steps: number[] = [];
    const audit: AgentAuditRow[] = [];
    // three AI steps on different fields (a revert skips fields changed since, so they must not overlap)
    const clip = app.store.list('clips')[0];
    const character = app.store.list('characters')[0];
    if (clip === undefined || character === undefined) throw new Error('no clip');
    const patches = [
      { table: 'clips', id: clip.id, patch: { tags: ['ai'] } },
      { table: 'characters', id: character.id, patch: { name: 'AI Bot' } },
      { table: 'clips', id: clip.id, patch: { name: 'a3' } },
    ];
    for (const args of patches) {
      await app.runUntyped('test.patch', args, { source: 'api', actor: AGENT, access: 'edit' });
      const top = app.history.peekUndo();
      if (top === null) throw new Error('no step');
      steps.push(top.id);
      audit.push(row(audit.length + 1, { tool: 'clip_update', step: { id: top.id, label: top.label } }));
    }
    session.setState({ audit });
    return { app, fake: session, steps, user, clip0Tags, characterName };
  }

  it('lists the rows newest first, undoes the top AI step, reverts an older one and reverts all', async () => {
    const { app, steps, user, clip0Tags, characterName } = await setup();
    rendered = await render(
      <EditorAppProvider app={app}>
        <AgentPanel app={app} instanceId="agent" />
      </EditorAppProvider>,
    );
    const c = rendered.container;
    expect(byTestId(c, 'agent-status').textContent).toContain('Claude Code (reported)');
    expect(agentPill()).not.toBeNull();
    const ids = [...c.querySelectorAll('[data-testid^="agent-audit-row-"]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['agent-audit-row-3', 'agent-audit-row-2', 'agent-audit-row-1']);
    expect(byTestId(c, 'agent-audit-row-3').dataset['action']).toBe('undo');
    expect(byTestId(c, 'agent-audit-row-2').dataset['action']).toBe('revert');

    // Undo the newest AI step: a plain undo; the next one becomes the top.
    await update(() => byTestId(c, 'agent-audit-undo-3').click());
    await until(() => app.history.entries().redo.length === 1);
    expect(app.history.entries().redo.map((s) => s.id)).toEqual([steps[2]]);
    expect(byTestId(c, 'agent-audit-row-3').dataset['action']).toBe('undone');
    expect(byTestId(c, 'agent-audit-row-2').dataset['action']).toBe('undo');

    // Revert the oldest: one forward step; the row says which step reverted it.
    await update(() => byTestId(c, 'agent-audit-revert-1').click());
    await until(() => app.history.peekUndo()?.label.startsWith('Revert') === true);
    const revertStep = app.history.peekUndo();
    await until(() => byTestId(c, 'agent-audit-row-1').dataset['action'] === 'reverted');
    expect(byTestId(c, 'agent-audit-row-1').dataset['action']).toBe('reverted');
    expect(byTestId(c, 'agent-audit-row-1').textContent).toContain(`reverted by step ${revertStep?.id}`);

    // Revert all: asks once, then reverts the remaining AI step; the user's own step stays.
    await update(() => byTestId(c, 'agent-revert-all').click());
    expect(byTestId(c, 'agent-revert-all-question').textContent).toBe('Revert 1 AI step? Your own edits stay.');
    await update(() => byTestId(c, 'agent-revert-all-confirm').click());
    await until(() => byTestId(c, 'agent-audit-row-2').dataset['action'] === 'reverted');
    expect(byTestId(c, 'agent-audit-row-2').dataset['action']).toBe('reverted');
    expect((byTestId(c, 'agent-revert-all') as HTMLButtonElement).disabled).toBe(true);
    expect(app.store.list('clips')[0]?.name).toBe('user');
    expect(app.store.list('clips')[0]?.tags).toEqual(clip0Tags);
    expect(app.store.list('characters')[0]?.name).toBe(characterName);
    expect(app.history.entries().undo.some((s) => s.id === user)).toBe(true);
  });

  it('pauses, resumes, toggles grants and disconnects through the session', async () => {
    const { app, fake } = await setup();
    rendered = await render(
      <EditorAppProvider app={app}>
        <AgentPanel app={app} instanceId="agent" />
      </EditorAppProvider>,
    );
    const c = rendered.container;
    await update(() => byTestId(c, 'agent-pause').click());
    expect(fake.store.getState().status).toBe('paused');
    await update(() => byTestId(c, 'agent-resume').click());
    expect(fake.store.getState().status).toBe('paired');
    const read = byTestId(c, 'agent-grant-read') as HTMLInputElement;
    expect([read.checked, read.disabled]).toEqual([true, true]);
    expect((byTestId(c, 'agent-grant-workspace') as HTMLInputElement).disabled).toBe(true);
    await update(() => byTestId(c, 'agent-grant-view').click());
    expect(fake.store.getState().grants.view).toBe(true);
    await update(() => byTestId(c, 'agent-disconnect').click());
    expect(fake.store.getState().status).toBe('off');
    expect(byTestId(c, 'agent-connect')).toBeTruthy();
    await update(() => byTestId(c, 'agent-connect').click());
    expect(byTestId(c, 'agent-code').textContent).toBe('K7Q-M4P');
  });

  it('answers the grants dialog and the confirm card', async () => {
    const app = await waveApp();
    const fake = createFakeAgentSession(app, { status: 'claimed' });
    const answers: string[] = [];
    rendered = await render(
      <EditorAppProvider app={app}>
        <GrantsDialog state={fake.store.getState()} session={fake} />
      </EditorAppProvider>,
    );
    const dialog = byTestId(document.body, 'agent-grants');
    expect(dialog.textContent).toContain('Claude Code wants to work in this editor');
    await update(() => byTestId(dialog, 'agent-grant-files').click());
    await update(() => byTestId(dialog, 'agent-allow').click());
    expect(fake.store.getState()).toMatchObject({ status: 'paired', grants: { edit: true, files: true, view: false } });
    await rendered.unmount();

    const state = baseState({
      confirm: {
        id: 'cf_1',
        prompt: { title: 'Delete clip "walk"?', detail: 'Undo restores it.', danger: true },
        expiresAt: Date.now() + 50_000,
      },
    });
    rendered = await render(
      <ConfirmCard
        state={state}
        session={{ ...fake, answerConfirm: (id, answer) => answers.push(`${id}:${answer}`) }}
      />,
    );
    const card = byTestId(document.body, 'agent-confirm');
    expect(card.textContent).toContain('Delete clip "walk"?');
    await update(() => byTestId(card, 'agent-confirm-allow').click());
    await update(() =>
      byTestId(card, 'agent-confirm-allow').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(answers).toEqual(['cf_1:allow', 'cf_1:deny']);
  });

  it('registers agent.show as a user-only operator and asks before discarding unkeyed changes', async () => {
    const app = await waveApp();
    setAgentSessionFactory((a) => createFakeAgentSession(a));
    agentRuntimeOf(app);
    expect(app.operators.get(AGENT_SHOW)).toBeDefined();
    const clip = app.store.list('clips')[0];
    if (clip === undefined) throw new Error('no clip');
    const args = { character: clip.character, clip: clip.id, frame: 3 };
    expect(app.operators.poll(AGENT_SHOW, { actor: AGENT }, args)).toMatchObject({ ok: false });
    expect(app.operators.poll(AGENT_SHOW, {}, args)).toBe(true);
    expect(showDiscardsOverrides(app, args)).toBe(false);
  });
});
