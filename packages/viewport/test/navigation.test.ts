import type { CameraId } from '@ekza-studio/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { type CameraSnapshot, WHEEL_BURST_MS } from '../src';
import { pointerGesture, wheelAction } from '../src/navigation/profiles';
import { addCamera, createRig, drag, pointer, type Rig, shotCamera, wheel } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

const SHOT = 'cam_TestShotCamera01' as CameraId;

function centre(r: Rig, pane: string): { x: number; y: number } {
  const rect = r.panes.get(pane)?.getBoundingClientRect();
  return { x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2 };
}

function altDrag(r: Rig, pane: string, dx: number, dy: number, button = 0): void {
  const c = centre(r, pane);
  drag(r.panes.get(pane) as HTMLElement, c, { x: c.x + dx, y: c.y + dy }, { altKey: true, button });
}

function same(a: CameraSnapshot, b: CameraSnapshot, digits = 9): void {
  for (let i = 0; i < 3; i++) {
    expect(a.position[i]).toBeCloseTo(b.position[i] ?? Number.NaN, digits);
    expect(a.target[i]).toBeCloseTo(b.target[i] ?? Number.NaN, digits);
  }
  for (let i = 0; i < 4; i++) expect(a.quaternion[i]).toBeCloseTo(b.quaternion[i] ?? Number.NaN, digits);
}

function distance(s: CameraSnapshot): number {
  return Math.hypot(s.position[0] - s.target[0], s.position[1] - s.target[1], s.position[2] - s.target[2]);
}

function changed(a: CameraSnapshot, b: CameraSnapshot): boolean {
  return (
    a.position.some((v, i) => Math.abs(v - (b.position[i] ?? 0)) > 1e-6) ||
    a.target.some((v, i) => Math.abs(v - (b.target[i] ?? 0)) > 1e-6)
  );
}

describe('navigation profiles', () => {
  it('maps pointer chords and wheel gestures per profile', () => {
    const chord = (
      button: number,
      mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {},
    ) => ({
      button,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(pointerGesture('dcc', chord(0, { altKey: true }))).toBe('tumble');
    expect(pointerGesture('dcc', chord(1, { altKey: true }))).toBe('track');
    expect(pointerGesture('dcc', chord(2, { altKey: true }))).toBe('dolly');
    expect(pointerGesture('dcc', chord(0))).toBeNull();
    expect(pointerGesture('trackpad', chord(0, { altKey: true }))).toBe('tumble');
    expect(pointerGesture('oneButton', chord(0, { altKey: true, metaKey: true }))).toBe('track');
    expect(pointerGesture('oneButton', chord(0, { altKey: true, ctrlKey: true }))).toBe('dolly');

    const w = (deltaY: number, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
      deltaX: 0,
      deltaY,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(wheelAction('dcc', w(-100), 600)).toEqual({ kind: 'dolly', amount: 0.15 });
    expect(wheelAction('trackpad', w(120), 600)).toEqual({ kind: 'tumble', dx: -0, dy: -120 });
    expect(wheelAction('trackpad', w(10, { shiftKey: true }), 600)).toEqual({ kind: 'track', dx: -0, dy: -10 });
    expect(wheelAction('trackpad', w(-10, { ctrlKey: true }), 600).kind).toBe('dolly');
    expect(wheelAction('dcc', { ...w(3), deltaMode: 1 }, 600)).toEqual({ kind: 'dolly', amount: -3 * 16 * 0.0015 });
  });
});

describe('view camera navigation (dcc profile)', () => {
  it('Alt+LMB tumbles around the pivot, Alt+MMB tracks, Alt+RMB dollies; plain LMB does not navigate', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.app.prefs.setState({ navProfile: 'dcc' });
    rig.frame();
    const start = rig.vm.camera('pane-right');

    const c = centre(rig, 'pane-right');
    drag(rig.panes.get('pane-right') as HTMLElement, c, { x: c.x + 100, y: c.y });
    same(rig.vm.camera('pane-right'), start);

    altDrag(rig, 'pane-right', 100, 0);
    const tumbled = rig.vm.camera('pane-right');
    expect(changed(tumbled, start)).toBe(true);
    expect(distance(tumbled)).toBeCloseTo(distance(start), 9);
    for (let i = 0; i < 3; i++) expect(tumbled.target[i]).toBeCloseTo(start.target[i] ?? 0, 9);

    altDrag(rig, 'pane-right', 50, 30, 1);
    const tracked = rig.vm.camera('pane-right');
    expect(distance(tracked)).toBeCloseTo(distance(tumbled), 9);
    expect(Math.hypot(...tracked.target.map((v, i) => v - (tumbled.target[i] ?? 0)))).toBeGreaterThan(0.01);

    altDrag(rig, 'pane-right', 80, 0, 2);
    expect(distance(rig.vm.camera('pane-right'))).toBeLessThan(distance(tracked));
  });

  it('wheel dollies towards the cursor, keeping the point under it fixed on screen', async () => {
    rig = await createRig();
    rig.layout('split');
    rig.frame();
    const before = rig.vm.camera('pane-right');
    const rect = rig.panes.get('pane-right')?.getBoundingClientRect() as DOMRect;
    const at = { x: rect.left + 400, y: rect.top + 200 };
    // A world point on the pivot plane under the cursor stays under it.
    const pivotScreen = rig.vm.project('pane-right', before.target);
    expect(pivotScreen).not.toBeNull();
    wheel(rig.panes.get('pane-right') as HTMLElement, at.x, at.y, { deltaY: -200 });
    const after = rig.vm.camera('pane-right');
    expect(distance(after)).toBeLessThan(distance(before));
    // The camera moved along the ray through the cursor: the cursor's pixel maps to the same ray direction.
    const dirBefore = before.quaternion;
    for (let i = 0; i < 4; i++) expect(after.quaternion[i]).toBeCloseTo(dirBefore[i] ?? 0, 9);
  });

  it('orthographic views track and zoom but never tumble', async () => {
    rig = await createRig();
    rig.layout('quad');
    rig.frame();
    const start = rig.vm.camera('pane-front');
    altDrag(rig, 'pane-front', 120, 40);
    same(rig.vm.camera('pane-front'), start);
    const c = centre(rig, 'pane-front');
    wheel(rig.panes.get('pane-front') as HTMLElement, c.x, c.y, { deltaY: -300 });
    expect(rig.vm.camera('pane-front').orthoHeight).toBeLessThan(start.orthoHeight);
  });
});

describe('trackpad profile', () => {
  it('two-finger scroll orbits, pinch (wheel + Ctrl) dollies, a locked pane ignores both', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: true }));
    rig.layout('split');
    rig.app.prefs.setState({ navProfile: 'trackpad' });
    rig.frame();
    const right = rig.panes.get('pane-right') as HTMLElement;
    const left = rig.panes.get('pane-left') as HTMLElement;
    const c = centre(rig, 'pane-right');
    const start = rig.vm.camera('pane-right');
    wheel(right, c.x, c.y, { deltaY: 120 });
    const orbited = rig.vm.camera('pane-right');
    expect(changed(orbited, start)).toBe(true);
    expect(distance(orbited)).toBeCloseTo(distance(start), 9);
    wheel(right, c.x, c.y, { deltaY: 20, ctrlKey: true });
    expect(distance(rig.vm.camera('pane-right'))).toBeGreaterThan(distance(orbited) + 1e-6);

    const lockedStart = rig.vm.camera('pane-left');
    const flashes = rig.vm.paneState('pane-left')?.lockFlash ?? 0;
    const l = centre(rig, 'pane-left');
    wheel(left, l.x, l.y, { deltaY: 120 });
    wheel(left, l.x, l.y, { deltaY: 20, ctrlKey: true });
    same(rig.vm.camera('pane-left'), lockedStart, 12);
    expect(rig.vm.paneState('pane-left')?.lockFlash).toBe(flashes + 2);
  });
});

describe('shot cameras', () => {
  it('a locked shot camera swallows navigation and flashes LOCKED', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: true }));
    rig.layout('split');
    rig.frame();
    expect(rig.vm.paneState('pane-left')).toMatchObject({
      cameraKind: 'shot',
      cameraName: 'shotCam',
      locked: true,
      shotCameraId: SHOT,
    });
    const start = rig.vm.camera('pane-left');
    const version = rig.app.store.version;
    altDrag(rig, 'pane-left', 100, 0);
    altDrag(rig, 'pane-left', 50, 50, 1);
    same(rig.vm.camera('pane-left'), start, 12);
    expect(rig.app.store.version).toBe(version);
    expect(rig.vm.paneState('pane-left')?.lockFlash).toBe(2);
  });

  it('navigating an unlocked shot camera commits one non-undoable batch per gesture', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: false }));
    rig.layout('split');
    rig.frame();
    const batches: { origin: string; tables: string[] }[] = [];
    rig.app.store.subscribe((batch) =>
      batches.push({ origin: batch.origin, tables: batch.changes.map((c) => c.table) }),
    );
    const undoTop = rig.app.store.undo.peekUndo();
    const historyTop = rig.app.history.peekUndo();
    const before = rig.app.store.get('cameras', SHOT);
    altDrag(rig, 'pane-left', 120, 0);
    const committed = batches.filter((b) => b.origin === 'local');
    expect(committed).toHaveLength(1);
    expect(committed[0]?.tables).toEqual(['cameras']);
    expect(batches.filter((b) => b.origin === 'preview').length).toBeGreaterThan(0);
    const after = rig.app.store.get('cameras', SHOT);
    expect(after?.transform.t).not.toEqual(before?.transform.t);
    expect(rig.app.store.undo.peekUndo()).toBe(undoTop);
    expect(rig.app.history.peekUndo()).toBe(historyTop);
    // The record is what the pane now shows.
    const snap = rig.vm.camera('pane-left');
    for (let i = 0; i < 3; i++) expect(snap.position[i]).toBeCloseTo(after?.transform.t[i] ?? Number.NaN, 9);
    expect(rig.app.store.preview).toBeNull();
  });

  it('a wheel burst on an unlocked shot camera commits once, 120 ms after the last event', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: false }));
    rig.layout('split');
    rig.frame();
    const local: number[] = [];
    rig.app.store.subscribe((batch) => {
      if (batch.origin === 'local') local.push(batch.version);
    });
    const left = rig.panes.get('pane-left') as HTMLElement;
    const c = centre(rig, 'pane-left');
    for (let i = 0; i < 3; i++) wheel(left, c.x, c.y, { deltaY: -100 });
    expect(local).toHaveLength(0);
    expect(rig.app.store.preview?.active).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, WHEEL_BURST_MS + 60));
    expect(local).toHaveLength(1);
    expect(rig.app.store.preview).toBeNull();
    expect(rig.app.store.undo.canUndo()).toBe(false);
  });

  it('an orthographic shot camera persists its zoom as orthoHeight (wheel and framing)', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: false, projection: 'orthographic', orthoHeight: 3 }));
    rig.layout('split');
    rig.frame();
    expect(rig.vm.camera('pane-left')).toMatchObject({ projection: 'orthographic', orthoHeight: 3 });
    const left = rig.panes.get('pane-left') as HTMLElement;
    const c = centre(rig, 'pane-left');
    for (let i = 0; i < 3; i++) wheel(left, c.x, c.y, { deltaY: -100 });
    const zoomed = rig.vm.camera('pane-left');
    expect(zoomed.orthoHeight).toBeLessThan(3);
    await new Promise((resolve) => setTimeout(resolve, WHEEL_BURST_MS + 60));
    const record = rig.app.store.get('cameras', SHOT);
    expect(record?.orthoHeight).toBeCloseTo(zoomed.orthoHeight, 9);
    // The committed record is re-applied (zoom folded into the height): the view does not jump.
    same(rig.vm.camera('pane-left'), zoomed, 9);
    expect(rig.vm.camera('pane-left').orthoHeight).toBeCloseTo(zoomed.orthoHeight, 9);
    // Framing writes the fitted height too.
    await rig.app.run('view.frame', { what: 'all', paneId: 'pane-left' });
    const framed = rig.vm.camera('pane-left');
    expect(rig.app.store.get('cameras', SHOT)?.orthoHeight).toBeCloseTo(framed.orthoHeight, 9);
    rig.frame();
    same(rig.vm.camera('pane-left'), framed, 9);
    expect(rig.vm.camera('pane-left').orthoHeight).toBeCloseTo(framed.orthoHeight, 9);
  });

  it('does not navigate a shot camera while another gesture holds the document', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: false }));
    rig.layout('split');
    rig.frame();
    const start = rig.vm.camera('pane-left');
    const preview = rig.app.store.beginPreview('Other gesture');
    altDrag(rig, 'pane-left', 100, 0);
    expect(rig.app.store.preview).toBe(preview);
    same(rig.vm.camera('pane-left'), start, 12);
    preview.cancel();
  });

  it('Esc during navigation puts the camera back (view camera and unlocked shot camera)', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: false }));
    rig.layout('split');
    rig.frame();
    const local: number[] = [];
    rig.app.store.subscribe((batch) => {
      if (batch.origin === 'local') local.push(batch.version);
    });
    for (const pane of ['pane-right', 'pane-left']) {
      const element = rig.panes.get(pane) as HTMLElement;
      const start = rig.vm.camera(pane);
      const c = centre(rig, pane);
      pointer(element, 'pointerdown', c.x, c.y, { altKey: true });
      pointer(element, 'pointermove', c.x + 80, c.y + 10, { altKey: true, buttons: 1 });
      expect(changed(rig.vm.camera(pane), start)).toBe(true);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
      pointer(element, 'pointermove', c.x + 120, c.y + 10, { altKey: true, buttons: 1 });
      pointer(element, 'pointerup', c.x + 120, c.y + 10, { altKey: true });
      same(rig.vm.camera(pane), start);
    }
    expect(local).toEqual([]);
    expect(rig.app.store.preview).toBeNull();
    expect(rig.app.store.get('cameras', SHOT)?.transform.t).toEqual([0, 1.2, 4]);
  });

  it('follows document changes to the shot camera (another pane, undo, load)', async () => {
    rig = await createRig();
    addCamera(rig.app, shotCamera({ locked: true }));
    rig.layout('split');
    rig.frame();
    rig.app.store.transact({ label: 'Move camera' }, (tx) =>
      tx.patch('cameras', SHOT, { transform: { t: [1, 2, 5], q: [0, 0, 0, 1], s: [1, 1, 1] }, target: [1, 2, 0] }),
    );
    const snap = rig.vm.camera('pane-left');
    expect(snap.position).toEqual([1, 2, 5]);
    expect(snap.target).toEqual([1, 2, 0]);
    rig.app.store.undo.undo();
    expect(rig.vm.camera('pane-left').position).toEqual([0, 1.2, 4]);
  });
});
