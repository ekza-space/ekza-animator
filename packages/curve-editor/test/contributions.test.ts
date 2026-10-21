import type { CurveId } from '@ekza-studio/doc';
import type { ToolDef } from '@ekza-studio/editor-core';
import type { FakeServices } from '@ekza-studio/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { GRAPH_TOOLS, type GraphEditorController, type GraphToolHost, registerGraphContributions } from '../src';
import { xToFrame } from '../src/view/transform';
import { callsOf, drag, KERNEL_READY, type Mounted, mount, selectKeys, settle, WAVE, waveApp } from './support/app';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

describe('registerGraphContributions', () => {
  it('registers the graph tools, graph.frame and select.curveKeys, and removes them again', async () => {
    const app = await waveApp();
    let focused: GraphEditorController | null = null;
    const dispose = registerGraphContributions(app, () => focused);
    // M2a (A4, §4.5 GRAPH_TOOL): the Scale tool joins the M1 tools.
    expect(app.tools.list('graph').map((tool) => tool.id)).toEqual(['select', 'move', 'insert', 'scale']);
    expect(app.tools.get('graph', 'insert')).toBe(GRAPH_TOOLS[2]);
    expect(app.operators.get('graph.frame')?.scope).toBe('graph');
    expect(app.operators.get('select.curveKeys')).toBeDefined();

    expect(app.operators.poll('graph.frame', { panel: 'graph' }, { what: 'all' })).toEqual({
      ok: false,
      reason: 'no Graph Editor is open',
    });
    mounted = mount(app);
    focused = mounted.controller;
    mounted.controller.setView({ f0: 500, v0: 0, sx: 1, sy: 1 });
    expect(await app.run('graph.frame', { what: 'all' })).toEqual({ status: 'finished', value: undefined });
    expect(xToFrame(mounted.controller.view, 0)).toBeCloseTo(-30 * 0.08, 6);
    expect(app.history.canUndo()).toBe(false);

    expect(await app.run('select.curveKeys', { curve: 'crv_0000000000000000' as CurveId, mode: 'replace' })).toEqual({
      status: 'cancelled',
      reason: 'no such curve',
    });
    expect(await app.run('select.curveKeys', { curve: WAVE.curve, mode: 'add' })).toMatchObject({ status: 'finished' });
    expect(app.session.getState().selection.keys.size).toBe(3);
    expect(app.history.canUndo()).toBe(false);

    dispose();
    expect(app.tools.list('graph')).toEqual([]);
    expect(app.operators.get('graph.frame')).toBeUndefined();
    expect(app.operators.get('select.curveKeys')).toBeUndefined();
  });

  it('refuses a second registration without leaving anything half-registered', async () => {
    const app = await waveApp();
    const dispose = registerGraphContributions(app, () => null);
    expect(() => registerGraphContributions(app, () => null)).toThrow(/already registered/);
    dispose();
    expect(app.tools.list('graph')).toEqual([]);
    const again = registerGraphContributions(app, () => null);
    expect(app.tools.list('graph')).toHaveLength(4);
    again();
    app.dispose();
  });
});

describe('extension tools', () => {
  const sweepTool: ToolDef<GraphToolHost> = {
    id: 'acme.sweep',
    panel: 'graph',
    label: 'Sweep',
    create: (_app, host) => ({
      pointerDown(e) {
        host.press(e, { empty: 'move' });
        return true;
      },
      cursor: () => 'ew-resize',
    }),
  };

  it('a registered graph tool gets the host; the Move tool behaves like Select with its own cursor', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const dispose = registerGraphContributions(app, () => controller);
    const disposeTool = app.contribute({ kind: 'tool', def: sweepTool });
    try {
      app.session.setState({ tools: { ...app.session.getState().tools, graph: 'move' } });
      expect(controller.cursor()).toBe('move');
      // A drag on empty space is a marquee (nothing inside: an empty replace), not a move.
      drag(controller, { x: 5, y: 150 }, { x: 30, y: 200 });
      await settle();
      expect(callsOf(app, 'select.keys')).toEqual([{ items: [], mode: 'replace' }]);

      app.session.setState({ tools: { ...app.session.getState().tools, graph: 'acme.sweep' } });
      expect(controller.cursor()).toBe('ew-resize');
    } finally {
      disposeTool();
      dispose();
    }
  });

  it.skipIf(KERNEL_READY)(
    'host.press with empty: "move" drags the current selection (stubbed kernel: reported)',
    async () => {
      const app = await waveApp();
      mounted = mount(app);
      const { controller } = mounted;
      const disposeTool = app.contribute({ kind: 'tool', def: sweepTool });
      try {
        app.session.setState({ tools: { ...app.session.getState().tools, graph: 'acme.sweep' } });
        selectKeys(app, [[WAVE.keys[1], { key: true }]]);
        drag(controller, { x: 5, y: 5 }, { x: 60, y: 5 });
        expect((app.services as FakeServices).toasts.at(-1)?.text).toContain('Move Keys');
      } finally {
        disposeTool();
      }
    },
  );

  it.skipIf(!KERNEL_READY)('[needs WP-7a] host.press with empty: "move" drags the current selection', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const disposeTool = app.contribute({ kind: 'tool', def: sweepTool });
    try {
      app.session.setState({ tools: { ...app.session.getState().tools, graph: 'acme.sweep' } });
      selectKeys(app, [[WAVE.keys[1], { key: true }]]);
      drag(controller, { x: 5, y: 5 }, { x: 5 + 2 * controller.view.sx, y: 5 });
      expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(17);
    } finally {
      disposeTool();
    }
  });
});
