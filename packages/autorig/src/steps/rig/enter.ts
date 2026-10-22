// ③'s step start (AUTORIG-SPEC §4.2, §5.4; D4; a lazy chunk): after the frame's entry order (preview stopped, tool
// session ended, Rig & Skin), the rig mode of the current sub-tool — review in Object mode (Bind Skin opened Skin
// mode, M6B-AF-1: Auto-Rig sets the mode it wants; Skin mode with the Select tool while *Show weights* is on),
// *Adjust joints* in Skeleton mode, *Paint weights* in Skin mode. The motion test starts from the view (`./motion`).
import type { WizardContext } from '../../shell/context';
import { applySubMode } from './mode';

export function enterRig(ctx: WizardContext): Promise<void> {
  return applySubMode(ctx);
}
