// Browser-mode test helpers: a fake EditorApp over the synthetic wave document (shared test kit), a real WebGL
// canvas and pane elements laid out like the viewport panel.
import type { CameraId, CameraRecord, DocSnapshot } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { WebGLRenderer } from 'three';
import { commands } from 'vitest/browser';
import {
  DEFAULT_DISPLAY,
  defaultPaneCamera,
  type DisplayFlags,
  LAYOUT_PANES,
  type PaneCamera,
  registerViewportContributions,
  ViewportManager,
} from '../src';

let cached: { snapshot: DocSnapshot; skeleton: SkeletonDesc } | null = null;

export async function fixtures(): Promise<{ snapshot: DocSnapshot; skeleton: SkeletonDesc }> {
  if (cached === null) {
    cached = {
      snapshot: JSON.parse(await commands.readFile('../../fixtures/synthetic/wave-doc.json')) as DocSnapshot,
      skeleton: JSON.parse(await commands.readFile('../../fixtures/synthetic/humanoid-skeleton.json')) as SkeletonDesc,
    };
  }
  return cached;
}

export interface Rig {
  readonly app: FakeEditorApp;
  readonly vm: ViewportManager;
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly root: HTMLElement;
  readonly panes: Map<string, HTMLElement>;
  /** Lays the panes of a layout out in the root and registers them (unregistering the previous ones). */
  layout(
    layout: 'single' | 'split' | 'quad',
    opts?: { readonly camera?: (id: string) => PaneCamera; readonly display?: Partial<DisplayFlags> },
  ): void;
  /** Runs the evaluation and renders, like one R3F frame. */
  frame(): void;
  dispose(): void;
}

export const WIDTH = 1200;
export const HEIGHT = 600;

/** A viewport over the wave document with the synthetic skeleton, a 1200×600 canvas at the page origin. */
export async function createRig(opts?: {
  readonly contributions?: boolean;
  readonly app?: FakeEditorApp;
}): Promise<Rig> {
  const { snapshot, skeleton } = await fixtures();
  const app = opts?.app ?? createFakeEditorApp({ snapshot, skeleton });
  const root = document.createElement('div');
  Object.assign(root.style, { position: 'fixed', left: '0px', top: '0px', width: `${WIDTH}px`, height: `${HEIGHT}px` });
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
  root.append(canvas);
  document.body.append(root);
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  app.setFrameRequester(() => {});
  const vm = new ViewportManager({ app, renderer });
  const disposeContributions = opts?.contributions === false ? () => {} : registerViewportContributions(app, vm);
  const panes = new Map<string, HTMLElement>();

  const rig: Rig = {
    app,
    vm,
    renderer,
    canvas,
    root,
    panes,
    layout(layout, layoutOpts) {
      for (const [id, element] of panes) {
        vm.unregisterPane(id);
        element.remove();
      }
      panes.clear();
      const ids = LAYOUT_PANES[layout];
      ids.forEach((id, i) => {
        const element = document.createElement('div');
        const rect = paneRect(layout, i);
        Object.assign(element.style, {
          position: 'absolute',
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.w}px`,
          height: `${rect.h}px`,
        });
        root.append(element);
        panes.set(id, element);
        vm.registerPane({
          id,
          element,
          camera: layoutOpts?.camera?.(id) ?? defaultPaneCamera(id),
          display: { ...DEFAULT_DISPLAY, ...layoutOpts?.display },
        });
      });
    },
    frame() {
      app.evaluation.tick();
      vm.render();
    },
    dispose() {
      disposeContributions();
      vm.dispose();
      renderer.dispose();
      root.remove();
      app.dispose();
    },
  };
  return rig;
}

/** Pane rectangles (page CSS px) of a layout inside the 1200×600 root. */
export function paneRect(
  layout: 'single' | 'split' | 'quad',
  index: number,
): { x: number; y: number; w: number; h: number } {
  if (layout === 'single') return { x: 0, y: 0, w: WIDTH, h: HEIGHT };
  if (layout === 'split') return { x: index * (WIDTH / 2), y: 0, w: WIDTH / 2, h: HEIGHT };
  return { x: (index % 2) * (WIDTH / 2), y: Math.floor(index / 2) * (HEIGHT / 2), w: WIDTH / 2, h: HEIGHT / 2 };
}

/** A shot camera record looking at the synthetic character from the front. */
export function shotCamera(fields?: Partial<CameraRecord>): CameraRecord {
  return {
    id: 'cam_TestShotCamera01' as CameraId,
    name: 'shotCam',
    projection: 'perspective',
    fovY: (40 * Math.PI) / 180,
    orthoHeight: 2,
    near: 0.01,
    far: 100,
    transform: { t: [0, 1.2, 4], q: [0, 0, 0, 1], s: [1, 1, 1] },
    target: [0, 1.2, 0],
    aspect: null,
    locked: true,
    order: 'a0',
    deleted: null,
    ...fields,
  };
}

export function addCamera(app: EditorApp, record: CameraRecord): void {
  app.store.transact({ label: 'Add camera', undoable: false }, (tx) => tx.put('cameras', record));
}

/** Dispatches a synthetic pointer event at page CSS px on an element. */
export function pointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  x: number,
  y: number,
  init?: PointerEventInit,
): void {
  const pressed = type === 'pointerup' ? 0 : (init?.buttons ?? (type === 'pointerdown' ? 1 << (init?.button ?? 0) : 0));
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      button: type === 'pointermove' ? -1 : (init?.button ?? 0),
      ...init,
      buttons: pressed,
    }),
  );
}

/** A full drag from (x0, y0) to (x1, y1) in `steps` moves. */
export function drag(
  element: HTMLElement,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  init?: PointerEventInit,
  steps = 4,
): void {
  pointer(element, 'pointerdown', from.x, from.y, init);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    pointer(element, 'pointermove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, {
      ...init,
      buttons: 1 << (init?.button ?? 0),
    });
  }
  pointer(element, 'pointerup', to.x, to.y, init);
}

export function wheel(element: HTMLElement, x: number, y: number, init: WheelEventInit): void {
  element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init }));
}
