import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPaneCamera, FIRST_SHOT_CAMERA, LAYOUT_PANES } from '../src';
import { paneGl } from '../src/panes/layout';
import { createRig, HEIGHT, paneRect, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

describe('pane layouts', () => {
  it('names the panes of each layout and their default cameras', () => {
    expect(LAYOUT_PANES.single).toEqual(['pane-single']);
    expect(LAYOUT_PANES.split).toEqual(['pane-left', 'pane-right']);
    expect(LAYOUT_PANES.quad).toEqual(['pane-top', 'pane-persp', 'pane-front', 'pane-side']);
    expect(defaultPaneCamera('pane-left')).toEqual(FIRST_SHOT_CAMERA);
    expect(defaultPaneCamera('pane-right')).toEqual({ kind: 'view', preset: 'persp' });
    expect(defaultPaneCamera('pane-top')).toEqual({ kind: 'view', preset: 'top' });
    expect(defaultPaneCamera('pane-front')).toEqual({ kind: 'view', preset: 'front' });
    expect(defaultPaneCamera('pane-side')).toEqual({ kind: 'view', preset: 'side' });
    expect(defaultPaneCamera('pane-other')).toEqual({ kind: 'view', preset: 'persp' });
  });

  it('maps a pane rectangle to a bottom-left GL viewport and a canvas-clipped scissor', () => {
    const canvas = { left: 10, top: 20, width: 800, height: 600 };
    expect(paneGl(canvas, { left: 10, top: 20, width: 400, height: 300 })).toEqual({
      viewport: { x: 0, y: 300, width: 400, height: 300 },
      scissor: { x: 0, y: 300, width: 400, height: 300 },
    });
    // Sticking out to the right and below: the viewport keeps the pane size, the scissor is clipped.
    expect(paneGl(canvas, { left: 610, top: 520, width: 400, height: 300 })).toEqual({
      viewport: { x: 600, y: -200, width: 400, height: 300 },
      scissor: { x: 600, y: 0, width: 200, height: 100 },
    });
    expect(paneGl(canvas, { left: 900, top: 20, width: 100, height: 100 })).toBeNull();
    expect(paneGl(canvas, { left: 10, top: 20, width: 0, height: 100 })).toBeNull();
  });

  it.each(['single', 'split', 'quad'] as const)('renders each %s pane inside its scissor rectangle', async (layout) => {
    rig = await createRig();
    rig.layout(layout);
    const scissor = vi.spyOn(rig.renderer, 'setScissor');
    const viewport = vi.spyOn(rig.renderer, 'setViewport');
    rig.vm.invalidate();
    rig.frame();
    const expected = LAYOUT_PANES[layout].map((_, i) => {
      const r = paneRect(layout, i);
      return [r.x, HEIGHT - (r.y + r.h), r.w, r.h];
    });
    expect(scissor.mock.calls.map((call) => call.slice(0, 4))).toEqual(expected);
    expect(viewport.mock.calls.map((call) => call.slice(0, 4))).toEqual(expected);
  });

  it('renders no frame while nothing changes, and one frame per change', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const after = rig.vm.renderedFrames;
    expect(after).toBe(1);
    for (let i = 0; i < 5; i++) rig.frame();
    expect(rig.vm.renderedFrames).toBe(after);
    const control = rig.app.store.list('controls')[3];
    rig.app.session.setState({
      selection: {
        controls: [control?.id ?? never()],
        keys: new Map(),
        channels: [],
        objects: [],
        joints: [],
        constraints: [],
      },
    });
    rig.frame();
    rig.frame();
    expect(rig.vm.renderedFrames).toBe(after + 1);
    rig.app.session.setState({ time: { ...rig.app.session.getState().time, sceneFrame: 7 } });
    rig.frame();
    rig.frame();
    expect(rig.vm.renderedFrames).toBe(after + 2);
  });

  it('remembers pane cameras and display flags across layout switches', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.vm.updatePane('pane-right', { camera: { kind: 'view', preset: 'top' } });
    rig.vm.updatePane('pane-right', {
      display: { ...(rig.vm.paneState('pane-right')?.display ?? never()), grid: false },
    });
    expect(rig.vm.rememberedPane('pane-right')?.camera).toEqual({ kind: 'view', preset: 'top' });
    rig.layout('quad');
    expect(rig.vm.paneIds()).toEqual(LAYOUT_PANES.quad);
    expect(rig.vm.paneState('pane-right')).toBeNull();
    expect(rig.vm.rememberedPane('pane-right')?.display.grid).toBe(false);
  });

  it('finds the pane under a page point', async () => {
    rig = await createRig();
    rig.layout('quad');
    expect(rig.vm.paneAt(10, 10)).toBe('pane-top');
    expect(rig.vm.paneAt(900, 10)).toBe('pane-persp');
    expect(rig.vm.paneAt(10, 590)).toBe('pane-front');
    expect(rig.vm.paneAt(900, 590)).toBe('pane-side');
    expect(rig.vm.paneAt(1300, 10)).toBeNull();
  });
});

function never(): never {
  throw new Error('fixture is missing data');
}
