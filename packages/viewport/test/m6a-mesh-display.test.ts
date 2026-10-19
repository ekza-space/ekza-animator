// The viewport's mesh display (M6A-SPEC §4.4, §4.7, §5.6, §5.23; B6): lazy loading of mesh-view, one host per mesh
// runtime through `addMeshLayer`, MeshSurface outside component mode, EditMeshView + picker for hilited open meshes,
// placements through groups, palette colours, hidden objects, per-pane isolate, "Dim unhilited", hover, face isolate,
// revisions written while shown, and the pane-flag mapping.
import type { Disposer, ReadonlyXf } from '@ekza-animator/anim-core';
import type { GroupId, MeshId, MeshRecord, MeshRef, PaletteId, SwatchId } from '@ekza-animator/doc';
import { type EditorApp, loadMeshKernel } from '@ekza-animator/editor-core';
import { createFakeEditorApp } from '@ekza-animator/editor-core/testing';
import { BitSet, type MeshData, primitive, writeRevision } from '@ekza-animator/mesh-core';
import {
  type Camera,
  Color,
  LinearSRGBColorSpace,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY,
  type DisplayFlags,
  loadMeshDisplay,
  loadMeshView,
  MESH_LAYERS,
  type MeshDisplay,
  type MeshLayerHost,
  meshPaneDisplay,
} from '../src';

const W = 400;
const H = 300;
const IDENTITY: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
const CLAY = 0x6e7179;
const BACKGROUND = 0x202020;

interface Harness {
  readonly app: EditorApp;
  readonly display: MeshDisplay;
  readonly hosts: Set<MeshLayerHost>;
  invalidations: number;
  render(camera: Camera, flags?: Partial<DisplayFlags>, paneId?: string): void;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

let harness: Harness | null = null;
afterEach(() => {
  harness?.dispose();
  harness = null;
});

beforeAll(async () => {
  await loadMeshKernel();
});

async function setup(): Promise<Harness> {
  const app = createFakeEditorApp();
  const element = document.createElement('canvas');
  Object.assign(element.style, { position: 'fixed', left: '0px', top: '0px', width: `${W}px`, height: `${H}px` });
  document.body.append(element);
  const renderer = new WebGLRenderer({ canvas: element, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(BACKGROUND, 1);
  const scene = new Scene();
  const hosts = new Set<MeshLayerHost>();
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  const state = {
    invalidations: 0,
  };
  const display = await loadMeshDisplay({
    app,
    target: {
      addMeshLayer(host): Disposer {
        hosts.add(host);
        scene.add(host.root);
        return () => {
          hosts.delete(host);
          host.root.removeFromParent();
        };
      },
      invalidate() {
        state.invalidations++;
      },
    },
  });
  const h: Harness = {
    app,
    display,
    hosts,
    get invalidations() {
      return state.invalidations;
    },
    set invalidations(v: number) {
      state.invalidations = v;
    },
    render(camera, flags = {}, paneId = 'pane-persp') {
      const pane = meshPaneDisplay({ ...DEFAULT_DISPLAY, shading: 'shaded', ...flags });
      for (const host of hosts) host.applyPane(pane, paneId);
      renderer.render(scene, camera);
    },
    pixel(x, y) {
      gl.readPixels(Math.floor(x), H - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [out[0] as number, out[1] as number, out[2] as number];
    },
    dispose() {
      display.dispose();
      renderer.dispose();
      element.remove();
      app.dispose();
    },
  };
  harness = h;
  return h;
}

function front(height = 4): OrthographicCamera {
  const aspect = W / H;
  const camera = new OrthographicCamera(
    (-height * aspect) / 2,
    (height * aspect) / 2,
    height / 2,
    -height / 2,
    0.05,
    100,
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.layers.enableAll();
  camera.updateMatrixWorld();
  return camera;
}

function screen(camera: Camera, p: readonly [number, number, number]): [number, number] {
  const v = new Vector3(...p).project(camera);
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
}

function storeRevision(app: EditorApp, data: MeshData): MeshRef {
  const out = writeRevision(data);
  for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
  app.blobs.put(out.manifestBytes);
  return { manifest: out.manifestId, rev: 1, base: null, joints: [] };
}

function meshRecord(id: string, fields: Partial<MeshRecord>): MeshRecord {
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

function createMesh(app: EditorApp, id: string, data: MeshData, fields: Partial<MeshRecord> = {}): MeshId {
  const ref = storeRevision(app, data);
  app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', meshRecord(id, { ...fields, data: ref })));
  return id as MeshId;
}

function srgbOf(rgbLinear: readonly number[]): [number, number, number] {
  const c = new Color().setRGB(
    rgbLinear[0] as number,
    rgbLinear[1] as number,
    rgbLinear[2] as number,
    LinearSRGBColorSpace,
  );
  const out = { r: 0, g: 0, b: 0 };
  c.getRGB(out, SRGBColorSpace);
  return [Math.round(out.r * 255), Math.round(out.g * 255), Math.round(out.b * 255)];
}

function hex(h: number): [number, number, number] {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

/** '' when within tolerance, else a description. */
function off(actual: readonly number[], expected: readonly number[], tolerance = 3): string {
  const bad = [0, 1, 2].some((i) => Math.abs((actual[i] as number) - (expected[i] as number)) > tolerance);
  return bad ? `${JSON.stringify(actual)} vs ${JSON.stringify(expected)}` : '';
}

/** The front face of a unit cube under the clay rig, seen along −Z (view normal (0, 0, 1)). */
function clayFront(base = CLAY): [number, number, number] {
  const c = new Color(base);
  const key = 0.72 / Math.hypot(-0.35, 0.6, 0.72);
  const fill = 0.84 / Math.hypot(0.5, -0.2, 0.84);
  const light = 0.4 + 0.5 * key + 0.15 * fill;
  return srgbOf([c.r * light, c.g * light, c.b * light]);
}

function enterComponentMode(app: EditorApp, mode: 'vertex' | 'edge' | 'face', hilite: readonly MeshId[]): void {
  for (const id of hilite) app.meshes.open(id);
  const model = app.session.getState().model;
  app.session.setState({ model: { ...model, componentMode: mode, lastComponentMode: mode, hilite } });
}

describe('viewport mesh display', () => {
  it('loads mesh-view once and maps the pane flags', async () => {
    const a = loadMeshView();
    const b = loadMeshView();
    expect(a).toBe(b);
    const meshView = await a;
    expect(typeof meshView.EditMeshView).toBe('function');
    expect(meshView.VIEW_MARKER.length).toBeGreaterThan(0);
    const pane = meshPaneDisplay({ ...DEFAULT_DISPLAY, dimUnhilited: true, shading: 'wire', normals: 'both' });
    expect(pane).toEqual({
      shading: 'wire',
      wireOnShaded: false,
      flat: false,
      cull: false,
      xray: false,
      components: true,
      normals: 'both',
      faceOrientation: false,
      triangulation: false,
      hardEdges: false,
      meshCheck: false,
      symmetryPlane: true,
      dimmed: true,
    });
    expect(MESH_LAYERS).toEqual({ surface: 1, components: 6, normals: 7, lint: 8, helpers: 9 });
  });

  it('shows every ready mesh as a surface outside component mode, at its placement through groups', async () => {
    const h = await setup();
    const camera = front();
    expect(h.hosts.size).toBe(0);
    h.app.store.transact({ label: 'Group' }, (tx) =>
      tx.put('groups', {
        id: 'grp_A' as GroupId,
        name: 'Group',
        owner: { scene: true },
        parent: null,
        order: 'a0',
        placement: { t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        pivot: [0, 0, 0],
        template: null,
        budget: null,
        handheld: null,
        deleted: null,
      }),
    );
    const id = createMesh(h.app, 'msh_A', primitive('cube', {}), {
      parent: 'grp_A' as GroupId,
      placement: { t: [0, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    expect(h.hosts.size).toBe(1);
    expect(h.display.picker(id)).toBeNull();
    expect(Array.from(h.display.worldOf(id) ?? []).slice(12, 15)).toEqual([1, 0.5, 0]);
    h.render(camera);
    expect(off(h.pixel(...screen(camera, [1.1, 0.6, 0.5])), clayFront())).toBe('');
    expect(off(h.pixel(...screen(camera, [-0.6, 0, 0.5])), hex(BACKGROUND), 1)).toBe('');
    // Deleting the record drops its host.
    h.app.store.transact({ label: 'Delete' }, (tx) => tx.softDelete('meshes', id));
    expect(h.hosts.size).toBe(0);
  });

  it('draws palette colours in the colours shading and follows swatch edits', async () => {
    const h = await setup();
    const camera = front();
    h.app.store.transact({ label: 'Palette' }, (tx) => {
      tx.put('palettes', { id: 'pal_A' as PaletteId, name: 'P', order: 'a0', deleted: null });
      tx.put('swatches', {
        id: 'sw_A' as SwatchId,
        palette: 'pal_A' as PaletteId,
        slot: 0,
        order: 'a0',
        name: 'Red',
        srgb: [255, 0, 0],
        kind: 'flat',
        ramp: null,
        deleted: null,
      });
    });
    createMesh(h.app, 'msh_A', primitive('cube', {}), { palette: 'pal_A' as PaletteId });
    const at = screen(camera, [0.1, 0.1, 0.5]);
    h.render(camera, { shading: 'colours' });
    expect(off(h.pixel(...at), clayFront(0xff0000))).toBe('');
    h.app.store.transact({ label: 'Recolour' }, (tx) =>
      tx.patch('swatches', 'sw_A' as SwatchId, { srgb: [0, 0, 255] }),
    );
    h.render(camera, { shading: 'colours' });
    expect(off(h.pixel(...at), clayFront(0x0000ff))).toBe('');
    h.render(camera, { shading: 'shaded' });
    expect(off(h.pixel(...at), clayFront())).toBe('');
  });

  it('switches hilited open meshes to edit views with pickers in component mode, and back', async () => {
    const h = await setup();
    const camera = front();
    const a = createMesh(h.app, 'msh_A', primitive('cube', {}), {
      placement: { t: [-1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    const b = createMesh(h.app, 'msh_B', primitive('cube', {}), {
      placement: { t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    enterComponentMode(h.app, 'vertex', [a]);
    expect(h.display.editable()).toEqual([a]);
    expect(h.display.picker(b)).toBeNull();
    h.render(camera);
    // A's corner shows a vertex glyph (--comp-vertex), B's corner is plain surface.
    const vertexA = screen(camera, [-0.5, 0.5, 0.5]);
    expect(off(h.pixel(...vertexA), hex(0xd17bff), 1)).toBe('');
    const cornerB = screen(camera, [0.5, 0.5, 0.5]);
    expect(off(h.pixel(cornerB[0] + 3, cornerB[1] + 3), clayFront())).toBe('');
    // Picking across hilited meshes.
    const ndc: [number, number] = [(vertexA[0] / W) * 2 - 1, 1 - (vertexA[1] / H) * 2];
    const hit = h.display.pick(camera, ndc, { w: W, h: H }, 'vertex', { cameraBased: true, backfaces: false });
    expect(hit?.mesh).toBe(a);
    expect(hit?.point[0]).toBeCloseTo(-0.5, 5);
    const all = h.display.marquee(camera, { x0: 0, y0: 0, x1: W, y1: H }, { w: W, h: H }, 'vertex', {
      cameraBased: false,
      backfaces: false,
    });
    expect([...all.keys()]).toEqual([a]);
    expect(all.get(a)).toHaveLength(8);
    // Hover pre-highlights.
    h.display.setHover(a, { kind: 'vertex', index: hit?.index ?? 0 });
    h.render(camera);
    expect(off(h.pixel(...vertexA), hex(0xffe58a), 1)).toBe('');
    // Dim unhilited: B fades while A stays.
    h.render(camera, { dimUnhilited: true });
    const dimmed = clayFront().map((v, i) => v * 0.35 + (hex(BACKGROUND)[i] as number) * 0.65);
    expect(off(h.pixel(cornerB[0] + 3, cornerB[1] + 3), dimmed)).toBe('');
    // Back to object mode: surfaces again, no pickers.
    const model = h.app.session.getState().model;
    h.app.session.setState({ model: { ...model, componentMode: 'object' } });
    expect(h.display.editable()).toEqual([]);
    h.render(camera, { dimUnhilited: true });
    expect(off(h.pixel(...vertexA), hex(0xd17bff), 1)).not.toBe('');
    expect(off(h.pixel(cornerB[0] + 3, cornerB[1] + 3), clayFront())).toBe('');
  });

  it('picks up a runtime opened after the mode switch at the next pane render', async () => {
    const h = await setup();
    const camera = front();
    const a = createMesh(h.app, 'msh_A', primitive('cube', {}));
    const model = h.app.session.getState().model;
    h.app.session.setState({ model: { ...model, componentMode: 'face', lastComponentMode: 'face', hilite: [a] } });
    expect(h.display.editable()).toEqual([]);
    h.app.meshes.open(a);
    h.render(camera);
    expect(h.display.editable()).toEqual([a]);
    // Face mode: the front face's centre dot.
    expect(off(h.pixel(...screen(camera, [0, 0, 0.5])), hex(0xd17bff), 1)).toBe('');
  });

  it('hides hidden objects and follows per-pane isolate and face isolate', async () => {
    const h = await setup();
    const camera = front();
    const a = createMesh(h.app, 'msh_A', primitive('plane', { width: 2, height: 1, subdivisionsWidth: 2 }), {
      placement: { t: [0, 0, 0], q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], s: [1, 1, 1] },
    });
    const p = screen(camera, [-0.5, 0, 0]);
    const q = screen(camera, [0.5, 0, 0]);
    h.render(camera);
    expect(off(h.pixel(...p), hex(BACKGROUND), 1)).not.toBe('');
    let model = h.app.session.getState().model;
    h.app.session.setState({ model: { ...model, hiddenObjects: new Set([a]) } });
    h.render(camera);
    expect(off(h.pixel(...p), hex(BACKGROUND), 1)).toBe('');
    model = h.app.session.getState().model;
    h.app.session.setState({
      model: { ...model, hiddenObjects: new Set(), isolate: { 'pane-a': ['msh_other' as MeshId] } },
    });
    h.render(camera, {}, 'pane-a');
    expect(off(h.pixel(...p), hex(BACKGROUND), 1)).toBe('');
    h.render(camera, {}, 'pane-b');
    expect(off(h.pixel(...p), hex(BACKGROUND), 1)).not.toBe('');
    // Face isolate in face mode: only one face in pane-a.
    model = h.app.session.getState().model;
    h.app.session.setState({ model: { ...model, isolate: {} } });
    enterComponentMode(h.app, 'face', [a]);
    const data = h.app.meshes.get(a)?.data();
    const faces = new BitSet(data?.counts.faces ?? 0);
    // The face on the −X side: its centroid x < 0 in mesh space.
    const xs = Array.from({ length: 2 }, (_, f) => {
      const mesh = h.app.meshes.get(a)?.mesh;
      const start = mesh?.faceCorner(f) ?? 0;
      return mesh?.position[3 * (mesh?.cornerVert(start) ?? 0)] ?? 0;
    });
    faces.add((xs[0] as number) < (xs[1] as number) ? 0 : 1);
    h.display.setFaceIsolate('pane-a', a, faces);
    h.render(camera, {}, 'pane-a');
    expect(off(h.pixel(q[0], q[1] - 20), hex(BACKGROUND), 1)).toBe('');
    expect(off(h.pixel(p[0], p[1] - 20), hex(BACKGROUND), 1)).not.toBe('');
    h.render(camera, {}, 'pane-b');
    expect(off(h.pixel(q[0], q[1] - 20), hex(BACKGROUND), 1)).not.toBe('');
  });

  it('follows a new revision of a shown mesh and drops hosts on dispose', async () => {
    const h = await setup();
    const camera = front();
    const a = createMesh(h.app, 'msh_A', primitive('cube', {}));
    h.render(camera);
    const moved = primitive('cube', { width: 0.5, height: 0.5, depth: 0.5 });
    h.app.store.transact({ label: 'Write' }, (tx) => h.app.meshes.writeData(tx, a, moved));
    await (h.app.meshes as unknown as { settled?: () => Promise<void> }).settled?.();
    h.render(camera);
    expect(off(h.pixel(...screen(camera, [0.4, 0.4, 0.5])), hex(BACKGROUND), 1)).toBe('');
    expect(off(h.pixel(...screen(camera, [0.1, 0.1, 0.5])), clayFront())).toBe('');
    const before = h.invalidations;
    h.display.dispose();
    expect(h.hosts.size).toBe(0);
    expect(h.invalidations).toBeGreaterThan(before);
  });
});
