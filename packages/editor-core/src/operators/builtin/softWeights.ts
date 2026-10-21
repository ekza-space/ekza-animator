// The soft-selection weights of a hilited mesh (M6A-SPEC §5.15; B12a): what a component transform would use now, for
// the overlay's tint (the viewport's transform runtime) and the test API's `softWeights`. Only lazy code imports it
// (§5.27: not in the eager route).
import type { MeshId } from '@ekza-studio/doc';
import type { BitSet, EditMesh } from '@ekza-studio/mesh-core';
import { meshKernel } from '../../mesh';
import { worldPlacement } from '../../mesh/context';
import { componentInternals } from '../../selection/component/service';
import type { EditorApp } from '../../types';

/**
 * The soft-selection weights a component transform of `mesh` would use now (§5.15): `w = f(d / r)` from the expanded
 * selection of the current component mode (its vertices weigh 1; hidden vertices 0), distances in world metres
 * through the mesh's placement. Null when soft selection is off, outside a component mode, for a mesh that is not
 * hilited or not ready, or before the kernel has loaded.
 */
export function softWeightsOf(app: EditorApp, mesh: string): Float32Array | null {
  const kernel = meshKernel();
  const state = app.session.getState();
  const soft = state.model.softSelect;
  const kind = state.model.componentMode;
  if (kernel === null || !soft.on || kind === 'object' || !state.model.hilite.includes(mesh as MeshId)) return null;
  const runtime = app.meshes.get(mesh as MeshId);
  const record = app.store.get('meshes', mesh as MeshId);
  const data = runtime?.state === 'ready' ? runtime.data() : null;
  if (runtime === undefined || record === undefined || data === null) return null;
  const m: EditMesh = runtime.mesh ?? kernel.editMeshFrom(data);
  const selection =
    componentInternals(app.components)?.expanded(mesh as MeshId, kind) ?? app.components.get(mesh as MeshId, kind);
  const seeds: BitSet = new kernel.BitSet(m.counts.points);
  const add = (v: number): void => {
    if (v >= 0 && v < m.counts.points) seeds.add(v);
  };
  if (kind === 'vertex') selection.verts.forEach(add);
  else if (kind === 'edge') {
    selection.edges.forEach((e) => {
      if (e >= m.counts.edges) return;
      add(m.edgeVert(e, 0));
      add(m.edgeVert(e, 1));
    });
  } else {
    selection.faces.forEach((f) => {
      if (f >= m.counts.faces) return;
      const first = m.faceCorner(f);
      let c = first;
      let guard = 0;
      do {
        add(m.cornerVert(c));
        c = m.cornerNext(c);
      } while (c !== first && ++guard <= m.counts.corners);
    });
  }
  let hidden: ReturnType<EditorApp['components']['hidden']> | null = null;
  try {
    hidden = app.components.hidden(mesh as MeshId);
  } catch {
    hidden = null;
  }
  return kernel.softWeights(m, seeds, {
    radius: soft.radius,
    falloff: soft.falloff,
    curve: soft.curve,
    placement: worldPlacement(app.store, record),
    hidden,
  });
}
