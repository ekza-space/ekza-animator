// M6A-SPEC §5.19, §5.26, §5.16 (B13): the viewport half of the content package — reference image planes (records →
// decoded images → the viewport's plane set, lazy until a plane exists), template guides (humanoid proportions and
// the handheld grip gizmo on the helpers layer, Model only) and the Paint Colour tool (face picking from the pane
// camera, click, drag stroke, Shift fill, the `I` eyedropper, `Enter` on the selection, refusals).
import type { MeshId, SwatchId } from '@ekza-animator/doc';
import { seededIdSource } from '@ekza-animator/doc';
import {
  attachMeshes,
  createEditorApp,
  DEFAULT_PALETTE_ID,
  type EditorApp,
  loadMeshKernel,
  meshKernel,
  meshOperator,
  registerBuiltins,
  swatchIdFor,
  type ToolPointerEvent,
} from '@ekza-animator/editor-core';
import { createFakeServices, type FakeServices } from '@ekza-animator/editor-core/testing';
import { MESH_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { attachGuides } from '../src/guides';
import { GuideLayer, gripGizmoSegments, humanoidGuideSegments } from '../src/guides/draw';
import { GUIDE_LEVELS, humanoidGuideLevels } from '../src/guides/levels';
import { attachImagePlanes } from '../src/imageplanes';
import { ImagePlaneBinding } from '../src/imageplanes/binding';
import type { ImagePlaneSpec } from '../src/manager/imagePlanes';
import { paintToolDef } from '../src/tools/model/paint';
import { faceAt, type PaintView, paneRay, rayTriangle } from '../src/tools/model/paint/pick';
import { PaintTool } from '../src/tools/model/paint/tool';
import type { CameraSnapshot } from '../src/types';

interface ContentApp {
  readonly app: EditorApp;
  readonly services: FakeServices;
}

/** A real editor app (doc store, kernel) whose `mesh.paint` ops are the B7 wrappers (B11 registers them later). */
async function contentApp(): Promise<ContentApp> {
  await loadMeshKernel();
  const services = createFakeServices();
  const app = createEditorApp({ services, idSource: seededIdSource(13), builtins: false });
  for (const id of ['mesh.paint', 'mesh.paint.fillShell'] as const) {
    const desc = MESH_OP_DESCRIPTORS[id];
    if (desc === undefined) throw new Error(`no descriptor ${id}`);
    app.contribute({ kind: 'operator', def: meshOperator(desc) });
  }
  registerBuiltins(app);
  app.prefs.setState({ firstRunDone: true });
  app.session.setState({ workspace: 'model' });
  return { app, services };
}

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DAwMDAAAAG/wH/vU3k4wAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('reference image planes (§5.26)', () => {
  it('loads nothing until a plane exists, then pushes decoded planes and drops deleted ones', async () => {
    const { app } = await contentApp();
    const calls: (readonly ImagePlaneSpec[])[] = [];
    let imports = 0;
    const target = {
      setImagePlanes: (planes: readonly ImagePlaneSpec[]): Promise<void> => {
        calls.push(planes);
        return Promise.resolve();
      },
    };
    const image = { width: 4, height: 2 } as unknown as ImageBitmap;
    const dispose = attachImagePlanes(app, target, {
      decode: () => Promise.resolve(image),
      importBinding: () => {
        imports += 1;
        return import('../src/imageplanes/binding');
      },
    });
    await settle();
    expect(imports).toBe(0);
    expect(calls).toEqual([]);

    const result = await app.runUntyped('imagePlane.import', { camera: 'side', name: 'side.png', bytes: PNG_1X1 });
    expect(result.status).toBe('finished');
    for (let i = 0; i < 5 && !calls.some((c) => c[0]?.image === image); i++) await settle();
    expect(imports).toBe(1);
    const last = calls.at(-1) ?? [];
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ camera: 'side', image, offset: [0, 1], size: 2, opacity: 0.5, depth: 'behind' });

    const id = (result.status === 'finished' ? (result.value as { id: string }).id : '') as never;
    await app.runUntyped('imagePlane.set', { id, patch: { opacity: 0.4, size: 1.8 } });
    expect(calls.at(-1)?.[0]).toMatchObject({ opacity: 0.4, size: 1.8 });
    await app.runUntyped('imagePlane.delete', { id });
    expect(calls.at(-1)).toEqual([]);
    dispose();
  });

  it('reports an image that cannot be decoded once and draws nothing for it', async () => {
    const { app, services } = await contentApp();
    const calls: (readonly ImagePlaneSpec[])[] = [];
    await app.runUntyped('imagePlane.import', { camera: 'front', bytes: PNG_1X1 });
    const binding = new ImagePlaneBinding(
      app,
      {
        setImagePlanes: (planes): Promise<void> => {
          calls.push(planes);
          return Promise.resolve();
        },
      },
      () => Promise.reject(new Error('bad image')),
    );
    for (let i = 0; i < 5; i++) await settle();
    expect(calls.at(-1)?.[0]?.image).toBeNull();
    expect(services.toasts.filter((t) => t.text.includes('bad image'))).toHaveLength(1);
    binding.dispose();
    expect(calls.at(-1)).toEqual([]);
  });
});

describe('template guides (§5.16)', () => {
  function target() {
    const root = new Group();
    let invalidations = 0;
    return {
      root,
      scene: { add: (o: Group) => root.add(o), remove: (o: Group) => root.remove(o) },
      invalidate: () => {
        invalidations += 1;
      },
      get invalidations() {
        return invalidations;
      },
    };
  }

  it('the stylized levels match the humanoid body generator at 1.6 m; chibi has the biggest head', () => {
    const levels = humanoidGuideLevels({ height: 1.6, preset: 'stylized' }).levels;
    expect(levels.chin).toBeCloseTo(1.46, 6);
    expect(levels.shoulder).toBeCloseTo(1.33, 6);
    expect(levels.hip).toBeCloseTo(0.82, 6);
    expect(levels.head).toBeCloseTo(1.6, 6);
    const head = (preset: 'stylized' | 'chibi' | 'blocky') => 1 - GUIDE_LEVELS[preset].chin;
    expect(head('chibi')).toBeGreaterThan(head('blocky'));
    expect(head('blocky')).toBeGreaterThan(head('stylized'));
    expect(humanoidGuideLevels({ height: 9, preset: 'nope' })).toMatchObject({ height: 3, preset: 'stylized' });
    // Seven square outlines (4 segments each), two height lines, the facing arrow (3): 33 segments.
    expect(humanoidGuideSegments({ height: 1.6 }).length / 6).toBe(33);
    const gizmo = gripGizmoSegments();
    expect(gizmo.shaft.length / 6).toBe(3);
    expect(gizmo.fingers.length / 6).toBe(3);
  });

  it('draws the humanoid guides and the grip gizmo in Model only, follows hiding and deletion', async () => {
    const { app } = await contentApp();
    const t = target();
    const human = await app.runUntyped('mesh.create.template', { template: 'humanoid', preset: 'chibi' });
    const hand = await app.runUntyped('mesh.create.template', { template: 'handheld' });
    expect([human.status, hand.status]).toEqual(['finished', 'finished']);
    const humanId = (human as { value: { root: string } }).value.root;
    const handId = (hand as { value: { root: string } }).value.root;
    const layer = new GuideLayer(app, t);
    expect(layer.drawn().map((d) => [d.id, d.lines])).toEqual(
      expect.arrayContaining([
        [humanId, ['humanoid']],
        [handId, ['grip-ring', 'grip-shaft', 'grip-fingers']],
      ]),
    );
    expect(t.root.children).toHaveLength(1);
    app.session.setState({ workspace: 'animate' });
    expect(layer.drawn()).toEqual([]);
    app.session.setState({ workspace: 'model' });
    const model = app.session.getState().model;
    app.session.setState({ model: { ...model, hiddenObjects: new Set([humanId as never]) } });
    expect(layer.drawn().map((d) => d.id)).toEqual([handId]);
    await app.runUntyped('scene.delete', { ids: [handId] });
    expect(layer.drawn()).toEqual([]);
    layer.dispose();
    expect(t.root.children).toHaveLength(0);
  });

  it('loads the drawing only once a template group exists in Model', async () => {
    const { app } = await contentApp();
    const t = target();
    let imports = 0;
    const dispose = attachGuides(app, t, {
      importDraw: () => {
        imports += 1;
        return import('../src/guides/draw');
      },
    });
    await app.runUntyped('mesh.create.cube');
    await settle();
    expect(imports).toBe(0);
    await app.runUntyped('mesh.create.template', { template: 'humanoid' });
    for (let i = 0; i < 5 && t.root.children.length === 0; i++) await settle();
    expect(imports).toBe(1);
    expect(t.root.children).toHaveLength(1);
    dispose();
    expect(t.root.children).toHaveLength(0);
  });
});

// ---------- Paint Colour ----------

const PANE = 'pane-test';
const SIZE = 400;

/** An orthographic view `height` m high looking along `dir` (front: −Z, top: −Y). */
function view(kind: 'front' | 'top', orthoHeight = 2): PaintView {
  const snapshot: CameraSnapshot =
    kind === 'front'
      ? {
          projection: 'orthographic',
          position: [0, 0, 10],
          quaternion: [0, 0, 0, 1],
          target: [0, 0, 0],
          fovY: 0,
          orthoHeight,
        }
      : {
          projection: 'orthographic',
          position: [0, 10, 0],
          // −90° about X: the camera's −Z looks down −Y, its up is −Z.
          quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
          target: [0, 0, 0],
          fovY: 0,
          orthoHeight,
        };
  return {
    camera: (paneId) => {
      if (paneId !== PANE) throw new Error('no pane');
      return snapshot;
    },
    paneRect: (paneId) => (paneId === PANE ? { w: SIZE, h: SIZE } : null),
  };
}

/** Pane px of a world point in `view` (1 m = SIZE / orthoHeight px). */
function px(kind: 'front' | 'top', x: number, yOrZ: number, orthoHeight = 2): { x: number; y: number } {
  const scale = SIZE / orthoHeight;
  return kind === 'front'
    ? { x: SIZE / 2 + x * scale, y: SIZE / 2 - yOrZ * scale }
    : { x: SIZE / 2 + x * scale, y: SIZE / 2 + yOrZ * scale };
}

function pointer(at: { x: number; y: number }, patch: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    panel: 'viewport',
    paneId: PANE,
    x: at.x,
    y: at.y,
    button: 0,
    buttons: 1,
    shift: false,
    alt: false,
    mod: false,
    ctrl: false,
    pointerType: 'mouse',
    timeStamp: 0,
    detail: 1,
    ...patch,
  };
}

function slots(app: EditorApp, mesh: MeshId): number[] {
  const data = app.meshes.get(mesh)?.data();
  if (data === undefined || data === null) return [];
  const layer = data.layers.get('paint');
  return Array.from({ length: data.counts.faces }, (_, f) => (layer === undefined ? 0 : (layer.data[f] as number)));
}

/** Face index whose centroid is extreme along an axis (the face a view sees first). */
function faceFacing(app: EditorApp, mesh: MeshId, axis: 0 | 1 | 2): number {
  const data = app.meshes.get(mesh)?.data();
  if (data === undefined || data === null) throw new Error('no data');
  let best = -1;
  let bestValue = -Infinity;
  for (let f = 0; f < data.counts.faces; f++) {
    let sum = 0;
    let n = 0;
    let c = data.faceCorner[f] as number;
    const first = c;
    do {
      sum += data.position[3 * (data.cornerVert[c] as number) + axis] as number;
      n += 1;
      c = data.cornerNext[c] as number;
    } while (c !== first);
    if (sum / n > bestValue) {
      bestValue = sum / n;
      best = f;
    }
  }
  return best;
}

async function created(app: EditorApp, op: string, args?: unknown): Promise<MeshId> {
  const result = await app.runUntyped(op, args);
  if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
  const value = result.value as { mesh?: string; root?: string };
  return (value.mesh ?? value.root) as MeshId;
}

function setActive(app: EditorApp, slot: number): SwatchId {
  const swatch = swatchIdFor(DEFAULT_PALETTE_ID, slot);
  const model = app.session.getState().model;
  app.session.setState({ model: { ...model, activeSwatch: swatch } });
  return swatch;
}

async function settled(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 20 && !fn(); i++) await settle();
}

describe('Paint Colour: picking (§5.19)', () => {
  it('builds the ray of an orthographic pane and hits triangles on either side of the camera plane', () => {
    const ray = paneRay(view('front'), PANE, SIZE / 2, SIZE / 2);
    expect(ray?.ortho).toBe(true);
    expect(ray?.dir[2]).toBeCloseTo(-1, 12);
    expect(rayTriangle(ray as never, [-1, -1, 0], [1, -1, 0], [0, 1, 0])).toBeCloseTo(10, 9);
    expect(rayTriangle(ray as never, [-1, -1, 20], [1, -1, 20], [0, 1, 20])).toBeCloseTo(-10, 9);
    expect(paneRay(view('front'), 'other', 0, 0)).toBeNull();
  });

  it('picks the nearest face of the meshes the pane draws, through the world placement', async () => {
    const { app } = await contentApp();
    const cube = await created(app, 'mesh.create.cube');
    const front = faceFacing(app, cube, 2);
    expect(faceAt(app, view('front'), PANE, SIZE / 2, SIZE / 2)?.face).toBe(front);
    expect(faceAt(app, view('front'), PANE, 5, 5)).toBeNull();
    // Moved 3 m right: the pane centre misses it, the new place hits it.
    app.store.transact({ label: 'Move' }, (tx) =>
      tx.patch('meshes', cube, { placement: { t: [3, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } }),
    );
    expect(faceAt(app, view('front', 8), PANE, SIZE / 2, SIZE / 2)).toBeNull();
    const at = px('front', 3, 0, 8);
    expect(faceAt(app, view('front', 8), PANE, at.x, at.y)).toMatchObject({ mesh: cube, face: front });
    // Hidden objects and objects outside the pane's isolate list are not picked.
    const model = app.session.getState().model;
    app.session.setState({ model: { ...model, hiddenObjects: new Set([cube]) } });
    expect(faceAt(app, view('front', 8), PANE, at.x, at.y)).toBeNull();
    app.session.setState({ model: { ...model, isolate: { [PANE]: ['msh_other' as never] } } });
    expect(faceAt(app, view('front', 8), PANE, at.x, at.y)).toBeNull();
  });
});

describe('Paint Colour: gestures (§5.19)', () => {
  it('declares KeyI and Enter, loads its behaviour lazily and paints a clicked face (one step, source tool)', async () => {
    const { app } = await contentApp();
    const def = paintToolDef(view('front'));
    expect(def.keys).toEqual(expect.arrayContaining(['KeyI', 'Enter']));
    expect(def.workspaces).toEqual(['model']);
    const cube = await created(app, 'mesh.create.cube');
    setActive(app, 4);
    const instance = def.create(app, {} as never);
    instance.activate?.();
    await settled(() => instance.cursor?.() === 'crosshair');
    for (let i = 0; i < 5; i++) await settle();
    const before = app.store.undo.entries().undo.length;
    const at = px('front', 0, 0);
    expect(instance.pointerDown?.(pointer(at))).toBe(true);
    expect(instance.pointerUp?.(pointer(at, { buttons: 0 }))).toBe(true);
    const front = faceFacing(app, cube, 2);
    await settled(() => slots(app, cube)[front] === 4);
    expect(slots(app, cube).filter((s) => s === 4)).toHaveLength(1);
    expect(slots(app, cube)[front]).toBe(4);
    expect(app.store.undo.entries().undo.length).toBe(before + 1);
  });

  it('a drag paints every face crossed on the stroke mesh as one step; Shift+click fills the shell', async () => {
    const { app } = await contentApp();
    const plane = await created(app, 'mesh.create.plane', {
      width: 2,
      height: 2,
      subdivisionsWidth: 4,
      subdivisionsHeight: 1,
    });
    setActive(app, 5);
    const tool = new PaintTool(app, view('top', 4));
    tool.activate();
    const undo = () => app.store.undo.entries().undo.length;
    const before = undo();
    tool.pointerDown(pointer(px('top', -0.75, 0, 4)));
    for (const x of [-0.6, -0.25, 0.25, 0.4]) tool.pointerMove(pointer(px('top', x, 0, 4)));
    expect(tool.state().stroke).toHaveLength(3);
    tool.pointerUp(pointer(px('top', 0.4, 0, 4), { buttons: 0 }));
    await settled(() => slots(app, plane).filter((s) => s === 5).length === 3);
    expect(slots(app, plane).filter((s) => s === 5)).toHaveLength(3);
    expect(undo()).toBe(before + 1);

    setActive(app, 6);
    tool.pointerDown(pointer(px('top', 0.75, 0, 4), { shift: true }));
    await settled(() => slots(app, plane).every((s) => s === 6));
    expect(slots(app, plane)).toEqual([6, 6, 6, 6]);
  });

  it('I held picks the clicked slot as the active swatch; Enter paints the selected faces', async () => {
    const { app } = await contentApp();
    const cube = await created(app, 'mesh.create.cube');
    setActive(app, 9);
    const tool = new PaintTool(app, view('front'));
    tool.activate();
    tool.pointerDown(pointer(px('front', 0, 0)));
    tool.pointerUp(pointer(px('front', 0, 0), { buttons: 0 }));
    const front = faceFacing(app, cube, 2);
    await settled(() => slots(app, cube)[front] === 9);
    setActive(app, 1);
    const key = (type: 'down' | 'up', code: string) =>
      tool.key({ type, code, shift: false, alt: false, mod: false, ctrl: false, repeat: false });
    expect(key('down', 'KeyI')).toBe(true);
    expect(tool.cursor()).toBe('copy');
    tool.pointerDown(pointer(px('front', 0, 0)));
    await settled(() => app.session.getState().model.activeSwatch === swatchIdFor(DEFAULT_PALETTE_ID, 9));
    expect(app.session.getState().model.activeSwatch).toBe(swatchIdFor(DEFAULT_PALETTE_ID, 9));
    expect(key('up', 'KeyI')).toBe(true);
    expect(tool.cursor()).toBe('crosshair');

    // Enter: the selected faces of the hilited mesh (face mode).
    const model = app.session.getState().model;
    app.session.setState({ model: { ...model, componentMode: 'face', hilite: [cube] } });
    const others = [0, 1, 2, 3, 4, 5].filter((f) => f !== front);
    // The component selection service is B10's: select through the runtimes, as Select by Swatch does.
    const kernel = meshKernel();
    const data = app.meshes.get(cube)?.data();
    if (kernel === null || data === null || data === undefined) throw new Error('no kernel');
    attachMeshes(app)?.select(cube, kernel.selectionOf('face', [others[0] as number], data.counts));
    setActive(app, 12);
    expect(key('down', 'Enter')).toBe(true);
    await settled(() => slots(app, cube)[others[0] as number] === 12);
    expect(slots(app, cube)[others[0] as number]).toBe(12);
  });

  it('refuses without an active swatch and on asset-backed meshes, and paints nothing', async () => {
    const { app, services } = await contentApp();
    const cube = await created(app, 'mesh.create.cube');
    const tool = new PaintTool(app, view('front'));
    tool.activate();
    expect(tool.pointerDown(pointer(px('front', 0, 0)))).toBe(true);
    expect(services.toasts.at(-1)?.text).toBe('Pick a swatch in the Palette first');
    setActive(app, 4);
    app.store.transact({ label: 'Fake asset' }, (tx) =>
      tx.patch('meshes', cube, { source: { asset: 'a'.repeat(64) as never, mesh: 0 } }),
    );
    expect(tool.pointerDown(pointer(px('front', 0, 0)))).toBe(true);
    expect(services.toasts.at(-1)?.text).toBe('Painting imported meshes arrives later');
    expect(tool.state().stroke).toBeNull();
    expect(slots(app, cube).every((s) => s === 0)).toBe(true);
  });
});
