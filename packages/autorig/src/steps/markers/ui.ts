// ②'s transient UI state (AUTORIG-SPEC §5.3; D4): the step start in flight, a start that failed. Per wizard (keyed by
// its session store); never in the session mirror (a reload starts Quick Rig again).
import type { WizardContext } from '../../shell/context';
import { smallStore, type SmallStore } from '../../shell/store';

export interface MarkersUi {
  readonly starting: boolean;
  /** Why Quick Rig could not open (the start's poll or failure), or null. */
  readonly error: string | null;
}

const uis = new WeakMap<WizardContext['session'], SmallStore<MarkersUi>>();

export function markersUi(ctx: Pick<WizardContext, 'session'>): SmallStore<MarkersUi> {
  let store = uis.get(ctx.session);
  if (store === undefined) {
    store = smallStore<MarkersUi>({ starting: false, error: null });
    uis.set(ctx.session, store);
  }
  return store;
}
