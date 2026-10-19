// M6a test API, B13 group (M6A-SPEC §4.8): palettes, the active swatch and image planes, read from the document and
// the session. Palettes and planes in their display order; a palette's swatches by slot (deleted ones left out).
import type { EkzaAnimatorTestApi } from '../types';
import type { M6aTestApiContext } from './support';

export type ModelContentTestApi = Pick<EkzaAnimatorTestApi, 'palettes' | 'activeSwatch' | 'imagePlanes'>;

const byOrder = (
  a: { readonly order: string; readonly id: string },
  b: { readonly order: string; readonly id: string },
) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function modelContentTestApi(ctx: M6aTestApiContext): ModelContentTestApi {
  const app = () => ctx.shell.app;
  return {
    palettes: () => {
      ctx.sync();
      const store = app().store;
      return [...store.list('palettes')].sort(byOrder).map((palette) => ({
        id: palette.id,
        name: palette.name,
        swatches: [...store.query.swatchesOfPalette(palette.id)]
          .sort((a, b) => a.slot - b.slot)
          .map((swatch) => ({
            id: swatch.id,
            slot: swatch.slot,
            srgb: [swatch.srgb[0], swatch.srgb[1], swatch.srgb[2]] as [number, number, number],
            name: swatch.name,
          })),
      }));
    },
    activeSwatch: () => {
      ctx.sync();
      return app().session.getState().model.activeSwatch;
    },
    imagePlanes: () => {
      ctx.sync();
      return [...app().store.list('imagePlanes')].sort(byOrder).map((plane) => ({
        id: plane.id,
        camera: plane.camera,
        asset: plane.asset,
        offset: [plane.offset[0], plane.offset[1]] as [number, number],
        size: plane.size,
        opacity: plane.opacity,
        depth: plane.depth,
        locked: plane.locked,
        visible: plane.visible,
      }));
    },
  };
}
