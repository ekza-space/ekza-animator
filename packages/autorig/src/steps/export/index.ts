// ⑤ Export step (AUTORIG-SPEC §5.6; D6): the targets, the checklist with its rule-label table, the avatar metadata and
// thumbnail, the OMOBA notes and *Continue in Studio*. This entry is eager (the frame's step registry and the session
// store import it), so it holds only the slice and the loaders: the view (`./ExportStep`) and the step's own start
// (`./enter`: the auto thumbnail and the remembered author) are lazy chunks of their own. Every download runs
// `autorig.export` (rig-workspace chunk), which builds the bytes with Studio's own export code.
import type { WizardContext } from '../../shell/context';
import type { StepViewProps } from '../../shell/steps';
import type { ComponentType } from 'react';

export { EXPORT_SLICE } from './slice';

/** The view of ⑤ (lazy). */
export const stepView = (): Promise<{ readonly default: ComponentType<StepViewProps> }> => import('./ExportStep');

/** ⑤'s own start after the frame's entry order (lazy). Best effort: the auto thumbnail and the remembered author are
 *  conveniences, so a failure (shown by the operator's own toast) never fails the step's entry. */
export const stepEnter = async (ctx: WizardContext): Promise<void> => {
  try {
    await (await import('./enter')).enterExport(ctx);
  } catch {
    // the step works without them
  }
};
