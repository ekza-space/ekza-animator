// Edit-mode overlays of one mesh in component mode (M6A-SPEC §4.4, research 13 §7.1 draw list): the surface with
// face tints and the soft ramp, edges (selected/hovered edges fat), vertices at constant pixel size, face-centre dots,
// normals, triangulation, hard edges, Mesh Check markers and the symmetry plane. Every glyph and overlay line has a
// 1 px `--comp-halo` outline; mirrored partners are drawn 60 % of the way to `--comp-selected` (§5.6); hidden and
// isolated elements are skipped. Incremental updates upload only touched ranges (`addUpdateRange`).
import {
  BitSet,
  type ComponentKind,
  type ComponentSelection,
  type DirtySet,
  EDGE_HARD,
  type EditMesh,
  type HiddenSet,
  type MeshProblem,
  type Normals,
  type Triangulation,
} from '@ekza-studio/mesh-core';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial } from 'three';
import { GlyphBatch, SHAPE } from './internal/glyphs';
import { LineBatch } from './internal/lines';
import { IndexSet, Touched, uploadAll } from './internal/ranges';
import { ViewBase } from './internal/base';
import {
  copyHidden,
  copyPalette,
  copyShaders,
  hiddenFits,
  type PaletteShaders,
  samePalette,
  sameHidden,
  sameSet,
  sameShaders,
} from './internal/sets';
import {
  bounds,
  copyPositions,
  type Csr,
  deriveVisibility,
  faceCentroids,
  has,
  topoOfEdit,
  type Topo,
  type Visibility,
  vertexCorners,
  vertexEdges,
} from './internal/topo';
import { MESH_VIEW_STYLE, ORDER, STATE } from './style';
import type { MeshViewThemeInput } from './theme';
import type { MeshPaneDisplay, MeshViewLayers } from './types';

type Hover = { readonly kind: ComponentKind; readonly index: number; readonly partner: number };

/** Problem codes drawn as the amber n-gon marker ◇; every other code is an error ✕ (§5.25). */
export const NGON_CODES: ReadonlySet<string> = new Set(['nonplanar-ngon', 'concave-ngon', 'ngon-degenerate']);

const VERTEX_CODES = new Set(['non-manifold-vertex', 'stray-vertex']);
const EDGE_CODES = new Set(['non-manifold-edge', 'zero-length-edge', 'open-border']);

// Change detection compares contents against the view's own copies (taken in `setState`/`setIsolate`; see
// `internal/sets.ts`).
function sameSelection(a: ComponentSelection | null, b: ComponentSelection | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && sameSet(a.verts, b.verts) && sameSet(a.edges, b.edges) && sameSet(a.faces, b.faces);
}

function copySelection(s: ComponentSelection | null): ComponentSelection | null {
  if (s === null) return null;
  return {
    kind: s.kind,
    verts: s.verts.clone(),
    edges: s.edges.clone(),
    faces: s.faces.clone(),
    order: null,
    active: -1,
  };
}

function setOf(sel: ComponentSelection | null, kind: ComponentKind): BitSet | null {
  if (sel === null) return null;
  return kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
}

export class EditMeshView extends ViewBase {
  private readonly verts: GlyphBatch;
  private readonly faceDots: GlyphBatch;
  private readonly lints: GlyphBatch;
  private readonly planeFill: Mesh;
  private readonly planeLines: LineBatch;
  private mesh: EditMesh | null = null;
  private vis: Visibility = { verts: new Uint8Array(0), edges: new Uint8Array(0), faces: new Uint8Array(0) };
  private vcorners: Csr = { start: new Uint32Array(1), items: new Uint32Array(0) };
  private vedges: Csr = { start: new Uint32Array(1), items: new Uint32Array(0) };
  private faceState = new Uint8Array(0);
  private sel: ComponentSelection | null = null;
  private hidden: HiddenSet | null = null;
  private isolate: BitSet | null = null;
  private mirrored: ComponentSelection | null = null;
  private hover: Hover | null = null;
  private soft: Float32Array | null = null;
  private paint: ReadonlyMap<number, readonly [number, number, number]> | null = null;
  /** Blinn swatches of the palette (SHADING-SPEC §3); null = all Lambert. */
  private shaders: PaletteShaders | null = null;
  private problems: readonly MeshProblem[] = [];
  private plane: { readonly axis: 'x' | 'y' | 'z'; readonly offset: number } | null = null;
  private lintsDirty = true;
  private planeDirty = true;
  private readonly touchedVerts = new Touched(0);
  private readonly touchedEdges = new Touched(0);
  private readonly touchedFaces = new Touched(0);
  // Scratch sets of `update` (sized per topology): edges and faces around moved vertices, faces whose normals change.
  private readonly movedEdges = new IndexSet();
  private readonly movedFaces = new IndexSet();
  private readonly normalFaces = new IndexSet();

  constructor(opts: { readonly theme: MeshViewThemeInput; readonly layers: MeshViewLayers }) {
    super(opts);
    const { theme, layers } = opts;
    const mix = MESH_VIEW_STYLE.mirroredMix;
    this.verts = new GlyphBatch({
      layer: layers.components,
      order: ORDER.verts,
      occludedOrder: ORDER.vertsOccluded,
      size: MESH_VIEW_STYLE.vertexPx,
      sizeHot: MESH_VIEW_STYLE.vertexHotPx,
      shape: SHAPE.square,
      halo: theme.halo,
      mirroredMix: mix,
      soft: theme.soft,
    });
    this.verts.setColours(theme.vertex, theme.vertex, theme.selected, theme.hover);
    this.faceDots = new GlyphBatch({
      layer: layers.components,
      order: ORDER.faceDots,
      occludedOrder: ORDER.faceDotsOccluded,
      size: MESH_VIEW_STYLE.faceDotPx,
      sizeHot: MESH_VIEW_STYLE.faceDotHotPx,
      shape: SHAPE.square,
      halo: theme.halo,
      mirroredMix: mix,
      soft: theme.soft,
    });
    this.faceDots.setColours(theme.vertex, theme.vertex, theme.selected, theme.hover);
    this.lints = new GlyphBatch({
      layer: layers.lint,
      order: ORDER.lint,
      occludedOrder: ORDER.lint,
      size: MESH_VIEW_STYLE.lintPx,
      sizeHot: MESH_VIEW_STYLE.lintPx,
      shape: SHAPE.diamond,
      altShape: SHAPE.cross,
      halo: theme.halo,
      mirroredMix: mix,
      soft: theme.soft,
    });
    this.lints.setColours(theme.lintNgon, theme.lintError, theme.selected, theme.hover);
    // Markers stay readable through the surface: no depth test.
    for (const points of [this.lints.visible, this.lints.occluded]) {
      (points.material as { depthTest: boolean }).depthTest = false;
    }
    this.planeFill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({
        color: new Color(theme.symPlane),
        transparent: true,
        opacity: MESH_VIEW_STYLE.symPlaneAlpha,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    this.planeFill.layers.set(layers.helpers);
    this.planeFill.renderOrder = ORDER.symPlane;
    this.planeFill.frustumCulled = false;
    this.planeFill.matrixAutoUpdate = false;
    this.planeFill.raycast = () => {};
    this.planeFill.visible = false;
    this.planeLines = new LineBatch({
      layer: layers.helpers,
      order: ORDER.symPlane,
      occludedOrder: ORDER.symPlane,
      style: { width: 1, widthHard: 1, widthHot: 1 },
      halo: theme.halo,
      mirroredMix: mix,
    });
    this.planeLines.setColours(theme.symPlane, theme.symPlane, theme.selected, theme.hover);
    this.planeLines.show(false, false);
    this.root.add(this.planeFill);
    this.planeLines.addTo(this.root);
    this.faceDots.addTo(this.root);
    this.verts.addTo(this.root);
    this.lints.addTo(this.root);
    this.verts.show(false, false);
    this.faceDots.show(false, false);
    this.lints.show(false, false);
  }

  /** Full rebuild after a topology commit (or the first mesh). */
  setMesh(mesh: EditMesh, tri: Triangulation, normals: Normals): void {
    const t = topoOfEdit(mesh);
    this.mesh = mesh;
    this.topo = t;
    this.position = mesh.position;
    this.tri = tri;
    this.normals = normals;
    this.vcorners = vertexCorners(t);
    this.vedges = vertexEdges(t);
    // A selection, hidden set, face isolate set or soft weights of another topology do not apply any more (their
    // indices may name other elements now); the host pushes remapped ones (M6A-B6-19).
    if (this.sel !== null && !this.fits(this.sel)) this.sel = null;
    if (this.mirrored !== null && !this.fits(this.mirrored)) this.mirrored = null;
    if (this.hidden !== null && !hiddenFits(t, this.hidden)) this.hidden = null;
    if (this.isolate !== null && this.isolate.size !== t.faces) this.isolate = null;
    this.vis = { verts: new Uint8Array(t.points), edges: new Uint8Array(t.edges), faces: new Uint8Array(t.faces) };
    deriveVisibility(t, this.hidden, this.isolate, this.vis);
    this.faceState = new Uint8Array(t.faces);
    this.touchedVerts.resize(t.points);
    this.touchedEdges.resize(t.edges);
    this.touchedFaces.resize(t.faces);
    this.movedEdges.resize(t.edges);
    this.movedFaces.resize(t.faces);
    this.normalFaces.resize(t.faces);
    if (this.soft !== null && this.soft.length < t.points) this.soft = null;
    this.hover = null;

    this.surface.build(t, this.position, tri, normals, this.vis.faces);
    this.edges.setGeometry(t.edges);
    this.writeEdgeSegments(t, null);
    this.verts.setGeometry(t.points);
    copyPositions(this.verts.position.array as Float32Array, this.position, t.points);
    this.faceDots.setGeometry(t.faces);
    faceCentroids(t, this.position, this.faceDots.position.array as Float32Array);
    this.writeAllStates();
    this.surface.writePaint(t, this.paintSlots(), this.paint, this.shaders);
    this.writeSoft();
    this.normalsDirty = true;
    this.diagonalsDirty = true;
    this.overlayVisibilityChanged();
    this.lintsDirty = true;
    this.planeDirty = true;
  }

  protected override faceVisibility(): Uint8Array {
    return this.vis.faces;
  }

  protected override vertexVisibility(): Uint8Array {
    return this.vis.verts;
  }

  private fits(sel: ComponentSelection): boolean {
    const t = this.topo;
    return t !== null && sel.verts.size === t.points && sel.edges.size === t.edges && sel.faces.size === t.faces;
  }

  private paintSlots(): ArrayLike<number> | null {
    const layer = this.mesh?.layer('paint');
    return layer === undefined ? null : layer.data;
  }

  /**
   * Incremental ranges after a commit or preview without topology change; a topology change rebuilds. Runs every
   * frame of a drag: its working sets are the view's own scratch (no allocation proportional to the edit).
   */
  update(mesh: EditMesh, dirty: DirtySet, tri: Triangulation, normals: Normals): void {
    const t = this.topo;
    const c = mesh.counts;
    if (
      t === null ||
      dirty.topology ||
      mesh !== this.mesh ||
      c.points !== t.points ||
      c.edges !== t.edges ||
      c.faces !== t.faces ||
      c.corners !== t.corners
    ) {
      this.setMesh(mesh, tri, normals);
      return;
    }
    this.position = mesh.position;
    this.tri = tri;
    this.normals = normals;
    const points = dirty.points;
    const allPoints = points === 'all';
    const movedPoints = allPoints || points.length > 0;
    let faces: Uint32Array | 'all' = dirty.faces === 'all' || allPoints ? 'all' : dirty.faces;

    if (movedPoints) {
      this.surface.updatePositions(t, this.position, points, this.vcorners);
      const vp = this.verts.position.array as Float32Array;
      const ep = this.movedEdges;
      const fp = this.movedFaces;
      ep.clear();
      fp.clear();
      if (allPoints) {
        copyPositions(vp, this.position, t.points);
        uploadAll(this.verts.position);
        this.writeEdgeSegments(t, null);
        uploadAll(this.edges.start);
        uploadAll(this.edges.end);
        faceCentroids(t, this.position, this.faceDots.position.array as Float32Array);
        uploadAll(this.faceDots.position);
      } else {
        for (let k = 0; k < points.length; k++) {
          const v = points[k] as number;
          if (v >= t.points) continue;
          vp[3 * v] = this.position[3 * v] as number;
          vp[3 * v + 1] = this.position[3 * v + 1] as number;
          vp[3 * v + 2] = this.position[3 * v + 2] as number;
          this.touchedVerts.add(v);
          for (let i = this.vedges.start[v] as number; i < (this.vedges.start[v + 1] as number); i++) {
            ep.add(this.vedges.items[i] as number);
          }
          for (let i = this.vcorners.start[v] as number; i < (this.vcorners.start[v + 1] as number); i++) {
            fp.add(t.cf[this.vcorners.items[i] as number] as number);
          }
        }
        this.touchedVerts.flush([this.verts.position]);
        const edgeList = ep.items();
        this.writeEdgeSegments(t, edgeList);
        for (let k = 0; k < edgeList.length; k++) this.touchedEdges.add(edgeList[k] as number);
        this.touchedEdges.flush([this.edges.start, this.edges.end]);
        this.writeFaceDots(t, fp.items());
        if (faces !== 'all') {
          for (let k = 0; k < faces.length; k++) fp.add(faces[k] as number);
          faces = fp.items();
        }
      }
      this.normalsDirty = true;
      this.diagonalsDirty = true;
      this.lintsDirty = true;
      this.planeDirty = true;
    }

    // Corner normals (the kernel's incremental `computeNormals` recomputes the same places): the faces around moved
    // vertices change, so every corner at those faces' vertices may (one ring); an edge whose hard flag changed splits
    // or joins the smooth fans at both endpoints, so every corner there; corners written directly (`normal.custom`)
    // take their value as is. Rewriting a superset is harmless: `normals` is the full current array.
    let allNormals = faces === 'all';
    const normalFaces = this.normalFaces;
    normalFaces.clear();
    if (faces === 'all') {
      this.surface.writeIndex(tri, this.vis.faces, null);
    } else if (faces.length > 0) {
      for (let k = 0; k < faces.length; k++) {
        const f = faces[k] as number;
        if (f >= t.faces) continue;
        for (let i = t.fstart[f] as number; i < (t.fstart[f + 1] as number); i++) {
          this.facesAt(t, t.cv[t.fcorners[i] as number] as number, normalFaces);
        }
      }
      this.surface.writeIndex(tri, this.vis.faces, faces);
      this.diagonalsDirty = true;
    }

    const edges = dirty.edges;
    if (edges === 'all' || edges.length > 0) {
      const list = edges === 'all' ? null : edges;
      const count = list === null ? t.edges : list.length;
      const ef = t.ef;
      for (let k = 0; k < count; k++) {
        const e = list === null ? k : (list[k] as number);
        if (e >= t.edges) continue;
        ef[e] = mesh.edgeFlags(e);
        if (list !== null) {
          this.facesAt(t, t.ev[2 * e] as number, normalFaces);
          this.facesAt(t, t.ev[2 * e + 1] as number, normalFaces);
        }
      }
      if (list === null) allNormals = true;
      this.writeEdgeStates(list);
    }

    const corners = dirty.corners;
    if (corners === 'all') allNormals = true;
    else {
      for (let k = 0; k < corners.length; k++) {
        const c = corners[k] as number;
        if (c < t.corners) normalFaces.add(t.cf[c] as number);
      }
    }

    if (allNormals) this.surface.writeNormals(t, normals, null);
    else if (normalFaces.size > 0) this.surface.writeNormals(t, normals, normalFaces.items());
    if (allNormals || normalFaces.size > 0) this.normalsDirty = true;

    if (dirty.layers.includes('paint') || dirty.faces === 'all' || dirty.faces.length > 0) {
      this.surface.writePaint(t, this.paintSlots(), this.paint, this.shaders);
    }
  }

  /** Adds every face with a corner at vertex `v` to `out`. */
  private facesAt(t: Topo, v: number, out: IndexSet): void {
    if (v >= t.points) return;
    for (let j = this.vcorners.start[v] as number; j < (this.vcorners.start[v + 1] as number); j++) {
      out.add(t.cf[this.vcorners.items[j] as number] as number);
    }
  }

  private writeFaceDots(t: Topo, faces: Uint32Array): void {
    const out = this.faceDots.position.array as Float32Array;
    const p = this.position;
    for (let k = 0; k < faces.length; k++) {
      const f = faces[k] as number;
      const start = t.fstart[f] as number;
      const end = t.fstart[f + 1] as number;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = start; i < end; i++) {
        const v = 3 * (t.cv[t.fcorners[i] as number] as number);
        x += p[v] as number;
        y += p[v + 1] as number;
        z += p[v + 2] as number;
      }
      const n = Math.max(1, end - start);
      out[3 * f] = x / n;
      out[3 * f + 1] = y / n;
      out[3 * f + 2] = z / n;
      this.touchedFaces.add(f);
    }
    this.touchedFaces.flush([this.faceDots.position]);
  }

  /**
   * Selection (its `kind` is the component mode), hidden set, hover (with its symmetry partner) and the mirrored
   * partners the symmetry expansion adds. A hover-only change updates just the elements it touches.
   */
  setState(
    sel: ComponentSelection,
    hidden: HiddenSet | null,
    hover: { readonly kind: ComponentKind; readonly index: number; readonly partner: number } | null,
    mirrored: ComponentSelection | null,
  ): void {
    const t = this.topo;
    const visChanged = !sameHidden(hidden, this.hidden);
    const selChanged = !sameSelection(sel, this.sel);
    const mirChanged = !sameSelection(mirrored, this.mirrored);
    const previousHover = this.hover;
    // Own copies: the next call compares contents, even when the caller mutated these objects in place.
    if (selChanged) this.sel = copySelection(sel);
    if (visChanged) this.hidden = copyHidden(hidden);
    if (mirChanged) this.mirrored = copySelection(mirrored);
    this.hover = hover === null ? null : { kind: hover.kind, index: hover.index, partner: hover.partner };
    if (t === null) return;
    if (visChanged) {
      deriveVisibility(t, this.hidden, this.isolate, this.vis);
      if (this.tri !== null) this.surface.writeIndex(this.tri, this.vis.faces, null);
      this.overlayVisibilityChanged();
      this.lintsDirty = true;
    }
    if (visChanged || selChanged || mirChanged) {
      this.writeAllStates();
      return;
    }
    if (
      previousHover?.kind === hover?.kind &&
      previousHover?.index === hover?.index &&
      previousHover?.partner === hover?.partner
    ) {
      return;
    }
    const faces: number[] = [];
    for (const h of [previousHover, hover]) {
      if (h === null) continue;
      for (const i of [h.index, h.partner]) {
        this.writeState(h.kind, i);
        if (h.kind === 'face' && i >= 0 && i < t.faces) faces.push(i);
      }
    }
    this.touchedVerts.flush([this.verts.state]);
    this.touchedEdges.flush([this.edges.state]);
    this.touchedFaces.flush([this.faceDots.state]);
    if (faces.length > 0) this.surface.writeFaceStates(t, this.faceState, faces);
  }

  /**
   * Draws only `faces` (and the edges and vertices they use): the face-mode isolate of a pane (`view.isolate`, §5.6).
   * null draws everything again. The host calls it from `applyPane` when the pane's isolate set differs.
   */
  setIsolate(faces: BitSet | null): void {
    const t = this.topo;
    // A set of another topology (stale face indices) isolates nothing: the host pushes a remapped one.
    const set = faces !== null && t !== null && faces.size !== t.faces ? null : faces;
    if (sameSet(set, this.isolate)) return;
    this.isolate = set === null ? null : set.clone();
    if (t === null) return;
    deriveVisibility(t, this.hidden, this.isolate, this.vis);
    if (this.tri !== null) this.surface.writeIndex(this.tri, this.vis.faces, null);
    this.overlayVisibilityChanged();
    this.lintsDirty = true;
    this.writeAllStates();
  }

  private stateOf(kind: ComponentKind, i: number): number {
    const visible = kind === 'vertex' ? this.vis.verts : kind === 'edge' ? this.vis.edges : this.vis.faces;
    let s = visible[i] === 1 ? 0 : STATE.hidden;
    if (this.sel !== null && this.sel.kind === kind) {
      if (has(setOf(this.sel, kind), i)) s |= STATE.selected;
      else if (this.mirrored !== null && has(setOf(this.mirrored, kind), i)) s |= STATE.mirrored;
    }
    // Hover, like selection, belongs to the current component mode only (M6A-B6-5): a hover of another kind draws
    // nothing (edge states show in every mode, so an edge hover in vertex mode would otherwise draw a fat edge).
    const h = this.hover;
    if (h !== null && h.kind === kind && this.sel?.kind === kind && (h.index === i || h.partner === i)) {
      s |= STATE.hover;
    }
    if (kind === 'edge' && this.topo !== null && ((this.topo.ef[i] as number) & EDGE_HARD) !== 0) s |= STATE.hard;
    return s;
  }

  private writeState(kind: ComponentKind, i: number): void {
    const t = this.topo;
    if (t === null || i < 0) return;
    if (kind === 'vertex') {
      if (i >= t.points) return;
      (this.verts.state.array as Uint8Array)[i] = this.stateOf(kind, i);
      this.touchedVerts.add(i);
    } else if (kind === 'edge') {
      if (i >= t.edges) return;
      (this.edges.state.array as Uint8Array)[i] = this.stateOf(kind, i);
      this.touchedEdges.add(i);
    } else {
      if (i >= t.faces) return;
      const s = this.stateOf(kind, i);
      (this.faceDots.state.array as Uint8Array)[i] = s;
      this.faceState[i] = s;
      this.touchedFaces.add(i);
    }
  }

  private writeAllStates(): void {
    const t = this.topo;
    if (t === null) return;
    const vs = this.verts.state.array as Uint8Array;
    for (let v = 0; v < t.points; v++) vs[v] = this.stateOf('vertex', v);
    this.writeEdgeStates(null);
    const ds = this.faceDots.state.array as Uint8Array;
    for (let f = 0; f < t.faces; f++) {
      const s = this.stateOf('face', f);
      ds[f] = s;
      this.faceState[f] = s;
    }
    uploadAll(this.verts.state);
    uploadAll(this.faceDots.state);
    this.surface.writeFaceStates(t, this.faceState, null);
  }

  private writeEdgeStates(edges: Uint32Array | null): void {
    const t = this.topo;
    if (t === null) return;
    const es = this.edges.state.array as Uint8Array;
    if (edges === null) {
      for (let e = 0; e < t.edges; e++) es[e] = this.stateOf('edge', e);
      uploadAll(this.edges.state);
      return;
    }
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k] as number;
      if (e >= t.edges) continue;
      es[e] = this.stateOf('edge', e);
      this.touchedEdges.add(e);
    }
    this.touchedEdges.flush([this.edges.state]);
  }

  /** Soft-selection weights per vertex (0…1; §5.15 ramp on the surface and on vertex glyphs); null clears them. */
  setSoftWeights(weights: Float32Array | null): void {
    this.soft = weights;
    this.writeSoft();
  }

  private writeSoft(): void {
    const t = this.topo;
    if (t === null) return;
    const weights = this.soft !== null && this.soft.length >= t.points ? this.soft : null;
    this.surface.writeSoft(t, weights);
    const out = this.verts.soft.array as Uint8Array;
    if (weights === null) out.fill(0);
    else {
      for (let v = 0; v < t.points; v++) {
        const w = weights[v] as number;
        out[v] = w > 0 ? Math.max(1, Math.round(Math.min(1, w) * 255)) : 0;
      }
    }
    uploadAll(this.verts.soft);
    this.verts.setUniform('uShowSoft', weights !== null);
  }

  /**
   * Palette colours (slot → sRGB 8-bit) of the `paint` layer for the `colours` and `lit` shadings; null = clay. The
   * same colours again (a host re-pushing on every document batch, often as a fresh map) upload nothing; the paint
   * slots themselves follow `update`'s dirty layers. `shaders` are the palette's Blinn swatches (SHADING-SPEC §3).
   */
  setPaint(
    colours: ReadonlyMap<number, readonly [number, number, number]> | null,
    shaders: PaletteShaders | null = null,
  ): void {
    if (samePalette(colours, this.paint) && sameShaders(shaders, this.shaders)) return;
    this.paint = copyPalette(colours);
    this.shaders = copyShaders(shaders);
    if (this.topo !== null) this.surface.writePaint(this.topo, this.paintSlots(), this.paint);
  }

  /** Mesh Check problems (§5.25): ◇ for n-gon codes, ✕ for the others, at their elements. The same list is a no-op. */
  setLints(problems: readonly MeshProblem[]): void {
    if (problems === this.problems) return;
    this.problems = problems;
    this.lintsDirty = true;
  }

  private buildLints(t: Topo): void {
    const marks: number[] = [];
    const p = this.position;
    const push = (x: number, y: number, z: number, alt: boolean): void => {
      marks.push(x, y, z, alt ? 1 : 0);
    };
    for (const problem of this.problems) {
      const elements = problem.elements;
      if (elements === undefined) continue;
      const alt = !NGON_CODES.has(problem.code);
      const domain =
        problem.domain ?? (VERTEX_CODES.has(problem.code) ? 'point' : EDGE_CODES.has(problem.code) ? 'edge' : 'face');
      for (let k = 0; k < elements.length; k++) {
        const i = elements[k] as number;
        if (domain === 'point') {
          if (i >= t.points || this.vis.verts[i] !== 1) continue;
          push(p[3 * i] as number, p[3 * i + 1] as number, p[3 * i + 2] as number, alt);
        } else if (domain === 'edge') {
          if (i >= t.edges || this.vis.edges[i] !== 1) continue;
          const a = 3 * (t.ev[2 * i] as number);
          const b = 3 * (t.ev[2 * i + 1] as number);
          push(
            ((p[a] as number) + (p[b] as number)) / 2,
            ((p[a + 1] as number) + (p[b + 1] as number)) / 2,
            ((p[a + 2] as number) + (p[b + 2] as number)) / 2,
            alt,
          );
        } else if (domain === 'corner') {
          // A corner is drawn at its vertex, as part of its face: either hidden (or isolated out) hides the marker.
          if (i >= t.corners || this.vis.faces[t.cf[i] as number] !== 1 || this.vis.verts[t.cv[i] as number] !== 1) {
            continue;
          }
          const v = 3 * (t.cv[i] as number);
          push(p[v] as number, p[v + 1] as number, p[v + 2] as number, alt);
        } else {
          if (i >= t.faces || this.vis.faces[i] !== 1) continue;
          const start = t.fstart[i] as number;
          const end = t.fstart[i + 1] as number;
          let x = 0;
          let y = 0;
          let z = 0;
          for (let j = start; j < end; j++) {
            const v = 3 * (t.cv[t.fcorners[j] as number] as number);
            x += p[v] as number;
            y += p[v + 1] as number;
            z += p[v + 2] as number;
          }
          const n = Math.max(1, end - start);
          push(x / n, y / n, z / n, alt);
        }
      }
    }
    const count = marks.length / 4;
    if (this.lints.count !== count) this.lints.setGeometry(count);
    const pos = this.lints.position.array as Float32Array;
    const state = this.lints.state.array as Uint8Array;
    for (let m = 0; m < count; m++) {
      pos[3 * m] = marks[4 * m] as number;
      pos[3 * m + 1] = marks[4 * m + 1] as number;
      pos[3 * m + 2] = marks[4 * m + 2] as number;
      state[m] = marks[4 * m + 3] === 1 ? STATE.alt : 0;
    }
    uploadAll(this.lints.position);
    uploadAll(this.lints.state);
  }

  /** The symmetry plane (mesh-local axis and offset), drawn across the mesh bounds; null hides it. */
  setSymmetryPlane(plane: { readonly axis: 'x' | 'y' | 'z'; readonly offset: number } | null): void {
    this.plane = plane;
    this.planeDirty = true;
  }

  private buildPlane(t: Topo): void {
    const plane = this.plane;
    if (plane === null) return;
    const b = bounds(this.position, t.points);
    const axis = plane.axis === 'x' ? 0 : plane.axis === 'y' ? 1 : 2;
    const u = (axis + 1) % 3;
    const w = (axis + 2) % 3;
    const margin = (k: number): number =>
      Math.max(((b[k + 3] as number) - (b[k] as number)) * MESH_VIEW_STYLE.symPlaneMargin, 0.05);
    const u0 = (b[u] as number) - margin(u);
    const u1 = (b[u + 3] as number) + margin(u);
    const w0 = (b[w] as number) - margin(w);
    const w1 = (b[w + 3] as number) + margin(w);
    const corner = (cu: number, cw: number): number[] => {
      const out = [0, 0, 0];
      out[axis] = plane.offset;
      out[u] = cu;
      out[w] = cw;
      return out;
    };
    const quad = [corner(u0, w0), corner(u1, w0), corner(u1, w1), corner(u0, w1)];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(quad.flat()), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.planeFill.geometry.dispose();
    this.planeFill.geometry = geometry;
    if (this.planeLines.count !== 4) this.planeLines.setGeometry(4);
    const s = this.planeLines.start.array as Float32Array;
    const e = this.planeLines.end.array as Float32Array;
    for (let k = 0; k < 4; k++) {
      s.set(quad[k] as number[], 3 * k);
      e.set(quad[(k + 1) % 4] as number[], 3 * k);
    }
    uploadAll(this.planeLines.start);
    uploadAll(this.planeLines.end);
  }

  /** Per-pane display (called before each pane renders; one scene, N cameras). */
  applyPane(display: MeshPaneDisplay): void {
    const t = this.topo;
    const mode = this.sel?.kind ?? null;
    const components = display.components && mode !== null;
    this.applyCommon(display, components);
    const wire = display.shading === 'wire';
    const xray = display.xray && !wire;
    const dim = display.dimmed ? MESH_VIEW_STYLE.dimOpacity : 1;
    // Runs before every pane render: nothing allocated here (MVP-SPEC §3 rule 5).
    this.verts.setUniform('uShowState', true);
    this.verts.setAlpha(dim, dim * MESH_VIEW_STYLE.occludedAlpha);
    this.faceDots.setUniform('uShowState', true);
    this.faceDots.setAlpha(dim, dim * MESH_VIEW_STYLE.occludedAlpha);
    this.verts.show(components && mode === 'vertex', xray);
    this.faceDots.show(components && mode === 'face', xray);

    if (display.meshCheck && this.lintsDirty && t !== null) {
      this.buildLints(t);
      this.lintsDirty = false;
    }
    this.lints.setAlpha(dim, 0);
    this.lints.show(display.meshCheck, false);

    const plane = display.symmetryPlane && this.plane !== null && t !== null;
    if (plane && this.planeDirty && t !== null) {
      this.buildPlane(t);
      this.planeDirty = false;
    }
    this.planeFill.visible = plane;
    this.planeLines.setAlpha(dim, 0);
    this.planeLines.show(plane, false);
  }

  /** The current selection kind (component mode) the view draws, or null before the first `setState`. */
  get mode(): ComponentKind | null {
    return this.sel?.kind ?? null;
  }

  override dispose(): void {
    if (this.isDisposed) return;
    this.verts.dispose();
    this.faceDots.dispose();
    this.lints.dispose();
    this.planeLines.dispose();
    this.planeFill.geometry.dispose();
    (this.planeFill.material as MeshBasicMaterial).dispose();
    this.planeFill.removeFromParent();
    this.mesh = null;
    super.dispose();
  }
}

/** An empty selection of `kind` for a mesh of these counts (object-mode hosts, tests). */
export function emptySelection(
  kind: ComponentKind,
  counts: { readonly points: number; readonly edges: number; readonly faces: number },
): ComponentSelection {
  return {
    kind,
    verts: new BitSet(counts.points),
    edges: new BitSet(counts.edges),
    faces: new BitSet(counts.faces),
    order: null,
    active: -1,
  };
}
