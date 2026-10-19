// Static display of a mesh outside component mode (M6A-SPEC §4.4, §5.23): props in every workspace and the meshes
// that are not hilited. Built from the stored form (no edit links): the surface in the pane's shading, wire on shaded,
// hard edges, flat, back-face culling, x-ray, face orientation, normals, triangulation and "Dim unhilited".
import type { MeshData, Normals, Triangulation } from '@ekza-animator/mesh-core';
import { EDGE_HARD } from '@ekza-animator/mesh-core';
import { ViewBase } from './internal/base';
import { uploadAll } from './internal/ranges';
import { topoOfData } from './internal/topo';
import { STATE } from './style';
import type { MeshViewThemeInput } from './theme';
import type { MeshPaneDisplay, MeshViewLayers } from './types';

export class MeshSurface extends ViewBase {
  private data: MeshData | null = null;
  private paint: ReadonlyMap<number, readonly [number, number, number]> | null = null;

  constructor(opts: { readonly theme: MeshViewThemeInput; readonly layers: MeshViewLayers }) {
    super(opts);
  }

  /** Replaces the displayed revision (stored form, its triangulation and normals) and its palette colours. */
  setData(
    data: MeshData,
    tri: Triangulation,
    normals: Normals,
    paint: ReadonlyMap<number, readonly [number, number, number]> | null,
  ): void {
    const t = topoOfData(data);
    this.data = data;
    this.topo = t;
    this.position = data.position;
    this.tri = tri;
    this.normals = normals;
    this.paint = paint;
    this.surface.build(t, data.position, tri, normals, null);
    this.surface.writePaint(t, data.layers.get('paint')?.data ?? null, paint);
    this.edges.setGeometry(t.edges);
    this.writeEdgeSegments(t, null);
    const state = this.edges.state.array as Uint8Array;
    for (let e = 0; e < t.edges; e++) state[e] = ((t.ef[e] as number) & EDGE_HARD) !== 0 ? STATE.hard : 0;
    uploadAll(this.edges.state);
    this.normalsDirty = true;
    this.diagonalsDirty = true;
  }

  /** The displayed stored form (null before the first `setData`). */
  get current(): MeshData | null {
    return this.data;
  }

  /** The palette colours last passed to `setData`. */
  get colours(): ReadonlyMap<number, readonly [number, number, number]> | null {
    return this.paint;
  }

  /** Per-pane display; component overlays (`components`, Mesh Check, symmetry plane) belong to `EditMeshView`. */
  applyPane(display: MeshPaneDisplay): void {
    this.applyCommon(display, false);
  }
}
