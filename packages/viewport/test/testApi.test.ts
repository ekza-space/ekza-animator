import type { ControlId } from '@ekza-studio/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveControl, viewportTestApi } from '../src';
import { addCamera, createRig, type Rig, shotCamera } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

describe('viewport test API helpers (MVP-SPEC §4.8)', () => {
  it('lists panes with camera kind, lock and page rectangles', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: true }));
    rig.layout('split');
    const api = viewportTestApi(rig.vm);
    // M6A-SPEC §4.8 literal update (B9): every pane also reports its shading (additive field).
    expect(api.panes()).toEqual([
      { id: 'pane-left', camera: 'shot', locked: true, rect: { x: 0, y: 0, w: 600, h: 600 }, shading: 'lit' },
      { id: 'pane-right', camera: 'persp', locked: false, rect: { x: 600, y: 0, w: 600, h: 600 }, shading: 'lit' },
    ]);
    expect(api.cameraOf('pane-left')).toEqual({ position: [0, 1.2, 4], quaternion: [0, 0, 0, 1] });
  });

  it('resolves template keys of the active character and returns page coordinates on the polyline', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const hand = rig.app.store.list('controls').find((c) => c.key === 'fk.hand.L');
    expect(resolveControl(rig.app, 'fk.hand.L')).toBe(hand?.id);
    expect(resolveControl(rig.app, hand?.id ?? '')).toBe(hand?.id);
    expect(resolveControl(rig.app, 'fk.tail')).toBeNull();
    const api = viewportTestApi(rig.vm);
    const page = api.screenOfControl('fk.hand.L', 'pane-right');
    const local = rig.vm.controlScreenPoint('pane-right', hand?.id as ControlId);
    expect(page).toEqual({ x: 600 + (local?.x ?? 0), y: local?.y ?? 0 });
    const hit = rig.vm.pick('pane-right', (page?.x ?? 0) - 600, page?.y ?? 0);
    expect(hit?.kind === 'control' ? hit.control : null).toBe(hand?.id);
    expect(api.screenOfManipulator('pane-right', 'rz')).toBeNull(); // nothing selected, select tool
    expect(api.renderedFrames()).toBe(rig.vm.renderedFrames);
  });
});
