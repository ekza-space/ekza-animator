// ComponentPicker (M6A-SPEC §4.4, §5.6): vertex/edge/face picking on fixed cameras, depth order, occlusion (by the mesh
// itself and by the meshes around it), back faces, the wire-shading dot rule, hidden elements, a pane's face isolate,
// marquee counts and Maya's edge rule, transforms, BVH refit and rebuild, and a randomized check of vertex and face
// picks against three.js's own raycaster over the same triangles.
import { BitSet, type HiddenSet, triangulate } from '@ekza-studio/mesh-core';
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  DoubleSide,
  Euler,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { ComponentPicker, MeshSurface, PICK_RADIUS, type PickOptionsInput } from '../src';
import type { PickOptions } from '../src/types';
import {
  centroidOf,
  cube,
  type Derived,
  edgeBetween,
  faceFacing,
  IDENTITY,
  LAYERS,
  matrixOf,
  ndc,
  orthoFront,
  orthoTop,
  perspective,
  plane,
  prng,
  screen,
  THEME,
  vertexAt,
  vertexOf,
} from './support';

const W = 400;
const H = 300;
const VIEW = { w: W, h: H } as const;
const CAMERA_BASED: PickOptions = { cameraBased: true, backfaces: false, hidden: null };
/** Camera-based selection off without back faces (wire shading's picks without the dot rule). */
const NO_OCCLUSION: PickOptions = { cameraBased: false, backfaces: false, hidden: null };
/** X-ray: camera-based off, back faces pickable (the caller passes `backfaces = xray || option`, §5.6). */
const XRAY: PickOptions = { cameraBased: false, backfaces: true, hidden: null };
/** Wire shading: camera-based off, faces by their centre dot only. */
const WIRE: PickOptionsInput = { cameraBased: false, backfaces: false, hidden: null, wire: true };

let picker: ComponentPicker | null = null;
afterEach(() => {
  picker?.dispose();
  picker = null;
});

function pickerFor(d: Derived, world: Float64Array = IDENTITY): ComponentPicker {
  picker = new ComponentPicker();
  picker.setMesh(d.mesh, d.tri, world, true);
  return picker;
}

function hiddenFaces(d: Derived, faces: readonly number[]): HiddenSet {
  const h: HiddenSet = {
    verts: new BitSet(d.mesh.counts.points),
    edges: new BitSet(d.mesh.counts.edges),
    faces: new BitSet(d.mesh.counts.faces),
  };
  for (const f of faces) h.faces.add(f);
  return h;
}

function ndcOf(x: number, y: number): [number, number] {
  return ndc(x, y, W, H);
}

function at(camera: Camera, p: readonly [number, number, number], dx = 0, dy = 0): [number, number] {
  const [x, y] = screen(camera, p, W, H);
  return ndc(x + dx, y + dy, W, H);
}

const BACK: [number, number, number] = [-0.5, -0.5, -0.5];

/** The front orthographic view from behind (looking along +Z). */
function orthoBack(height = 4): Camera {
  const camera = orthoFront(height);
  camera.position.set(0, 0, -10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function hiding(d: Derived, kind: 'verts' | 'edges', index: number): HiddenSet {
  const h = hiddenFaces(d, []);
  h[kind].add(index);
  return h;
}

describe('ComponentPicker: vertices', () => {
  it('picks every visible cube vertex at its projection and none of the occluded one (camera-based)', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = perspective([2, 1.5, 3]);
    const hidden = vertexAt(d, BACK);
    expect(p.hover(camera, at(camera, BACK), VIEW, 'vertex', CAMERA_BASED)).toBeNull();
    for (let v = 0; v < 8; v++) {
      if (v === hidden) continue;
      const hit = p.hover(camera, at(camera, vertexOf(d, v)), VIEW, 'vertex', CAMERA_BASED);
      expect(hit?.index).toBe(v);
      expect(hit?.kind).toBe('vertex');
      expect(hit?.t).toBeNull();
      expect(hit?.distancePx).toBeLessThan(1e-3);
      for (let k = 0; k < 3; k++) expect(hit?.point[k]).toBeCloseTo(vertexOf(d, v)[k] as number, 6);
    }
    // Camera-based selection off (wire, x-ray): the vertex behind the cube is pickable.
    expect(p.hover(camera, at(camera, BACK), VIEW, 'vertex', NO_OCCLUSION)?.index).toBe(hidden);
  });

  it('uses the 8 px radius by default and honours radiusPx', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = orthoFront(4);
    const v = vertexAt(d, [0.5, 0.5, 0.5]);
    expect(p.hover(camera, at(camera, vertexOf(d, v), 7.5, 0), VIEW, 'vertex', CAMERA_BASED)?.index).toBe(v);
    expect(p.hover(camera, at(camera, vertexOf(d, v), 8.5, 0), VIEW, 'vertex', CAMERA_BASED)).toBeNull();
    expect(
      p.hover(camera, at(camera, vertexOf(d, v), 11, 0), VIEW, 'vertex', { ...CAMERA_BASED, radiusPx: 12 })?.index,
    ).toBe(v);
    expect(PICK_RADIUS).toEqual({ vertex: 8, edge: 6, face: 8 });
  });

  it('prefers the nearer of two vertices projecting onto the same point (front ortho view)', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = orthoFront(4);
    const front = vertexAt(d, [0.5, 0.5, 0.5]);
    const back = vertexAt(d, [0.5, 0.5, -0.5]);
    const pointer = at(camera, vertexOf(d, front));
    // Camera-based off: both project to the same pixel at the same distance; the nearer one wins …
    const hit = p.hover(camera, pointer, VIEW, 'vertex', NO_OCCLUSION);
    expect(hit?.index).toBe(front);
    expect(hit?.distancePx).toBeLessThan(1e-3);
    // … the back one is a candidate there: with the front one hidden it is the pick, at the same distance …
    const behindIt = p.hover(camera, pointer, VIEW, 'vertex', { ...NO_OCCLUSION, hidden: hiding(d, 'verts', front) });
    expect(behindIt?.index).toBe(back);
    expect(behindIt?.distancePx).toBeLessThan(1e-3);
    // … and seen from behind the order flips: depth decides, not the index.
    const behind = orthoBack();
    expect(p.hover(behind, at(behind, vertexOf(d, back)), VIEW, 'vertex', NO_OCCLUSION)?.index).toBe(back);
    // Off axis the back vertex lies behind the front face: camera-based picks nothing at its projection.
    const persp = perspective([0.3, 0.2, 3]);
    expect(p.hover(persp, at(persp, vertexOf(d, back)), VIEW, 'vertex', CAMERA_BASED)).toBeNull();
    expect(p.hover(persp, at(persp, vertexOf(d, back)), VIEW, 'vertex', NO_OCCLUSION)?.index).toBe(back);
  });

  it('never picks hidden vertices, and hiding faces takes the vertices only they use along', () => {
    const d = plane({ subdivisionsWidth: 2, subdivisionsHeight: 1, width: 2 });
    const p = pickerFor(d);
    const camera = orthoTop(3);
    // Faces: two quads side by side; hide the one at x > 0.
    const right = centroidOf(d, 0)[0] > 0 ? 0 : 1;
    const corner = vertexAt(d, [1, 0, -0.5]);
    const shared = vertexAt(d, [0, 0, -0.5]);
    const hidden = hiddenFaces(d, [right]);
    const opts = { ...CAMERA_BASED, hidden };
    expect(p.hover(camera, at(camera, vertexOf(d, corner)), VIEW, 'vertex', opts)).toBeNull();
    expect(p.hover(camera, at(camera, vertexOf(d, shared)), VIEW, 'vertex', opts)?.index).toBe(shared);
    expect(p.isVisible('vertex', corner)).toBe(false);
    expect(p.isVisible('face', right)).toBe(false);
    // A hidden vertex bit hides the vertex itself.
    const h2: HiddenSet = { ...hiddenFaces(d, []), verts: new BitSet(d.mesh.counts.points) };
    h2.verts.add(shared);
    expect(
      p.hover(camera, at(camera, vertexOf(d, shared)), VIEW, 'vertex', { ...CAMERA_BASED, hidden: h2 }),
    ).toBeNull();
    // Showing everything again makes both pickable.
    expect(p.hover(camera, at(camera, vertexOf(d, corner)), VIEW, 'vertex', CAMERA_BASED)?.index).toBe(corner);
  });

  it('follows the world matrix', () => {
    const d = cube();
    const m = new Matrix4()
      .makeTranslation(1.5, -0.25, 0.5)
      .multiply(new Matrix4().makeRotationY(0.4))
      .multiply(new Matrix4().makeScale(2, 2, 2));
    const p = pickerFor(d, matrixOf(m));
    const camera = perspective([5, 4, 7]);
    const v = vertexAt(d, [0.5, 0.5, 0.5]);
    const wp = new Vector3(...vertexOf(d, v)).applyMatrix4(m);
    const hit = p.hover(camera, at(camera, [wp.x, wp.y, wp.z]), VIEW, 'vertex', CAMERA_BASED);
    expect(hit?.index).toBe(v);
    expect(hit?.point[0]).toBeCloseTo(wp.x, 5);
    expect(hit?.point[1]).toBeCloseTo(wp.y, 5);
    expect(hit?.point[2]).toBeCloseTo(wp.z, 5);
  });

  it('refits after a position commit and rebuilds after a topology change', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = orthoFront(4);
    const v = vertexAt(d, [0.5, 0.5, 0.5]);
    expect(p.hover(camera, at(camera, [0.5, 0.5, 0.5]), VIEW, 'vertex', CAMERA_BASED)?.index).toBe(v);
    d.mesh.begin('test.move');
    d.mesh.setPosition(v, 0.9, 0.9, 0.5);
    d.mesh.end();
    p.setMesh(d.mesh, triangulate(d.mesh), IDENTITY, false);
    expect(p.bvhReady).toBe(false);
    expect(p.hover(camera, at(camera, [0.9, 0.9, 0.5]), VIEW, 'vertex', CAMERA_BASED)?.index).toBe(v);
    expect(p.bvhReady).toBe(true);
    // The old position is empty now (the nearest other vertex is far away).
    expect(p.hover(camera, at(camera, [0.5, 0.5, 0.5]), VIEW, 'vertex', CAMERA_BASED)).toBeNull();
    // A new mesh (topology commit) rebuilds everything.
    const other = plane();
    p.setMesh(other.mesh, other.tri, IDENTITY, true);
    p.prepareBvh(null);
    expect(p.bvhReady).toBe(true);
  });
});

describe('ComponentPicker: edges', () => {
  it('picks each visible edge with its parameter t from edgeVert(e, 0)', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = perspective([2, 1.5, 3]);
    const back = vertexAt(d, BACK);
    let checked = 0;
    for (let e = 0; e < d.mesh.counts.edges; e++) {
      const a = d.mesh.edgeVert(e, 0);
      const b = d.mesh.edgeVert(e, 1);
      if (a === back || b === back) continue;
      for (const t of [0.3, 0.5, 0.8]) {
        const pa = vertexOf(d, a);
        const pb = vertexOf(d, b);
        const point: [number, number, number] = [0, 1, 2].map(
          (k) => (pa[k] as number) * (1 - t) + (pb[k] as number) * t,
        ) as [number, number, number];
        const hit = p.hover(camera, at(camera, point), VIEW, 'edge', CAMERA_BASED);
        expect(hit?.index).toBe(e);
        expect(hit?.t).toBeCloseTo(t, 4);
        for (let k = 0; k < 3; k++) expect(hit?.point[k]).toBeCloseTo(point[k] as number, 4);
        checked++;
      }
    }
    expect(checked).toBe(9 * 3);
  });

  it('uses the 6 px edge radius and leaves occluded edges out', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = orthoFront(4);
    // The top front edge, seen edge-on from the front: offset 5 px above it is a hit, 7 px is not.
    const a = vertexAt(d, [-0.5, 0.5, 0.5]);
    const b = vertexAt(d, [0.5, 0.5, 0.5]);
    const e = edgeBetween(d, a, b);
    expect(p.hover(camera, at(camera, [0.1, 0.5, 0.5], 0, -5), VIEW, 'edge', CAMERA_BASED)?.index).toBe(e);
    expect(p.hover(camera, at(camera, [0.1, 0.5, 0.5], 0, -7), VIEW, 'edge', CAMERA_BASED)).toBeNull();
    // The top back edge projects onto the same line: the nearer edge wins at the same distance …
    const back = edgeBetween(d, vertexAt(d, [-0.5, 0.5, -0.5]), vertexAt(d, [0.5, 0.5, -0.5]));
    const onLine = at(camera, [0.1, 0.5, 0.5], 0, -3);
    expect(p.hover(camera, onLine, VIEW, 'edge', NO_OCCLUSION)?.index).toBe(e);
    // … the back one is a candidate there (the pick once the front one is hidden) …
    const behindIt = p.hover(camera, onLine, VIEW, 'edge', { ...NO_OCCLUSION, hidden: hiding(d, 'edges', e) });
    expect(behindIt?.index).toBe(back);
    expect(behindIt?.distancePx).toBeCloseTo(3, 3);
    // … and from behind the order flips.
    const behind = orthoBack();
    expect(p.hover(behind, at(behind, [0.1, 0.5, -0.5], 0, -3), VIEW, 'edge', NO_OCCLUSION)?.index).toBe(back);
    // From above-front the back-bottom edge is hidden behind the cube.
    const cam2 = perspective([0.3, 2, 3]);
    const hidden = edgeBetween(d, vertexAt(d, [-0.5, -0.5, -0.5]), vertexAt(d, [0.5, -0.5, -0.5]));
    expect(p.hover(cam2, at(cam2, [0.1, -0.5, -0.5]), VIEW, 'edge', CAMERA_BASED)).toBeNull();
    expect(p.hover(cam2, at(cam2, [0.1, -0.5, -0.5]), VIEW, 'edge', NO_OCCLUSION)?.index).toBe(hidden);
  });

  it('picks an edge with an end behind the camera by the part the pane draws (clipped at the near plane)', () => {
    // A long 1.2 × 4 m floor quad; the camera hovers over it at z = 1.5, so its side edges run from z = −2 in front
    // of the camera to z = 2 behind it (the line shader trims them at the near plane and draws the rest).
    const d = plane({ width: 1.2, height: 4 });
    const p = pickerFor(d);
    const camera = perspective([0, 0.3, 1.5]);
    const far = vertexAt(d, [0.6, 0, -2]);
    const near = vertexAt(d, [0.6, 0, 2]);
    const e = edgeBetween(d, far, near);
    const z0 = vertexOf(d, d.mesh.edgeVert(e, 0))[2];
    const z1 = vertexOf(d, d.mesh.edgeVert(e, 1))[2];
    for (const opts of [CAMERA_BASED, NO_OCCLUSION]) {
      for (const z of [-1, 0]) {
        const hit = p.hover(camera, at(camera, [0.6, 0, z]), VIEW, 'edge', opts);
        expect(hit?.index).toBe(e);
        expect(hit?.t).toBeCloseTo((z - z0) / (z1 - z0), 4);
        expect(hit?.point[2]).toBeCloseTo(z, 4);
        expect(hit?.distancePx).toBeLessThan(1e-3);
      }
      // 7 px beside the drawn part: outside the 6 px radius.
      const [x, y] = screen(camera, [0.6, 0, -1], W, H);
      const beside = new Vector3(0.6, 0, -1).project(camera);
      const along = new Vector3(0.6, 0, 0).project(camera);
      const dir = new Vector2((along.x - beside.x) * W, (beside.y - along.y) * H).normalize();
      expect(p.hover(camera, ndcOf(x - 7 * dir.y, y + 7 * dir.x), VIEW, 'edge', opts)).toBeNull();
    }
    // The edge whose ends both lie behind the camera is never a candidate; the far edge still is.
    const back = edgeBetween(d, vertexAt(d, [-0.6, 0, 2]), near);
    const front = edgeBetween(d, vertexAt(d, [-0.6, 0, -2]), far);
    for (let k = 0; k < 40; k++) {
      const hit = p.hover(camera, ndcOf((k / 39) * W, (k % 7) * (H / 6)), VIEW, 'edge', NO_OCCLUSION);
      expect(hit?.index).not.toBe(back);
    }
    expect(p.hover(camera, at(camera, [0.1, 0, -2]), VIEW, 'edge', NO_OCCLUSION)?.index).toBe(front);
    // The marquee keeps Maya's rule: an end behind the camera is not inside any rectangle.
    expect(Array.from(p.marquee(camera, { x0: 0, y0: 0, x1: W, y1: H }, VIEW, 'edge', NO_OCCLUSION))).toEqual([front]);
  });
});

describe('ComponentPicker: faces', () => {
  it('picks the face under the pointer by ray hit', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = perspective([2, 1.5, 3]);
    for (const dir of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const) {
      const f = faceFacing(d, dir);
      const hit = p.hover(camera, at(camera, centroidOf(d, f)), VIEW, 'face', CAMERA_BASED);
      expect(hit?.index).toBe(f);
      expect(hit?.t).toBeNull();
      for (let k = 0; k < 3; k++) expect(hit?.point[k]).toBeCloseTo(centroidOf(d, f)[k] as number, 4);
    }
    // Off the mesh: nothing.
    expect(p.hover(camera, ndc(5, 5, W, H), VIEW, 'face', CAMERA_BASED)).toBeNull();
  });

  it('back faces are pickable only with backfaces, in every shading (x-ray passes it, §5.6)', () => {
    const d = plane();
    const p = pickerFor(d);
    const below = perspective([0.4, -3, 0.5]);
    const centre = at(below, [0, 0, 0]);
    const full = { x0: 0, y0: 0, x1: W, y1: H } as const;
    expect(p.hover(below, centre, VIEW, 'face', CAMERA_BASED)).toBeNull();
    expect(p.hover(below, centre, VIEW, 'face', { ...CAMERA_BASED, backfaces: true })?.index).toBe(0);
    // Camera-based off: neither the dot nor the ray picks the back of the face without `backfaces` …
    expect(p.hover(below, centre, VIEW, 'face', NO_OCCLUSION)).toBeNull();
    expect(p.hover(below, centre, VIEW, 'face', WIRE)).toBeNull();
    expect(p.marquee(below, full, VIEW, 'face', NO_OCCLUSION)).toHaveLength(0);
    expect(p.screenOf(below, VIEW, 'face', 0, NO_OCCLUSION)).toBeNull();
    // … x-ray (and the Backfaces option) does.
    expect(p.hover(below, centre, VIEW, 'face', XRAY)?.index).toBe(0);
    expect(p.hover(below, centre, VIEW, 'face', { ...WIRE, backfaces: true })?.index).toBe(0);
    expect(Array.from(p.marquee(below, full, VIEW, 'face', XRAY))).toEqual([0]);
    expect(p.screenOf(below, VIEW, 'face', 0, XRAY)).not.toBeNull();
    // Vertices and edges have no back.
    expect(p.marquee(below, full, VIEW, 'vertex', NO_OCCLUSION)).toHaveLength(4);
    const above = perspective([0.4, 3, 0.5]);
    for (const opts of [CAMERA_BASED, NO_OCCLUSION, WIRE, XRAY]) {
      expect(p.hover(above, at(above, [0, 0, 0]), VIEW, 'face', opts)?.index).toBe(0);
    }
  });

  it('hidden faces are neither picked nor occluding', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = orthoFront(4);
    const front = faceFacing(d, [0, 0, 1]);
    const back = faceFacing(d, [0, 0, -1]);
    const hidden = hiddenFaces(d, [front]);
    // Through the hole the back face shows its inside (a back face): not pickable camera-based …
    expect(p.hover(camera, at(camera, [0, 0, 0.5]), VIEW, 'face', { ...CAMERA_BASED, hidden })).toBeNull();
    // … pickable with backfaces, and never the hidden face.
    expect(
      p.hover(camera, at(camera, [0, 0, 0.5]), VIEW, 'face', { ...CAMERA_BASED, hidden, backfaces: true })?.index,
    ).toBe(back);
    // Vertices of the back face are no longer occluded by the hidden front face.
    const v = vertexAt(d, [0.5, 0.5, -0.5]);
    const persp = perspective([0.2, 0.1, 3]);
    expect(p.hover(persp, at(persp, vertexOf(d, v)), VIEW, 'vertex', CAMERA_BASED)).toBeNull();
    expect(p.hover(persp, at(persp, vertexOf(d, v)), VIEW, 'vertex', { ...CAMERA_BASED, hidden })?.index).toBe(v);
  });

  it('camera-based off picks a face by its centre dot within 8 px before the ray', () => {
    const d = plane({ width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 });
    const p = pickerFor(d);
    const camera = orthoTop(3);
    for (let f = 0; f < 4; f++) {
      const c = centroidOf(d, f);
      expect(p.hover(camera, at(camera, c, 6, 0), VIEW, 'face', NO_OCCLUSION)?.index).toBe(f);
      expect(p.hover(camera, at(camera, c, 6, 0), VIEW, 'face', NO_OCCLUSION)?.distancePx).toBeCloseTo(6, 3);
    }
  });

  it('wire shading picks a face by its centre dot only (§5.6)', () => {
    const d = plane({ width: 2, height: 2, subdivisionsWidth: 2, subdivisionsHeight: 2 });
    const p = pickerFor(d);
    const camera = orthoTop(3);
    for (let f = 0; f < 4; f++) {
      const c = centroidOf(d, f);
      expect(p.hover(camera, at(camera, c, 6, 0), VIEW, 'face', WIRE)).toMatchObject({ index: f, kind: 'face' });
      expect(p.hover(camera, at(camera, c, 0, 7.5), VIEW, 'face', WIRE)?.distancePx).toBeCloseTo(7.5, 3);
      // 30 px from the dot, well inside the face (100 px across): the ray would hit it, the dot rule does not.
      expect(p.hover(camera, at(camera, c, 30, 30), VIEW, 'face', NO_OCCLUSION)?.index).toBe(f);
      expect(p.hover(camera, at(camera, c, 30, 30), VIEW, 'face', WIRE)).toBeNull();
      // Its screen point is the dot.
      const q = p.screenOf(camera, VIEW, 'face', f, WIRE);
      const expected = screen(camera, c, W, H);
      expect(q?.x).toBeCloseTo(expected[0], 3);
      expect(q?.y).toBeCloseTo(expected[1], 3);
    }
    expect(p.hover(camera, at(camera, centroidOf(d, 0), 6, 0), VIEW, 'face', { ...WIRE, radiusPx: 4 })).toBeNull();
  });

  it('wire shading with camera-based selection forced on skips occluded dots', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = perspective([0.15, 0.1, 6]);
    const front = faceFacing(d, [0, 0, 1]);
    const back = faceFacing(d, [0, 0, -1]);
    const forced: PickOptionsInput = { ...WIRE, cameraBased: true, backfaces: true };
    // Both dots project within 3 px of each other; the back one lies behind the front face.
    expect(p.hover(camera, at(camera, centroidOf(d, back)), VIEW, 'face', forced)?.index).toBe(front);
    expect(p.hover(camera, at(camera, centroidOf(d, back)), VIEW, 'face', { ...WIRE, backfaces: true })?.index).toBe(
      back,
    );
  });

  it('raycastFace takes a world ray and the mesh transform', () => {
    const d = cube();
    const m = new Matrix4().makeTranslation(0, 2, 0).multiply(new Matrix4().makeScale(3, 1, 1));
    const p = pickerFor(d, matrixOf(m));
    const top = faceFacing(d, [0, 1, 0]);
    const hit = p.raycastFace(new Ray(new Vector3(1, 10, 0.2), new Vector3(0, -1, 0)), CAMERA_BASED);
    expect(hit?.face).toBe(top);
    expect(hit?.point[0]).toBeCloseTo(1, 5);
    expect(hit?.point[1]).toBeCloseTo(2.5, 5);
    expect(hit?.point[2]).toBeCloseTo(0.2, 5);
    expect(p.raycastFace(new Ray(new Vector3(2, 10, 0), new Vector3(0, -1, 0)), CAMERA_BASED)).toBeNull();
  });
});

describe("ComponentPicker: face isolate (a pane's view.isolate)", () => {
  it('never picks faces outside the isolate set, nor the edges and vertices only they use', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const p = pickerFor(d);
    const camera = orthoTop(3);
    const full = { x0: 0, y0: 0, x1: W, y1: H } as const;
    const left = centroidOf(d, 0)[0] < 0 ? 0 : 1;
    const right = 1 - left;
    const corner = vertexAt(d, [1, 0, -0.5]);
    const shared = vertexAt(d, [0, 0, -0.5]);
    const outer = edgeBetween(d, corner, vertexAt(d, [1, 0, 0.5]));
    const only = new BitSet(d.mesh.counts.faces);
    only.add(left);
    p.setIsolate(only);
    expect(p.hover(camera, at(camera, centroidOf(d, right)), VIEW, 'face', CAMERA_BASED)).toBeNull();
    expect(p.hover(camera, at(camera, centroidOf(d, right)), VIEW, 'face', NO_OCCLUSION)).toBeNull();
    expect(p.hover(camera, at(camera, centroidOf(d, left)), VIEW, 'face', CAMERA_BASED)?.index).toBe(left);
    expect(p.hover(camera, at(camera, vertexOf(d, corner)), VIEW, 'vertex', CAMERA_BASED)).toBeNull();
    expect(p.hover(camera, at(camera, vertexOf(d, shared)), VIEW, 'vertex', CAMERA_BASED)?.index).toBe(shared);
    expect(p.hover(camera, at(camera, [1, 0, 0]), VIEW, 'edge', CAMERA_BASED)).toBeNull();
    expect(p.marquee(camera, full, VIEW, 'vertex', NO_OCCLUSION)).toHaveLength(4);
    expect(p.marquee(camera, full, VIEW, 'edge', NO_OCCLUSION)).toHaveLength(4);
    expect(Array.from(p.marquee(camera, full, VIEW, 'face', NO_OCCLUSION))).toEqual([left]);
    expect(p.screenOf(camera, VIEW, 'face', right, CAMERA_BASED)).toBeNull();
    expect(p.isVisible('edge', outer)).toBe(false);
    // The hidden set applies on top of the isolate set.
    expect(
      p.hover(camera, at(camera, centroidOf(d, left)), VIEW, 'face', {
        ...CAMERA_BASED,
        hidden: hiddenFaces(d, [left]),
      }),
    ).toBeNull();
    // The picker keeps a copy: an in-place change takes another call.
    only.add(right);
    expect(p.hover(camera, at(camera, centroidOf(d, right)), VIEW, 'face', CAMERA_BASED)).toBeNull();
    p.setIsolate(only);
    expect(p.hover(camera, at(camera, centroidOf(d, right)), VIEW, 'face', CAMERA_BASED)?.index).toBe(right);
    // A set of another face count isolates nothing; null ends the isolate.
    p.setIsolate(new BitSet(5));
    expect(p.marquee(camera, full, VIEW, 'face', NO_OCCLUSION)).toHaveLength(2);
    only.delete(right);
    p.setIsolate(only);
    expect(p.marquee(camera, full, VIEW, 'face', NO_OCCLUSION)).toHaveLength(1);
    p.setIsolate(null);
    expect(p.marquee(camera, full, VIEW, 'vertex', NO_OCCLUSION)).toHaveLength(6);
    // A topology change drops a set of the old face count.
    p.setIsolate(only);
    const four = plane({ width: 2, height: 1, subdivisionsWidth: 4, subdivisionsHeight: 1 });
    p.setMesh(four.mesh, four.tri, IDENTITY, true);
    expect(p.marquee(camera, full, VIEW, 'face', NO_OCCLUSION)).toHaveLength(4);
  });
});

describe('ComponentPicker: marquee', () => {
  const full = { x0: 0, y0: 0, x1: W, y1: H } as const;

  it('counts what the camera sees of a cube (camera-based) and everything without occlusion', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = perspective([2, 1.5, 3]);
    expect(p.marquee(camera, full, VIEW, 'vertex', CAMERA_BASED)).toHaveLength(7);
    expect(p.marquee(camera, full, VIEW, 'edge', CAMERA_BASED)).toHaveLength(9);
    expect(p.marquee(camera, full, VIEW, 'face', CAMERA_BASED)).toHaveLength(3);
    expect(p.marquee(camera, full, VIEW, 'face', { ...CAMERA_BASED, backfaces: true })).toHaveLength(3);
    expect(p.marquee(camera, full, VIEW, 'vertex', NO_OCCLUSION)).toHaveLength(8);
    expect(p.marquee(camera, full, VIEW, 'edge', NO_OCCLUSION)).toHaveLength(12);
    // Camera-based off: every face dot facing the camera (wire), or every one with back faces (x-ray).
    expect(p.marquee(camera, full, VIEW, 'face', NO_OCCLUSION)).toHaveLength(3);
    expect(p.marquee(camera, full, VIEW, 'face', XRAY)).toHaveLength(6);
    const faces = Array.from(p.marquee(camera, full, VIEW, 'face', CAMERA_BASED));
    const byIndex = (a: number, b: number): number => a - b;
    expect(faces.sort(byIndex)).toEqual(
      [faceFacing(d, [1, 0, 0]), faceFacing(d, [0, 1, 0]), faceFacing(d, [0, 0, 1])].sort(byIndex),
    );
  });

  it('selects an edge only when both projected endpoints are inside (Maya)', () => {
    const d = plane({ width: 10, height: 10, subdivisionsWidth: 10, subdivisionsHeight: 10 });
    const p = pickerFor(d);
    const camera = orthoTop(12);
    const [x0, y0] = screen(camera, [-1.2, 0, -1.2], W, H);
    const [x1, y1] = screen(camera, [1.2, 0, 1.2], W, H);
    const rect = { x0, y0, x1, y1 };
    expect(p.marquee(camera, rect, VIEW, 'vertex', CAMERA_BASED)).toHaveLength(9);
    expect(p.marquee(camera, rect, VIEW, 'edge', CAMERA_BASED)).toHaveLength(12);
    expect(p.marquee(camera, rect, VIEW, 'face', CAMERA_BASED)).toHaveLength(4);
    // Reversed corners select the same.
    expect(Array.from(p.marquee(camera, { x0: x1, y0: y1, x1: x0, y1: y0 }, VIEW, 'edge', CAMERA_BASED))).toEqual(
      Array.from(p.marquee(camera, rect, VIEW, 'edge', CAMERA_BASED)),
    );
    // A rectangle around one endpoint of an edge selects the vertex but not the edge.
    const a = vertexAt(d, [0, 0, 0]);
    const b = vertexAt(d, [1, 0, 0]);
    const e = edgeBetween(d, a, b);
    const [ax, ay] = screen(camera, [0, 0, 0], W, H);
    const one = { x0: ax - 5, y0: ay - 5, x1: ax + 5, y1: ay + 5 };
    expect(Array.from(p.marquee(camera, one, VIEW, 'vertex', CAMERA_BASED))).toEqual([a]);
    expect(Array.from(p.marquee(camera, one, VIEW, 'edge', CAMERA_BASED))).not.toContain(e);
    const [bx, by] = screen(camera, [1, 0, 0], W, H);
    const both = { x0: ax - 5, y0: ay - 5, x1: bx + 5, y1: by + 5 };
    expect(Array.from(p.marquee(camera, both, VIEW, 'edge', CAMERA_BASED))).toEqual([e]);
  });

  it('leaves hidden components out', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = perspective([2, 1.5, 3]);
    const top = faceFacing(d, [0, 1, 0]);
    const hidden = hiddenFaces(d, [top]);
    const faces = Array.from(p.marquee(camera, full, VIEW, 'face', { ...CAMERA_BASED, hidden }));
    expect(faces).not.toContain(top);
    // Without the top face the two other front faces stay; the inside of the bottom face looks away from the camera.
    expect(faces).toHaveLength(2);
    expect(p.marquee(camera, full, VIEW, 'face', { ...NO_OCCLUSION, hidden })).toHaveLength(2);
    expect(p.marquee(camera, full, VIEW, 'face', { ...XRAY, hidden })).toHaveLength(5);
  });
});

describe('ComponentPicker: screenOf', () => {
  it('projects visible components and answers null for occluded, hidden and off-screen ones', () => {
    const d = cube();
    const p = pickerFor(d);
    const camera = perspective([2, 1.5, 3]);
    const v = vertexAt(d, [0.5, 0.5, 0.5]);
    const s = p.screenOf(camera, VIEW, 'vertex', v, CAMERA_BASED);
    const expected = screen(camera, vertexOf(d, v), W, H);
    expect(s?.x).toBeCloseTo(expected[0], 3);
    expect(s?.y).toBeCloseTo(expected[1], 3);
    expect(p.screenOf(camera, VIEW, 'vertex', vertexAt(d, BACK), CAMERA_BASED)).toBeNull();
    expect(p.screenOf(camera, VIEW, 'vertex', vertexAt(d, BACK), NO_OCCLUSION)).not.toBeNull();
    // Every visible face has a point that hovers back to it.
    for (const dir of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const) {
      const f = faceFacing(d, dir);
      const q = p.screenOf(camera, VIEW, 'face', f, CAMERA_BASED);
      expect(q).not.toBeNull();
      expect(p.hover(camera, ndc(q?.x ?? 0, q?.y ?? 0, W, H), VIEW, 'face', CAMERA_BASED)?.index).toBe(f);
    }
    expect(p.screenOf(camera, VIEW, 'face', faceFacing(d, [0, -1, 0]), CAMERA_BASED)).toBeNull();
    // An edge point at t hovers back to that edge and t.
    const e = edgeBetween(d, v, vertexAt(d, [0.5, -0.5, 0.5]));
    const q = p.screenOf(camera, VIEW, 'edge', e, CAMERA_BASED, 0.25);
    const hit = p.hover(camera, ndc(q?.x ?? 0, q?.y ?? 0, W, H), VIEW, 'edge', CAMERA_BASED);
    expect(hit?.index).toBe(e);
    expect(hit?.t).toBeCloseTo(0.25, 3);
    // Off-screen.
    const far = perspective([0, 0, 3]);
    far.position.set(20, 0, 3);
    far.updateMatrixWorld();
    expect(p.screenOf(far, VIEW, 'vertex', v, CAMERA_BASED)).toBeNull();
  });
});

describe('ComponentPicker: occlusion by the meshes around it (setOccluder, occludes)', () => {
  /** A 2 m cube centred 3 m in front of the unit cube (towards the front camera). */
  const IN_FRONT = matrixOf(new Matrix4().makeTranslation(0, 0, 3).multiply(new Matrix4().makeScale(2, 2, 2)));
  const full = { x0: 0, y0: 0, x1: W, y1: H } as const;

  function occluderPicker(world: Float64Array): ComponentPicker {
    const o = cube();
    const other = new ComponentPicker();
    other.setMesh(o.mesh, o.tri, world, true);
    return other;
  }

  it('leaves out what another mesh hides, camera-based only', () => {
    const d = cube();
    const p = pickerFor(d);
    const other = occluderPicker(IN_FRONT);
    const camera = orthoFront(4);
    const corner = vertexAt(d, [0.5, 0.5, 0.5]);
    const pointer = at(camera, vertexOf(d, corner));
    const front = faceFacing(d, [0, 0, 1]);
    expect(p.hover(camera, pointer, VIEW, 'vertex', CAMERA_BASED)?.index).toBe(corner);
    p.setOccluder(other);
    try {
      expect(p.hover(camera, pointer, VIEW, 'vertex', CAMERA_BASED)).toBeNull();
      expect(p.hover(camera, at(camera, [0.5, 0, 0.5]), VIEW, 'edge', CAMERA_BASED)).toBeNull();
      expect(p.hover(camera, at(camera, [0.1, 0.1, 0.5]), VIEW, 'face', CAMERA_BASED)).toBeNull();
      for (const kind of ['vertex', 'edge', 'face'] as const) {
        expect(p.marquee(camera, full, VIEW, kind, CAMERA_BASED)).toHaveLength(0);
      }
      expect(p.screenOf(camera, VIEW, 'vertex', corner, CAMERA_BASED)).toBeNull();
      expect(p.screenOf(camera, VIEW, 'face', front, CAMERA_BASED)).toBeNull();
      // Camera-based off (wire, x-ray): nothing occludes.
      expect(p.hover(camera, pointer, VIEW, 'vertex', NO_OCCLUSION)?.index).toBe(corner);
      expect(p.marquee(camera, full, VIEW, 'vertex', NO_OCCLUSION)).toHaveLength(8);
      expect(p.screenOf(camera, VIEW, 'face', front, XRAY)).not.toBeNull();
      // From the side the other cube is out of the way.
      const side = perspective([4, 1.5, 0.3]);
      const right = vertexAt(d, [0.5, 0.5, -0.5]);
      expect(p.hover(side, at(side, vertexOf(d, right)), VIEW, 'vertex', CAMERA_BASED)?.index).toBe(right);
    } finally {
      p.setOccluder(null);
      other.dispose();
    }
    expect(p.hover(camera, pointer, VIEW, 'vertex', CAMERA_BASED)?.index).toBe(corner);
    expect(p.marquee(camera, full, VIEW, 'vertex', CAMERA_BASED)).toHaveLength(4);
  });

  it('a picker occludes with its visible triangles along its world placement', () => {
    const other = occluderPicker(IN_FRONT);
    try {
      const through = (x: number, y: number, z0 = 10, z1 = 0): boolean =>
        other.occludes(new Vector3(x, y, z0), new Vector3(x, y, z1));
      expect(through(0, 0)).toBe(true);
      expect(through(0.9, -0.9)).toBe(true);
      expect(through(1.1, 0)).toBe(false);
      // A segment that stops short of the cube, or ends on its surface (the margin), is not occluded.
      expect(through(0, 0, 10, 4.5)).toBe(false);
      expect(through(0, 0, 10, 4)).toBe(false);
      expect(through(0, 0, 10, 3.9)).toBe(true);
      // Hidden faces do not occlude; nor do faces outside the face isolate set.
      const o = cube();
      const front = faceFacing(o, [0, 0, 1]);
      const back = faceFacing(o, [0, 0, -1]);
      other.prepareBvh(hiddenFaces(o, [front, back]));
      expect(through(0, 0)).toBe(false);
      expect(through(0, 0, 3, -10)).toBe(false);
      expect(other.occludes(new Vector3(0, 10, 3), new Vector3(0, -10, 3))).toBe(true);
      other.prepareBvh(null);
      expect(through(0, 0)).toBe(true);
      const isolate = new BitSet(o.mesh.counts.faces);
      isolate.add(faceFacing(o, [0, 1, 0]));
      other.setIsolate(isolate);
      other.prepareBvh(null);
      expect(through(0, 0)).toBe(false);
    } finally {
      other.dispose();
    }
  });

  it('a MeshSurface occludes with every face along its world placement, following setWorld and setData', () => {
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    try {
      const segment = (x: number, y: number): boolean => surface.occludes(new Vector3(x, y, 10), new Vector3(x, y, 0));
      expect(segment(0, 0)).toBe(false);
      const o = cube();
      surface.setData(o.data, o.tri, o.normals, null);
      surface.setWorld(IN_FRONT);
      expect(segment(0, 0)).toBe(true);
      expect(segment(0.9, 0.9)).toBe(true);
      expect(segment(1.1, 0)).toBe(false);
      expect(surface.occludes(new Vector3(0, 0, 10), new Vector3(0, 0, 4))).toBe(false);
      surface.setWorld(matrixOf(new Matrix4().makeTranslation(3, 0, 3)));
      expect(segment(0, 0)).toBe(false);
      expect(segment(3.4, 0)).toBe(true);
      const big = cube({ width: 4, height: 4, depth: 4 });
      surface.setData(big.data, big.tri, big.normals, null);
      expect(segment(1.5, 0)).toBe(true);
      // Back faces occlude as well (the surface draws both sides): from inside the cube.
      expect(surface.occludes(new Vector3(3, 0, 3), new Vector3(3, 0, 10))).toBe(true);
      surface.dispose();
      expect(segment(3, 0)).toBe(false);
    } finally {
      surface.dispose();
    }
  });
});

describe('ComponentPicker: randomized agreement with three.js raycasting', () => {
  /** three's own raycast over the same triangles (DoubleSide). */
  function oracleMesh(d: Derived): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(d.mesh.position), 3));
    const index: number[] = [];
    for (const c of d.tri.tris) index.push(d.mesh.cornerVert(c));
    geometry.setIndex(index);
    return new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  }

  function faceOfTriangle(d: Derived, tri: number): number {
    return d.tri.triFace[tri] as number;
  }

  function faceHasVertex(d: Derived, f: number, v: number): boolean {
    const start = d.mesh.faceCorner(f);
    let c = start;
    do {
      if (d.mesh.cornerVert(c) === v) return true;
      c = d.mesh.cornerNext(c);
    } while (c !== start);
    return false;
  }

  it('vertex and face picks match a brute-force oracle on random cameras and pointers', () => {
    const d = cube({ subdivisionsWidth: 3, subdivisionsHeight: 2, subdivisionsDepth: 2 });
    const p = pickerFor(d);
    const oracle = oracleMesh(d);
    const raycaster = new Raycaster();
    const random = prng(0x5eed);
    let vertexHits = 0;
    let faceHits = 0;
    for (let trial = 0; trial < 40; trial++) {
      const theta = random() * Math.PI * 2;
      const phi = (random() - 0.5) * Math.PI * 0.9;
      const r = 2.5 + random() * 2;
      const camera = perspective([
        r * Math.cos(phi) * Math.cos(theta),
        r * Math.sin(phi),
        r * Math.cos(phi) * Math.sin(theta),
      ]);
      for (let k = 0; k < 25; k++) {
        // Half the pointers near a random vertex, half anywhere.
        let x: number;
        let y: number;
        if (k % 2 === 0) {
          const v = Math.floor(random() * d.mesh.counts.points);
          [x, y] = screen(camera, vertexOf(d, v), W, H);
          x += (random() - 0.5) * 12;
          y += (random() - 0.5) * 12;
        } else {
          x = random() * W;
          y = random() * H;
        }
        const pointer = ndc(x, y, W, H);
        // Oracle vertex: nearest projected within 8 px, then depth, then index; first one not occluded.
        const candidates: { d2: number; z: number; v: number }[] = [];
        for (let v = 0; v < d.mesh.counts.points; v++) {
          const [sx, sy] = screen(camera, vertexOf(d, v), W, H);
          const d2 = (sx - x) ** 2 + (sy - y) ** 2;
          const z = new Vector3(...vertexOf(d, v)).applyMatrix4(camera.matrixWorldInverse).z;
          if (d2 <= 64) candidates.push({ d2, z: -z, v });
        }
        candidates.sort((a, b) => (Math.abs(a.d2 - b.d2) > 1e-6 ? a.d2 - b.d2 : a.z !== b.z ? a.z - b.z : a.v - b.v));
        let expected: number | null = null;
        for (const c of candidates) {
          const target = new Vector3(...vertexOf(d, c.v));
          const dir = target.clone().sub(camera.position);
          const dist = dir.length();
          raycaster.set(camera.position, dir.normalize());
          raycaster.far = dist * (1 - 1e-4);
          const hit = raycaster.intersectObject(oracle)[0];
          if (hit === undefined || faceHasVertex(d, faceOfTriangle(d, hit.faceIndex ?? 0), c.v)) {
            expected = c.v;
            break;
          }
        }
        const got = p.hover(camera, pointer, VIEW, 'vertex', CAMERA_BASED);
        expect(got?.index ?? null).toBe(expected);
        if (expected !== null) vertexHits++;
        // Oracle face: the first triangle hit, if it faces the camera.
        raycaster.far = Infinity;
        raycaster.setFromCamera(new Vector2(...pointer), camera);
        const first = raycaster.intersectObject(oracle)[0];
        let expectedFace: number | null = null;
        if (first !== undefined) {
          const n = first.face?.normal as Vector3;
          if (n.dot(raycaster.ray.direction) < 0) expectedFace = faceOfTriangle(d, first.faceIndex ?? 0);
        }
        expect(p.hover(camera, pointer, VIEW, 'face', CAMERA_BASED)?.index ?? null).toBe(expectedFace);
        if (expectedFace !== null) faceHits++;
      }
    }
    // The trials exercise both outcomes.
    expect(vertexHits).toBeGreaterThan(100);
    expect(faceHits).toBeGreaterThan(100);
  });

  it('vertex and face picks behind another mesh match the oracle over both meshes (setOccluder)', () => {
    const d = cube({ subdivisionsWidth: 2, subdivisionsHeight: 2, subdivisionsDepth: 2 });
    const p = pickerFor(d);
    const own = oracleMesh(d);
    const o = cube();
    const blocker = oracleMesh(o);
    const other = new ComponentPicker();
    const raycaster = new Raycaster();
    const random = prng(0xb10c);
    let hidden = 0;
    let shown = 0;
    let facesHidden = 0;
    /** True when a triangle of `mesh` (world matrix applied) lies on the camera ray before 0.9999 × `dist`. */
    const blocks = (mesh: Mesh, origin: Vector3, dir: Vector3, dist: number): boolean => {
      raycaster.set(origin, dir);
      raycaster.near = 0;
      raycaster.far = dist * (1 - 1e-4);
      return raycaster.intersectObject(mesh).length > 0;
    };
    try {
      for (let trial = 0; trial < 30; trial++) {
        const theta = random() * Math.PI * 2;
        const phi = (random() - 0.5) * Math.PI * 0.8;
        const r = 3 + random() * 2;
        const eye: [number, number, number] = [
          r * Math.cos(phi) * Math.cos(theta),
          r * Math.sin(phi),
          r * Math.cos(phi) * Math.sin(theta),
        ];
        const camera = perspective(eye);
        // A rotated, non-uniformly scaled cube somewhere between the camera and the mesh, a little off the line.
        const along = 0.35 + random() * 0.3;
        const m = new Matrix4()
          .makeTranslation(
            eye[0] * along + (random() - 0.5) * 0.6,
            eye[1] * along + (random() - 0.5) * 0.6,
            eye[2] * along + (random() - 0.5) * 0.6,
          )
          .multiply(new Matrix4().makeRotationFromEuler(new Euler(random() * 3, random() * 3, random() * 3)))
          .multiply(new Matrix4().makeScale(0.3 + random() * 0.5, 0.3 + random() * 0.5, -(0.3 + random() * 0.5)));
        other.setMesh(o.mesh, o.tri, matrixOf(m), true);
        blocker.matrixAutoUpdate = false;
        blocker.matrix.copy(m);
        blocker.matrixWorld.copy(m);
        p.setOccluder(other);
        for (let k = 0; k < 30; k++) {
          const v0 = Math.floor(random() * d.mesh.counts.points);
          const [sx, sy] = screen(camera, vertexOf(d, v0), W, H);
          const x = sx + (random() - 0.5) * 10;
          const y = sy + (random() - 0.5) * 10;
          const pointer = ndc(x, y, W, H);
          const candidates: { d2: number; z: number; v: number }[] = [];
          for (let v = 0; v < d.mesh.counts.points; v++) {
            const [vx, vy] = screen(camera, vertexOf(d, v), W, H);
            const d2 = (vx - x) ** 2 + (vy - y) ** 2;
            const z = new Vector3(...vertexOf(d, v)).applyMatrix4(camera.matrixWorldInverse).z;
            if (d2 <= 64) candidates.push({ d2, z: -z, v });
          }
          candidates.sort((a, b) => (Math.abs(a.d2 - b.d2) > 1e-6 ? a.d2 - b.d2 : a.z !== b.z ? a.z - b.z : a.v - b.v));
          let expected: number | null = null;
          let blockedFirst = false;
          for (const c of candidates) {
            const target = new Vector3(...vertexOf(d, c.v));
            const dir = target.clone().sub(camera.position);
            const dist = dir.length();
            dir.normalize();
            raycaster.set(camera.position, dir);
            raycaster.near = 0;
            raycaster.far = dist * (1 - 1e-4);
            const hit = raycaster.intersectObject(own)[0];
            if (hit !== undefined && !faceHasVertex(d, faceOfTriangle(d, hit.faceIndex ?? 0), c.v)) continue;
            if (blocks(blocker, camera.position, dir, dist)) {
              if (expected === null && c === candidates[0]) blockedFirst = true;
              continue;
            }
            expected = c.v;
            break;
          }
          expect(p.hover(camera, pointer, VIEW, 'vertex', CAMERA_BASED)?.index ?? null).toBe(expected);
          if (blockedFirst) hidden++;
          if (expected !== null) shown++;
          // Face: the first own hit, front-facing, with nothing of the other mesh before it.
          raycaster.near = 0;
          raycaster.far = Infinity;
          raycaster.setFromCamera(new Vector2(...pointer), camera);
          const first = raycaster.intersectObject(own)[0];
          let expectedFace: number | null = null;
          const normal = first?.face?.normal;
          if (first !== undefined && normal !== undefined && normal.dot(raycaster.ray.direction) < 0) {
            const dir = raycaster.ray.direction.clone();
            if (blocks(blocker, camera.position, dir, first.distance)) facesHidden++;
            else expectedFace = faceOfTriangle(d, first.faceIndex ?? 0);
          }
          expect(p.hover(camera, pointer, VIEW, 'face', CAMERA_BASED)?.index ?? null).toBe(expectedFace);
        }
      }
    } finally {
      p.setOccluder(null);
      other.dispose();
    }
    // The trials exercise hidden and visible candidates and faces.
    expect(hidden).toBeGreaterThan(20);
    expect(shown).toBeGreaterThan(100);
    expect(facesHidden).toBeGreaterThan(20);
  });
});
