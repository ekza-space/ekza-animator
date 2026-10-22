// ③'s step start (AUTORIG-SPEC §4.2, §5.4; D4; a lazy chunk): after the frame's entry order (preview stopped, tool
// session ended, Rig & Skin), the rig mode of the current sub-tool — review in Object mode (Bind Skin opened Skin
// mode, M6B-AF-1: Auto-Rig sets the mode it wants), *Adjust joints* in Skeleton mode, *Paint weights* in Skin mode.
// The motion test starts from the view once the rig is checked (`./motion`).
import type { WizardContext } from '../../shell/context';
import { SUB_MODE } from './slice';

export async function enterRig(ctx: WizardContext): Promise<void> {
  const { app } = ctx;
  if (app.session.getState().workspace !== 'rig') return;
  const mode = SUB_MODE[ctx.session.getState().rig.sub];
  if (app.session.getState().rig.mode !== mode) await app.runUntyped('rig.mode', { mode });
}
