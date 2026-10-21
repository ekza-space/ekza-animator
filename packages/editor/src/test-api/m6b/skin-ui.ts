// M6b test API, C6 group (M6B-SPEC §4.8, §0.5): `paint()` — the brush, the active influence, the holds per character
// and the weight display mode of the panes; `weightLabels(paneId)` — the active influence's weight of every visible
// posed point of the shown bound meshes in page CSS px (the numbers overlay's labels; its drawing arrives after the MVP,
// the positions are what tests paint at); `componentEditor()` — null: the Component Editor arrives after the MVP
// (`test.fixme('c6-ce')`).
import { paneDisplayPort } from '@ekza-studio/editor-core';
import { rigSkinOf } from '@ekza-studio/viewport';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type SkinUiTestApi = Pick<EkzaStudioTestApi, 'paint' | 'weightLabels' | 'componentEditor'>;

export function skinUiTestApi(ctx: M6bTestApiContext): SkinUiTestApi {
  const app = ctx.shell.app;
  return {
    paint() {
      ctx.sync();
      const rig = app.session.getState().rig;
      const brush = rig.paint.brush;
      const holds: Record<string, string[]> = {};
      for (const [character, keys] of rig.holds) holds[character] = [...keys].sort();
      const port = paneDisplayPort(app);
      let display = 'off';
      for (const pane of port?.panes() ?? []) {
        const mode = port?.display(pane)?.weights;
        if (mode !== undefined && mode !== 'off') {
          display = mode;
          break;
        }
      }
      return {
        mode: rig.paint.mode,
        op: brush.op,
        value: brush.value,
        opacity: brush.opacity,
        radiusPx: brush.radiusPx,
        reach: brush.reach,
        mirror: brush.mirror,
        active:
          rig.activeInfluence === null ? null : { mesh: rig.activeInfluence.mesh, joint: rig.activeInfluence.joint },
        holds,
        display,
      };
    },
    weightLabels(paneId) {
      ctx.sync();
      return rigSkinOf(app)?.weightLabels(paneId) ?? [];
    },
    componentEditor: () => null,
  };
}
