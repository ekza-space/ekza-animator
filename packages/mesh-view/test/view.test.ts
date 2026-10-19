// Pixel probes of the mesh overlays (M6A-SPEC §4.4, §5.6, §8.9; research 13 §7.1) on a real WebGL canvas: the clay
// rig, selected/unselected/mirrored/hovered glyphs with their halo, fat selected edges, face tints, x-ray's occluded
// pass, hidden and isolated faces, wire shading, palette colours, face orientation, culling, flat display, normals,
// triangulation, Mesh Check markers, the symmetry plane, the soft ramp, "Dim unhilited", per-pane display and the
// incremental upload of moved vertices.
import {
  BitSet,
  type ComponentSelection,
  computeNormals,
  type HiddenSet,
  selectionOf,
  triangulate,
} from '@ekza-animator/mesh-core';
import { cubeData } from '@ekza-animator/mesh-core/testing';
import { type BufferAttribute, type Camera, Matrix4, type Points, Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { EditMeshView, MeshSurface } from '../src';
import { LIGHT_RIG, MESH_VIEW_STYLE } from '../src/style';
import type { MeshPaneDisplay } from '../src/types';
import {
  BACKGROUND,
  bytes,
  type Canvas,
  canvas,
  centroidOf,
  cube,
  type Derived,
  DISPLAY,
  derived,
  edgeBetween,
  expectClose,
  faceFacing,
  hexBytes,
  LAYERS,
  light,
  linear,
  matrixOf,
  mix,
  orthoFront,
  orthoTop,
  perspective,
  plane,
  scale,
  screen,
  THEME,
  vertexAt,
  vertexOf,
} from './support';

let c: Canvas | null = null;
const disposables: { dispose(): void }[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d.dispose();
  c?.dispose();
  c = null;
});

function setup(): Canvas {
  c = canvas();
  return c;
}

function editView(d: Derived, sel: ComponentSelection, world?: Matrix4): EditMeshView {
  const view = new EditMeshView({ theme: THEME, layers: LAYERS });
  disposables.push(view);
  view.setMesh(d.mesh, d.tri, d.normals);
  view.setState(sel, null, null, null);
  if (world !== undefined) view.setWorld(matrixOf(world));
  return view;
}

function render(view: EditMeshView | MeshSurface, camera: Camera, display: Partial<MeshPaneDisplay> = {}): Canvas {
  const canvasRef = c ?? setup();
  if (view.root.parent === null) canvasRef.scene.add(view.root);
  view.applyPane({ ...DISPLAY, ...display });
  canvasRef.render(camera);
  return canvasRef;
}

function px(camera: Camera, p: readonly [number, number, number], world?: Matrix4): [number, number] {
  const q = new Vector3(...p);
  if (world !== undefined) q.applyMatrix4(world);
  return screen(camera, [q.x, q.y, q.z], 400, 300);
}

function at(canvasRef: Canvas, [x, y]: readonly [number, number], dx = 0, dy = 0): [number, number, number, number] {
  return canvasRef.pixel(x + dx, y + dy);
}

/** View-space normal of a world direction for `camera`. */
function viewNormal(camera: Camera, dir: readonly [number, number, number]): [number, number, number] {
  const n = new Vector3(...dir).transformDirection(camera.matrixWorldInverse);
  return [n.x, n.y, n.z];
}

function lit(hex: number, camera: Camera, dir: readonly [number, number, number]): [number, number, number] {
  return scale(linear(hex), light(viewNormal(camera, dir)));
}

/** Blend in the framebuffer (sRGB bytes): src·a + dst·(1 − a). */
function over(src: readonly number[], a: number, dst: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((i) => (src[i] as number) * a + (dst[i] as number) * (1 - a)) as [number, number, number];
}

// Half a pixel of the 4 m-wide top/front ortho views (0.01 m per px): moves lines at x = 0 / z = 0 onto pixel centres.
const HALF_PX = new Matrix4().makeTranslation(0.005, -0.005, 0.005);

describe('EditMeshView: glyphs and halos', () => {
  it('draws selected vertices in --comp-selected with a 1 px halo and others in --comp-vertex', () => {
    const d = cube();
    const camera = orthoFront(4);
    const selected = vertexAt(d, [0.5, 0.5, 0.5]);
    const other = vertexAt(d, [-0.5, 0.5, 0.5]);
    const view = editView(d, selectionOf('vertex', [selected], d.mesh.counts));
    const canvasRef = render(view, camera);
    const s = px(camera, vertexOf(d, selected));
    expectClose(at(canvasRef, s), hexBytes(THEME.selected), 1);
    // Hot glyph: 7 px core + 1 px halo each side → the ring 4 px from the centre.
    expectClose(at(canvasRef, s, 4, 0), hexBytes(THEME.halo), 1);
    expectClose(at(canvasRef, s, 3, 0), hexBytes(THEME.selected), 1);
    const o = px(camera, vertexOf(d, other));
    expectClose(at(canvasRef, o), hexBytes(THEME.vertex), 1);
    // Plain glyph: 5 px core → ring 3 px from the centre.
    expectClose(at(canvasRef, o, -3, 0), hexBytes(THEME.halo), 1);
    expect(MESH_VIEW_STYLE.haloPx).toBe(1);
  });

  it('draws mirrored partners 60 % of the way to --comp-selected and the hover with its partner', () => {
    const d = cube();
    const camera = orthoFront(4);
    const picked = vertexAt(d, [0.5, 0.5, 0.5]);
    const partner = vertexAt(d, [-0.5, 0.5, 0.5]);
    const sel = selectionOf('vertex', [picked], d.mesh.counts);
    const mirrored = selectionOf('vertex', [partner], d.mesh.counts);
    const view = editView(d, sel);
    view.setState(sel, null, null, mirrored);
    let canvasRef = render(view, camera);
    const expected = bytes(mix(linear(THEME.vertex), linear(THEME.selected), MESH_VIEW_STYLE.mirroredMix));
    expectClose(at(canvasRef, px(camera, vertexOf(d, partner))), expected, 2);
    expectClose(at(canvasRef, px(camera, vertexOf(d, picked))), hexBytes(THEME.selected), 1);
    // Hover a third vertex and pre-highlight its partner.
    const h = vertexAt(d, [0.5, -0.5, 0.5]);
    const hp = vertexAt(d, [-0.5, -0.5, 0.5]);
    view.setState(sel, null, { kind: 'vertex', index: h, partner: hp }, mirrored);
    canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, vertexOf(d, h))), hexBytes(THEME.hover), 1);
    expectClose(at(canvasRef, px(camera, vertexOf(d, hp))), hexBytes(THEME.hover), 1);
    // Moving the hover away restores both (hover-only update path).
    view.setState(sel, null, null, mirrored);
    canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, vertexOf(d, h))), hexBytes(THEME.vertex), 1);
    expectClose(at(canvasRef, px(camera, vertexOf(d, hp))), hexBytes(THEME.vertex), 1);
  });

  it('draws selected edges 3 px wide in --comp-selected with a halo, in edge mode only', () => {
    const d = cube();
    const camera = perspective([0.3, 0.9, 3]);
    const e = edgeBetween(d, vertexAt(d, [-0.5, 0.5, 0.5]), vertexAt(d, [0.5, 0.5, 0.5]));
    const view = editView(d, selectionOf('edge', [e], d.mesh.counts));
    let canvasRef = render(view, camera);
    const s = px(camera, [0.1, 0.5, 0.5]);
    const column = (): string[] =>
      [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((dy) => {
        const p = at(canvasRef, s, 0, dy);
        const is = (hex: number): boolean => hexBytes(hex).every((v, i) => Math.abs(v - (p[i] as number)) <= 1);
        return is(THEME.selected) ? 'S' : is(THEME.halo) ? 'H' : '.';
      });
    // Across the line: halo, 3 core pixels, halo (the row the line falls on decides the exact offsets).
    expect(column().join('')).toMatch(/^\.*H?SSSH?\.*$/);
    expect(column().join('')).toMatch(/HSSS|SSSH/);
    // The same edge bits in vertex mode are per-mode memory: not drawn as selected.
    const edges = new BitSet(d.mesh.counts.edges);
    edges.add(e);
    view.setState({ ...selectionOf('vertex', [], d.mesh.counts), edges }, null, null, null);
    canvasRef = render(view, camera);
    expect(column()).not.toContain('S');
  });

  it('shows face-centre dots in face mode and tints selected and mirrored faces', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const left = centroidOf(d, 0)[0] < 0 ? 0 : 1;
    const right = 1 - left;
    const sel = selectionOf('face', [left], d.mesh.counts);
    const view = editView(d, sel);
    view.setState(sel, null, null, selectionOf('face', [right], d.mesh.counts));
    const canvasRef = render(view, camera);
    const base = lit(THEME.clay, camera, [0, 1, 0]);
    // Away from the dot and the edges.
    const inLeft = px(camera, [centroidOf(d, left)[0] - 0.25, 0, 0.2]);
    const inRight = px(camera, [centroidOf(d, right)[0] + 0.25, 0, 0.2]);
    expectClose(at(canvasRef, inLeft), bytes(mix(base, linear(THEME.selected), MESH_VIEW_STYLE.faceSelectedTint)), 2);
    expectClose(
      at(canvasRef, inRight),
      bytes(mix(base, linear(THEME.selected), MESH_VIEW_STYLE.faceSelectedTint * MESH_VIEW_STYLE.mirroredMix)),
      2,
    );
    // The selected face's dot.
    expectClose(at(canvasRef, px(camera, centroidOf(d, left))), hexBytes(THEME.selected), 1);
  });
});

describe('EditMeshView: surface', () => {
  it('lights clay with the soft rig and palette colours in the colours shading', () => {
    const d = cube();
    const camera = orthoFront(4);
    const view = editView(d, selectionOf('vertex', [], d.mesh.counts));
    let canvasRef = render(view, camera);
    const centre = px(camera, [0.1, 0.15, 0.5]);
    expectClose(at(canvasRef, centre), bytes(lit(THEME.clay, camera, [0, 0, 1])), 2);
    // Palette: slot 0 (the primitives' paint) red.
    view.setPaint(new Map([[0, [255, 0, 0] as const]]));
    canvasRef = render(view, camera, { shading: 'colours' });
    const red = at(canvasRef, centre);
    expectClose(red, bytes(lit(0xff0000, camera, [0, 0, 1])), 2);
    expect(red[0]).toBeGreaterThanOrEqual(180);
    expect(red[1]).toBeLessThanOrEqual(40);
    expect(red[2]).toBeLessThanOrEqual(40);
    // `shaded` stays clay with a palette set; `lit` draws the palette too (M6A-B6-3).
    canvasRef = render(view, camera, { shading: 'shaded' });
    expectClose(at(canvasRef, centre), bytes(lit(THEME.clay, camera, [0, 0, 1])), 2);
    canvasRef = render(view, camera, { shading: 'lit' });
    expectClose(at(canvasRef, centre), bytes(lit(0xff0000, camera, [0, 0, 1])), 2);
    // A slot without a colour shows clay.
    view.setPaint(new Map([[3, [0, 255, 0] as const]]));
    canvasRef = render(view, camera, { shading: 'colours' });
    expectClose(at(canvasRef, centre), bytes(lit(THEME.clay, camera, [0, 0, 1])), 2);
  });

  it('draws nothing for hidden faces and the vertices only they use', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const right = centroidOf(d, 0)[0] > 0 ? 0 : 1;
    const view = editView(d, selectionOf('vertex', [], d.mesh.counts));
    const hidden: HiddenSet = {
      verts: new BitSet(d.mesh.counts.points),
      edges: new BitSet(d.mesh.counts.edges),
      faces: new BitSet(d.mesh.counts.faces),
    };
    hidden.faces.add(right);
    view.setState(selectionOf('vertex', [], d.mesh.counts), hidden, null, null);
    const canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, [0.6, 0, 0.1])), hexBytes(BACKGROUND), 1);
    expectClose(at(canvasRef, px(camera, [-0.6, 0, 0.1])), bytes(lit(THEME.clay, camera, [0, 1, 0])), 2);
    // The corner vertex of the hidden face only: no glyph.
    expectClose(at(canvasRef, px(camera, [1, 0, -0.5]), -1, 1), hexBytes(BACKGROUND), 1);
    // The shared vertex stays.
    expectClose(at(canvasRef, px(camera, [0, 0, -0.5]), 0, 1), hexBytes(THEME.vertex), 1);
  });

  it('isolates faces per pane (setIsolate)', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const left = centroidOf(d, 0)[0] < 0 ? 0 : 1;
    const view = editView(d, selectionOf('face', [], d.mesh.counts));
    const only = new BitSet(d.mesh.counts.faces);
    only.add(left);
    view.setIsolate(only);
    let canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, [0.6, 0, 0.1])), hexBytes(BACKGROUND), 1);
    expectClose(at(canvasRef, px(camera, [-0.6, 0, 0.1])), bytes(lit(THEME.clay, camera, [0, 1, 0])), 2);
    view.setIsolate(null);
    canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, [0.6, 0, 0.1])), bytes(lit(THEME.clay, camera, [0, 1, 0])), 2);
  });

  it('wire shading draws no surface and the edges in --wire-wiremode', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const view = editView(d, selectionOf('face', [], d.mesh.counts), HALF_PX);
    const canvasRef = render(view, camera, { shading: 'wire' });
    expectClose(at(canvasRef, px(camera, [-0.6, 0, 0.1], HALF_PX)), hexBytes(BACKGROUND), 1);
    // The middle edge (x = 0) on a pixel column: core, then the halo beside it.
    const line = px(camera, [0, 0, 0.2], HALF_PX);
    expectClose(at(canvasRef, line), hexBytes(THEME.wireMode), 1);
    expectClose(at(canvasRef, line, 1, 0), hexBytes(THEME.halo), 1);
    expectClose(at(canvasRef, line, 2, 0), hexBytes(BACKGROUND), 1);
  });

  it('face orientation, back-face culling and the darker back side', () => {
    const d = plane();
    const below = perspective([0.3, -3, 0.4]);
    const view = editView(d, selectionOf('face', [], d.mesh.counts));
    const centre = px(below, [0.1, 0, 0.15]);
    let canvasRef = render(view, below);
    const back = viewNormal(below, [0, -1, 0]);
    expectClose(at(canvasRef, centre), bytes(scale(linear(THEME.clay), light(back) * LIGHT_RIG.backFactor)), 2);
    canvasRef = render(view, below, { faceOrientation: true });
    const key = (light(back) - LIGHT_RIG.ambient - LIGHT_RIG.fill * fillDot(back)) / LIGHT_RIG.key;
    expectClose(
      at(canvasRef, centre),
      bytes(scale(linear(THEME.faceBack), LIGHT_RIG.orientationAmbient + LIGHT_RIG.orientationKey * key)),
      2,
    );
    canvasRef = render(view, below, { cull: true });
    expectClose(at(canvasRef, centre), hexBytes(BACKGROUND), 1);
    const above = perspective([0.3, 3, 0.4]);
    canvasRef = render(view, above, { faceOrientation: true });
    const front = viewNormal(above, [0, 1, 0]);
    const keyFront = (light(front) - LIGHT_RIG.ambient - LIGHT_RIG.fill * fillDot(front)) / LIGHT_RIG.key;
    expectClose(
      at(canvasRef, px(above, [0.1, 0, 0.15])),
      bytes(scale(linear(THEME.faceFront), LIGHT_RIG.orientationAmbient + LIGHT_RIG.orientationKey * keyFront)),
      2,
    );
  });

  it('flat display lights each face by its face normal; smooth normals vary across it', () => {
    const d = derived(cubeData({ hard: false }));
    const camera = perspective([1.2, 1, 3]);
    const view = editView(d, selectionOf('face', [], d.mesh.counts));
    const near = px(camera, [0.38, 0.38, 0.5]);
    const flat = at(render(view, camera, { flat: true }), near);
    expectClose(flat, bytes(lit(THEME.clay, camera, [0, 0, 1])), 2);
    const smooth = at(render(view, camera, { flat: false }), near);
    expect(
      Math.abs((smooth[0] as number) - (flat[0] as number)) + Math.abs((smooth[2] as number) - (flat[2] as number)),
    ).toBeGreaterThan(3);
  });

  it('x-ray: occluded components draw in a second pass at 35 % over the transparent surface', () => {
    const d = cube();
    const camera = perspective([0.6, 0.4, 3]);
    const back = vertexAt(d, [-0.5, -0.5, -0.5]);
    const sel = selectionOf('vertex', [], d.mesh.counts);
    const view = editView(d, sel);
    const hiddenBack: HiddenSet = {
      verts: new BitSet(d.mesh.counts.points),
      edges: new BitSet(d.mesh.counts.edges),
      faces: new BitSet(d.mesh.counts.faces),
    };
    hiddenBack.verts.add(back);
    const s = px(camera, vertexOf(d, back));
    // Not x-ray: the vertex behind the front face is not drawn.
    view.setState(sel, null, null, null);
    const shown = at(render(view, camera), s);
    view.setState(sel, hiddenBack, null, null);
    const without = at(render(view, camera), s);
    expectClose(shown, without, 0);
    // X-ray: the occluded pass blends the glyph at 35 % over whatever is drawn there.
    view.setState(sel, null, null, null);
    const xShown = at(render(view, camera, { xray: true }), s);
    view.setState(sel, hiddenBack, null, null);
    const xWithout = at(render(view, camera, { xray: true }), s);
    expectClose(xShown, over(hexBytes(THEME.vertex), MESH_VIEW_STYLE.occludedAlpha, xWithout), 2);
    // A vertex in front keeps its full colour in x-ray.
    view.setState(sel, null, null, null);
    const front = vertexAt(d, [0.5, 0.5, 0.5]);
    expectClose(at(render(view, camera, { xray: true }), px(camera, vertexOf(d, front))), hexBytes(THEME.vertex), 1);
    // The x-ray surface is half transparent over the background.
    const surfaceOnly = px(camera, [0.15, 0.2, 0.5]);
    const opaque = bytes(lit(THEME.clay, camera, [0, 0, 1]));
    expectClose(
      at(render(view, camera, { xray: true }), surfaceOnly),
      over(opaque, MESH_VIEW_STYLE.xrayOpacity, hexBytes(BACKGROUND)),
      3,
    );
  });
});

function fillDot(n: readonly [number, number, number]): number {
  const d = LIGHT_RIG.fillDir;
  const len = Math.hypot(d[0], d[1], d[2]);
  return Math.max(0, (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / len);
}

describe('EditMeshView: overlays', () => {
  it('draws face normals in --normal-face, only when asked', () => {
    const d = cube();
    const camera = orthoTop(4);
    const view = editView(d, selectionOf('face', [], d.mesh.counts), HALF_PX);
    // +X face normal: from (0.5, 0, 0) to (0.9, 0, 0); sample outside the cube.
    const p = px(camera, [0.75, 0, 0], HALF_PX);
    expectClose(at(render(view, camera, { normals: 'face' }), p), hexBytes(THEME.normalFace), 1);
    expectClose(at(render(view, camera, { normals: 'off' }), p), hexBytes(BACKGROUND), 1);
    expectClose(at(render(view, camera, { normals: 'vertex' }), p), hexBytes(BACKGROUND), 1);
    // Vertex normals (faceted: along the face normals) from the corners.
    const q = px(camera, [0.75, 0, 0.5], HALF_PX);
    expectClose(at(render(view, camera, { normals: 'both' }), q), hexBytes(THEME.normalVertex), 1);
  });

  it('draws the triangulation diagonals at 60 % of the wire colour', () => {
    const d = plane();
    const camera = orthoTop(3);
    const view = editView(d, selectionOf('face', [], d.mesh.counts), HALF_PX);
    // The diagonal passes the centre; sample a quarter of the way to a corner along both diagonals.
    const base = bytes(lit(THEME.clay, camera, [0, 1, 0]));
    const onDiagonal = (canvasRef: Canvas): boolean =>
      [
        [0.25, 0.25],
        [0.25, -0.25],
      ].some(([x, z]) => {
        const pixel = at(canvasRef, px(camera, [x as number, 0, z as number], HALF_PX));
        const expected = over(hexBytes(THEME.wire), MESH_VIEW_STYLE.triangulationAlpha, base);
        return [0, 1, 2].every((i) => Math.abs((pixel[i] as number) - (expected[i] as number)) <= 3);
      });
    expect(onDiagonal(render(view, camera, { triangulation: true, components: false }))).toBe(true);
    expect(onDiagonal(render(view, camera, { triangulation: false, components: false }))).toBe(false);
  });

  it('draws Mesh Check markers: ✕ errors in --lint-error, ◇ n-gon codes in --lint-ngon', () => {
    const d = cube();
    const camera = orthoFront(4);
    const view = editView(d, selectionOf('vertex', [], d.mesh.counts));
    const front = faceFacing(d, [0, 0, 1]);
    const e = edgeBetween(d, vertexAt(d, [-0.5, -0.5, 0.5]), vertexAt(d, [0.5, -0.5, 0.5]));
    view.setLints([
      { code: 'nonplanar-ngon', message: 'n-gon', elements: Uint32Array.of(front), domain: 'face' },
      { code: 'non-manifold-edge', message: 'edge', elements: Uint32Array.of(e) },
    ]);
    let canvasRef = render(view, camera, { meshCheck: true });
    expectClose(at(canvasRef, px(camera, centroidOf(d, front))), hexBytes(THEME.lintNgon), 1);
    expectClose(at(canvasRef, px(camera, [0, -0.5, 0.5])), hexBytes(THEME.lintError), 1);
    canvasRef = render(view, camera, { meshCheck: false });
    expect(at(canvasRef, px(camera, centroidOf(d, front))).slice(0, 3)).not.toEqual(hexBytes(THEME.lintNgon));
  });

  it('draws the symmetry plane across the mesh bounds when the pane shows it', () => {
    const d = cube();
    const camera = orthoFront(4);
    const view = editView(d, selectionOf('vertex', [], d.mesh.counts));
    view.setSymmetryPlane({ axis: 'z', offset: 0 });
    const outside = px(camera, [0.58, 0.1, 0]);
    const expected = over(hexBytes(THEME.symPlane), MESH_VIEW_STYLE.symPlaneAlpha, hexBytes(BACKGROUND));
    expectClose(at(render(view, camera), outside), expected, 2);
    expectClose(at(render(view, camera, { symmetryPlane: false }), outside), hexBytes(BACKGROUND), 1);
    view.setSymmetryPlane(null);
    expectClose(at(render(view, camera), outside), hexBytes(BACKGROUND), 1);
  });

  it('colours soft-selection weights with the --soft ramp', () => {
    const d = cube();
    const camera = orthoFront(4);
    const full = vertexAt(d, [0.5, 0.5, 0.5]);
    const half = vertexAt(d, [-0.5, 0.5, 0.5]);
    const view = editView(d, selectionOf('vertex', [], d.mesh.counts));
    const weights = new Float32Array(d.mesh.counts.points);
    weights[full] = 1;
    weights[half] = 0.5;
    view.setSoftWeights(weights);
    let canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, vertexOf(d, full))), hexBytes(THEME.soft[0]), 2);
    // Weight 0.5 = halfway between --soft-2 and --soft-3 (linear light), within the 8-bit weight.
    expectClose(
      at(canvasRef, px(camera, vertexOf(d, half))),
      bytes(mix(linear(THEME.soft[1]), linear(THEME.soft[2]), 0.5)),
      4,
    );
    view.setSoftWeights(null);
    canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, vertexOf(d, full))), hexBytes(THEME.vertex), 1);
  });

  it('fades the whole view to 35 % when dimmed', () => {
    const d = cube();
    const camera = orthoFront(4);
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    surface.setData(d.data, d.tri, d.normals, null);
    const centre = px(camera, [0.1, 0.15, 0.5]);
    const opaque = bytes(lit(THEME.clay, camera, [0, 0, 1]));
    expectClose(at(render(surface, camera), centre), opaque, 2);
    expectClose(
      at(render(surface, camera, { dimmed: true }), centre),
      over(opaque, MESH_VIEW_STYLE.dimOpacity, hexBytes(BACKGROUND)),
      3,
    );
  });
});

describe('MeshSurface', () => {
  it('draws hard edges 2 px in --hard-edge and wire on shaded on request', () => {
    const d = cube();
    const camera = orthoFront(4);
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    surface.setData(d.data, d.tri, d.normals, null);
    // The top front edge (y = 0.5, a horizontal pixel row at 112.5).
    const edge = px(camera, [0.1, 0.5, 0.5]);
    const face = bytes(lit(THEME.clay, camera, [0, 0, 1]));
    let canvasRef = render(surface, camera, { hardEdges: false, wireOnShaded: false });
    expectClose(at(canvasRef, edge, 0, 1), face, 2);
    canvasRef = render(surface, camera, { hardEdges: true });
    expectClose(at(canvasRef, edge), hexBytes(THEME.hardEdge), 1);
    expectClose(at(canvasRef, edge, 0, 2), face, 2);
    canvasRef = render(surface, camera, { wireOnShaded: true });
    expectClose(at(canvasRef, edge), hexBytes(THEME.wire), 1);
    expect(surface.current).toBe(d.data);
  });

  it('applies per-pane display before each render (one scene, two panes)', () => {
    const d = cube();
    const camera = orthoFront(4);
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    surface.setData(d.data, d.tri, d.normals, new Map([[0, [0, 0, 255] as const]]));
    const centre = px(camera, [0.1, 0.15, 0.5]);
    expectClose(at(render(surface, camera, { shading: 'wire' }), centre), hexBytes(BACKGROUND), 1);
    expectClose(
      at(render(surface, camera, { shading: 'colours' }), centre),
      bytes(lit(0x0000ff, camera, [0, 0, 1])),
      2,
    );
    expectClose(
      at(render(surface, camera, { shading: 'shaded' }), centre),
      bytes(lit(THEME.clay, camera, [0, 0, 1])),
      2,
    );
  });
});

describe('EditMeshView: incremental updates', () => {
  it('moves a vertex through ranged uploads without a rebuild and rebuilds after a topology change', () => {
    const d = cube();
    const camera = orthoFront(4);
    const v = vertexAt(d, [0.5, 0.5, 0.5]);
    const view = editView(d, selectionOf('vertex', [v], d.mesh.counts));
    let canvasRef = render(view, camera);
    const glyphs = view.root.children.filter((o) => (o as Points).isPoints === true) as Points[];
    const geometries = glyphs.map((o) => o.geometry);
    d.mesh.begin('test.move');
    d.mesh.setPosition(v, 0.8, 0.8, 0.5);
    const delta = d.mesh.end();
    view.update(d.mesh, delta.dirty, triangulate(d.mesh), computeNormals(d.mesh));
    // Same geometries (no rebuild), the vertex glyph uploads a range, not the whole array.
    expect(
      view.root.children.filter((o) => (o as Points).isPoints === true).map((o) => (o as Points).geometry),
    ).toEqual(geometries);
    const vertexGlyphs = glyphs.find(
      (o) => (o.geometry.getAttribute('position') as BufferAttribute).count === d.mesh.counts.points,
    ) as Points;
    const ranges = (vertexGlyphs.geometry.getAttribute('position') as BufferAttribute).updateRanges;
    expect(ranges.length).toBe(1);
    expect(ranges[0]?.count).toBe(3);
    canvasRef = render(view, camera);
    expectClose(at(canvasRef, px(camera, [0.8, 0.8, 0.5])), hexBytes(THEME.selected), 1);
    expect(at(canvasRef, px(camera, [0.5, 0.5, 0.5])).slice(0, 3)).not.toEqual(hexBytes(THEME.selected));
    // A topology change (another mesh) rebuilds and drops the old selection.
    const other = plane();
    view.update(other.mesh, { ...delta.dirty, topology: true }, other.tri, other.normals);
    expect(view.mode).toBeNull();
    canvasRef = render(view, orthoTop(3));
    expectClose(at(canvasRef, [200, 150], -10, -10), bytes(lit(THEME.clay, orthoTop(3), [0, 1, 0])), 2);
  });

  it('follows the world matrix', () => {
    const d = cube();
    const camera = orthoFront(6);
    const world = new Matrix4().makeTranslation(1, 0.5, 0);
    const v = vertexAt(d, [0.5, 0.5, 0.5]);
    const view = editView(d, selectionOf('vertex', [v], d.mesh.counts), world);
    expectClose(at(render(view, camera), px(camera, vertexOf(d, v), world)), hexBytes(THEME.selected), 1);
  });

  it('never schedules frames of its own (idle costs nothing)', () => {
    const d = cube();
    const original = window.requestAnimationFrame;
    let scheduled = 0;
    window.requestAnimationFrame = (cb) => {
      scheduled++;
      return original(cb);
    };
    try {
      const view = editView(d, selectionOf('vertex', [0], d.mesh.counts));
      view.setSoftWeights(new Float32Array(8).fill(0.5));
      view.setLints([]);
      view.setSymmetryPlane({ axis: 'x', offset: 0 });
      render(view, orthoFront(4));
      expect(scheduled).toBe(0);
    } finally {
      window.requestAnimationFrame = original;
    }
  });
});
