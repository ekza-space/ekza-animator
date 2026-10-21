// M6b test API, C4 group (M6B-SPEC §4.8, §0.5; C0 stub file, C4 fills it): `skin(mesh)` — the mesh's skeleton, its
// palette (joint keys in palette order), the stored `SkinBindRecord`, the review layer and the `checkSkin` problems
// (C6's rules; an empty list until they land) with the unreachable points of the mesh's last bind.
import { EkzaError } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import { meshKernel, type SkinServiceImpl } from '@ekza-studio/editor-core';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type AutoSkinTestApi = Pick<EkzaStudioTestApi, 'skin'>;

export function autoSkinTestApi(ctx: M6bTestApiContext): AutoSkinTestApi {
  return {
    skin(mesh) {
      ctx.sync();
      const app = ctx.shell.app;
      const record = app.store.get('meshes', mesh as MeshId);
      if (record === undefined || record.deleted !== null) return null;
      const kernel = meshKernel();
      const data = app.meshes.get(record.id)?.data() ?? null;
      const skin = kernel === null || data === null ? null : kernel.readSkin(data);
      const review = kernel === null || data === null ? null : kernel.readSkinReview(data);
      const stored = record.skin !== null && 'skeleton' in record.skin ? record.skin : null;
      let problems: { code: string; count: number }[] = [];
      const service = app.rig.loaded ? (app.rig.skin as SkinServiceImpl) : null;
      if (
        kernel !== null &&
        skin !== null &&
        stored !== null &&
        service !== null &&
        typeof service.skeleton === 'function'
      ) {
        try {
          problems = kernel
            .checkSkin(skin, {
              skeleton: service.skeleton(stored.skeleton),
              review,
              unreachable: service.report(record.id)?.unreachable ?? null,
            })
            .map((problem) => ({ code: problem.code, count: problem.points.length }));
        } catch (error) {
          // C6 lands the rules (§9.0); until then the list is empty.
          if (!(error instanceof EkzaError && error.code === 'not-implemented')) throw error;
        }
      }
      return {
        skeleton: stored?.skeleton ?? null,
        palette: skin === null ? [] : skin.palette.map((entry) => entry.key),
        bind: stored?.bind === null || stored?.bind === undefined ? null : { ...stored.bind },
        review: review === null ? null : { reason: review.reason, points: Array.from(review.points) },
        problems,
      };
    },
  };
}
