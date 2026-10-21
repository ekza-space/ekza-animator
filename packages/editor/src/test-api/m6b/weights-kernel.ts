// M6b test API, C6 (C5 subset) group (M6B-SPEC §4.8, §0.5): `weights(mesh, points?)` — per point the joint keys and
// weights of the mesh's current skin, by descending weight (empty rows for unweighted points; [] for an unbound mesh).
import type { MeshId } from '@ekza-studio/doc';
import { meshKernel } from '@ekza-studio/editor-core';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type WeightsKernelTestApi = Pick<EkzaStudioTestApi, 'weights'>;

export function weightsKernelTestApi(ctx: M6bTestApiContext): WeightsKernelTestApi {
  return {
    weights(mesh, points) {
      ctx.sync();
      const kernel = meshKernel();
      const data = ctx.shell.app.meshes.get(mesh as MeshId)?.data() ?? null;
      const skin = kernel === null || data === null ? null : kernel.readSkin(data);
      if (skin === null) return [];
      const list = points ?? Array.from({ length: skin.points }, (_, v) => v);
      return list.map((v) => {
        const row: [string, number][] = [];
        for (let k = 0; k < 4; k++) {
          const w = skin.weights[4 * v + k] as number;
          const key = skin.palette[skin.joints[4 * v + k] as number]?.key;
          if (w > 0 && key !== undefined) row.push([key, w]);
        }
        row.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
        return { joints: row.map(([key]) => key), weights: row.map(([, w]) => w) };
      });
    },
  };
}
