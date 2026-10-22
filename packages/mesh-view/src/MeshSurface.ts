// Static display of a mesh outside component mode (M6A-SPEC §4.4, §5.23): props in every workspace and the meshes
// that are not hilited. Built from the stored form (no edit links): the surface in the pane's shading, wire on shaded,
// hard edges, flat, back-face culling, x-ray, face orientation, normals, triangulation and "Dim unhilited". Component
// hides stay in force here (§5.6 "hidden components are not drawn" until Show All; M6A-B6-26): hidden faces, the edges
// and vertices only they use and their overlays are not drawn and do not occlude. It also answers camera-based
// occlusion for the components of other meshes (`occludes`, §5.6; M6A-B6-22).
import type { HiddenSet, MeshData, Normals, Triangulation } from '@ekza-studio/mesh-core';
import { EDGE_HARD } from '@ekza-studio/mesh-core';
import type { Vector3 } from 'three';
import { ViewBase } from './internal/base';
import { type PickOccluder, TriangleOccluder, triangleIndex } from './internal/occluder';
import { uploadAll } from './internal/ranges';
import {
  copyHidden,
  copyPalette,
  copyShaders,
  hiddenFits,
  hidesNothing,
  type PaletteColours,
  type PaletteShaders,
  samePalette,
  sameShaders,
  sameHidden,
} from './internal/sets';
import { deriveVisibility, type Topo, topoOfData, type Visibility, withCornerEdges } from './internal/topo';
import { STATE } from './style';
import type { MeshViewThemeInput } from './theme';
import type { MeshPaneDisplay, MeshViewLayers } from './types';

export class MeshSurface extends ViewBase implements PickOccluder {
  private data: MeshData | null = null;
  private paint: PaletteColours | null = null;
  /** Blinn swatches of the palette (SHADING-SPEC §3); null = all Lambert. */
  private shaders: PaletteShaders | null = null;
  /** The view's own copy of the hidden set (null = nothing hidden). */
  private hidden: HiddenSet | null = null;
  /** Visibility under `hidden` (null = every element drawn), derived on `linked`. */
  private vis: Visibility | null = null;
  /** The displayed topology with corner → edge links, built the first time a hidden set applies to it. */
  private linked: Topo | null = null;
  /** Built on the first `occludes` call for the current revision and hidden set. */
  private occluder: TriangleOccluder | null = null;

  constructor(opts: { readonly theme: MeshViewThemeInput; readonly layers: MeshViewLayers }) {
    super(opts);
  }

  /**
   * Replaces the displayed revision (stored form, its triangulation and normals) and its palette colours and shaders.
   * A hidden set kept from before applies when it fits the new topology and is dropped otherwise (M6A-B6-19).
   */
  setData(
    data: MeshData,
    tri: Triangulation,
    normals: Normals,
    paint: PaletteColours | null,
    shaders: PaletteShaders | null = null,
  ): void {
    const t = topoOfData(data);
    this.data = data;
    this.topo = t;
    this.linked = null;
    this.position = data.position;
    this.tri = tri;
    this.normals = normals;
    this.paint = copyPalette(paint);
    this.shaders = copyShaders(shaders);
    if (this.hidden !== null && !hiddenFits(t, this.hidden)) this.hidden = null;
    this.deriveVis(t);
    this.surface.build(t, data.position, tri, normals, this.vis?.faces ?? null);
    this.surface.writePaint(t, this.paintSlots(), this.paint, this.shaders);
    this.edges.setGeometry(t.edges);
    this.writeEdgeSegments(t, null);
    this.writeEdgeStates(t);
    this.normalsDirty = true;
    this.diagonalsDirty = true;
    this.dropOccluder();
    this.writeMap();
  }

  protected override mapData(): MeshData | null {
    return this.data;
  }

  /**
   * Palette colours (slot → sRGB) of the displayed revision: a palette reassignment or a swatch edit. Compared by
   * content (the document hands out a fresh map per query), so unchanged colours upload nothing; otherwise only the
   * paint attributes are rewritten. `shaders`: the palette's Blinn swatches (SHADING-SPEC §3).
   */
  setPaint(colours: PaletteColours | null, shaders: PaletteShaders | null = null): void {
    if (samePalette(colours, this.paint) && sameShaders(shaders, this.shaders)) return;
    this.paint = copyPalette(colours);
    this.shaders = copyShaders(shaders);
    if (this.topo !== null) this.surface.writePaint(this.topo, this.paintSlots(), this.paint, this.shaders);
  }

  /**
   * The mesh's hidden components (§5.6; the selection service's set, M6A-B6-26): hidden faces, the edges and vertices
   * only they use, and their normals and diagonals are not drawn and do not occlude. Compared by content (a set mutated
   * in place and passed again applies); a set of another topology hides nothing (M6A-B6-19). null shows everything.
   */
  setHidden(hidden: HiddenSet | null): void {
    const t = this.topo;
    const set = hidesNothing(hidden) || (t !== null && hidden !== null && !hiddenFits(t, hidden)) ? null : hidden;
    if (sameHidden(set, this.hidden)) return;
    this.hidden = copyHidden(set);
    if (t === null) return;
    this.deriveVis(t);
    if (this.tri !== null) this.surface.writeIndex(this.tri, this.vis?.faces ?? null, null);
    this.writeEdgeStates(t);
    this.overlayVisibilityChanged();
    this.dropOccluder();
  }

  override setWorld(matrix: Float64Array): void {
    super.setWorld(matrix);
    this.occluder?.setWorld(this.root.matrix);
  }

  /**
   * True when the displayed surface crosses the world segment `from`–`to` short of a 1e-4 margin at `to`: this mesh
   * hiding another mesh's component from the camera (§5.6; the host asks only for panes that draw it). Every drawn
   * face counts (hidden faces do not); the BVH is built when a segment first reaches the mesh's bounding box.
   */
  occludes(from: Vector3, to: Vector3): boolean {
    const t = this.topo;
    const tri = this.tri;
    if (t === null || tri === null) return false;
    if (this.occluder === null) {
      const index = triangleIndex(t, tri, this.vis?.faces ?? null);
      this.occluder = new TriangleOccluder(this.position, t.points, index, this.root.matrix);
    }
    return this.occluder.occludes(from, to);
  }

  /** The displayed stored form (null before the first `setData`). */
  get current(): MeshData | null {
    return this.data;
  }

  /** The Blinn swatches drawn (a copy of the last passed to `setData` or `setPaint`; null = all Lambert). */
  get shading(): PaletteShaders | null {
    return this.shaders;
  }

  /** The palette colours drawn (a copy of the last passed to `setData` or `setPaint`). */
  get colours(): PaletteColours | null {
    return this.paint;
  }

  /** Per-pane display; component overlays (`components`, Mesh Check, symmetry plane) belong to `EditMeshView`. */
  applyPane(display: MeshPaneDisplay): void {
    this.applyCommon(display, false);
  }

  protected override faceVisibility(): Uint8Array | null {
    return this.vis?.faces ?? null;
  }

  protected override vertexVisibility(): Uint8Array | null {
    return this.vis?.verts ?? null;
  }

  override dispose(): void {
    this.dropOccluder();
    super.dispose();
  }

  private paintSlots(): ArrayLike<number> | null {
    return this.data?.layers.get('paint')?.data ?? null;
  }

  /** `vis` for the current hidden set (null when nothing is hidden). */
  private deriveVis(t: Topo): void {
    if (this.hidden === null) {
      this.vis = null;
      return;
    }
    this.linked ??= withCornerEdges(t);
    const v = this.vis;
    const out =
      v !== null && v.verts.length === t.points && v.edges.length === t.edges && v.faces.length === t.faces
        ? v
        : { verts: new Uint8Array(t.points), edges: new Uint8Array(t.edges), faces: new Uint8Array(t.faces) };
    this.vis = deriveVisibility(this.linked, this.hidden, null, out);
  }

  /** Hard flags, and the hidden bit of edges the visibility rule leaves out (the line shader drops those). */
  private writeEdgeStates(t: Topo): void {
    const state = this.edges.state.array as Uint8Array;
    const edges = this.vis?.edges ?? null;
    for (let e = 0; e < t.edges; e++) {
      let s = ((t.ef[e] as number) & EDGE_HARD) !== 0 ? STATE.hard : 0;
      if (edges !== null && edges[e] !== 1) s |= STATE.hidden;
      state[e] = s;
    }
    uploadAll(this.edges.state);
  }

  private dropOccluder(): void {
    this.occluder?.dispose();
    this.occluder = null;
  }
}
