import { type CameraId, EkzaError, fractionalIndex } from '@ekza-animator/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_SHOT_CAMERA } from '../src';
import { RADIAL_MARGIN_PX } from '../src/manager/ViewportManager';
import { addCamera, createRig, pointer, type Rig, shotCamera } from './helpers';

/** fractionalIndex (WP-2) is stubbed until the doc package lands; creating a new shot camera needs it. */
const FRACTIONAL_INDEX = (() => {
  try {
    fractionalIndex(null, null);
    return true;
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
})();

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

const SHOT = 'cam_TestShotCamera01' as CameraId;

describe('viewport operators', () => {
  it('registers the viewport tools and operators, and removes them again', async () => {
    rig = await createRig({ contributions: false });
    const { registerViewportContributions } = await import('../src');
    const dispose = registerViewportContributions(rig.app, rig.vm);
    expect(rig.app.tools.list('viewport').map((t) => t.id)).toEqual(['select', 'move', 'rotate']);
    const ids = [
      'view.layout',
      'view.frame',
      'view.display.toggle',
      'view.lookThrough',
      'view.copyViewToShot',
      'view.toggleCameraLock',
      'view.cameraRadial',
    ];
    expect(ids.filter((id) => rig?.app.operators.get(id) === undefined)).toEqual([]);
    dispose();
    expect(rig.app.tools.list('viewport')).toEqual([]);
    expect(rig.app.operators.get('view.layout')).toBeUndefined();
  });

  it('view.layout switches the layout and keeps a maximized pane only when it still exists', async () => {
    rig = await createRig();
    rig.app.session.setState({ maximizedPane: 'pane-right' });
    expect((await rig.app.run('view.layout', { layout: 'quad' })).status).toBe('finished');
    expect(rig.app.session.getState()).toMatchObject({ viewportLayout: 'quad', maximizedPane: null });
    rig.app.session.setState({ maximizedPane: 'pane-persp' });
    await rig.app.run('view.layout', { layout: 'quad' });
    expect(rig.app.session.getState().maximizedPane).toBe('pane-persp');
    expect((await rig.app.runUntyped('view.layout', { layout: 'nine' })).status).toBe('cancelled');
  });

  it('view.display.toggle flips one flag of one pane (explicit pane, run context or last used pane)', async () => {
    rig = await createRig();
    rig.layout('split');
    await rig.app.run('view.display.toggle', { flag: 'xray', paneId: 'pane-left' });
    expect(rig.vm.paneState('pane-left')?.display.xray).toBe(true);
    expect(rig.vm.paneState('pane-right')?.display.xray).toBe(false);
    await rig.app.run('view.display.toggle', { flag: 'skeleton' }, { panel: 'viewport', paneId: 'pane-right' });
    expect(rig.vm.paneState('pane-right')?.display.skeleton).toBe(true);
    await rig.app.run('view.display.toggle', { flag: 'xray', paneId: 'pane-left' });
    expect(rig.vm.paneState('pane-left')?.display.xray).toBe(false);
    expect((await rig.app.runUntyped('view.display.toggle', { flag: 'wire', paneId: 'pane-left' })).status).toBe(
      'cancelled',
    );
  });

  it('view.lookThrough binds a pane to a view or shot camera', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera());
    rig.layout('split');
    expect(rig.vm.paneState('pane-left')).toMatchObject({ cameraKind: 'shot', cameraName: 'shotCam', locked: true });
    await rig.app.run('view.lookThrough', { paneId: 'pane-left', camera: { kind: 'view', preset: 'side' } });
    expect(rig.vm.paneState('pane-left')).toMatchObject({
      cameraKind: 'view',
      preset: 'side',
      cameraName: 'side',
      locked: false,
    });
    await rig.app.run('view.lookThrough', { paneId: 'pane-right', camera: { kind: 'shot', cameraId: SHOT } });
    expect(rig.vm.paneState('pane-right')).toMatchObject({ cameraKind: 'shot', shotCameraId: SHOT });
    const missing = await rig.app.run('view.lookThrough', {
      paneId: 'pane-right',
      camera: { kind: 'shot', cameraId: 'cam_DoesNotExist00' as CameraId },
    });
    expect(missing).toMatchObject({ status: 'cancelled', reason: 'no such camera' });
  });

  it('view.toggleCameraLock is one undoable step on the pane’s shot camera', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: true }));
    rig.layout('split');
    expect((await rig.app.run('view.toggleCameraLock', { paneId: 'pane-left' })).status).toBe('finished');
    expect(rig.app.store.get('cameras', SHOT)?.locked).toBe(false);
    expect(rig.vm.paneState('pane-left')?.locked).toBe(false);
    expect(rig.app.history.peekUndo()?.label).toBe('Toggle Camera Lock');
    rig.app.history.undo();
    expect(rig.app.store.get('cameras', SHOT)?.locked).toBe(true);
    expect(rig.vm.paneState('pane-left')?.locked).toBe(true);
    const noShot = await rig.app.run('view.toggleCameraLock', { paneId: 'pane-right' });
    expect(noShot.status).toBe('cancelled');
  });

  it('view.copyViewToShot copies the pane camera into the shot camera (undoable)', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: true }));
    rig.layout('split');
    rig.frame();
    const view = rig.vm.camera('pane-right');
    const result = await rig.app.run('view.copyViewToShot', { paneId: 'pane-right' });
    expect(result).toEqual({ status: 'finished', value: { cameraId: SHOT } });
    const record = rig.app.store.get('cameras', SHOT);
    expect(record?.transform.t).toEqual(view.position);
    expect(record?.transform.q).toEqual(view.quaternion);
    expect(record?.target).toEqual(view.target);
    expect(record?.fovY).toBeCloseTo(view.fovY, 12);
    expect(record?.locked).toBe(true);
    const shown = rig.vm.camera('pane-left');
    for (let i = 0; i < 3; i++) expect(shown.position[i]).toBeCloseTo(view.position[i] ?? Number.NaN, 9);
    rig.app.history.undo();
    expect(rig.app.store.get('cameras', SHOT)?.transform.t).toEqual([0, 1.2, 4]);
  });

  it('view.copyViewToShot from an orthographic view turns the shot camera orthographic (and undo back)', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: false }));
    rig.layout('split', {
      camera: (id) => (id === 'pane-right' ? { kind: 'view', preset: 'front' } : FIRST_SHOT_CAMERA),
    });
    rig.frame();
    const view = rig.vm.camera('pane-right');
    expect(view.projection).toBe('orthographic');
    await rig.app.run('view.copyViewToShot', { paneId: 'pane-right' });
    expect(rig.app.store.get('cameras', SHOT)).toMatchObject({ projection: 'orthographic' });
    const shown = rig.vm.camera('pane-left');
    expect(shown.projection).toBe('orthographic');
    expect(shown.orthoHeight).toBeCloseTo(view.orthoHeight, 9);
    for (let i = 0; i < 3; i++) expect(shown.position[i]).toBeCloseTo(view.position[i] ?? Number.NaN, 9);
    rig.frame();
    rig.app.history.undo();
    expect(rig.vm.camera('pane-left')).toMatchObject({ projection: 'perspective', position: [0, 1.2, 4] });
    rig.frame();
  });

  it.runIf(FRACTIONAL_INDEX)('view.copyViewToShot creates shotCam when the project has none', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const result = await rig.app.run('view.copyViewToShot', { paneId: 'pane-right' });
    expect(result.status).toBe('finished');
    const cameras = rig.app.store.list('cameras');
    expect(cameras).toHaveLength(1);
    expect(cameras[0]).toMatchObject({ name: 'shotCam', locked: false });
    expect(rig.vm.paneState('pane-left')).toMatchObject({ cameraKind: 'shot', cameraName: 'shotCam' });
  });

  it('view.frame frames the selection in the pane (selection centred, all of it visible)', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const hand = rig.app.store.list('controls').find((c) => c.key === 'fk.hand.L');
    if (hand === undefined) throw new Error('no hand control');
    rig.app.session.setState({ selection: { controls: [hand.id], keys: new Map(), channels: [] } });
    const before = rig.vm.camera('pane-right');
    await rig.app.run('view.frame', { what: 'selection', paneId: 'pane-right' });
    const after = rig.vm.camera('pane-right');
    // The hand circle's centre (pose position + shape offset) is the framing pivot, at the pane centre.
    const runtime = rig.app.characters.list()[0];
    const slot = runtime?.program.controlIndex.get(hand.id) ?? -1;
    const m = runtime?.pose.controlWorld ?? new Float64Array(16);
    const o = hand.shape.offset.t;
    const at = (row: number): number =>
      (m[slot * 16 + row] ?? 0) * o[0] +
      (m[slot * 16 + 4 + row] ?? 0) * o[1] +
      (m[slot * 16 + 8 + row] ?? 0) * o[2] +
      (m[slot * 16 + 12 + row] ?? 0);
    const centre = rig.vm.project('pane-right', [at(0), at(1), at(2)]);
    expect(centre?.x).toBeCloseTo(300, 0);
    expect(centre?.y).toBeCloseTo(300, 0);
    // View direction kept, closer than the "all" framing.
    const dir = (s: typeof before) => {
      const d = s.position.map((v, i) => v - (s.target[i] ?? 0));
      const len = Math.hypot(...d);
      return d.map((v) => v / len);
    };
    dir(after).forEach((v, i) => expect(v).toBeCloseTo(dir(before)[i] ?? Number.NaN, 9));
    await rig.app.run('view.frame', { what: 'all', paneId: 'pane-right' });
    const all = rig.vm.camera('pane-right');
    const dist = (s: typeof before) => Math.hypot(...s.position.map((v, i) => v - (s.target[i] ?? 0)));
    expect(dist(after)).toBeLessThan(dist(all));
  });

  it('view.frame on a locked shot camera only flashes LOCKED', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: true }));
    rig.layout('split');
    rig.frame();
    const before = rig.vm.camera('pane-left');
    await rig.app.run('view.frame', { what: 'all', paneId: 'pane-left' });
    expect(rig.vm.camera('pane-left')).toEqual(before);
    expect(rig.vm.paneState('pane-left')?.lockFlash).toBe(1);
  });

  it('view.cameraRadial opens the pane radial at the last pointer position, kept inside the pane', async () => {
    rig = await createRig();
    rig.layout('split');
    const right = rig.panes.get('pane-right') as HTMLElement;
    const rect = right.getBoundingClientRect();
    // No pointer over the pane yet: its centre.
    expect((await rig.app.run('view.cameraRadial', { paneId: 'pane-right' })).status).toBe('finished');
    expect(rig.vm.paneState('pane-right')?.radial).toEqual({ x: rect.width / 2, y: rect.height / 2 });
    // At the pointer, through the hovered pane of the run context.
    pointer(right, 'pointermove', rect.left + 200, rect.top + 150, { buttons: 0 });
    expect(
      (await rig.app.run('view.cameraRadial', undefined, { panel: 'viewport', paneId: 'pane-right' })).status,
    ).toBe('finished');
    expect(rig.vm.paneState('pane-right')?.radial).toEqual({ x: 200, y: 150 });
    // Near an edge it is pushed inside by RADIAL_MARGIN_PX.
    pointer(right, 'pointermove', rect.left + 5, rect.bottom - 5, { buttons: 0 });
    await rig.app.run('view.cameraRadial', { paneId: 'pane-right' });
    expect(rig.vm.paneState('pane-right')?.radial).toEqual({ x: RADIAL_MARGIN_PX, y: rect.height - RADIAL_MARGIN_PX });
    // One radial at a time; closeRadial and unregistering close it.
    await rig.app.run('view.cameraRadial', { paneId: 'pane-left' });
    expect(rig.vm.paneState('pane-right')?.radial).toBeNull();
    expect(rig.vm.paneState('pane-left')?.radial).not.toBeNull();
    rig.vm.closeRadial();
    expect(rig.vm.paneState('pane-left')?.radial).toBeNull();
    await rig.app.run('view.cameraRadial', { paneId: 'pane-left' });
    rig.layout('single');
    expect(rig.vm.paneState('pane-left')).toBeNull();
    await rig.app.run('view.cameraRadial', { paneId: 'pane-single' });
    expect(rig.vm.paneState('pane-single')?.radial).not.toBeNull();
  });
});
