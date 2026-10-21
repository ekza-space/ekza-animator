// Pixel probes of the mesh overlays (M6A-SPEC §4.4, §5.6, §8.9; research 13 §7.1) on a real WebGL canvas: the clay
// rig, selected/unselected/mirrored/hovered glyphs with their halo, fat selected edges, face tints, x-ray's occluded
// pass, hidden and isolated faces, wire shading, palette colours, face orientation, culling, flat display, normals,
// triangulation, Mesh Check markers, the symmetry plane, the soft ramp, "Dim unhilited", per-pane display, inputs
// mutated in place, and incremental updates (ranged uploads; equal to a full rebuild after random edits).
import {
  BitSet,
  BUILTIN_LAYERS,
  type ComponentSelection,
  computeNormals,
  EDGE_HARD,
  type HiddenSet,
  selectionOf,
  triangulate,
} from '@ekza-animator/mesh-core';
import { cubeData } from '@ekza-animator/mesh-core/testing';
import { type BufferAttribute, type BufferGeometry, type Camera, Matrix4, type Points, Vector3 } from 'three';
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
  colourError,
  faceFacing,
  hexBytes,
  IDENTITY,
  LAYERS,
  light,
  linear,
  matrixOf,
  mix,
  orthoFront,
  orthoTop,
  perspective,
  plane,
  prng,
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

/** Every attribute array and index of every object under the view's root, keyed by child position and name. */
function arraysOf(view: EditMeshView): Map<string, ArrayLike<number>> {
  const out = new Map<string, ArrayLike<number>>();
  view.root.children.forEach((object, i) => {
    const geometry = (object as { geometry?: BufferGeometry }).geometry;
    if (geometry === undefined) return;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      out.set(`${i} ${object.type} ${name}`, (attribute as BufferAttribute).array);
    }
    if (geometry.index !== null) out.set(`${i} ${object.type} index`, geometry.index.array);
  });
  return out;
}

/** '' when both maps hold the same arrays, else where they first differ. */
function firstDifference(a: Map<string, ArrayLike<number>>, b: Map<string, ArrayLike<number>>): string {
  if (a.size !== b.size) return `${a.size} vs ${b.size} arrays`;
  for (const [key, x] of a) {
    const y = b.get(key);
    if (y === undefined) return `${key} missing`;
    if (x.length !== y.length) return `${key}: length ${x.length} vs ${y.length}`;
    for (let i = 0; i < x.length; i++) {
      if (!Object.is(x[i], y[i])) return `${key}[${i}]: ${x[i]} vs ${y[i]}`;
    }
  }
  return '';
}

/** The whole frame (RGBA bytes) right after a render. */
function frame(canvasRef: Canvas): Uint8Array {
  const gl = canvasRef.renderer.getContext();
  const out = new Uint8Array(canvasRef.width * canvasRef.height * 4);
  gl.readPixels(0, 0, canvasRef.width, canvasRef.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

/** Pixels of a frame that are not the clear colour (`BACKGROUND`). */
function drawnPixels(pixels: Uint8Array): number {
  const [r, g, b] = hexBytes(BACKGROUND);
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] !== r || pixels[i + 1] !== g || pixels[i + 2] !== b) n++;
  }
  return n;
}

function differentPixels(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++;
  }
  return n;
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
    expect(colourError(at(canvasRef, s), hexBytes(THEME.selected), 1)).toBe('');
    // Hot glyph: 7 px core + 1 px halo each side → the ring 4 px from the centre.
    expect(colourError(at(canvasRef, s, 4, 0), hexBytes(THEME.halo), 1)).toBe('');
    expect(colourError(at(canvasRef, s, 3, 0), hexBytes(THEME.selected), 1)).toBe('');
    const o = px(camera, vertexOf(d, other));
    expect(colourError(at(canvasRef, o), hexBytes(THEME.vertex), 1)).toBe('');
    // Plain glyph: 5 px core → ring 3 px from the centre.
    expect(colourError(at(canvasRef, o, -3, 0), hexBytes(THEME.halo), 1)).toBe('');
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
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, partner))), expected, 2)).toBe('');
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, picked))), hexBytes(THEME.selected), 1)).toBe('');
    // Hover a third vertex and pre-highlight its partner.
    const h = vertexAt(d, [0.5, -0.5, 0.5]);
    const hp = vertexAt(d, [-0.5, -0.5, 0.5]);
    view.setState(sel, null, { kind: 'vertex', index: h, partner: hp }, mirrored);
    canvasRef = render(view, camera);
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, h))), hexBytes(THEME.hover), 1)).toBe('');
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, hp))), hexBytes(THEME.hover), 1)).toBe('');
    // Moving the hover away restores both (hover-only update path).
    view.setState(sel, null, null, mirrored);
    canvasRef = render(view, camera);
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, h))), hexBytes(THEME.vertex), 1)).toBe('');
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, hp))), hexBytes(THEME.vertex), 1)).toBe('');
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

  it('draws a hover only in its own component mode (an edge hover in vertex mode draws nothing)', () => {
    const d = cube();
    const camera = perspective([0.3, 0.9, 3]);
    const e = edgeBetween(d, vertexAt(d, [-0.5, 0.5, 0.5]), vertexAt(d, [0.5, 0.5, 0.5]));
    const s = px(camera, [0.1, 0.5, 0.5]);
    const hovered = (canvasRef: Canvas): boolean =>
      [-2, -1, 0, 1, 2].some((dy) => colourError(at(canvasRef, s, 0, dy), hexBytes(THEME.hover), 1) === '');
    const edgeMode = selectionOf('edge', [], d.mesh.counts);
    const view = editView(d, edgeMode);
    view.setState(edgeMode, null, { kind: 'edge', index: e, partner: -1 }, null);
    expect(hovered(render(view, camera))).toBe(true);
    // Vertex mode still draws the edges (wire), but a hover of another kind is not this mode's hover.
    const vertexMode = selectionOf('vertex', [], d.mesh.counts);
    view.setState(vertexMode, null, { kind: 'edge', index: e, partner: -1 }, null);
    expect(hovered(render(view, camera))).toBe(false);
    // Hover-only update path too: a fresh vertex-mode view handed the edge hover second.
    const other = editView(d, vertexMode);
    other.setState(vertexMode, null, { kind: 'edge', index: e, partner: -1 }, null);
    view.root.removeFromParent();
    expect(hovered(render(other, camera))).toBe(false);
    // Face hovers do not tint faces outside face mode either.
    const front = faceFacing(d, [0, 0, 1]);
    other.setState(vertexMode, null, { kind: 'face', index: front, partner: -1 }, null);
    const centre = px(camera, [0.1, 0.1, 0.5]);
    const tinted = at(render(other, camera), centre);
    other.setState(vertexMode, null, null, null);
    expect(colourError(tinted, at(render(other, camera), centre), 0)).toBe('');
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
    expect(
      colourError(at(canvasRef, inLeft), bytes(mix(base, linear(THEME.selected), MESH_VIEW_STYLE.faceSelectedTint)), 2),
    ).toBe('');
    expect(
      colourError(
        at(canvasRef, inRight),
        bytes(mix(base, linear(THEME.selected), MESH_VIEW_STYLE.faceSelectedTint * MESH_VIEW_STYLE.mirroredMix)),
        2,
      ),
    ).toBe('');
    // The selected face's dot.
    expect(colourError(at(canvasRef, px(camera, centroidOf(d, left))), hexBytes(THEME.selected), 1)).toBe('');
  });
});

describe('EditMeshView: surface', () => {
  it('lights clay with the soft rig and palette colours in the colours shading', () => {
    const d = cube();
    const camera = orthoFront(4);
    const view = editView(d, selectionOf('vertex', [], d.mesh.counts));
    let canvasRef = render(view, camera);
    const centre = px(camera, [0.1, 0.15, 0.5]);
    expect(colourError(at(canvasRef, centre), bytes(lit(THEME.clay, camera, [0, 0, 1])), 2)).toBe('');
    // Palette: slot 0 (the primitives' paint) red.
    view.setPaint(new Map([[0, [255, 0, 0] as const]]));
    canvasRef = render(view, camera, { shading: 'colours' });
    const red = at(canvasRef, centre);
    expect(colourError(red, bytes(lit(0xff0000, camera, [0, 0, 1])), 2)).toBe('');
    expect(red[0]).toBeGreaterThanOrEqual(180);
    expect(red[1]).toBeLessThanOrEqual(40);
    expect(red[2]).toBeLessThanOrEqual(40);
    // `shaded` stays clay with a palette set; `lit` draws the palette too (M6A-B6-3).
    canvasRef = render(view, camera, { shading: 'shaded' });
    expect(colourError(at(canvasRef, centre), bytes(lit(THEME.clay, camera, [0, 0, 1])), 2)).toBe('');
    canvasRef = render(view, camera, { shading: 'lit' });
    expect(colourError(at(canvasRef, centre), bytes(lit(0xff0000, camera, [0, 0, 1])), 2)).toBe('');
    // A slot without a colour shows clay.
    view.setPaint(new Map([[3, [0, 255, 0] as const]]));
    canvasRef = render(view, camera, { shading: 'colours' });
    expect(colourError(at(canvasRef, centre), bytes(lit(THEME.clay, camera, [0, 0, 1])), 2)).toBe('');
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
    expect(colourError(at(canvasRef, px(camera, [0.6, 0, 0.1])), hexBytes(BACKGROUND), 1)).toBe('');
    expect(colourError(at(canvasRef, px(camera, [-0.6, 0, 0.1])), bytes(lit(THEME.clay, camera, [0, 1, 0])), 2)).toBe(
      '',
    );
    // The corner vertex of the hidden face only: no glyph.
    expect(colourError(at(canvasRef, px(camera, [1, 0, -0.5]), -1, 1), hexBytes(BACKGROUND), 1)).toBe('');
    // The shared vertex stays.
    expect(colourError(at(canvasRef, px(camera, [0, 0, -0.5]), 0, 1), hexBytes(THEME.vertex), 1)).toBe('');
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
    expect(colourError(at(canvasRef, px(camera, [0.6, 0, 0.1])), hexBytes(BACKGROUND), 1)).toBe('');
    expect(colourError(at(canvasRef, px(camera, [-0.6, 0, 0.1])), bytes(lit(THEME.clay, camera, [0, 1, 0])), 2)).toBe(
      '',
    );
    view.setIsolate(null);
    canvasRef = render(view, camera);
    expect(colourError(at(canvasRef, px(camera, [0.6, 0, 0.1])), bytes(lit(THEME.clay, camera, [0, 1, 0])), 2)).toBe(
      '',
    );
  });

  it('wire shading draws no surface and the edges in --wire-wiremode', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const view = editView(d, selectionOf('face', [], d.mesh.counts), HALF_PX);
    const canvasRef = render(view, camera, { shading: 'wire' });
    expect(colourError(at(canvasRef, px(camera, [-0.6, 0, 0.1], HALF_PX)), hexBytes(BACKGROUND), 1)).toBe('');
    // The middle edge (x = 0) on a pixel column: core, then the halo beside it.
    const line = px(camera, [0, 0, 0.2], HALF_PX);
    expect(colourError(at(canvasRef, line), hexBytes(THEME.wireMode), 1)).toBe('');
    expect(colourError(at(canvasRef, line, 1, 0), hexBytes(THEME.halo), 1)).toBe('');
    expect(colourError(at(canvasRef, line, 2, 0), hexBytes(BACKGROUND), 1)).toBe('');
  });

  it('draws an edge with an end behind the camera up to the near plane (where the picker finds it)', () => {
    // The scene of the picker's near-plane test: a long floor quad whose side edges end behind the camera.
    const d = plane({ width: 1.2, height: 4 });
    const camera = perspective([0, 0.3, 1.5]);
    const view = editView(d, selectionOf('edge', [], d.mesh.counts));
    const canvasRef = render(view, camera, { shading: 'wire' });
    for (const z of [-1, 0]) {
      const p = px(camera, [0.6, 0, z]);
      const around = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => at(canvasRef, p, dx, dy)));
      expect(around.some((q) => colourError(q, hexBytes(THEME.wireMode), 1) === '')).toBe(true);
    }
  });

  it('face orientation, back-face culling and the darker back side', () => {
    const d = plane();
    const below = perspective([0.3, -3, 0.4]);
    const view = editView(d, selectionOf('face', [], d.mesh.counts));
    const centre = px(below, [0.1, 0, 0.15]);
    let canvasRef = render(view, below);
    const back = viewNormal(below, [0, -1, 0]);
    expect(
      colourError(at(canvasRef, centre), bytes(scale(linear(THEME.clay), light(back) * LIGHT_RIG.backFactor)), 2),
    ).toBe('');
    canvasRef = render(view, below, { faceOrientation: true });
    const key = (light(back) - LIGHT_RIG.ambient - LIGHT_RIG.fill * fillDot(back)) / LIGHT_RIG.key;
    expect(
      colourError(
        at(canvasRef, centre),
        bytes(scale(linear(THEME.faceBack), LIGHT_RIG.orientationAmbient + LIGHT_RIG.orientationKey * key)),
        2,
      ),
    ).toBe('');
    canvasRef = render(view, below, { cull: true });
    expect(colourError(at(canvasRef, centre), hexBytes(BACKGROUND), 1)).toBe('');
    const above = perspective([0.3, 3, 0.4]);
    canvasRef = render(view, above, { faceOrientation: true });
    const front = viewNormal(above, [0, 1, 0]);
    const keyFront = (light(front) - LIGHT_RIG.ambient - LIGHT_RIG.fill * fillDot(front)) / LIGHT_RIG.key;
    expect(
      colourError(
        at(canvasRef, px(above, [0.1, 0, 0.15])),
        bytes(scale(linear(THEME.faceFront), LIGHT_RIG.orientationAmbient + LIGHT_RIG.orientationKey * keyFront)),
        2,
      ),
    ).toBe('');
  });

  it('flat display lights each face by its face normal; smooth normals vary across it', () => {
    const d = derived(cubeData({ hard: false }));
    const camera = perspective([1.2, 1, 3]);
    const view = editView(d, selectionOf('face', [], d.mesh.counts));
    const near = px(camera, [0.38, 0.38, 0.5]);
    const flat = at(render(view, camera, { flat: true }), near);
    expect(colourError(flat, bytes(lit(THEME.clay, camera, [0, 0, 1])), 2)).toBe('');
    const smooth = at(render(view, camera, { flat: false }), near);
    expect(Math.abs(smooth[0] - flat[0]) + Math.abs(smooth[2] - flat[2])).toBeGreaterThan(3);
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
    expect(colourError(shown, without, 0)).toBe('');
    // X-ray: the occluded pass blends the glyph at 35 % over whatever is drawn there.
    view.setState(sel, null, null, null);
    const xShown = at(render(view, camera, { xray: true }), s);
    view.setState(sel, hiddenBack, null, null);
    const xWithout = at(render(view, camera, { xray: true }), s);
    expect(colourError(xShown, over(hexBytes(THEME.vertex), MESH_VIEW_STYLE.occludedAlpha, xWithout), 2)).toBe('');
    // A vertex in front keeps its full colour in x-ray.
    view.setState(sel, null, null, null);
    const front = vertexAt(d, [0.5, 0.5, 0.5]);
    expect(
      colourError(at(render(view, camera, { xray: true }), px(camera, vertexOf(d, front))), hexBytes(THEME.vertex), 1),
    ).toBe('');
    // The x-ray surface is half transparent over the background.
    const surfaceOnly = px(camera, [0.15, 0.2, 0.5]);
    const opaque = bytes(lit(THEME.clay, camera, [0, 0, 1]));
    expect(
      colourError(
        at(render(view, camera, { xray: true }), surfaceOnly),
        over(opaque, MESH_VIEW_STYLE.xrayOpacity, hexBytes(BACKGROUND)),
        3,
      ),
    ).toBe('');
  });

  it('x-ray: an occluded edge draws in the second pass at 35 %, and never without x-ray', () => {
    const d = cube();
    const camera = perspective([0.6, 0.4, 3]);
    // The back left vertical edge projects inside the front face.
    const e = edgeBetween(d, vertexAt(d, [-0.5, -0.5, -0.5]), vertexAt(d, [-0.5, 0.5, -0.5]));
    const sel = selectionOf('edge', [e], d.mesh.counts);
    const view = editView(d, sel);
    const hiddenEdge: HiddenSet = {
      verts: new BitSet(d.mesh.counts.points),
      edges: new BitSet(d.mesh.counts.edges),
      faces: new BitSet(d.mesh.counts.faces),
    };
    hiddenEdge.edges.add(e);
    const s = px(camera, [-0.5, 0, -0.5]);
    view.setState(sel, null, null, null);
    const shown = at(render(view, camera), s);
    view.setState(sel, hiddenEdge, null, null);
    const without = at(render(view, camera), s);
    expect(colourError(shown, without, 0)).toBe('');
    view.setState(sel, null, null, null);
    const xShown = at(render(view, camera, { xray: true }), s);
    view.setState(sel, hiddenEdge, null, null);
    const xWithout = at(render(view, camera, { xray: true }), s);
    expect(colourError(xWithout, hexBytes(THEME.selected), 40)).not.toBe('');
    expect(colourError(xShown, over(hexBytes(THEME.selected), MESH_VIEW_STYLE.occludedAlpha, xWithout), 2)).toBe('');
  });

  it('x-ray: an occluded face-centre dot draws in the second pass at 35 %, and never without x-ray', () => {
    const d = cube();
    const camera = perspective([0.6, 0.4, 3]);
    const back = faceFacing(d, [0, 0, -1]);
    const s = px(camera, centroidOf(d, back));
    // The front face's own dot is far enough away not to touch the back one's pixels.
    const frontDot = px(camera, centroidOf(d, faceFacing(d, [0, 0, 1])));
    expect(Math.hypot(frontDot[0] - s[0], frontDot[1] - s[1])).toBeGreaterThan(12);
    const selected = selectionOf('face', [back], d.mesh.counts);
    const none = selectionOf('face', [], d.mesh.counts);
    const view = editView(d, none);
    const sample = (sel: ComponentSelection, xray: boolean): [number, number, number, number] => {
      view.setState(sel, null, null, null);
      return at(render(view, camera, { xray }), s);
    };
    // Without x-ray the dot is occluded: selecting its face changes nothing at its pixel.
    expect(colourError(sample(selected, false), sample(none, false), 0)).toBe('');
    // In x-ray both pixels are the dot at 35 % over the same surface: solve the plain one for the surface …
    const plain = sample(none, true);
    const hot = sample(selected, true);
    const a = MESH_VIEW_STYLE.occludedAlpha;
    const surface = [0, 1, 2].map((i) => ((plain[i] as number) - a * (hexBytes(THEME.vertex)[i] as number)) / (1 - a));
    // … and the selected one must be the selected colour at 35 % over that surface.
    expect(colourError(hot, over(hexBytes(THEME.selected), a, surface), 3)).toBe('');
    expect(colourError(hot, plain, 10)).not.toBe('');
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
    expect(colourError(at(render(view, camera, { normals: 'face' }), p), hexBytes(THEME.normalFace), 1)).toBe('');
    expect(colourError(at(render(view, camera, { normals: 'off' }), p), hexBytes(BACKGROUND), 1)).toBe('');
    expect(colourError(at(render(view, camera, { normals: 'vertex' }), p), hexBytes(BACKGROUND), 1)).toBe('');
    // Vertex normals (faceted: along the face normals) from the corners.
    const q = px(camera, [0.75, 0, 0.5], HALF_PX);
    expect(colourError(at(render(view, camera, { normals: 'both' }), q), hexBytes(THEME.normalVertex), 1)).toBe('');
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

  it('draws no normals or diagonals of hidden faces: every face hidden leaves the background only', () => {
    const d = cube();
    const camera = perspective([1.6, 1.2, 2.4]);
    const { points: P, edges: E, faces: F } = d.mesh.counts;
    const sel = selectionOf('vertex', [], d.mesh.counts);
    const all: HiddenSet = { verts: new BitSet(P), edges: new BitSet(E), faces: new BitSet(F) };
    for (let f = 0; f < F; f++) all.faces.add(f);
    const overlays: Partial<MeshPaneDisplay> = { shading: 'wire', normals: 'both', triangulation: true };
    // Hidden before the overlays are first built (the build path) …
    const view = editView(d, sel);
    view.setState(sel, all, null, null);
    expect(drawnPixels(frame(render(view, camera, overlays)))).toBe(0);
    expect(drawnPixels(frame(render(view, camera, { ...overlays, shading: 'shaded', xray: true })))).toBe(0);
    view.root.removeFromParent();
    // … and after (the visibility-only rewrite of overlays already built), then shown again.
    const later = editView(d, sel);
    const shown = drawnPixels(frame(render(later, camera, overlays)));
    expect(shown).toBeGreaterThan(0);
    later.setState(sel, all, null, null);
    expect(drawnPixels(frame(render(later, camera, overlays)))).toBe(0);
    later.setState(sel, null, null, null);
    expect(drawnPixels(frame(render(later, camera, overlays)))).toBe(shown);
  });

  it('draws no normals or diagonals of faces outside the isolate set (an empty set leaves the background only)', () => {
    const d = cube();
    const camera = perspective([1.6, 1.2, 2.4]);
    const sel = selectionOf('face', [], d.mesh.counts);
    const overlays: Partial<MeshPaneDisplay> = { shading: 'wire', normals: 'both', triangulation: true };
    const view = editView(d, sel);
    const shown = drawnPixels(frame(render(view, camera, overlays)));
    expect(shown).toBeGreaterThan(0);
    view.setIsolate(new BitSet(d.mesh.counts.faces));
    expect(drawnPixels(frame(render(view, camera, overlays)))).toBe(0);
    view.setIsolate(null);
    expect(drawnPixels(frame(render(view, camera, overlays)))).toBe(shown);
    // Isolated before the first build.
    view.root.removeFromParent();
    const first = editView(d, sel);
    first.setIsolate(new BitSet(d.mesh.counts.faces));
    expect(drawnPixels(frame(render(first, camera, overlays)))).toBe(0);
  });

  it('hiding one face removes its normals and its diagonal only', () => {
    const d = cube();
    const camera = orthoTop(4);
    const sel = selectionOf('vertex', [], d.mesh.counts);
    const right = faceFacing(d, [1, 0, 0]);
    const hidden: HiddenSet = {
      verts: new BitSet(d.mesh.counts.points),
      edges: new BitSet(d.mesh.counts.edges),
      faces: new BitSet(d.mesh.counts.faces),
    };
    hidden.faces.add(right);
    const view = editView(d, sel, HALF_PX);
    // Seen from the top: the ±X face normals at (±0.75, 0, 0), the ±X corner normals at (±0.75, ·, ±0.5).
    const normalsOf = (canvasRef: Canvas, x: number): [boolean, boolean] => [
      colourError(at(canvasRef, px(camera, [x, 0, 0], HALF_PX)), hexBytes(THEME.normalFace), 1) === '',
      colourError(at(canvasRef, px(camera, [x, 0, 0.5], HALF_PX)), hexBytes(THEME.normalVertex), 1) === '',
    ];
    let canvasRef = render(view, camera, { normals: 'both' });
    expect(normalsOf(canvasRef, 0.75)).toEqual([true, true]);
    expect(normalsOf(canvasRef, -0.75)).toEqual([true, true]);
    view.setState(sel, hidden, null, null);
    canvasRef = render(view, camera, { normals: 'both' });
    expect(normalsOf(canvasRef, 0.75)).toEqual([false, false]);
    expect(colourError(at(canvasRef, px(camera, [0.75, 0, 0], HALF_PX)), hexBytes(BACKGROUND), 1)).toBe('');
    expect(normalsOf(canvasRef, -0.75)).toEqual([true, true]);

    // Diagonals: two quads seen from the top; hiding the right one leaves the left one's diagonal.
    view.root.removeFromParent();
    const two = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const top = orthoTop(3);
    const rightQuad = centroidOf(two, 0)[0] > 0 ? 0 : 1;
    const flat = editView(two, selectionOf('face', [], two.mesh.counts), HALF_PX);
    const base = bytes(lit(THEME.clay, top, [0, 1, 0]));
    const onDiagonal = (canvasRef: Canvas, cx: number, under: readonly number[]): boolean =>
      [
        [0.25, 0.25],
        [0.25, -0.25],
      ].some(([x, z]) => {
        const pixel = at(canvasRef, px(top, [cx + (x as number), 0, z as number], HALF_PX));
        const expected = over(hexBytes(THEME.wire), MESH_VIEW_STYLE.triangulationAlpha, under);
        return [0, 1, 2].every((i) => Math.abs((pixel[i] as number) - (expected[i] as number)) <= 3);
      });
    const shading: Partial<MeshPaneDisplay> = { triangulation: true, components: false };
    canvasRef = render(flat, top, shading);
    expect(onDiagonal(canvasRef, 0.5, base)).toBe(true);
    expect(onDiagonal(canvasRef, -0.5, base)).toBe(true);
    const hideRight: HiddenSet = {
      verts: new BitSet(two.mesh.counts.points),
      edges: new BitSet(two.mesh.counts.edges),
      faces: new BitSet(two.mesh.counts.faces),
    };
    hideRight.faces.add(rightQuad);
    flat.setState(selectionOf('face', [], two.mesh.counts), hideRight, null, null);
    canvasRef = render(flat, top, shading);
    expect(onDiagonal(canvasRef, -0.5, base)).toBe(true);
    // Nothing at all where the right quad was: neither surface nor its diagonal.
    for (const [x, z] of [
      [0.75, 0.25],
      [0.75, -0.25],
      [0.25, 0.25],
      [0.25, -0.25],
    ] as const) {
      expect(colourError(at(canvasRef, px(top, [x, 0, z], HALF_PX)), hexBytes(BACKGROUND), 1)).toBe('');
    }
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
    expect(colourError(at(canvasRef, px(camera, centroidOf(d, front))), hexBytes(THEME.lintNgon), 1)).toBe('');
    expect(colourError(at(canvasRef, px(camera, [0, -0.5, 0.5])), hexBytes(THEME.lintError), 1)).toBe('');
    canvasRef = render(view, camera, { meshCheck: false });
    expect(at(canvasRef, px(camera, centroidOf(d, front))).slice(0, 3)).not.toEqual(hexBytes(THEME.lintNgon));
  });

  it('skips Mesh Check markers of hidden and isolated elements, corners included', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const right = centroidOf(d, 0)[0] > 0 ? 0 : 1;
    const left = 1 - right;
    const sel = selectionOf('face', [], d.mesh.counts);
    const view = editView(d, sel);
    // A corner of each quad at its outer far vertex: (1, 0, -0.5) on the right, (-1, 0, -0.5) on the left.
    const cornerAt = (f: number, p: readonly [number, number, number]): number => {
      const v = vertexAt(d, p);
      const m = d.mesh;
      for (let c = 0; c < m.counts.corners; c++) if (m.cornerFace(c) === f && m.cornerVert(c) === v) return c;
      throw new Error('no such corner');
    };
    view.setLints([
      {
        code: 'zero-area-face',
        message: 'corner',
        elements: Uint32Array.of(cornerAt(right, [1, 0, -0.5]), cornerAt(left, [-1, 0, -0.5])),
        domain: 'corner',
      },
    ]);
    const marker = (canvasRef: Canvas, x: number): boolean =>
      colourError(at(canvasRef, px(camera, [x, 0, -0.5])), hexBytes(THEME.lintError), 1) === '';
    let canvasRef = render(view, camera, { meshCheck: true });
    expect([marker(canvasRef, 1), marker(canvasRef, -1)]).toEqual([true, true]);
    const hidden: HiddenSet = {
      verts: new BitSet(d.mesh.counts.points),
      edges: new BitSet(d.mesh.counts.edges),
      faces: new BitSet(d.mesh.counts.faces),
    };
    hidden.faces.add(right);
    view.setState(sel, hidden, null, null);
    canvasRef = render(view, camera, { meshCheck: true });
    expect([marker(canvasRef, 1), marker(canvasRef, -1)]).toEqual([false, true]);
    view.setState(sel, null, null, null);
    const only = new BitSet(d.mesh.counts.faces);
    only.add(right);
    view.setIsolate(only);
    canvasRef = render(view, camera, { meshCheck: true });
    expect([marker(canvasRef, 1), marker(canvasRef, -1)]).toEqual([true, false]);
  });

  it('draws the symmetry plane across the mesh bounds when the pane shows it', () => {
    const d = cube();
    const camera = orthoFront(4);
    const view = editView(d, selectionOf('vertex', [], d.mesh.counts));
    view.setSymmetryPlane({ axis: 'z', offset: 0 });
    const outside = px(camera, [0.58, 0.1, 0]);
    const expected = over(hexBytes(THEME.symPlane), MESH_VIEW_STYLE.symPlaneAlpha, hexBytes(BACKGROUND));
    expect(colourError(at(render(view, camera), outside), expected, 2)).toBe('');
    expect(colourError(at(render(view, camera, { symmetryPlane: false }), outside), hexBytes(BACKGROUND), 1)).toBe('');
    view.setSymmetryPlane(null);
    expect(colourError(at(render(view, camera), outside), hexBytes(BACKGROUND), 1)).toBe('');
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
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, full))), hexBytes(THEME.soft[0]), 2)).toBe('');
    // Weight 0.5 = halfway between --soft-2 and --soft-3 (linear light), within the 8-bit weight.
    expect(
      colourError(
        at(canvasRef, px(camera, vertexOf(d, half))),
        bytes(mix(linear(THEME.soft[1]), linear(THEME.soft[2]), 0.5)),
        4,
      ),
    ).toBe('');
    view.setSoftWeights(null);
    canvasRef = render(view, camera);
    expect(colourError(at(canvasRef, px(camera, vertexOf(d, full))), hexBytes(THEME.vertex), 1)).toBe('');
  });

  it('fades the whole view to 35 % when dimmed', () => {
    const d = cube();
    const camera = orthoFront(4);
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    surface.setData(d.data, d.tri, d.normals, null);
    const centre = px(camera, [0.1, 0.15, 0.5]);
    const opaque = bytes(lit(THEME.clay, camera, [0, 0, 1]));
    expect(colourError(at(render(surface, camera), centre), opaque, 2)).toBe('');
    expect(
      colourError(
        at(render(surface, camera, { dimmed: true }), centre),
        over(opaque, MESH_VIEW_STYLE.dimOpacity, hexBytes(BACKGROUND)),
        3,
      ),
    ).toBe('');
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
    expect(colourError(at(canvasRef, edge, 0, 1), face, 2)).toBe('');
    canvasRef = render(surface, camera, { hardEdges: true });
    expect(colourError(at(canvasRef, edge), hexBytes(THEME.hardEdge), 1)).toBe('');
    expect(colourError(at(canvasRef, edge, 0, 2), face, 2)).toBe('');
    canvasRef = render(surface, camera, { wireOnShaded: true });
    expect(colourError(at(canvasRef, edge), hexBytes(THEME.wire), 1)).toBe('');
    expect(surface.current).toBe(d.data);
  });

  it('applies per-pane display before each render (one scene, two panes)', () => {
    const d = cube();
    const camera = orthoFront(4);
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    surface.setData(d.data, d.tri, d.normals, new Map([[0, [0, 0, 255] as const]]));
    const centre = px(camera, [0.1, 0.15, 0.5]);
    expect(colourError(at(render(surface, camera, { shading: 'wire' }), centre), hexBytes(BACKGROUND), 1)).toBe('');
    expect(
      colourError(
        at(render(surface, camera, { shading: 'colours' }), centre),
        bytes(lit(0x0000ff, camera, [0, 0, 1])),
        2,
      ),
    ).toBe('');
    expect(
      colourError(
        at(render(surface, camera, { shading: 'shaded' }), centre),
        bytes(lit(THEME.clay, camera, [0, 0, 1])),
        2,
      ),
    ).toBe('');
  });

  it('repaints new palette colours by content, rewriting the paint attribute only (setPaint)', () => {
    const d = cube();
    const camera = orthoFront(4);
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    surface.setData(d.data, d.tri, d.normals, new Map([[0, [255, 0, 0] as const]]));
    const centre = px(camera, [0.1, 0.15, 0.5]);
    const colours: Partial<MeshPaneDisplay> = { shading: 'colours' };
    expect(colourError(at(render(surface, camera, colours), centre), bytes(lit(0xff0000, camera, [0, 0, 1])), 2)).toBe(
      '',
    );
    const versions = (): Map<string, number> => {
      const out = new Map<string, number>();
      surface.root.traverse((object) => {
        const geometry = (object as { geometry?: BufferGeometry }).geometry;
        if (geometry === undefined) return;
        for (const [name, attribute] of Object.entries(geometry.attributes)) {
          out.set(`${object.id} ${name}`, (attribute as BufferAttribute).version);
        }
        if (geometry.index !== null) out.set(`${object.id} index`, geometry.index.version);
      });
      return out;
    };
    const before = versions();
    // The same colours in a fresh map (the document hands out one per query): nothing uploaded.
    surface.setPaint(new Map([[0, [255, 0, 0] as const]]));
    expect(versions()).toEqual(before);
    // Another palette's colours: the paint attribute only.
    surface.setPaint(new Map([[0, [0, 0, 255] as const]]));
    const after = versions();
    const changed = [...after].filter(([key, version]) => before.get(key) !== version).map(([key]) => key);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((key) => key.endsWith(' paint'))).toBe(true);
    expect(colourError(at(render(surface, camera, colours), centre), bytes(lit(0x0000ff, camera, [0, 0, 1])), 2)).toBe(
      '',
    );
    expect(surface.colours?.get(0)).toEqual([0, 0, 255]);
    // No palette: clay.
    surface.setPaint(null);
    expect(
      colourError(at(render(surface, camera, colours), centre), bytes(lit(THEME.clay, camera, [0, 0, 1])), 2),
    ).toBe('');
  });

  it('draws Blinn swatches with a highlight and Lambert ones without, in colours and lit only (SHADING-SPEC §3)', () => {
    const d = cube();
    const camera = orthoFront(4);
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    const red = new Map([[0, [255, 0, 0] as const]]);
    surface.setData(d.data, d.tri, d.normals, red);
    const centre = px(camera, [0.1, 0.15, 0.5]);
    const colours: Partial<MeshPaneDisplay> = { shading: 'colours' };
    const lambert = at(render(surface, camera, colours), centre);
    expect(colourError(lambert, bytes(lit(0xff0000, camera, [0, 0, 1])), 2)).toBe('');
    // Lambert: the shade attribute is all zeros.
    const shade = (): Uint8Array => {
      let found: Uint8Array | null = null;
      surface.root.traverse((object) => {
        const attribute = (object as { geometry?: BufferGeometry }).geometry?.attributes['shade'];
        if (attribute !== undefined) found = attribute.array as Uint8Array;
      });
      if (found === null) throw new Error('no shade attribute');
      return found;
    };
    expect(shade().every((byte) => byte === 0)).toBe(true);

    // Blinn, glossiness 0.2, white specular: a broad white highlight on the red face.
    surface.setPaint(red, new Map([[0, { glossiness: 0.2, specular: [255, 255, 255] as const }]]));
    expect(surface.shading?.get(0)?.glossiness).toBe(0.2);
    const bytesOf = shade();
    expect([...bytesOf.subarray(0, 4)]).toEqual([255, 255, 255, 1 + Math.round(0.2 * 254)]);
    const blinn = at(render(surface, camera, colours), centre);
    expect(blinn[0]).toBeGreaterThanOrEqual(lambert[0]);
    expect(blinn[1]).toBeGreaterThan(lambert[1] + 30);
    expect(blinn[2]).toBeGreaterThan(lambert[2] + 30);
    // lit draws the same; shaded (clay) has no highlight.
    expect(colourError(at(render(surface, camera, { shading: 'lit' }), centre), blinn, 1)).toBe('');
    expect(
      colourError(
        at(render(surface, camera, { shading: 'shaded' }), centre),
        bytes(lit(THEME.clay, camera, [0, 0, 1])),
        2,
      ),
    ).toBe('');

    // The same shaders in fresh maps upload nothing; back to Lambert clears the attribute.
    const versionOf = (): number => {
      let version = -1;
      surface.root.traverse((object) => {
        const attribute = (object as { geometry?: BufferGeometry }).geometry?.attributes['shade'];
        if (attribute !== undefined) version = (attribute as BufferAttribute).version;
      });
      return version;
    };
    const before = versionOf();
    surface.setPaint(
      new Map([[0, [255, 0, 0] as const]]),
      new Map([[0, { glossiness: 0.2, specular: [255, 255, 255] }]]),
    );
    expect(versionOf()).toBe(before);
    surface.setPaint(red, null);
    expect(shade().every((byte) => byte === 0)).toBe(true);
    expect(colourError(at(render(surface, camera, colours), centre), lambert, 1)).toBe('');
  });

  it('keeps component hides: draws what an edit view with the same hidden set draws without overlays (M6A-B6-26)', () => {
    const random = prng(26);
    const shapes: [Derived, Camera][] = [
      [cube(), perspective([1.6, 1.2, 2.4])],
      [plane({ width: 2, height: 2, subdivisionsWidth: 4, subdivisionsHeight: 3 }), perspective([1.2, 2.6, 2.2])],
    ];
    const displays: Partial<MeshPaneDisplay>[] = [
      { shading: 'wire', normals: 'both', triangulation: true },
      { shading: 'shaded', wireOnShaded: true, hardEdges: true, normals: 'both', triangulation: true },
      { shading: 'shaded', xray: true, hardEdges: true },
    ];
    const frameOf = (view: EditMeshView | MeshSurface, camera: Camera, display: Partial<MeshPaneDisplay>) => {
      const pixels = frame(render(view, camera, { ...display, components: false }));
      view.root.removeFromParent();
      return pixels;
    };
    for (const [d, camera] of shapes) {
      const { points: P, edges: E, faces: F } = d.mesh.counts;
      const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
      disposables.push(surface);
      surface.setData(d.data, d.tri, d.normals, null);
      const shown = displays.map((display) => frameOf(surface, camera, display));
      for (let round = 0; round < 4; round++) {
        const hidden: HiddenSet = { verts: new BitSet(P), edges: new BitSet(E), faces: new BitSet(F) };
        for (let f = 0; f < F; f++) if (random() < 0.35) hidden.faces.add(f);
        for (let e = 0; e < E; e++) if (random() < 0.1) hidden.edges.add(e);
        for (let v = 0; v < P; v++) if (random() < 0.1) hidden.verts.add(v);
        if (hidden.faces.isEmpty()) hidden.faces.add(0);
        const edit = editView(d, selectionOf('vertex', [], d.mesh.counts));
        edit.setState(selectionOf('vertex', [], d.mesh.counts), hidden, null, null);
        surface.setHidden(hidden);
        displays.forEach((display, i) => {
          const expected = frameOf(edit, camera, display);
          const actual = frameOf(surface, camera, display);
          expect(differentPixels(actual, expected), `round ${round}, display ${i}`).toBe(0);
          expect(differentPixels(actual, shown[i] as Uint8Array), `round ${round}, display ${i}`).toBeGreaterThan(0);
        });
        // Show All: the surface draws everything again.
        surface.setHidden(null);
        displays.forEach((display, i) => {
          expect(differentPixels(frameOf(surface, camera, display), shown[i] as Uint8Array)).toBe(0);
        });
      }
      // A set mutated in place and passed again applies; one of another topology hides nothing; a set passed before
      // the first `setData` applies to a revision it fits.
      const wire = displays[0] as Partial<MeshPaneDisplay>;
      const unhidden = shown[0] as Uint8Array;
      const hidden: HiddenSet = { verts: new BitSet(P), edges: new BitSet(E), faces: new BitSet(F) };
      surface.setHidden(hidden);
      hidden.faces.add(0);
      surface.setHidden(hidden);
      const edit = editView(d, selectionOf('vertex', [], d.mesh.counts));
      edit.setState(selectionOf('vertex', [], d.mesh.counts), hidden, null, null);
      const faceZeroHidden = frameOf(edit, camera, wire);
      expect(differentPixels(faceZeroHidden, unhidden)).toBeGreaterThan(0);
      expect(differentPixels(frameOf(surface, camera, wire), faceZeroHidden)).toBe(0);
      const stale: HiddenSet = { verts: new BitSet(P + 1), edges: new BitSet(E + 1), faces: new BitSet(F + 1) };
      stale.faces.add(0);
      surface.setHidden(stale);
      expect(differentPixels(frameOf(surface, camera, wire), unhidden)).toBe(0);
      const fresh = new MeshSurface({ theme: THEME, layers: LAYERS });
      disposables.push(fresh);
      fresh.setHidden(hidden);
      fresh.setData(d.data, d.tri, d.normals, null);
      expect(differentPixels(frameOf(fresh, camera, wire), faceZeroHidden)).toBe(0);
    }
  });

  it('does not occlude through hidden faces (M6A-B6-26)', () => {
    const d = cube();
    const surface = new MeshSurface({ theme: THEME, layers: LAYERS });
    disposables.push(surface);
    surface.setData(d.data, d.tri, d.normals, null);
    surface.setWorld(IDENTITY);
    // Along Z through the cube's centre: only the ±Z faces lie on the segment.
    const from = new Vector3(0.1, 0.1, 5);
    const to = new Vector3(0.1, 0.1, -5);
    expect(surface.occludes(from, to)).toBe(true);
    const { points: P, edges: E, faces: F } = d.mesh.counts;
    const hidden: HiddenSet = { verts: new BitSet(P), edges: new BitSet(E), faces: new BitSet(F) };
    hidden.faces.add(faceFacing(d, [0, 0, 1]));
    surface.setHidden(hidden);
    expect(surface.occludes(from, to)).toBe(true);
    hidden.faces.add(faceFacing(d, [0, 0, -1]));
    surface.setHidden(hidden);
    expect(surface.occludes(from, to)).toBe(false);
    // Along X the ±X faces are still drawn.
    expect(surface.occludes(new Vector3(5, 0.1, 0.1), new Vector3(-5, 0.1, 0.1))).toBe(true);
    surface.setHidden(null);
    expect(surface.occludes(from, to)).toBe(true);
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
    expect(colourError(at(canvasRef, px(camera, [0.8, 0.8, 0.5])), hexBytes(THEME.selected), 1)).toBe('');
    expect(at(canvasRef, px(camera, [0.5, 0.5, 0.5])).slice(0, 3)).not.toEqual(hexBytes(THEME.selected));
    // A topology change (another mesh) rebuilds and drops the old selection.
    const other = plane();
    view.update(other.mesh, { ...delta.dirty, topology: true }, other.tri, other.normals);
    expect(view.mode).toBeNull();
    canvasRef = render(view, orthoTop(3));
    expect(colourError(at(canvasRef, [200, 150], -10, -10), bytes(lit(THEME.clay, orthoTop(3), [0, 1, 0])), 2)).toBe(
      '',
    );
  });

  it('redraws edge flags from an incremental update (hard 2 px → soft 1 px) and the smoothing they change', () => {
    const d = cube();
    const camera = perspective([0.3, 0.9, 3]);
    const e = edgeBetween(d, vertexAt(d, [-0.5, 0.5, 0.5]), vertexAt(d, [0.5, 0.5, 0.5]));
    const view = editView(d, selectionOf('face', [], d.mesh.counts));
    const s = px(camera, [0.1, 0.5, 0.5]);
    // On the front face just below the edge (smooth shading interpolates the corner normals there).
    const nearEdge = px(camera, [0.1, 0.4, 0.5]);
    const darkRows = (canvasRef: Canvas): number =>
      [-2, -1, 0, 1, 2].filter((dy) => colourError(at(canvasRef, s, 0, dy), hexBytes(THEME.hardEdge), 2) === '').length;
    let canvasRef = render(view, camera, { hardEdges: true });
    const hard = darkRows(canvasRef);
    const hardShade = at(canvasRef, nearEdge);
    expect(hard).toBeGreaterThanOrEqual(2);
    expect((d.mesh.edgeFlags(e) & EDGE_HARD) !== 0).toBe(true);
    d.mesh.begin('test.soften');
    d.mesh.setEdgeFlags(e, 0);
    const delta = d.mesh.end();
    expect(delta.dirty.topology).toBe(false);
    expect(delta.dirty.points).toHaveLength(0);
    const normals = computeNormals(d.mesh);
    view.update(d.mesh, delta.dirty, triangulate(d.mesh), normals);
    canvasRef = render(view, camera, { hardEdges: true });
    const soft = darkRows(canvasRef);
    expect(soft).toBeGreaterThanOrEqual(1);
    expect(soft).toBeLessThan(hard);
    // The two faces now share the edge's corner normals: the shading near it changes, exactly as a rebuilt view draws.
    const softShade = at(canvasRef, nearEdge);
    expect(colourError(softShade, hardShade, 3)).not.toBe('');
    view.root.removeFromParent();
    const fresh = editView(d, selectionOf('face', [], d.mesh.counts));
    fresh.setMesh(d.mesh, triangulate(d.mesh), normals);
    fresh.setState(selectionOf('face', [], d.mesh.counts), null, null, null);
    expect(colourError(at(render(fresh, camera, { hardEdges: true }), nearEdge), softShade, 0)).toBe('');
  });

  it('equals a full rebuild after random moves, flags, custom normals, paint, hiding and isolating (arrays, pixels)', () => {
    const d = cube({ subdivisionsWidth: 2, subdivisionsHeight: 2, subdivisionsDepth: 2 });
    const mesh = d.mesh;
    const { points: P, edges: E, faces: F, corners: C } = mesh.counts;
    const random = prng(0xb6);
    const camera = perspective([1.6, 1.2, 2.4]);
    const display: Partial<MeshPaneDisplay> = {
      normals: 'both',
      triangulation: true,
      hardEdges: true,
      wireOnShaded: true,
    };
    const sel = selectionOf('vertex', [0, 5, 9], mesh.counts);
    const hidden: HiddenSet = { verts: new BitSet(P), edges: new BitSet(E), faces: new BitSet(F) };
    hidden.faces.add(faceFacing(d, [1, 0, 0]));
    const palette = new Map<number, readonly [number, number, number]>([
      [1, [200, 60, 40]],
      [2, [40, 160, 220]],
    ]);
    const view = new EditMeshView({ theme: THEME, layers: LAYERS });
    disposables.push(view);
    view.setMesh(mesh, d.tri, d.normals);
    view.setState(sel, hidden, null, null);
    view.setPaint(palette);
    // A first frame: the attributes are on the GPU, so later writes go up as ranges.
    const canvasRef = render(view, camera, display);
    mesh.begin('test.layers');
    const custom = mesh.addLayer(BUILTIN_LAYERS.normalCustom);
    const paint = mesh.addLayer(BUILTIN_LAYERS.paint);
    const added = mesh.end();
    view.update(mesh, added.dirty, triangulate(mesh), computeNormals(mesh));

    const counts = { move: 0, flag: 0, custom: 0, paint: 0, hide: 0, isolate: 0 };
    // The pane's face isolate set (null = none); hiding and isolating rewrite the overlays' visibility only.
    let isolate: BitSet | null = null;
    for (let step = 0; step < 30; step++) {
      mesh.begin('test.edit');
      const ops = 1 + Math.floor(random() * 3);
      for (let k = 0; k < ops; k++) {
        const r = random();
        if (r < 0.12) {
          hidden.faces.toggle(Math.floor(random() * F));
          counts.hide++;
          continue;
        }
        if (r < 0.22) {
          if (isolate !== null && random() < 0.3) isolate = null;
          else {
            if (isolate === null) {
              isolate = new BitSet(F);
              for (let f = 0; f < F; f++) isolate.add(f);
            }
            isolate.toggle(Math.floor(random() * F));
          }
          counts.isolate++;
          continue;
        }
        if (r < 0.4) {
          const v = Math.floor(random() * P);
          const p = mesh.position;
          mesh.setPosition(
            v,
            (p[3 * v] as number) + (random() - 0.5) * 0.15,
            (p[3 * v + 1] as number) + (random() - 0.5) * 0.15,
            (p[3 * v + 2] as number) + (random() - 0.5) * 0.15,
          );
          counts.move++;
        } else if (r < 0.7) {
          const e = Math.floor(random() * E);
          mesh.setEdgeFlags(e, mesh.edgeFlags(e) ^ EDGE_HARD);
          counts.flag++;
        } else if (r < 0.85) {
          const c = Math.floor(random() * C);
          const clear = random() < 0.25;
          for (let comp = 0; comp < 3; comp++) custom.set(c, comp, clear ? 0 : random() - 0.5);
          counts.custom++;
        } else {
          paint.set(Math.floor(random() * F), 0, Math.floor(random() * 3));
          counts.paint++;
        }
      }
      const delta = mesh.end();
      expect(delta.dirty.topology).toBe(false);
      const tri = triangulate(mesh);
      const normals = computeNormals(mesh);
      view.update(mesh, delta.dirty, tri, normals);
      view.setState(sel, hidden, null, null);
      view.setIsolate(isolate);
      const fresh = new EditMeshView({ theme: THEME, layers: LAYERS });
      fresh.setMesh(mesh, tri, normals);
      fresh.setState(sel, hidden, null, null);
      fresh.setIsolate(isolate);
      fresh.setPaint(palette);
      try {
        // The same arrays (every attribute and index of every object, lazy overlays built for the pane) …
        view.applyPane({ ...DISPLAY, ...display });
        fresh.applyPane({ ...DISPLAY, ...display });
        expect(firstDifference(arraysOf(view), arraysOf(fresh)), `step ${step}`).toBe('');
        // … and the same pixels: the incremental ranges reached the GPU.
        canvasRef.render(camera);
        const incremental = frame(canvasRef);
        view.root.removeFromParent();
        canvasRef.scene.add(fresh.root);
        canvasRef.render(camera);
        const rebuilt = frame(canvasRef);
        expect(differentPixels(incremental, rebuilt), `step ${step}`).toBe(0);
      } finally {
        fresh.dispose();
        canvasRef.scene.add(view.root);
      }
    }
    expect(Object.values(counts).every((n) => n >= 3)).toBe(true);
  });

  it('redraws a selection, hidden set or isolate set mutated in place and passed again', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const right = centroidOf(d, 0)[0] > 0 ? 0 : 1;
    const corner = vertexAt(d, [-1, 0, -0.5]);
    const glyph = (canvasRef: Canvas) => at(canvasRef, px(camera, [-1, 0, -0.5]), 1, 1);
    const inRight = px(camera, [0.6, 0, 0.1]);
    const sel = selectionOf('vertex', [], d.mesh.counts);
    const view = editView(d, sel);
    expect(colourError(glyph(render(view, camera)), hexBytes(THEME.vertex), 1)).toBe('');
    sel.verts.add(corner);
    view.setState(sel, null, null, null);
    expect(colourError(glyph(render(view, camera)), hexBytes(THEME.selected), 1)).toBe('');
    sel.verts.delete(corner);
    view.setState(sel, null, null, null);
    expect(colourError(glyph(render(view, camera)), hexBytes(THEME.vertex), 1)).toBe('');
    // Hidden set.
    const hidden: HiddenSet = {
      verts: new BitSet(d.mesh.counts.points),
      edges: new BitSet(d.mesh.counts.edges),
      faces: new BitSet(d.mesh.counts.faces),
    };
    view.setState(sel, hidden, null, null);
    hidden.faces.add(right);
    view.setState(sel, hidden, null, null);
    expect(colourError(at(render(view, camera), inRight), hexBytes(BACKGROUND), 1)).toBe('');
    hidden.faces.delete(right);
    view.setState(sel, hidden, null, null);
    expect(colourError(at(render(view, camera), inRight), hexBytes(BACKGROUND), 1)).not.toBe('');
    // Isolate set.
    const only = new BitSet(d.mesh.counts.faces);
    only.add(0);
    only.add(1);
    view.setIsolate(only);
    expect(colourError(at(render(view, camera), inRight), hexBytes(BACKGROUND), 1)).not.toBe('');
    only.delete(right);
    view.setIsolate(only);
    expect(colourError(at(render(view, camera), inRight), hexBytes(BACKGROUND), 1)).toBe('');
  });

  it('drops a face isolate set of another topology (rebuild) and ignores one pushed for another face count', () => {
    const d = plane({ width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
    const camera = orthoTop(3);
    const left = centroidOf(d, 0)[0] < 0 ? 0 : 1;
    const inRight = px(camera, [0.6, 0, 0.1]);
    const clay = bytes(lit(THEME.clay, camera, [0, 1, 0]));
    const view = editView(d, selectionOf('face', [], d.mesh.counts));
    const only = new BitSet(d.mesh.counts.faces);
    only.add(left);
    view.setIsolate(only);
    expect(colourError(at(render(view, camera), inRight), hexBytes(BACKGROUND), 1)).toBe('');
    // Four faces now: the two-face set would name other faces.
    const four = plane({ width: 2, height: 1, subdivisionsWidth: 4, subdivisionsHeight: 1 });
    view.setMesh(four.mesh, four.tri, four.normals);
    view.setState(selectionOf('face', [], four.mesh.counts), null, null, null);
    expect(colourError(at(render(view, camera), inRight), clay, 2)).toBe('');
    view.setIsolate(only);
    expect(colourError(at(render(view, camera), inRight), clay, 2)).toBe('');
  });

  it('follows the world matrix', () => {
    const d = cube();
    const camera = orthoFront(6);
    const world = new Matrix4().makeTranslation(1, 0.5, 0);
    const v = vertexAt(d, [0.5, 0.5, 0.5]);
    const view = editView(d, selectionOf('vertex', [v], d.mesh.counts), world);
    expect(colourError(at(render(view, camera), px(camera, vertexOf(d, v), world)), hexBytes(THEME.selected), 1)).toBe(
      '',
    );
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
