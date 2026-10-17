import type { CurveId } from '@ekza-animator/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { GRAPH_TOOLS, type GraphEditorController, registerGraphContributions } from '../src';
import { xToFrame } from '../src/view/transform';
import { type Mounted, mount, WAVE, waveApp } from './support/app';

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
    expect(app.tools.list('graph').map((tool) => tool.id)).toEqual(['select', 'move', 'insert']);
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
    expect(app.tools.list('graph')).toHaveLength(3);
    again();
    app.dispose();
  });
});
