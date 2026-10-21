// Hosting of mesh-view in the viewport (M6A-SPEC §4.4, §4.7, §2; B6). The eager part is this file only: the one lazy
// loader of `@ekza-studio/mesh-view` (with three-mesh-bvh) and of the display that hosts it, and the mapping of a
// pane's `DisplayFlags` onto `MeshPaneDisplay`. Everything that draws or picks lives in the lazy chunk, which carries
// the mesh-view size marker (§2 boundary); eager code must never contain the marker string.
import type { DisplayFlags } from '@ekza-studio/editor-core';
import type * as MeshViewModule from '@ekza-studio/mesh-view';
import type { MeshPaneDisplay } from '@ekza-studio/mesh-view';
import type * as DisplayModule from './display';
import type { MeshDisplay, MeshDisplayOptions } from './display';

export type { MeshDisplay, MeshDisplayOptions, MeshDisplayPick, MeshLayerHost, MeshLayerTarget } from './display';
export { MESH_LAYERS } from './layers';

/** The lazy mesh-view module. */
export type MeshView = typeof MeshViewModule;

let view: Promise<MeshView> | null = null;
let display: Promise<typeof DisplayModule> | null = null;

/** Loads mesh-view once (later calls share the promise; a failed load is retried by the next call). */
export function loadMeshView(): Promise<MeshView> {
  if (view === null) {
    // oxlint-disable-next-line no-restricted-imports -- the one lazy mesh-view loader of the viewport (M6A-SPEC §2)
    view = import('@ekza-studio/mesh-view').then(
      (loaded) => {
        // The chunk's entry references its size marker; reading it keeps the export in the chunk.
        if (typeof loaded.VIEW_MARKER !== 'string') throw new Error('mesh-view chunk without its marker');
        return loaded;
      },
      (error: unknown) => {
        view = null;
        throw error;
      },
    );
  }
  return view;
}

/**
 * Loads mesh-view and the display that hosts one view per mesh runtime (MeshSurface outside component mode,
 * EditMeshView for hilited meshes in component mode) through `target.addMeshLayer`.
 */
export async function loadMeshDisplay(opts: MeshDisplayOptions): Promise<MeshDisplay> {
  if (display === null) {
    display = import('./display').catch((error: unknown) => {
      display = null;
      throw error;
    });
  }
  const [module, host] = await Promise.all([loadMeshView(), display]);
  return new host.MeshDisplay(module, opts);
}

/**
 * A pane's display flags as mesh-view reads them (§4.4). `dimmed` carries the pane's "Dim unhilited" flag; each mesh
 * host turns it on only for meshes outside the hilite set while a component mode is active (§5.6).
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
