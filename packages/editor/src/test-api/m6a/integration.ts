// M6a test API, integration group (M6A-SPEC §4.8; E2E-MOD-30): expression weights on a character's display model,
// a pane rectangle's pixels, a display-model node's drawn position and the display model's counts (the last three
// additive, M6A-INT-17).
import { EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId } from '@ekza-animator/doc';
import type { EkzaAnimatorTestApi } from '../types';
import type { M6aTestApiContext } from './support';

export type IntegrationTestApi = Pick<
  EkzaAnimatorTestApi,
  'setExpression' | 'pixels' | 'displayNodeWorld' | 'displayModel'
>;

export function integrationTestApi(ctx: M6aTestApiContext): IntegrationTestApi {
  const { shell } = ctx;
  const viewport = () => {
    const vm = shell.ui.getState().viewport;
    if (vm === null) throw new EkzaError('unsupported', 'No ViewportManager (the viewport has not started)');
    return vm;
  };
  /** A character by id or name. */
  const character = (ref: string): CharacterId => {
    const runtime = shell.app.characters
      .list()
      .find((c) => c.id === ref || shell.app.store.get('characters', c.id)?.name === ref);
    if (runtime === undefined) throw new EkzaError('invalid-record', `No character ${ref}`);
    return runtime.id;
  };
  return {
    setExpression(ref, name, weight) {
      ctx.sync();
      if (!viewport().setExpression(character(ref), name, weight)) {
        throw new EkzaError('invalid-record', `${ref} has no displayed VRM expression '${name}'`);
      }
    },
    pixels(paneId, x, y, w, h) {
      ctx.sync();
      const vm = shell.ui.getState().viewport;
      const rect = vm?.paneRect(paneId) ?? null;
      if (vm === null || rect === null) return null;
      const x0 = Math.max(x, rect.x);
      const y0 = Math.max(y, rect.y);
      const x1 = Math.min(x + w, rect.x + rect.w);
      const y1 = Math.min(y + h, rect.y + rect.h);
      if (x1 <= x0 || y1 <= y0) return null;
      const read = vm.readPixels(x0, y0, x1 - x0, y1 - y0);
      return read === null ? null : { width: read.width, height: read.height, data: Array.from(read.data) };
    },
    displayNodeWorld(ref, node) {
      ctx.sync();
      return viewport().displayNodeWorld(character(ref), node);
    },
    displayModel(ref) {
      ctx.sync();
      const info = viewport().displayModelInfo(character(ref));
      return info === null ? null : { meshes: info.meshes, vertices: info.vertices };
    },
  };
}
