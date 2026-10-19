// M6A-SPEC §4.7, §5.17, §5.26 (B9): the M6a camera layers, pane memory per workspace, per-pane shading of character
// models (pixel probes), mesh layers (`addMeshLayer`, `applyPane` per pane), reference image planes in their ortho
// pane, the pointer platform rules (no context-menu RMB, the Model MMB stand-in, marking-menu presses, the stand-in's
// virtual slider at the MMB rate), a control selection carried over to Model (no manipulator, no unseen edit) and
// the Scale tool on controls (Animate) and on scene objects (Model), with undo.
import { DEG2RAD } from '@ekza-animator/anim-core';
import type { CharacterId, ControlId, ControlRecord, MeshId, MeshRecord, RigId, Tx } from '@ekza-animator/doc';
import {
  type DisplayFlags,
  registerBuiltinOperators,
  type ToolInstance,
  type ToolPointerEvent,
  VIEWPORT_TOOL,
} from '@ekza-animator/editor-core';
import {
  createFakeIkEditorApp,
  type FakeEditorApp,
  fixtureControl,
  withLimbIkRecords,
} from '@ekza-animator/editor-core/testing';
import type { LoadedModel } from '@ekza-animator/io/three';
import {
  BoxGeometry,
  Group,
  Layers,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISPLAY,
  type ImagePlaneSpec,
  LAYER,
  loadScaleKit,
  MODEL_DISPLAY,
  type PanePointerPress,
  SCALE_LABEL,
  startVirtualSliderDrag,
} from '../src';
import { applyMainLayers } from '../src/layers';
import type { MeshLayerHost } from '../src/manager/meshLayers';
import type { SceneSync } from '../src/sync/SceneSync';
import { createRig, drag, fixtures, pointer, type Rig } from './helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

const setWorkspace = (r: Rig, workspace: string): void => r.app.session.setState({ workspace });

/** A display model: one big box at the character's chest height, in a material of `color`. */
function boxModel(color: number): LoadedModel {
  const root = new Group();
  const box = new Mesh(new BoxGeometry(0.8, 0.8, 0.8).translate(0, 1, 0), new MeshStandardMaterial({ color }));
  root.add(box);
  root.updateMatrixWorld(true);
  return {
    root,
    nodeObjects: [],
    skinnedMeshes: [],
    vrm: null,
    springBones: null,
    nodeConstraints: null,
    dispose: () => {},
  };
}

function attach(r: Rig, model: LoadedModel): CharacterId {
  const character = r.app.store.list('characters')[0]?.id as CharacterId;
  (r.vm as unknown as { readonly sync: SceneSync }).sync.attachModel(character, model);
  return character;
}

/** The page pixel of a world point in a pane, read after a render. */
function probe(r: Rig, paneId: string, world: readonly [number, number, number]): [number, number, number, number] {
  const at = r.vm.project(paneId, world);
  const rect = r.vm.paneRect(paneId);
  if (at === null || rect === null || at.x < 0 || at.y < 0 || at.x >= rect.w || at.y >= rect.h) {
    throw new Error(`point ${world.join(', ')} not in ${paneId}`);
  }
  const pixel = r.vm.readPixel(rect.x + at.x, rect.y + at.y);
  if (pixel === null) throw new Error('outside the canvas');
  return pixel;
}

type Rgba = readonly [number, number, number, number];
const redDominant = (p: Rgba): boolean => p[0] > 120 && p[0] > 2.5 * p[1] && p[0] > 2.5 * p[2];
const greyish = (p: Rgba): boolean => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) < 24;
const show = (p: Rgba): string => p.join(', ');

function setDisplay(r: Rig, paneId: string, patch: Partial<DisplayFlags>): void {
  const display = r.vm.paneState(paneId)?.display;
  if (display === undefined) throw new Error(`no pane ${paneId}`);
  r.vm.updatePane(paneId, { display: { ...display, ...patch } });
}

describe('camera layers (§4.7)', () => {
  it('adds components 6, normals 7, lint 8 and helpers 9, enabled per display flags', () => {
    expect([LAYER.meshComponents, LAYER.meshNormals, LAYER.meshLint, LAYER.helpers]).toEqual([6, 7, 8, 9]);
    const camera = new PerspectiveCamera();
    const enabled = (layer: number): boolean => {
      const probeLayers = new Layers();
      probeLayers.set(layer);
      return camera.layers.test(probeLayers);
    };
    applyMainLayers(camera, DEFAULT_DISPLAY);
    expect([1, 2, 3, 6, 7, 8, 9].map(enabled)).toEqual([true, true, false, true, false, false, true]);
    applyMainLayers(camera, { ...DEFAULT_DISPLAY, normals: 'face', meshCheck: true, components: false });
    expect([6, 7, 8].map(enabled)).toEqual([false, true, true]);
    applyMainLayers(camera, { ...DEFAULT_DISPLAY, mesh: false, normals: 'both', meshCheck: true });
    expect([1, 6, 7, 8, 9].map(enabled)).toEqual([false, false, false, false, true]);
  });
});

describe('pane memory per workspace (§5.17)', () => {
  it('Model’s display and M-Side cameras never show in Animate after a round trip; cameras themselves stay', async () => {
    rig = await createRig();
    rig.layout('split');
    setDisplay(rig, 'pane-right', { shading: 'shaded', grid: false });
    const animateLeft = rig.vm.paneState('pane-left')?.binding;
    const cameraBefore = rig.vm.camera('pane-right');

    setWorkspace(rig, 'model');
    expect(rig.vm.currentWorkspace).toBe('model');
    expect(rig.vm.paneState('pane-right')?.display).toEqual(MODEL_DISPLAY);
    expect(rig.vm.paneState('pane-left')?.binding).toEqual({ kind: 'view', preset: 'front' });
    expect(rig.vm.camera('pane-right')).toEqual(cameraBefore); // the persp view camera is the pane's own
    setDisplay(rig, 'pane-right', { shading: 'wire' });

    setWorkspace(rig, 'animate');
    expect(rig.vm.paneState('pane-right')?.display).toEqual({ ...DEFAULT_DISPLAY, shading: 'shaded', grid: false });
    expect(rig.vm.paneState('pane-left')?.binding).toEqual(animateLeft);
    expect(rig.vm.rememberedPane('pane-right')?.display.shading).toBe('shaded');

    setWorkspace(rig, 'model');
    expect(rig.vm.paneState('pane-right')?.display.shading).toBe('wire');
    // A pane registered while in Model starts from Model's defaults.
    expect(rig.vm.paneSetup('pane-top')).toEqual({ camera: { kind: 'view', preset: 'top' }, display: MODEL_DISPLAY });
  });
});

describe('per-pane shading of character models (§4.7; pixel probes)', () => {
  it('lit draws the model’s own material, shaded a neutral clay, colours its colour, wire no surface', async () => {
    rig = await createRig();
    rig.layout('quad');
    attach(rig, boxModel(0xff2020));
    for (const id of ['pane-top', 'pane-persp', 'pane-front', 'pane-side']) {
      setDisplay(rig, id, { controls: false, grid: false });
    }
    setDisplay(rig, 'pane-persp', { shading: 'shaded' });
    setDisplay(rig, 'pane-front', { shading: 'colours' });
    setDisplay(rig, 'pane-side', { shading: 'wire' });
    rig.frame();
    const centre = [0, 1, 0] as const;
    const lit = probe(rig, 'pane-top', centre);
    const shaded = probe(rig, 'pane-persp', centre);
    const colours = probe(rig, 'pane-front', centre);
    // The side view's centre is a face centre: probe off the diagonal, inside the box.
    const wire = probe(rig, 'pane-side', [0, 1.2, 0.1]);
    expect(redDominant(lit), `lit ${show(lit)}`).toBe(true);
    expect(greyish(shaded) && shaded[0] > 40, `shaded ${show(shaded)}`).toBe(true);
    expect(redDominant(colours), `colours ${show(colours)}`).toBe(true);
    expect(redDominant(wire), `wire ${show(wire)}`).toBe(false);
    // The materials are back after the frame: the model keeps its own look.
    const box = (rig.vm as unknown as { readonly sync: SceneSync }).sync.model(
      rig.app.store.list('characters')[0]?.id as CharacterId,
    )?.root.children[0] as Mesh;
    expect(box.material).toBeInstanceOf(MeshStandardMaterial);
  });

  it('a Model round trip leaves Animate’s pane lit', async () => {
    rig = await createRig();
    rig.layout('single');
    attach(rig, boxModel(0xff2020));
    setDisplay(rig, 'pane-single', { controls: false, grid: false });
    rig.frame();
    expect(redDominant(probe(rig, 'pane-single', [0, 1, 0]))).toBe(true);
    setWorkspace(rig, 'model');
    rig.frame();
    // Model's colours shading draws the base colour flat under the scene lights: still red, but no longer the
    // standard material's shading; what matters is that Animate is unchanged when it comes back.
    expect(rig.vm.paneState('pane-single')?.display.shading).toBe('colours');
    setWorkspace(rig, 'animate');
    rig.frame();
    expect(rig.vm.paneState('pane-single')?.display.shading).toBe('lit');
    expect(redDominant(probe(rig, 'pane-single', [0, 1, 0]))).toBe(true);
  });

  it('wire on shaded draws the wireframe over the shading', async () => {
    rig = await createRig();
    rig.layout('single');
    attach(rig, boxModel(0xffffff));
    setDisplay(rig, 'pane-single', { controls: false, grid: false, shading: 'shaded', wireOnShaded: true });
    rig.frame();
    // An edge of the box: the wire colour (--wire, near black) over the clay.
    const edge = probe(rig, 'pane-single', [0.4, 1.4, 0.4]);
    expect(Math.max(edge[0], edge[1], edge[2])).toBeLessThan(60);
    setDisplay(rig, 'pane-single', { wireOnShaded: false });
    const plain = probe(rig, 'pane-single', [0.4, 1.4, 0.4]);
    expect(Math.max(plain[0], plain[1], plain[2])).toBeGreaterThan(60);
  });
});

/** A mesh-view stand-in: a plane on the mesh layer whose colour follows each pane's shading. */
function fakeHost(): MeshLayerHost & {
  readonly calls: { paneId: string; shading: string }[];
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
} {
  const dispose = vi.fn<() => void>();
  const root = new Group();
  const material = new MeshBasicMaterial({ color: 0xffffff });
  const plane = new Mesh(new PlaneGeometry(4, 4).translate(0, 1, -2), material);
  plane.layers.set(LAYER.mesh);
  root.add(plane);
  const calls: { paneId: string; shading: string }[] = [];
  return {
    root,
    calls,
    applyPane(display, paneId) {
      calls.push({ paneId, shading: display.shading });
      material.color.set(display.shading === 'wire' ? 0x0000ff : display.shading === 'colours' ? 0x00ff00 : 0xffffff);
    },
    dispose,
  };
}

describe('mesh layers (§4.7 addMeshLayer)', () => {
  it('one scene, N panes: every host gets each pane’s display right before that pane renders', async () => {
    rig = await createRig();
    rig.layout('split');
    for (const id of ['pane-left', 'pane-right']) setDisplay(rig, id, { controls: false, grid: false });
    setDisplay(rig, 'pane-left', { shading: 'wire' });
    setDisplay(rig, 'pane-right', { shading: 'colours' });
    const host = fakeHost();
    const remove = rig.vm.addMeshLayer(host);
    expect(rig.vm.meshLayers()).toEqual([host]);
    rig.frame();
    expect(host.calls.map((c) => [c.paneId, c.shading])).toEqual([
      ['pane-left', 'wire'],
      ['pane-right', 'colours'],
    ]);
    const left = probe(rig, 'pane-left', [0.3, 1.2, -2]);
    const right = probe(rig, 'pane-right', [0.3, 1.2, -2]);
    expect(left[2] > 200 && left[1] < 60, `left ${show(left)}`).toBe(true);
    expect(right[1] > 200 && right[2] < 60, `right ${show(right)}`).toBe(true);
    remove();
    expect(rig.vm.meshLayers()).toEqual([]);
    expect(host.root.parent).toBeNull();
    remove(); // idempotent
  });

  it('disposes the hosts still in the scene with the manager', async () => {
    rig = await createRig();
    const host = fakeHost();
    rig.vm.addMeshLayer(host);
    rig.dispose();
    rig = null;
    expect(host.dispose).toHaveBeenCalledOnce();
  });
});

function solidImage(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no 2d context');
  context.fillStyle = color;
  context.fillRect(0, 0, 64, 32);
  return canvas;
}

describe('reference image planes (§5.26)', () => {
  const plane = (fields: Partial<ImagePlaneSpec>): ImagePlaneSpec => ({
    id: 'img_Front',
    camera: 'front',
    image: solidImage('#ff00ff'),
    offset: [0, 1],
    size: 3,
    opacity: 1,
    depth: 'behind',
    visible: true,
    ...fields,
  });
  const magenta = (p: Rgba): boolean => p[0] > 200 && p[2] > 200 && p[1] < 60;

  it('draws only in the pane of its ortho view, behind the geometry or in front of it', async () => {
    rig = await createRig();
    rig.layout('quad');
    for (const id of ['pane-top', 'pane-persp', 'pane-front', 'pane-side']) {
      setDisplay(rig, id, { controls: false, grid: false });
    }
    attach(rig, boxModel(0xff2020));
    await rig.vm.setImagePlanes([plane({})]);
    rig.frame();
    expect(rig.vm.imagePlanesIn('pane-front')).toEqual(['img_Front']);
    expect(rig.vm.imagePlanesIn('pane-persp')).toEqual([]);
    expect(rig.vm.imagePlanesIn('pane-side')).toEqual([]);
    // Away from the box the plane shows; on the box (behind) the geometry covers it.
    expect(magenta(probe(rig, 'pane-front', [1.2, 2, 0]))).toBe(true);
    expect(redDominant(probe(rig, 'pane-front', [0, 1, 0]))).toBe(true);
    expect(magenta(probe(rig, 'pane-persp', [1.2, 2, 0]))).toBe(false);
    // In front: over the geometry too.
    await rig.vm.setImagePlanes([plane({ depth: 'front' })]);
    expect(magenta(probe(rig, 'pane-front', [0, 1, 0]))).toBe(true);
    // Hidden by the pane's flag, by the record's visibility, or without an image.
    setDisplay(rig, 'pane-front', { imagePlanes: false });
    expect(magenta(probe(rig, 'pane-front', [1.2, 2, 0]))).toBe(false);
    setDisplay(rig, 'pane-front', { imagePlanes: true });
    await rig.vm.setImagePlanes([plane({ visible: false })]);
    expect(rig.vm.imagePlanesIn('pane-front')).toEqual([]);
    await rig.vm.setImagePlanes([plane({ image: null })]);
    expect(rig.vm.imagePlanesIn('pane-front')).toEqual([]);
    await rig.vm.setImagePlanes([plane({ camera: 'side', id: 'img_Side' })]);
    expect(rig.vm.imagePlanesIn('pane-side')).toEqual(['img_Side']);
    expect(rig.vm.imagePlanesIn('pane-front')).toEqual([]);
    await rig.vm.setImagePlanes([]);
    expect(rig.vm.imagePlanesIn('pane-side')).toEqual([]);
  });

  it('is never picked: through a plane the pick finds the geometry behind it, and nothing where there is none', async () => {
    rig = await createRig();
    rig.layout('quad');
    attach(rig, boxModel(0xff2020));
    await rig.vm.setImagePlanes([plane({ depth: 'front', size: 50 })]);
    rig.frame();
    const at = rig.vm.project('pane-front', [0, 1, 0]);
    if (at === null) throw new Error('box not in view');
    expect(rig.vm.isOverMesh('pane-front', at.x, at.y)).toBe(true);
    // The plane covers the whole pane, yet an empty corner has no mesh under it.
    expect(magenta(probe(rig, 'pane-front', [1.2, 2, 0]))).toBe(true);
    expect(rig.vm.isOverMesh('pane-front', 2, 2)).toBe(false);
  });
});

/** A viewport tool that records what it receives (placing: keeps RMB). */
function recordingTool(r: Rig, phase: 'idle' | 'placing' = 'idle'): ToolPointerEvent[] {
  const events: ToolPointerEvent[] = [];
  const instance: ToolInstance = {
    pointerDown: (e) => {
      events.push(e);
      return true;
    },
    pointerMove: (e) => {
      events.push(e);
      return true;
    },
    pointerUp: (e) => {
      events.push(e);
      return true;
    },
    phase: () => phase,
  };
  r.app.contribute({
    kind: 'tool',
    def: { id: 'recorder', panel: 'viewport', label: 'Recorder', create: () => instance },
  });
  const tools = r.app.session.getState().tools;
  r.app.session.setState({ tools: { ...tools, viewport: 'recorder' } });
  return events;
}

describe('pointer platform rules (§5.17)', () => {
  it('(a) contextmenu is suppressed and never opens a menu; RMB presses do (button 2); a Mac Ctrl-click is LMB', async () => {
    rig = await createRig();
    rig.layout('single');
    recordingTool(rig);
    const presses: PanePointerPress[] = [];
    rig.vm.setPointerMenus((press) => {
      presses.push(press);
      return press.button === 2;
    });
    const pane = rig.panes.get('pane-single') as HTMLElement;
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 300,
      clientY: 300,
    });
    expect(pane.dispatchEvent(event)).toBe(false);
    expect(presses).toEqual([]);
    pointer(pane, 'pointerdown', 300, 300, { button: 2, shiftKey: true });
    expect(presses.map((p) => [p.button, p.shift, p.ctrl])).toEqual([[2, true, false]]);
    expect(presses[0]?.overMesh()).toBe(false);
    pointer(pane, 'pointerup', 300, 300, { button: 2 });
    // macOS Ctrl-click: button 0 with ctrlKey — offered to the menus as an LMB press, which they decline.
    pointer(pane, 'pointerdown', 310, 300, { button: 0, ctrlKey: true });
    expect(presses.at(-1)).toMatchObject({ button: 0, ctrl: true });
    pointer(pane, 'pointerup', 310, 300, { button: 0, ctrlKey: true });
  });

  it('(a) a placing tool keeps its RMB (Multi-Cut completes) before any marking menu', async () => {
    rig = await createRig();
    rig.layout('single');
    const events = recordingTool(rig, 'placing');
    const menus = vi.fn<(press: PanePointerPress) => boolean>(() => true);
    rig.vm.setPointerMenus(menus);
    const pane = rig.panes.get('pane-single') as HTMLElement;
    pointer(pane, 'pointerdown', 300, 300, { button: 2 });
    expect(menus).not.toHaveBeenCalled();
    expect(events.at(-1)?.button).toBe(2);
  });

  it('(b) Alt+Shift+LMB in a Model pane is MMB for the tools on the trackpad and one-button profiles only', async () => {
    rig = await createRig();
    rig.layout('single');
    const events = recordingTool(rig);
    const pane = rig.panes.get('pane-single') as HTMLElement;
    rig.frame();
    const cameraBefore = rig.vm.camera('pane-single');
    const standIn = { button: 0, altKey: true, shiftKey: true };
    for (const profile of ['trackpad', 'mayaOneButton'] as const) {
      rig.vm.setNavProfile(profile);
      setWorkspace(rig, 'model');
      events.length = 0;
      drag(pane, { x: 400, y: 300 }, { x: 460, y: 300 }, standIn);
      expect(events[0]).toMatchObject({ button: 1, alt: false, shift: false });
      expect(events.slice(1, -1).every((e) => (e.buttons & 4) === 4 && !e.alt && !e.shift)).toBe(true);
      expect(events.at(-1)).toMatchObject({ button: 1 });
      expect(rig.vm.camera('pane-single')).toEqual(cameraBefore); // no tumble
      // Ctrl+Alt+Shift+LMB = Ctrl+MMB.
      events.length = 0;
      drag(pane, { x: 400, y: 300 }, { x: 420, y: 300 }, { ...standIn, ctrlKey: true });
      expect(events[0]).toMatchObject({ button: 1, ctrl: true, alt: false, shift: false });
      setWorkspace(rig, 'animate');
    }
    // Animate, and the maya profile in Model: Alt+LMB stays tumble.
    rig.vm.setNavProfile('trackpad');
    events.length = 0;
    drag(pane, { x: 400, y: 300 }, { x: 460, y: 300 }, standIn);
    expect(events).toEqual([]);
    expect(rig.vm.camera('pane-single')).not.toEqual(cameraBefore);
    const tumbled = rig.vm.camera('pane-single');
    rig.vm.setNavProfile('maya');
    setWorkspace(rig, 'model');
    drag(pane, { x: 400, y: 300 }, { x: 460, y: 300 }, standIn);
    expect(events).toEqual([]);
    expect(rig.vm.camera('pane-single')).not.toEqual(tumbled);
  });
});

// ---------- a control selection carried over from Animate (§5.17) ----------

const IK_RIG = 'rig_SyntheticWave001' as RigId;
const ctl = (key: string): ControlId => fixtureControl(IK_RIG, key);

/** The synthetic IK rig in one pane (Animate), pointer capture for the virtual slider. */
async function ikRig(): Promise<Rig> {
  const { snapshot, skeleton } = await fixtures();
  const app = createFakeIkEditorApp({ snapshot: withLimbIkRecords(snapshot), skeleton });
  registerBuiltinOperators(app);
  const r = await createRig({ app: app as FakeEditorApp });
  rig = r;
  r.layout('single');
  r.vm.setPointerLockAllowed(false);
  r.frame();
  return r;
}

function selectControl(r: Rig, key: string, channel?: 'rz'): void {
  r.app.session.setState({
    selection: {
      ...r.app.session.getState().selection,
      controls: [ctl(key)],
      channels: channel === undefined ? [] : [{ control: ctl(key), channel }],
    },
  });
}

function setTool(r: Rig, tool: string): void {
  r.app.session.setState({ tools: { ...r.app.session.getState().tools, viewport: tool } });
}

/** A pointer move with a movement, as the browser reports it under capture or lock (MMB held). */
function slide(element: HTMLElement, movementX: number, init?: PointerEventInit): void {
  element.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 4,
      button: -1,
      movementX,
      ...init,
    }),
  );
}

/** A 40 px virtual-slider drag in four moves, pressed with `press` and moved with `held`; returns Δrz in degrees. */
function slideDrag(r: Rig, press: PointerEventInit, held: PointerEventInit = {}, px = 40): number {
  const pane = r.panes.get(PANE) as HTMLElement;
  const before = r.app.evaluation.channelValues(ctl('fk.lowerArm.L')).rz;
  pointer(pane, 'pointerdown', 300, 300, press);
  for (let i = 0; i < 4; i++) slide(pane, px / 4, held);
  pointer(pane, 'pointerup', 300 + px, 300, press);
  r.app.flushScheduled();
  return (r.app.evaluation.channelValues(ctl('fk.lowerArm.L')).rz - before) / DEG2RAD;
}

describe('a control selection carried over to Model (§5.17)', () => {
  it('gets no W, E or R manipulator in any mode, and a drag where its handle was edits and keys nothing', async () => {
    const r = await ikRig();
    await loadScaleKit();
    const control = ctl('fk.lowerArm.L');
    // Free translate and scale too, so every tool has a handle on it in Animate.
    r.app.store.transact({ label: 'Keyable', undoable: false }, (tx) =>
      tx.patch('controls', control, {
        keyable: { ...keyableOf(tx, control), t: [true, true, true], s: [true, true, true] },
      }),
    );
    selectControl(r, 'fk.lowerArm.L', 'rz');
    const pane = r.panes.get(PANE) as HTMLElement;
    const handles = [
      [VIEWPORT_TOOL.move, 'tx'],
      [VIEWPORT_TOOL.rotate, 'rz'],
      [VIEWPORT_TOOL.scale, 'sx'],
    ] as const;
    // Animate: each tool sits on the lead control.
    const grabs = new Map<string, { x: number; y: number }>();
    for (const [tool, handle] of handles) {
      setTool(r, tool);
      r.frame();
      const at = r.vm.manipulatorScreenPoint(PANE, handle);
      expect(at, `${tool} on the control in Animate`).not.toBeNull();
      if (at !== null) grabs.set(tool, at);
    }
    const before = { ...r.app.evaluation.channelValues(control) };
    const historyBefore = r.app.history.peekUndo()?.label ?? null;

    setWorkspace(r, 'model');
    for (const componentMode of ['object', 'vertex', 'edge', 'face'] as const) {
      r.app.session.setState({ model: { ...r.app.session.getState().model, componentMode } });
      for (const [tool, handle] of handles) {
        // The carried-over selection (a press on empty space in Model may clear it: re-select it each time).
        selectControl(r, 'fk.lowerArm.L', 'rz');
        setTool(r, tool);
        r.frame();
        expect(r.vm.manipulatorScreenPoint(PANE, handle), `${tool} in Model ${componentMode} mode`).toBeNull();
        const at = grabs.get(tool) as { x: number; y: number };
        const rect = r.vm.paneRect(PANE) as { x: number; y: number };
        drag(pane, { x: rect.x + at.x, y: rect.y + at.y }, { x: rect.x + at.x + 30, y: rect.y + at.y - 30 });
      }
    }
    r.app.flushScheduled();
    expect(r.app.evaluation.channelValues(control)).toEqual(before);
    expect(['Move', 'Rotate', 'Scale']).not.toContain(r.app.history.peekUndo()?.label);
    expect(r.app.history.peekUndo()?.label ?? null).toBe(historyBefore);

    // Back in Animate the manipulator is there again.
    setWorkspace(r, 'animate');
    selectControl(r, 'fk.lowerArm.L', 'rz');
    setTool(r, VIEWPORT_TOOL.rotate);
    r.frame();
    expect(r.vm.manipulatorScreenPoint(PANE, 'rz')).not.toBeNull();
  });

  it('a plain MMB drag leaves the hidden control’s selected channels alone; a pane that shows controls slides them', async () => {
    const r = await ikRig();
    selectControl(r, 'fk.lowerArm.L', 'rz');
    setWorkspace(r, 'model');
    expect(r.vm.paneState(PANE)?.display.controls).toBe(false);
    const pane = r.panes.get(PANE) as HTMLElement;
    pointer(pane, 'pointerdown', 300, 300, { button: 1 });
    expect(r.vm.virtualSliderActive).toBe(false);
    pointer(pane, 'pointerup', 300, 300, { button: 1 });
    expect(slideDrag(r, { button: 1 })).toBe(0);
    expect(r.app.history.canUndo()).toBe(false);
    // Show ▸ Controls in this pane: the control is drawn, so the shipped virtual slider runs (one step).
    setDisplay(r, PANE, { controls: true });
    expect(slideDrag(r, { button: 1 })).toBeCloseTo(20, 9);
    expect(r.app.history.peekUndo()?.label).toBe('Drag Rotate Z');
  });
});

describe('the MMB stand-in reaches the virtual slider as MMB (§5.17 (b))', () => {
  it('a 40 px Alt+Shift+LMB drag with the keys held gives the same delta as a 40 px MMB drag; Mod keeps ×10', async () => {
    const r = await ikRig();
    selectControl(r, 'fk.lowerArm.L', 'rz');
    setWorkspace(r, 'model');
    setDisplay(r, PANE, { controls: true });
    const chord = { button: 0, altKey: true, shiftKey: true };
    for (const profile of ['trackpad', 'mayaOneButton'] as const) {
      r.vm.setNavProfile(profile);
      const mmb = slideDrag(r, { button: 1 });
      const standIn = slideDrag(r, chord, { altKey: true, shiftKey: true });
      expect(mmb).toBeCloseTo(20, 9);
      expect(standIn).toBeCloseTo(mmb, 9);
      // Ctrl+Alt+Shift+LMB = Ctrl+MMB: the coarse ×10 rate (4 px = 20°), Shift still not fine.
      const coarse = slideDrag(r, { ...chord, ctrlKey: true }, { altKey: true, shiftKey: true, ctrlKey: true }, 4);
      expect(coarse).toBeCloseTo(20, 9);
    }
    // A real MMB drag with Shift held stays fine (×0.1): the rule applies to the stand-in only.
    expect(slideDrag(r, { button: 1 }, { shiftKey: true })).toBeCloseTo(2, 9);
  });

  it('startVirtualSliderDrag: `standIn` reads Shift as released for the moves and the initial motion', async () => {
    const r = await ikRig();
    const pane = r.panes.get(PANE) as HTMLElement;
    const refs = [{ control: ctl('fk.lowerArm.L'), channel: 'rz' as const }];
    const press = new PointerEvent('pointerdown', { pointerId: 1, button: 0, shiftKey: true, altKey: true });
    const before = r.app.evaluation.channelValues(ctl('fk.lowerArm.L')).rz;
    const gesture = startVirtualSliderDrag(r.app, refs, pane, press, {
      pointerLock: false,
      standIn: true,
      initialDx: 4,
    });
    expect(gesture).not.toBeNull();
    slide(pane, 36, { shiftKey: true });
    gesture?.end(true);
    r.app.flushScheduled();
    expect((r.app.evaluation.channelValues(ctl('fk.lowerArm.L')).rz - before) / DEG2RAD).toBeCloseTo(20, 9);
  });
});

// ---------- the Scale tool ----------

/** A control's keyable flags inside a transaction. */
function keyableOf(tx: Tx, id: ControlId): ControlRecord['keyable'] {
  const record = tx.get('controls', id);
  if (record === undefined) throw new Error(`no control ${id}`);
  return record.keyable;
}

const PANE = 'pane-single';

/** Picks the Scale tool and waits for its lazy chunk (the tool and the scale handles appear once it has loaded). */
async function scaleTool(r: Rig): Promise<void> {
  const tools = r.app.session.getState().tools;
  r.app.session.setState({ tools: { ...tools, viewport: VIEWPORT_TOOL.scale } });
  await loadScaleKit();
}

function handlePoint(r: Rig, handle: 'sx' | 'sy' | 'sz' | 'suniform'): { x: number; y: number } {
  const point = r.vm.manipulatorScreenPoint(PANE, handle);
  const rect = r.vm.paneRect(PANE);
  if (point === null || rect === null) throw new Error(`no ${handle} handle`);
  return { x: rect.x + point.x, y: rect.y + point.y };
}

/** Drags from a handle's grab point along the screen direction from the pivot through it, by `factor` of its length. */
function dragHandle(r: Rig, handle: 'sx' | 'sy' | 'sz', factor: number): void {
  const pane = r.panes.get(PANE) as HTMLElement;
  const from = handlePoint(r, handle);
  const pivot = handlePoint(r, 'suniform');
  const to = { x: pivot.x + (from.x - pivot.x) * factor, y: pivot.y + (from.y - pivot.y) * factor };
  drag(pane, from, to, undefined, 6);
}

describe('the Scale tool (R) on controls (Animate)', () => {
  it('scales the lead control’s keyable s channels along an axis and uniformly; one step "Scale" each; undo', async () => {
    rig = await createRig();
    rig.layout('single');
    const control = rig.app.store.list('controls').find((c) => c.parent !== null) as { id: ControlId };
    // The synthetic rig's controls do not key scale: make this one's scale keyable.
    rig.app.store.transact({ label: 'Keyable scale', undoable: false }, (tx) =>
      tx.patch('controls', control.id, { keyable: { ...keyableOf(tx, control.id), s: [true, true, true] } }),
    );
    rig.app.session.setState({ selection: { ...rig.app.session.getState().selection, controls: [control.id] } });
    await scaleTool(rig);
    rig.frame();
    const before = rig.app.evaluation.channelValues(control.id);
    dragHandle(rig, 'sy', 2);
    rig.app.flushScheduled();
    const after = rig.app.evaluation.channelValues(control.id);
    expect(after.sy).toBeGreaterThan(before.sy * 1.5);
    expect([after.sx, after.sz]).toEqual([before.sx, before.sz]);
    expect(rig.app.history.peekUndo()?.label).toBe('Scale');
    rig.app.history.undo();
    expect(rig.app.evaluation.channelValues(control.id).sy).toBeCloseTo(before.sy, 9);

    rig.frame();
    const pane = rig.panes.get(PANE) as HTMLElement;
    const centre = handlePoint(rig, 'suniform');
    drag(pane, centre, { x: centre.x + 45, y: centre.y }, undefined, 5);
    const uniform = rig.app.evaluation.channelValues(control.id);
    expect(uniform.sx).toBeGreaterThan(before.sx);
    expect(uniform.sy / before.sy).toBeCloseTo(uniform.sx / before.sx, 9);
    expect(uniform.sz / before.sz).toBeCloseTo(uniform.sx / before.sx, 9);
  });

  it('shows no scale handles for controls whose scale is not keyable, and Esc cancels a drag', async () => {
    rig = await createRig();
    rig.layout('single');
    const control = rig.app.store.list('controls').find((c) => c.parent !== null) as { id: ControlId };
    rig.app.store.transact({ label: 'Locked scale', undoable: false }, (tx) =>
      tx.patch('controls', control.id, { keyable: { ...keyableOf(tx, control.id), s: [false, false, false] } }),
    );
    rig.app.session.setState({ selection: { ...rig.app.session.getState().selection, controls: [control.id] } });
    await scaleTool(rig);
    rig.frame();
    expect(rig.vm.manipulatorScreenPoint(PANE, 'sx')).toBeNull();
    expect(rig.vm.manipulatorScreenPoint(PANE, 'suniform')).toBeNull();
  });
});

const IDENTITY = {
  t: [0, 0, 0] as [number, number, number],
  q: [0, 0, 0, 1] as [number, number, number, number],
  s: [1, 1, 1] as [number, number, number],
};

function meshRecord(id: string, fields: Partial<MeshRecord> = {}): MeshRecord {
  return {
    id: id as MeshId,
    name: id,
    owner: { scene: true },
    parent: null,
    order: 'a0',
    placement: IDENTITY,
    pivot: [0, 0, 0],
    source: null,
    data: null,
    faceted: true,
    generator: null,
    palette: null,
    material: { preset: 'unlit' },
    colourOutput: 'palette-texture',
    skin: null,
    budget: null,
    handheld: null,
    deleted: null,
    ...fields,
  };
}

describe('the Scale tool (R) on scene objects (Model object mode)', () => {
  it('scales the selected meshes about their pivots in one step "Scale"; undo restores the placements', async () => {
    rig = await createRig();
    rig.layout('single');
    rig.app.store.transact({ label: 'Meshes', undoable: false }, (tx) => {
      tx.put('meshes', meshRecord('msh_Crate', { placement: { ...IDENTITY, t: [0, 1, 0] }, pivot: [0, -0.5, 0] }));
      tx.put('meshes', meshRecord('msh_Lid', { placement: { ...IDENTITY, t: [0.5, 1.5, 0] } }));
    });
    setWorkspace(rig, 'model');
    rig.app.session.setState({
      selection: { ...rig.app.session.getState().selection, objects: ['msh_Lid' as MeshId, 'msh_Crate' as MeshId] },
    });
    await scaleTool(rig);
    rig.frame();
    // The manipulator sits on the lead object's pivot (the crate's bottom centre).
    const pivot = rig.vm.manipulatorScreenPoint(PANE, 'suniform');
    const expected = rig.vm.project(PANE, [0, 0.5, 0]);
    expect(pivot?.x).toBeCloseTo(expected?.x ?? Number.NaN, 6);
    expect(pivot?.y).toBeCloseTo(expected?.y ?? Number.NaN, 6);

    dragHandle(rig, 'sy', 2);
    const crate = rig.app.store.get('meshes', 'msh_Crate' as MeshId);
    const lid = rig.app.store.get('meshes', 'msh_Lid' as MeshId);
    const f = crate?.placement.s[1] ?? 1;
    expect(f).toBeGreaterThan(1.5);
    expect([crate?.placement.s[0], crate?.placement.s[2]]).toEqual([1, 1]);
    // The pivot keeps its place: t' = t + (1 − f)·p.
    expect(crate?.placement.t[1]).toBeCloseTo(1 + (1 - f) * -0.5, 9);
    expect(lid?.placement.s[1]).toBeCloseTo(f, 9);
    expect(lid?.placement.t).toEqual([0.5, 1.5, 0]);
    expect(rig.app.history.peekUndo()?.label).toBe('Scale');
    rig.app.history.undo();
    expect(rig.app.history.canUndo()).toBe(false);
    expect(rig.app.store.get('meshes', 'msh_Crate' as MeshId)?.placement).toEqual({ ...IDENTITY, t: [0, 1, 0] });
    expect(rig.app.store.get('meshes', 'msh_Lid' as MeshId)?.placement).toEqual({ ...IDENTITY, t: [0.5, 1.5, 0] });
  });

  it('a click on a handle (no drag) changes nothing and records no step', async () => {
    rig = await createRig();
    rig.layout('single');
    rig.app.store.transact({ label: 'Mesh', undoable: false }, (tx) => tx.put('meshes', meshRecord('msh_Crate')));
    setWorkspace(rig, 'model');
    rig.app.session.setState({
      selection: { ...rig.app.session.getState().selection, objects: ['msh_Crate' as MeshId] },
    });
    await scaleTool(rig);
    rig.frame();
    const pane = rig.panes.get(PANE) as HTMLElement;
    const at = handlePoint(rig, 'sx');
    pointer(pane, 'pointerdown', at.x, at.y);
    pointer(pane, 'pointerup', at.x, at.y);
    expect(rig.app.history.canUndo()).toBe(false);
    expect(SCALE_LABEL).toBe('Scale');
  });
});
