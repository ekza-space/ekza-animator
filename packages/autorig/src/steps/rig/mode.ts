// The rig mode of ③'s sub-tool (AUTORIG-SPEC §4.2, §5.4; D4; lazy with the view and the step start): review in Object
// mode, *Adjust joints* in Skeleton mode, *Paint weights* in Skin mode. *Show weights* in review: C6 draws the weight
// display only in Skin mode, so review then works in Skin mode with the Select tool (no brush: a click never paints)
// and the panes' display on greyscale.
import { paneDisplayPort } from '@ekza-studio/editor-core';
import type { WizardContext } from '../../shell/context';
import { SUB_MODE } from './slice';
import { rigUi } from './ui';

/** Sets every pane's weight display (greyscale or off). */
export function setWeightDisplay(ctx: WizardContext, on: boolean): void {
  const port = paneDisplayPort(ctx.app);
  for (const pane of port?.panes() ?? []) {
    const display = port?.display(pane);
    const weights = on ? 'greyscale' : 'off';
    if (display !== null && display !== undefined && display.weights !== weights) {
      port?.setDisplay(pane, { ...display, weights });
    }
  }
}

/** Puts the app in the rig mode (and tool) of the current sub-tool. */
export async function applySubMode(ctx: WizardContext): Promise<void> {
  const { app } = ctx;
  if (app.session.getState().workspace !== 'rig') return;
  const sub = ctx.session.getState().rig.sub;
  const weights = sub === 'review' && rigUi(ctx).get().showWeights;
  const mode = weights ? 'skin' : SUB_MODE[sub];
  if (app.session.getState().rig.mode !== mode) await app.runUntyped('rig.mode', { mode });
  // the tool of the mode (Skin mode keeps the tool it had when it is entered from review's Show weights)
  const tool = weights ? 'select' : sub === 'paint' ? 'paintSkinWeights' : null;
  if (weights) setWeightDisplay(ctx, true);
  if (tool !== null && app.session.getState().tools.viewport !== tool) {
    await app.runUntyped('view.tool', { panel: 'viewport', tool });
  }
}
