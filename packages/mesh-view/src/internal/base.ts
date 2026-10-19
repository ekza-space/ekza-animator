// What `EditMeshView` and `MeshSurface` share (M6A-SPEC §4.4): the surface, the wire/hard edges, normals and
// triangulation lines, the world matrix and the per-pane display rules.
import type { Normals, Triangulation } from '@ekza-animator/mesh-core';
import { Group } from 'three';
import { MESH_VIEW_STYLE, ORDER } from '../style';
import type { MeshViewThemeInput } from '../theme';
import type { MeshPaneDisplay, MeshViewLayers } from '../types';
import { LineBatch } from './lines';
import { SurfaceLayer } from './surface';
import { faceCentroids, meanEdgeLength, type Topo, triangulationDiagonals } from './topo';

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
  }

  private buildDiagonals(t: Topo, tri: Triangulation): void {
    const pairs = triangulationDiagonals(t, tri.tris);
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
  }

  /**
   * The display rules both views share. `components`: the view draws component overlays in this pane (component mode
   * and the pane's `components` flag); edges then live on the components layer, otherwise on the surface layer.
   */
  protected applyCommon(display: MeshPaneDisplay, components: boolean): void {
    const wire = display.shading === 'wire';
    const xray = display.xray && !wire;
    const dim = display.dimmed ? MESH_VIEW_STYLE.dimOpacity : 1;
    this.surface.apply({
      shading: display.shading,
      flat: display.flat,
      cull: display.cull,
      faceOrientation: display.faceOrientation,
      opacity: dim * (xray ? MESH_VIEW_STYLE.xrayOpacity : 1),
      xray,
    });
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
    if ((showFace || showVertex) && this.normalsDirty && t !== null && this.normals !== null) {
      this.buildNormals(t, this.normals);
      this.normalsDirty = false;
    }
    this.faceNormals.setAlpha(dim, dim * MESH_VIEW_STYLE.occludedAlpha);
    this.vertexNormals.setAlpha(dim, dim * MESH_VIEW_STYLE.occludedAlpha);
    this.faceNormals.show(showFace, xray);
    this.vertexNormals.show(showVertex, xray);

    if (display.triangulation && this.diagonalsDirty && t !== null && this.tri !== null) {
      this.buildDiagonals(t, this.tri);
      this.diagonalsDirty = false;
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
