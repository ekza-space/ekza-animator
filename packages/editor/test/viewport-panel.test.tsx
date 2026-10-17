// The viewport panel (WP-5): pane grid per layout, pane headers, HUD and the empty-state drop zone, mounted with the
// shared test kit's fake app (no model loader, so the panel hosts its own canvas and ViewportManager).
import type { CameraId, DocSnapshot } from '@ekza-animator/doc';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { viewportManagerOf } from '@ekza-animator/viewport';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPanelRegistry, EditorAppProvider } from '../src';
import { registerViewportPanel, ViewportPanel } from '../src/panels/viewport';
import { RADIAL_RADIUS_PX, radialItemAt, radialOffsets } from '../src/panels/viewport/CameraRadial';
import { byTestId, type Rendered, readSynthetic, render, update } from './render';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
  skeleton = (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc;
});

let mounted: { view: Rendered; app: FakeEditorApp } | null = null;
afterEach(async () => {
  await mounted?.view.unmount();
  mounted?.app.dispose();
  mounted = null;
});

const SHOT = 'cam_PanelShotCamera1' as CameraId;

async function mount(app: FakeEditorApp): Promise<{ view: Rendered; app: FakeEditorApp }> {
  const view = await render(
    <EditorAppProvider app={app}>
      <div style={{ position: 'fixed', left: 0, top: 0, width: 1000, height: 600 }}>
        <ViewportPanel app={app} instanceId="viewport#1" />
      </div>
    </EditorAppProvider>,
  );
  mounted = { view, app };
  return mounted;
}

function withCharacter(): FakeEditorApp {
  return createFakeEditorApp({ snapshot, skeleton });
}

function paneIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-ekza-pane]')].map((el) => el.dataset['ekzaPane'] ?? '');
}

describe('viewport panel', () => {
  it('registers as the viewport panel with the viewport key scope', () => {
    const registry = createPanelRegistry();
    const dispose = registerViewportPanel(registry);
    expect(registry.get('viewport')).toMatchObject({
      id: 'viewport',
      kind: 'viewport',
      keyScope: 'viewport',
      title: 'Viewport',
    });
    dispose();
    expect(registry.get('viewport')).toBeUndefined();
  });

  it('lays out panes for split, quad and single, honouring the maximized pane', async () => {
    const { view, app } = await mount(withCharacter());
    expect(paneIds(view.container)).toEqual(['pane-left', 'pane-right']);
    const vm = viewportManagerOf(app);
    expect(vm?.paneIds()).toEqual(['pane-left', 'pane-right']);
    byTestId(view.container, 'viewport-standalone-canvas');

    await update(() => app.session.setState({ viewportLayout: 'quad' }));
    expect(paneIds(view.container)).toEqual(['pane-top', 'pane-persp', 'pane-front', 'pane-side']);
    expect(viewportManagerOf(app)?.paneIds()).toEqual(['pane-top', 'pane-persp', 'pane-front', 'pane-side']);

    await update(() => app.session.setState({ maximizedPane: 'pane-persp' }));
    expect(paneIds(view.container)).toEqual(['pane-persp']);
    await update(() => app.session.setState({ maximizedPane: null, viewportLayout: 'single' }));
    expect(paneIds(view.container)).toEqual(['pane-single']);
    // Each pane surface is the element registered with the manager (it receives pointer input).
    const rect = byTestId(view.container, 'pane-pane-single').getBoundingClientRect();
    expect(viewportManagerOf(app)?.paneRect('pane-single')).toEqual({
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    });
  });

  it('shows the drop zone with sample buttons while the project has no character', async () => {
    const { view, app } = await mount(createFakeEditorApp());
    byTestId(view.container, 'dropzone');
    await update(() => byTestId(view.container, 'sample-polybot').click());
    await update(() => byTestId(view.container, 'sample-seed-san').click());
    await update(() => byTestId(view.container, 'dropzone-open').click());
    expect(app.calls.map((call) => [call.id, call.args])).toEqual([
      ['file.loadSample', { sample: 'polybot' }],
      ['file.loadSample', { sample: 'seed-san' }],
      ['ui.open', { dialog: 'open' }],
    ]);
    byTestId(view.container, 'sample-quaternius-ual');
  });

  it('hides the drop zone once a character exists', async () => {
    const { view } = await mount(withCharacter());
    expect(view.container.querySelector('[data-testid="dropzone"]')).toBeNull();
  });

  it('camera menu: looks through a view preset or a shot camera', async () => {
    const app = withCharacter();
    app.store.transact({ label: 'Add camera', undoable: false }, (tx) =>
      tx.put('cameras', {
        id: SHOT,
        name: 'shotCam',
        projection: 'perspective',
        fovY: 0.7,
        orthoHeight: 2,
        near: 0.01,
        far: 100,
        transform: { t: [0, 1.2, 4], q: [0, 0, 0, 1], s: [1, 1, 1] },
        target: [0, 1.2, 0],
        aspect: null,
        locked: false,
        order: 'a0',
        deleted: null,
      }),
    );
    const { view } = await mount(app);
    const menu = byTestId(view.container, 'pane-camera-menu-pane-right');
    expect(menu.textContent).toContain('persp');
    await update(() => menu.click());
    await update(() => byTestId(view.container, 'pane-camera-menu-pane-right-top').click());
    // The camera choice runs through the view.lookThrough operator.
    await update(() => {});
    expect(byTestId(view.container, 'pane-camera-menu-pane-right').textContent).toContain('top');
    expect(viewportManagerOf(app)?.paneState('pane-right')).toMatchObject({ cameraKind: 'view', preset: 'top' });
    await update(() => byTestId(view.container, 'pane-camera-menu-pane-right').click());
    await update(() => byTestId(view.container, `pane-camera-menu-pane-right-shot-${SHOT}`).click());
    await update(() => {});
    expect(viewportManagerOf(app)?.paneState('pane-right')).toMatchObject({ cameraKind: 'shot', shotCameraId: SHOT });
    expect(app.calls.filter((c) => c.id === 'view.lookThrough')).toHaveLength(2);
  });

  it('display toggles and the lock button run the viewport operators; the HUD shows LOCKED', async () => {
    const app = withCharacter();
    app.store.transact({ label: 'Add camera', undoable: false }, (tx) =>
      tx.put('cameras', {
        id: SHOT,
        name: 'shotCam',
        projection: 'perspective',
        fovY: 0.7,
        orthoHeight: 2,
        near: 0.01,
        far: 100,
        transform: { t: [0, 1.2, 4], q: [0, 0, 0, 1], s: [1, 1, 1] },
        target: [0, 1.2, 0],
        aspect: null,
        locked: true,
        order: 'a0',
        deleted: null,
      }),
    );
    const { view } = await mount(app);
    const xray = byTestId(view.container, 'pane-display-xray-pane-right');
    expect(xray.getAttribute('aria-pressed')).toBe('false');
    await update(() => xray.click());
    await update(() => {});
    expect(byTestId(view.container, 'pane-display-xray-pane-right').getAttribute('aria-pressed')).toBe('true');
    expect(viewportManagerOf(app)?.paneState('pane-right')?.display.xray).toBe(true);

    const lock = byTestId(view.container, 'pane-lock-pane-left');
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    byTestId(view.container, 'pane-pane-left').querySelector('[data-testid="pane-hud-locked"]');
    expect(byTestId(view.container, 'pane-pane-left').textContent).toContain('LOCKED');
    await update(() => lock.click());
    await update(() => {});
    expect(app.store.get('cameras', SHOT)?.locked).toBe(false);
    expect(byTestId(view.container, 'pane-lock-pane-left').getAttribute('aria-pressed')).toBe('false');
    expect(byTestId(view.container, 'pane-pane-left').textContent).not.toContain('LOCKED');
    // A view pane has nothing to lock.
    expect((byTestId(view.container, 'pane-lock-pane-right') as HTMLButtonElement).disabled).toBe(true);
  });

  it('HUD shows the clip frame and scene seconds without re-rendering the panel', async () => {
    const app = withCharacter();
    const { view } = await mount(app);
    const frame = () => byTestId(byTestId(view.container, 'pane-pane-right'), 'pane-hud-frame').textContent;
    const seconds = () => byTestId(byTestId(view.container, 'pane-pane-right'), 'pane-hud-seconds').textContent;
    expect(frame()).toBe('f 0');
    expect(seconds()).toBe('0.00 s');
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 15 } });
    expect(frame()).toBe('f 15');
    expect(seconds()).toBe('0.50 s');
    expect(view.container.querySelector('[data-testid="pane-hud-feet-pinned"]')).toBeNull();
  });

  it('Space-hold camera radial: point at a camera and release Space to look through it', async () => {
    const { view, app } = await mount(withCharacter());
    const radial = () => view.container.querySelector('[data-testid="pane-radial-pane-right"]');
    const lookThroughCalls = () => app.calls.filter((c) => c.id === 'view.lookThrough').map((c) => c.args);
    await update(() => void app.run('view.cameraRadial', { paneId: 'pane-right' }));
    await update(() => {});
    expect(radial()).not.toBeNull();
    const items = [...(radial()?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    expect(items.map((item) => item.dataset['testid'])).toEqual([
      'pane-radial-pane-right-persp',
      'pane-radial-pane-right-top',
      'pane-radial-pane-right-front',
      'pane-radial-pane-right-side',
    ]);
    expect(byTestId(view.container, 'pane-radial-pane-right-persp').getAttribute('aria-checked')).toBe('true');

    // Pointing straight down from the centre highlights the third item (clockwise from the top).
    const centre = viewportManagerOf(app)?.paneState('pane-right')?.radial ?? { x: 0, y: 0 };
    const pane = byTestId(view.container, 'pane-pane-right').getBoundingClientRect();
    const move = (dx: number, dy: number) =>
      update(() => {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: pane.left + centre.x + dx, clientY: pane.top + centre.y + dy }),
        );
      });
    await move(0, 60);
    expect(byTestId(view.container, 'pane-radial-pane-right-front').dataset['hot']).toBe('true');
    await update(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })));
    await update(() => {});
    expect(radial()).toBeNull();
    expect(lookThroughCalls()).toEqual([{ paneId: 'pane-right', camera: { kind: 'view', preset: 'front' } }]);
    expect(viewportManagerOf(app)?.paneState('pane-right')).toMatchObject({ cameraKind: 'view', preset: 'front' });

    // Released in the centre: closes without a change. Escape closes too. A click on an item picks it.
    await update(() => void app.run('view.cameraRadial', { paneId: 'pane-right' }));
    await move(2, 3);
    await update(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })));
    expect(radial()).toBeNull();
    await update(() => void app.run('view.cameraRadial', { paneId: 'pane-right' }));
    await update(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })));
    expect(radial()).toBeNull();
    await update(() => void app.run('view.cameraRadial', { paneId: 'pane-right' }));
    await update(() => byTestId(view.container, 'pane-radial-pane-right-side').click());
    await update(() => {});
    expect(radial()).toBeNull();
    expect(lookThroughCalls()).toEqual([
      { paneId: 'pane-right', camera: { kind: 'view', preset: 'front' } },
      { paneId: 'pane-right', camera: { kind: 'view', preset: 'side' } },
    ]);
    // A press elsewhere closes it.
    await update(() => void app.run('view.cameraRadial', { paneId: 'pane-right' }));
    await update(() =>
      byTestId(view.container, 'pane-pane-left').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
    );
    expect(radial()).toBeNull();
  });

  it('radial geometry: items clockwise from the top, the nearest angle outside the dead zone', () => {
    const offsets = radialOffsets(4);
    expect(offsets[0]?.x).toBeCloseTo(0, 9);
    expect(offsets[0]?.y).toBeCloseTo(-RADIAL_RADIUS_PX, 9);
    expect(offsets[1]?.x).toBeCloseTo(RADIAL_RADIUS_PX, 9);
    expect(offsets[2]?.y).toBeCloseTo(RADIAL_RADIUS_PX, 9);
    expect(offsets[3]?.x).toBeCloseTo(-RADIAL_RADIUS_PX, 9);
    expect(radialItemAt(4, 0, -50)).toBe(0);
    expect(radialItemAt(4, 50, 0)).toBe(1);
    expect(radialItemAt(4, 0, 50)).toBe(2);
    expect(radialItemAt(4, -50, 0)).toBe(3);
    expect(radialItemAt(4, -50, -51)).toBe(0); // just past the top-left diagonal
    expect(radialItemAt(4, 5, 5)).toBeNull(); // dead zone
    expect(radialItemAt(0, 50, 0)).toBeNull();
    expect(radialItemAt(5, 0, -50)).toBe(0);
    expect(radialItemAt(5, -10, -50)).toBe(0);
  });
});
