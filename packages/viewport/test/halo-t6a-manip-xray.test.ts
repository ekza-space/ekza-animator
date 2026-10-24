// STUDIO-TOUCH-SPEC §5.4, §4.7, §20.3 item 17 (T6a's lines for ST-T1-5 and T1's x-ray patch): a touch shell's
// manipulator scale changes the handles' size at render time without writing the session's `tools.manipulatorSize`
// (Studio Pro's value), and a display overlay's x-ray opacity reaches the mesh-view surfaces' pane display.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, meshPaneDisplay } from '../src';
import { createRig, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

describe('ViewportManager.setManipulatorScale (ST-T1-5)', () => {
  it('scales the manipulator at render time; tools.manipulatorSize is never written', async () => {
    rig = await createRig();
    rig.layout('single');
    const control = rig.app.store.list('controls')[0];
    if (control === undefined) throw new Error('no control');
    rig.app.session.setState((s) => ({
      selection: { ...s.selection, controls: [control.id] },
      tools: { ...s.tools, viewport: 'rotate' },
    }));
    rig.frame();
    const size = rig.app.session.getState().tools.manipulatorSize;
    expect(rig.vm.manipulatorFrame('pane-single')?.sizePx).toBe(size);
    rig.vm.setManipulatorScale(1.4);
    expect(rig.vm.manipulatorFrame('pane-single')?.sizePx).toBeCloseTo(size * 1.4, 6);
    expect(rig.app.session.getState().tools.manipulatorSize).toBe(size);
    rig.vm.setManipulatorScale(1);
    expect(rig.vm.manipulatorFrame('pane-single')?.sizePx).toBe(size);
  });
});

describe('the overlay’s x-ray opacity reaches mesh-view (§20.3 item 17)', () => {
  it('meshPaneDisplay carries it; without it the style’s 0.5 stays', () => {
    expect(meshPaneDisplay({ ...DEFAULT_DISPLAY, xray: true }).xrayOpacity).toBeUndefined();
    expect(meshPaneDisplay({ ...DEFAULT_DISPLAY, xray: true, xrayOpacity: 0.4 }).xrayOpacity).toBe(0.4);
  });
});
