// M6a test API, B12a group (M6A-SPEC §4.8): symmetry maps and soft-selection weights.
// - `symmetry(mesh)`: the mesh's remembered settings (§5.14; defaults: off, the preferences' tolerance, Preserve Seam
//   on) with the partner map the runtime builds for them (`unmatched`, `vertexPartners`: −1 = none, a vertex on the
//   seam is its own partner); null for a mesh without a ready runtime. With symmetry off: `unmatched` 0, no partners.
// - `softWeights(mesh)`: the weights a component transform of the mesh would use now (§5.15: `w = f(d / r)` from the
//   expanded selection, seeds 1, hidden vertices 0); null when soft selection is off, outside a component mode or for
//   a mesh that is not hilited.
import type { MeshId } from '@ekza-studio/doc';
import { attachMeshes, softWeightsOf, symmetryOf } from '@ekza-studio/editor-core';
import type { EkzaAnimatorTestApi } from '../types';
import type { M6aTestApiContext } from './support';

export type ModelTransformToolsTestApi = Pick<EkzaAnimatorTestApi, 'symmetry' | 'softWeights'>;

export function modelTransformToolsTestApi(ctx: M6aTestApiContext): ModelTransformToolsTestApi {
  const { app } = ctx.shell;
  return {
    symmetry(mesh) {
      ctx.sync();
      attachMeshes(app);
      const runtime = app.meshes.get(mesh as MeshId);
      if (runtime === undefined || runtime.state !== 'ready') return null;
      const settings = symmetryOf(app, mesh);
      const map = settings.mode === 'off' ? null : runtime.symmetry();
      return {
        mode: settings.mode,
        tolerance: settings.tolerance,
        preserveSeam: settings.preserveSeam,
        unmatched: map?.unmatched ?? 0,
        vertexPartners: map === null ? [] : [...map.vertex],
      };
    },
    softWeights(mesh) {
      ctx.sync();
      const weights = softWeightsOf(app, mesh);
      return weights === null ? null : [...weights];
    },
  };
}
