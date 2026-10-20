// Mesh layer hosting (M6A-SPEC §4.7; B9): mesh-view's per-mesh views (B6) join the one shared scene through
// `ViewportManager.addMeshLayer`, and the manager hands each pane's display to every host before the pane renders,
// so one scene serves N panes with different shading (wire, shaded, colours, lit), overlays and dimming.
import type { DisplayFlags } from '@ekza-animator/editor-core';
import type { MeshPaneDisplay } from '@ekza-animator/mesh-view';
import type { Object3D } from 'three';

/** What `ViewportManager.addMeshLayer` takes (§4.7; `mesh/display.ts` re-exports it). */
export interface MeshLayerHost {
  readonly root: Object3D;
  /** Called before every pane render with that pane's display (one scene, N cameras). */
  applyPane(display: MeshPaneDisplay, paneId: string): void;
  dispose(): void;
}

/**
 * A pane's display flags as mesh-view reads them (§4.4). `dimmed` carries the pane's "Dim unhilited" flag; each host
 * applies it only to meshes outside the hilite set while a component mode is active (§5.6).
 */
export function meshPaneDisplay(flags: DisplayFlags): MeshPaneDisplay {
  return {
    shading: flags.shading,
    wireOnShaded: flags.wireOnShaded,
    flat: flags.flat,
    cull: flags.cull,
    xray: flags.xray,
    components: flags.components,
    normals: flags.normals,
    faceOrientation: flags.faceOrientation,
    triangulation: flags.triangulation,
    hardEdges: flags.hardEdges,
    meshCheck: flags.meshCheck,
    symmetryPlane: flags.symmetryPlane,
    dimmed: flags.dimUnhilited,
  };
}
