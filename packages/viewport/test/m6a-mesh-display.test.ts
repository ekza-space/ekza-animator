// The viewport's mesh display (M6A-SPEC §4.4, §4.7, §5.6, §5.23; B6): lazy loading of mesh-view, one host per mesh
// runtime through `addMeshLayer`, MeshSurface outside component mode, EditMeshView + picker for hilited open meshes,
// placements through groups, palette colours, hidden objects, per-pane isolate, "Dim unhilited", hover, face isolate,
// revisions written while shown, and the pane-flag mapping.
import type { Disposer, ReadonlyXf } from '@ekza-animator/anim-core';
import type { CharacterId, GroupId, MeshId, MeshRecord, MeshRef, PaletteId, SwatchId } from '@ekza-animator/doc';
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

function ndcOf(camera: Camera, p: readonly [number, number, number]): [number, number] {
  const [x, y] = screen(camera, p);
  return [(x / W) * 2 - 1, 1 - (y / H) * 2];
}

/** The world x of face f's vertex average (meshes placed without rotation about Y). */
function faceCentreX(app: EditorApp, id: MeshId, f: number): number {
  const mesh = app.meshes.get(id)?.mesh;
  if (mesh === null || mesh === undefined) throw new Error(`${id} is not open`);
  const start = mesh.faceCorner(f);
  let c = start;
  let x = 0;
  let n = 0;
  do {
    x += mesh.position[3 * mesh.cornerVert(c)] as number;
    n++;
    c = mesh.cornerNext(c);
  } while (c !== start);
  return x / n;
}

/** A plane standing in the XY plane (normal +Z, facing the front camera). */
const STANDING = { q: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const, s: [1, 1, 1] as const };

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
    const hit = h.display.pick(
      camera,
      ndc,
      { w: W, h: H },
      'vertex',
      { cameraBased: true, backfaces: false },
      'pane-persp',
    );
    expect(hit?.mesh).toBe(a);
    expect(hit?.point[0]).toBeCloseTo(-0.5, 5);
    const all = h.display.marquee(
      camera,
      { x0: 0, y0: 0, x1: W, y1: H },
      { w: W, h: H },
      'vertex',
      { cameraBased: false, backfaces: false },
      'pane-persp',
    );
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

  it('picks only what a pane draws: hidden objects, the pane object isolate and its face isolate', async () => {
    const h = await setup();
    const camera = front();
    const view = { w: W, h: H } as const;
    const opts = { cameraBased: true, backfaces: false } as const;
    const all = { cameraBased: false, backfaces: false } as const;
    const full = { x0: 0, y0: 0, x1: W, y1: H } as const;
    // A: two standing quads at x ∈ [−2.25, −0.25]; B: a cube at x ∈ [1, 2].
    const a = createMesh(h.app, 'msh_A', primitive('plane', { width: 2, height: 1, subdivisionsWidth: 2 }), {
      placement: { t: [-1.25, 0, 0], ...STANDING },
    });
    const b = createMesh(h.app, 'msh_B', primitive('cube', {}), {
      placement: { t: [1.5, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    enterComponentMode(h.app, 'face', [a, b]);
    expect([...h.display.editable()].sort()).toEqual([a, b]);
    const right = faceCentreX(h.app, a, 0) > faceCentreX(h.app, a, 1) ? 0 : 1;
    const left = 1 - right;
    const rightAt: [number, number, number] = [-0.75, 0.2, 0];
    const leftAt: [number, number, number] = [-1.75, 0.2, 0];
    const cubeAt: [number, number, number] = [1.5, 0.2, 0.5];
    const pick = (p: readonly [number, number, number], pane: string) =>
      h.display.pick(camera, ndcOf(camera, p), view, 'face', opts, pane);
    expect(pick(rightAt, 'pane-a')).toMatchObject({ mesh: a, index: right });
    expect(pick(cubeAt, 'pane-a')?.mesh).toBe(b);

    // Face isolate in pane-a: the right quad is neither drawn nor pickable there, and its own vertices and edges go
    // with it; pane-b is untouched.
    const isolated = new BitSet(2);
    isolated.add(left);
    h.display.setFaceIsolate('pane-a', a, isolated);
    h.render(camera, {}, 'pane-a');
    expect(off(h.pixel(...screen(camera, rightAt)), hex(BACKGROUND), 1)).toBe('');
    expect(pick(rightAt, 'pane-a')).toBeNull();
    expect(pick(leftAt, 'pane-a')).toMatchObject({ mesh: a, index: left });
    expect(h.display.marquee(camera, full, view, 'vertex', all, 'pane-a').get(a)).toHaveLength(4);
    expect(h.display.marquee(camera, full, view, 'edge', all, 'pane-a').get(a)).toHaveLength(4);
    expect(Array.from(h.display.marquee(camera, full, view, 'face', all, 'pane-a').get(a) ?? [])).toEqual([left]);
    expect(h.display.screenOf(a, camera, view, 'face', right, opts, 'pane-a')).toBeNull();
    expect(h.display.screenOf(a, camera, view, 'face', left, opts, 'pane-a')).not.toBeNull();
    h.render(camera, {}, 'pane-b');
    expect(off(h.pixel(...screen(camera, rightAt)), hex(BACKGROUND), 1)).not.toBe('');
    expect(pick(rightAt, 'pane-b')).toMatchObject({ mesh: a, index: right });
    expect(h.display.marquee(camera, full, view, 'vertex', all, 'pane-b').get(a)).toHaveLength(6);
    expect(h.display.screenOf(a, camera, view, 'face', right, opts, 'pane-b')).not.toBeNull();
    // In-place changes of the pushed set do not leak into the display (it keeps a copy).
    isolated.add(right);
    expect(pick(rightAt, 'pane-a')).toBeNull();

    // Object isolate in pane-b (only B): A is neither drawn nor pickable there.
    let model = h.app.session.getState().model;
    h.app.session.setState({ model: { ...model, isolate: { 'pane-b': [b] } } });
    h.render(camera, {}, 'pane-b');
    expect(off(h.pixel(...screen(camera, leftAt)), hex(BACKGROUND), 1)).toBe('');
    expect(pick(leftAt, 'pane-b')).toBeNull();
    expect(pick(cubeAt, 'pane-b')?.mesh).toBe(b);
    expect([...h.display.marquee(camera, full, view, 'vertex', all, 'pane-b').keys()]).toEqual([b]);
    expect(h.display.screenOf(a, camera, view, 'face', left, opts, 'pane-b')).toBeNull();
    expect(pick(leftAt, 'pane-a')).toMatchObject({ mesh: a, index: left });

    // Hidden objects: B is neither drawn nor pickable in any pane.
    model = h.app.session.getState().model;
    h.app.session.setState({ model: { ...model, isolate: {}, hiddenObjects: new Set([b]) } });
    for (const pane of ['pane-a', 'pane-b']) {
      h.render(camera, {}, pane);
      expect(off(h.pixel(...screen(camera, cubeAt)), hex(BACKGROUND), 1)).toBe('');
      expect(pick(cubeAt, pane)).toBeNull();
      expect(h.display.marquee(camera, full, view, 'face', all, pane).has(b)).toBe(false);
      expect(h.display.screenOf(b, camera, view, 'face', 0, all, pane)).toBeNull();
    }
    expect(pick(leftAt, 'pane-b')).toMatchObject({ mesh: a, index: left });
  });

  it('drops a face isolate set when a new revision changes the face count', async () => {
    const h = await setup();
    const camera = front();
    const a = createMesh(h.app, 'msh_A', primitive('plane', { width: 2, height: 1, subdivisionsWidth: 2 }), {
      placement: { t: [0, 0, 0], ...STANDING },
    });
    enterComponentMode(h.app, 'face', [a]);
    const isolated = new BitSet(2);
    isolated.add(faceCentreX(h.app, a, 0) < 0 ? 0 : 1);
    h.display.setFaceIsolate('pane-a', a, isolated);
    const opts = { cameraBased: true, backfaces: false } as const;
    expect(h.display.pick(camera, ndcOf(camera, [0.5, 0.2, 0]), { w: W, h: H }, 'face', opts, 'pane-a')).toBeNull();
    // Four quads now: the two-face set would name the wrong faces, so pane-a draws and picks every face again.
    const four = primitive('plane', { width: 2, height: 1, subdivisionsWidth: 4 });
    h.app.store.transact({ label: 'Write' }, (tx) => h.app.meshes.writeData(tx, a, four));
    await (h.app.meshes as unknown as { settled?: () => Promise<void> }).settled?.();
    expect(h.app.meshes.get(a)?.mesh?.counts.faces).toBe(4);
    h.render(camera, {}, 'pane-a');
    expect(off(h.pixel(...screen(camera, [0.75, 0.2, 0])), hex(BACKGROUND), 1)).not.toBe('');
    const hit = h.display.pick(camera, ndcOf(camera, [0.75, 0.2, 0]), { w: W, h: H }, 'face', opts, 'pane-a');
    expect(hit?.mesh).toBe(a);
    expect(faceCentreX(h.app, a, hit?.index ?? -1)).toBeCloseTo(0.75, 5);
  });

  it('hosts character-owned meshes only in Model; props in every workspace (§5.23)', async () => {
    const h = await setup();
    const camera = front();
    const propAt = screen(camera, [-1.5, 0.1, 0.5]);
    const bodyAt = screen(camera, [1.5, 0.1, 0.5]);
    createMesh(h.app, 'msh_P', primitive('cube', {}), {
      placement: { t: [-1.5, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    const body = createMesh(h.app, 'msh_C', primitive('cube', {}), {
      owner: { character: 'chr_A' as CharacterId },
      placement: { t: [1.5, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    expect(h.app.meshes.get(body)?.state).toBe('ready');
    expect(h.app.session.getState().workspace).toBe('animate');
    expect(h.hosts.size).toBe(1);
    h.render(camera);
    expect(off(h.pixel(...propAt), clayFront())).toBe('');
    expect(off(h.pixel(...bodyAt), hex(BACKGROUND), 1)).toBe('');
    h.app.session.setState({ workspace: 'model' });
    expect(h.hosts.size).toBe(2);
    h.render(camera);
    expect(off(h.pixel(...bodyAt), clayFront())).toBe('');
    // Component mode on the character's mesh in Model, then leaving Model drops its host again.
    enterComponentMode(h.app, 'vertex', [body]);
    expect(h.display.editable()).toEqual([body]);
    const model = h.app.session.getState().model;
    h.app.session.setState({ workspace: 'review', model: { ...model, componentMode: 'object' } });
    expect(h.hosts.size).toBe(1);
    expect(h.display.editable()).toEqual([]);
    h.render(camera);
    expect(off(h.pixel(...bodyAt), hex(BACKGROUND), 1)).toBe('');
    expect(off(h.pixel(...propAt), clayFront())).toBe('');
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
