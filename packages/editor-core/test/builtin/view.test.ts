// View and rig operators owned by WP-7b (MVP-SPEC §4.9): tools, manipulator size and space, navigation profile,
// control size (undoable), secondary controls, camera settings (WP-9 R-3). Rotate order: rig.test.ts.
import type { CameraId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { expectUndoRedoExact, opsApp, runOk, runResult, WAVE } from './support';

describe('view.tool / view.manipulatorSize / view.setManipSpace / view.setNavProfile', () => {
  it('sets the viewport and Graph Editor tools', async () => {
    const app = opsApp();
    await runOk(app, 'view.tool', { panel: 'viewport', tool: 'rotate' });
    await runOk(app, 'view.tool', { panel: 'graph', tool: 'insert' });
    expect(app.session.getState().tools).toMatchObject({ viewport: 'rotate', graph: 'insert' });
    expect((await runResult(app, 'view.tool', { panel: 'outliner', tool: 'select' })).status).toBe('cancelled');
    app.tools.register({ id: 'select', panel: 'viewport', label: 'Select', create: () => ({}) });
    expect((await runResult(app, 'view.tool', { panel: 'viewport', tool: 'lasso' })).status).toBe('cancelled');
    expect((await runResult(app, 'view.tool', { panel: 'viewport', tool: 'select' })).status).toBe('finished');
    expect(app.history.canUndo()).toBe(false);
  });

  it('clamps the manipulator size to 40–200 px', async () => {
    const app = opsApp();
    await runOk(app, 'view.manipulatorSize', { delta: 10 });
    expect(app.session.getState().tools.manipulatorSize).toBe(100);
    await runOk(app, 'view.manipulatorSize', { delta: 500 });
    expect(app.session.getState().tools.manipulatorSize).toBe(200);
    await runOk(app, 'view.manipulatorSize', { delta: -1000 });
    expect(app.session.getState().tools.manipulatorSize).toBe(40);
  });

  it('remembers the manipulator spaces in the preferences; gimbal is for rotation only', async () => {
    const app = opsApp();
    await runOk(app, 'view.setManipSpace', { tool: 'rotate', space: 'gimbal' });
    await runOk(app, 'view.setManipSpace', { tool: 'move', space: 'object' });
    expect(app.prefs.getState()).toMatchObject({ rotateSpace: 'gimbal', moveSpace: 'object' });
    expect((await runResult(app, 'view.setManipSpace', { tool: 'move', space: 'gimbal' })).status).toBe('cancelled');
    expect((await runResult(app, 'view.setManipSpace', { tool: 'scale', space: 'world' })).status).toBe('cancelled');
  });

  it('sets the navigation profile', async () => {
    const app = opsApp();
    await runOk(app, 'view.setNavProfile', { profile: 'trackpad' });
    expect(app.prefs.getState().navProfile).toBe('trackpad');
    expect((await runResult(app, 'view.setNavProfile', { profile: 'blender' })).status).toBe('cancelled');
  });
});

describe('rig.*', () => {
  it('resizes a control shape (undoable)', async () => {
    const app = opsApp();
    await expectUndoRedoExact(app, 'rig.setControlSize', { control: WAVE.lowerArmL, size: 0.12 });
    expect(app.store.get('controls', WAVE.lowerArmL)?.shape.size).toBe(0.12);
    expect(app.history.peekUndo()?.label).toBe('Control Size');
    for (const args of [{ control: WAVE.lowerArmL, size: 0 }, { control: WAVE.lowerArmL, size: Number.NaN }, {}]) {
      expect((await runResult(app, 'rig.setControlSize', args)).status).toBe('cancelled');
    }
  });

  it('shows and hides secondary controls', async () => {
    const app = opsApp();
    await runOk(app, 'rig.toggleSecondary');
    expect(app.session.getState().showSecondary).toBe(true);
    await runOk(app, 'rig.toggleSecondary');
    expect(app.session.getState().showSecondary).toBe(false);
  });
});

describe('view.camera.setSettings', () => {
  it('patches the lens and clip planes of a camera (undoable) and validates them', async () => {
    const app = opsApp();
    app.store.transact({ label: 'setup' }, (tx) =>
      tx.put('cameras', {
        id: 'cam_TestShot00000001' as CameraId,
        name: 'shotCam',
        projection: 'perspective',
        fovY: 0.5,
        orthoHeight: 2,
        near: 0.01,
        far: 1000,
        transform: { t: [0, 1, 3], q: [0, 0, 0, 1], s: [1, 1, 1] },
        target: [0, 1, 0],
        aspect: null,
        locked: true,
        order: 'a0',
        deleted: null,
      }),
    );
    const camera = 'cam_TestShot00000001';
    await expectUndoRedoExact(app, 'view.camera.setSettings', { camera, fovY: 0.8, near: 0.1, aspect: 16 / 9 });
    expect(app.store.get('cameras', camera as CameraId)).toMatchObject({
      fovY: 0.8,
      near: 0.1,
      far: 1000,
      aspect: 16 / 9,
    });
    expect(app.history.peekUndo()?.label).toBe('Camera Settings');
    for (const args of [
      { camera, fovY: 0 },
      { camera, fovY: 4 },
      { camera, near: -1 },
      { camera, far: 0.05 },
      { camera, aspect: 0 },
      { camera: 'cam_missing000000000' },
      {},
    ]) {
      const result = await runResult(app, 'view.camera.setSettings', args);
      expect([JSON.stringify(args), result.status]).toEqual([JSON.stringify(args), 'cancelled']);
    }
  });
});
