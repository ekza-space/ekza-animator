// MCP-SPEC §4.9, §7.1 (D0): the agent URL parameters keep the header promise (no URL connects a user's editor by
// itself), `historySteps()` reports actors, the Agent panel is registered (Windows › Agent) as a lazy chunk.
import type { ClipId, DocSnapshot } from '@ekza-animator/doc';
import type { RunActor } from '@ekza-animator/editor-core';
import { createFakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { registerBuiltinPanels } from '../src/panels';
import { AGENT_PANEL } from '../src/panels/agent';
import { createPanelRegistry } from '../src/panels/registry';
import { shellMenuItems } from '../src/shell/menuItems';
import { historyStepsOf } from '../src/test-api/mai/history';
import { parseAgentParams } from '../src/test-api/params';
import { readSynthetic } from './render';

const AGENT: RunActor = { kind: 'agent', id: 'agt_EditorTest001', name: 'Claude Code' };

describe('agent URL parameters (MCP-SPEC §4.9)', () => {
  it('in e2e builds opened with ?e2e=1: any loopback ports (≤ 10), connect at start, the test timings', () => {
    const params = parseAgentParams('?e2e=1&agentPort=5100,47821,80,5100&agentGestureWaitMs=500', true);
    expect(params).toEqual({
      agentPorts: [5100, 47821],
      openPanel: true,
      connectAtStart: true,
      gestureWaitMs: 500,
      confirmTimeoutMs: null,
    });
    const many = parseAgentParams(`?e2e=1&agentPort=${Array.from({ length: 12 }, (_, i) => 6000 + i).join(',')}`, true);
    expect(many.agentPorts).toHaveLength(10);
  });

  it('elsewhere: only 47821–47830, never a connection without a click, no test timings', () => {
    expect(parseAgentParams('?agentPort=47823,8080&agentConfirmTimeoutMs=10', true)).toEqual({
      agentPorts: [47823],
      openPanel: true,
      connectAtStart: false,
      gestureWaitMs: null,
      confirmTimeoutMs: null,
    });
    expect(parseAgentParams('?e2e=1&agentPort=5100', false)).toMatchObject({ agentPorts: [], connectAtStart: false });
    expect(parseAgentParams('?agentPort=8080', true)).toMatchObject({ agentPorts: [], openPanel: false });
  });
});

describe('historySteps (MCP-SPEC §4.9)', () => {
  it('lists the steps of both stacks oldest first with their actor', async () => {
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
    await app.runUntyped('test.rename', { name: 'a' });
    await app.runUntyped('test.rename', { name: 'b' }, { source: 'api', actor: AGENT, access: 'edit' });
    app.history.undo();
    const steps = historyStepsOf(app);
    expect(steps.map(({ label, actor, undone }) => ({ label, actor, undone }))).toEqual([
      { label: 'Rename a', actor: 'user', undone: false },
      { label: 'AI: Rename b', actor: 'Claude Code', undone: true },
    ]);
  });
});

describe('Agent panel registration (MCP-SPEC §7.1)', () => {
  it('registers the agent extra panel and its Windows menu item', () => {
    const registry = createPanelRegistry();
    registerBuiltinPanels(registry);
    expect(registry.get('agent')).toBe(AGENT_PANEL);
    const items = shellMenuItems([{ kind: AGENT_PANEL.kind, title: AGENT_PANEL.title }]);
    expect(items.find((item) => item.id === 'shell.windows.panel.agent')).toMatchObject({
      menu: 'windows',
      op: 'workspace.showPanel',
      args: { panel: 'agent' },
      label: 'Agent',
    });
  });
});
