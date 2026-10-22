// What `EditMeshView` and `MeshSurface` share (M6A-SPEC §4.4): the surface, the wire/hard edges, normals and
// triangulation lines (skipping hidden and isolated faces, `faceVisibility`), the world matrix and the per-pane display
// rules.
import type { MeshData, Normals, Triangulation } from '@ekza-studio/mesh-core';
import { Group, type Texture } from 'three';
import { MESH_VIEW_STYLE, ORDER, STATE } from '../style';
import type { MeshViewThemeInput } from '../theme';
import type { MeshPaneDisplay, MeshViewLayers } from '../types';
import { LineBatch } from './lines';
import { uploadAll } from './ranges';
import { type SurfaceDisplay, SurfaceLayer } from './surface';
import { faceCentroids, meanEdgeLength, type Topo, triangulationDiagonals } from './topo';

/** An imported model's base colour image as a mesh view draws it (AR-D8-1). */
export interface SurfaceMap {
  readonly texture: Texture;
  /** The material slots (`faceMaterial`) that sample it. */
  readonly slots: ReadonlySet<number>;
  /** The base colour factor (linear RGB). */
  readonly factor: readonly [number, number, number];
  /** The UV layer: 0 = `uv0`, 1 = `uv1`. */
  readonly texCoord: number;
}

export class ViewBase {
  readonly root = new Group();
  protected readonly theme: MeshViewThemeInput;
  protected readonly layers: MeshViewLayers;
  protected readonly surface: SurfaceLayer;
  protected readonly edges: LineBatch;
  protected readonly faceNormals: LineBatch;
  protected readonly vertexNormals: LineBatch;
  protected readonly diagonals: LineBatch;
  protected topo: Topo | null = null;
  protected position: ArrayLike<number> = new Float32Array(0);
  protected tri: Triangulation | null = null;
  protected normals: Normals | null = null;
  /** Optional overlays are rebuilt on the next pane that shows them after a change. */
  protected normalsDirty = true;
  protected diagonalsDirty = true;
  /**
   * Their visibility states only (hidden set or isolate set changed, positions not): rewritten on the next pane that
   * shows them. A rebuild writes them too.
   */
  private normalStatesDirty = true;
  private diagonalStatesDirty = true;
  /** Corner pairs of the triangulation diagonals last built (the face of a diagonal is the face of its corners). */
  private diagonalPairs: Uint32Array = new Uint32Array(0);
  /** `applyCommon`'s surface options, reused per pane. */
  private readonly surfaceDisplay: SurfaceDisplay = {
    shading: 'shaded',
    flat: false,
    cull: false,
    faceOrientation: false,
    opacity: 1,
    xray: false,
  };
  private disposed = false;

  constructor(opts: { readonly theme: MeshViewThemeInput; readonly layers: MeshViewLayers }) {
    this.theme = opts.theme;
    this.layers = opts.layers;
    this.root.name = 'ekza-mesh-view';
    this.root.matrixAutoUpdate = false;
    const halo = opts.theme.halo;
    const mix = MESH_VIEW_STYLE.mirroredMix;
    this.surface = new SurfaceLayer(opts.theme, opts.layers.surface);
    this.edges = new LineBatch({
      layer: opts.layers.components,
      order: ORDER.edges,
      occludedOrder: ORDER.edgesOccluded,
      style: { width: MESH_VIEW_STYLE.wirePx, widthHard: MESH_VIEW_STYLE.hardPx, widthHot: MESH_VIEW_STYLE.edgeHotPx },
      halo,
      mirroredMix: mix,
    });
    const normalStyle = {
      width: MESH_VIEW_STYLE.normalPx,
      widthHard: MESH_VIEW_STYLE.normalPx,
      widthHot: MESH_VIEW_STYLE.normalPx,
    };
    this.faceNormals = new LineBatch({
      layer: opts.layers.normals,
      order: ORDER.normals,
      occludedOrder: ORDER.normalsOccluded,
      style: normalStyle,
      halo,
      mirroredMix: mix,
    });
    this.faceNormals.setColours(opts.theme.normalFace, opts.theme.normalFace, opts.theme.selected, opts.theme.hover);
    this.vertexNormals = new LineBatch({
      layer: opts.layers.normals,
      order: ORDER.normals,
      occludedOrder: ORDER.normalsOccluded,
      style: normalStyle,
      halo,
      mirroredMix: mix,
    });
    this.vertexNormals.setColours(
      opts.theme.normalVertex,
      opts.theme.normalVertex,
      opts.theme.selected,
      opts.theme.hover,
    );
    const triangulationStyle = {
      width: MESH_VIEW_STYLE.triangulationPx,
      widthHard: MESH_VIEW_STYLE.triangulationPx,
      widthHot: MESH_VIEW_STYLE.triangulationPx,
    };
    this.diagonals = new LineBatch({
      layer: opts.layers.surface,
      order: ORDER.triangulation,
      occludedOrder: ORDER.triangulation,
      style: triangulationStyle,
      halo,
      mirroredMix: mix,
    });
    this.surface.addTo(this.root);
    this.diagonals.addTo(this.root);
    this.edges.addTo(this.root);
    this.faceNormals.addTo(this.root);
    this.vertexNormals.addTo(this.root);
    for (const batch of [this.edges, this.faceNormals, this.vertexNormals, this.diagonals]) batch.show(false, false);
  }

  /** The displayed base colour image (AR-D8-1), or null. */
  private map: SurfaceMap | null = null;

  /**
   * An imported model's base colour image (AR-D8-1): drawn on the faces whose material slot is in `slots`, through the
   * `texCoord` layer's UVs (`uv0` / `uv1`), times `factor`, where the palette colours would be (`colours`, `lit`). A
   * mesh without that UV layer draws none. null removes it. Kept across `setData` (the same mesh's next revision).
   */
  setMap(map: SurfaceMap | null): void {
    if (map === this.map) return;
    this.map = map;
    this.writeMap();
  }

  /** The stored form the image maps onto (the subclass's displayed data). */
  protected mapData(): MeshData | null {
    return null;
  }

  /** Writes the image's attributes for the current topology (after a rebuild, or a new map). */
  protected writeMap(): void {
    const t = this.topo;
    const data = this.mapData();
    if (t === null || data === null) return;
    const map = this.map;
    const uvs = map === null ? undefined : data.layers.get(map.texCoord === 1 ? 'uv1' : 'uv0')?.data;
    if (map === null || uvs === undefined) {
      this.surface.writeMap(t, null);
      return;
    }
    const faceMapped = new Uint8Array(t.faces);
    for (let f = 0; f < t.faces; f++) faceMapped[f] = map.slots.has(data.faceMaterial[f] as number) ? 1 : 0;
    this.surface.writeMap(t, { texture: map.texture, factor: map.factor, uvs, faceMapped });
  }

  /** Whether an image is drawn in the last pane applied (tests). */
  get mapDrawn(): boolean {
    return this.surface.mapDrawn;
  }

  /** Column-major world-from-local matrix (`ReadonlyXf` composed by the caller). */
  setWorld(matrix: Float64Array): void {
    this.root.matrix.fromArray(matrix);
    this.root.matrixWorldNeedsUpdate = true;
  }

  /** Wire and hard edge segments of every edge (positions only; states are the subclass's). */
  protected writeEdgeSegments(t: Topo, edges: Uint32Array | null): void {
    const start = this.edges.start.array as Float32Array;
    const end = this.edges.end.array as Float32Array;
    const p = this.position;
    const write = (e: number): void => {
      const a = 3 * (t.ev[2 * e] as number);
      const b = 3 * (t.ev[2 * e + 1] as number);
      start[3 * e] = p[a] as number;
      start[3 * e + 1] = p[a + 1] as number;
      start[3 * e + 2] = p[a + 2] as number;
      end[3 * e] = p[b] as number;
      end[3 * e + 1] = p[b + 1] as number;
      end[3 * e + 2] = p[b + 2] as number;
    };
    if (edges === null) for (let e = 0; e < t.edges; e++) write(e);
    else for (let k = 0; k < edges.length; k++) write(edges[k] as number);
  }

  /** Face normals from the centroids and corner normals from their vertices, `normalLength` × mean edge long. */
  private buildNormals(t: Topo, normals: Normals): void {
    const length = MESH_VIEW_STYLE.normalLength * (meanEdgeLength(t, this.position) || 1);
    const centroids = faceCentroids(t, this.position, new Float32Array(3 * t.faces));
    if (this.faceNormals.count !== t.faces) this.faceNormals.setGeometry(t.faces);
    const fs = this.faceNormals.start.array as Float32Array;
    const fe = this.faceNormals.end.array as Float32Array;
    for (let i = 0; i < 3 * t.faces; i++) {
      fs[i] = centroids[i] as number;
      fe[i] = (centroids[i] as number) + length * (normals.face[i] as number);
    }
    this.faceNormals.start.needsUpdate = true;
    this.faceNormals.end.needsUpdate = true;
    if (this.vertexNormals.count !== t.corners) this.vertexNormals.setGeometry(t.corners);
    const vs = this.vertexNormals.start.array as Float32Array;
    const ve = this.vertexNormals.end.array as Float32Array;
    const p = this.position;
    for (let c = 0; c < t.corners; c++) {
      const v = 3 * (t.cv[c] as number);
      for (let k = 0; k < 3; k++) {
        vs[3 * c + k] = p[v + k] as number;
        ve[3 * c + k] = (p[v + k] as number) + length * (normals.corner[3 * c + k] as number);
      }
    }
    this.vertexNormals.start.needsUpdate = true;
    this.vertexNormals.end.needsUpdate = true;
    this.writeNormalStates(t);
  }

  /**
   * Per-face visibility of the overlays (1 = drawn): normals and triangulation diagonals of a face that is hidden or
   * outside the isolate set are not drawn (§9 B6 "hidden and isolated elements skipped"). null = every face.
   */
  protected faceVisibility(): Uint8Array | null {
    return null;
  }

  /** Per-vertex visibility (1 = drawn): a corner's normal starts at its vertex, so a hidden vertex hides it too. */
  protected vertexVisibility(): Uint8Array | null {
    return null;
  }

  /** The hidden set or the isolate set changed: the overlays' visibility states are rewritten when next shown. */
  protected overlayVisibilityChanged(): void {
    this.normalStatesDirty = true;
    this.diagonalStatesDirty = true;
  }

  /** Face normals by their face, corner normals by their face and their vertex (`STATE.hidden` or 0). */
  private writeNormalStates(t: Topo): void {
    const faces = this.faceVisibility();
    const verts = this.vertexVisibility();
    const fs = this.faceNormals.state.array as Uint8Array;
    for (let f = 0; f < t.faces; f++) fs[f] = faces === null || faces[f] === 1 ? 0 : STATE.hidden;
    const cs = this.vertexNormals.state.array as Uint8Array;
    for (let c = 0; c < t.corners; c++) {
      const shown =
        (faces === null || faces[t.cf[c] as number] === 1) && (verts === null || verts[t.cv[c] as number] === 1);
      cs[c] = shown ? 0 : STATE.hidden;
    }
    uploadAll(this.faceNormals.state);
    uploadAll(this.vertexNormals.state);
    this.normalStatesDirty = false;
  }

  private buildDiagonals(t: Topo, tri: Triangulation): void {
    const pairs = triangulationDiagonals(t, tri.tris);
    this.diagonalPairs = pairs;
    const n = pairs.length / 2;
    if (this.diagonals.count !== n) this.diagonals.setGeometry(n);
    const s = this.diagonals.start.array as Float32Array;
    const e = this.diagonals.end.array as Float32Array;
    const p = this.position;
    for (let i = 0; i < n; i++) {
      const a = 3 * (t.cv[pairs[2 * i] as number] as number);
      const b = 3 * (t.cv[pairs[2 * i + 1] as number] as number);
      for (let k = 0; k < 3; k++) {
        s[3 * i + k] = p[a + k] as number;
        e[3 * i + k] = p[b + k] as number;
      }
    }
    this.diagonals.start.needsUpdate = true;
    this.diagonals.end.needsUpdate = true;
    this.writeDiagonalStates(t);
  }

  /** Each diagonal by the face its two corners belong to. */
  private writeDiagonalStates(t: Topo): void {
    const faces = this.faceVisibility();
    const pairs = this.diagonalPairs;
    const state = this.diagonals.state.array as Uint8Array;
    const n = Math.min(state.length, pairs.length / 2);
    for (let i = 0; i < n; i++) {
      state[i] = faces === null || faces[t.cf[pairs[2 * i] as number] as number] === 1 ? 0 : STATE.hidden;
    }
    uploadAll(this.diagonals.state);
    this.diagonalStatesDirty = false;
  }

  /**
   * The display rules both views share. `components`: the view draws component overlays in this pane (component mode
   * and the pane's `components` flag); edges then live on the components layer, otherwise on the surface layer.
   */
  protected applyCommon(display: MeshPaneDisplay, components: boolean): void {
    const wire = display.shading === 'wire';
    const xray = display.xray && !wire;
    const dim = display.dimmed ? MESH_VIEW_STYLE.dimOpacity : 1;
    // Runs before every pane render: one reused options object, nothing allocated (MVP-SPEC §3 rule 5).
    const surface = this.surfaceDisplay;
    surface.shading = display.shading;
    surface.flat = display.flat;
    surface.cull = display.cull;
    surface.faceOrientation = display.faceOrientation;
    surface.opacity = dim * (xray ? MESH_VIEW_STYLE.xrayOpacity : 1);
    surface.xray = xray;
    this.surface.apply(surface);
    const theme = this.theme;
    const edgeLines = wire || display.wireOnShaded || components;
    this.edges.setColours(
      wire ? theme.wireMode : theme.wire,
      wire ? theme.wireMode : theme.hardEdge,
      theme.selected,
      theme.hover,
    );
    this.edges.setUniform('uShowHard', display.hardEdges);
    this.edges.setUniform('uOnlyHard', !edgeLines);
    this.edges.setUniform('uShowState', components);
    this.edges.setAlpha(dim, dim * MESH_VIEW_STYLE.occludedAlpha);
    this.edges.show(edgeLines || display.hardEdges, xray);
    const edgeLayer = components ? this.layers.components : this.layers.surface;
    this.edges.visible.layers.set(edgeLayer);
    this.edges.occluded.layers.set(edgeLayer);

    const t = this.topo;
    const showFace = display.normals === 'face' || display.normals === 'both';
    const showVertex = display.normals === 'vertex' || display.normals === 'both';
    if ((showFace || showVertex) && t !== null && this.normals !== null) {
      if (this.normalsDirty) {
        this.buildNormals(t, this.normals);
        this.normalsDirty = false;
      } else if (this.normalStatesDirty) this.writeNormalStates(t);
    }
    this.faceNormals.setAlpha(dim, dim * MESH_VIEW_STYLE.occludedAlpha);
    this.vertexNormals.setAlpha(dim, dim * MESH_VIEW_STYLE.occludedAlpha);
    this.faceNormals.show(showFace, xray);
    this.vertexNormals.show(showVertex, xray);

    if (display.triangulation && t !== null && this.tri !== null) {
      if (this.diagonalsDirty) {
        this.buildDiagonals(t, this.tri);
        this.diagonalsDirty = false;
      } else if (this.diagonalStatesDirty) this.writeDiagonalStates(t);
    }
    this.diagonals.setColours(wire ? theme.wireMode : theme.wire, theme.wire, theme.selected, theme.hover);
    this.diagonals.setAlpha(dim * MESH_VIEW_STYLE.triangulationAlpha, 0);
    this.diagonals.show(display.triangulation, false);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.surface.dispose();
    this.edges.dispose();
    this.faceNormals.dispose();
    this.vertexNormals.dispose();
    this.diagonals.dispose();
    this.root.removeFromParent();
    this.topo = null;
  }
}
