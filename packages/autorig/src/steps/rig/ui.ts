// ③'s transient UI state (AUTORIG-SPEC §5.4; D4), shared by ② (which starts `autorig.rig`) and ③: the plan of the
// running composition (which stages the progress sheet lists), how the last run ended (cancelled during the bind, or
// interrupted by another change) and its failure, and where *Adjust joints* started (the history top, for Done's
// rebind). Per wizard (keyed by its session store); never mirrored.
import type { WizardContext } from '../../shell/context';
import { smallStore, type SmallStore } from '../../shell/store';

export interface RigUi {
  /** The stages of the running `autorig.rig` (Bind Skin is skipped by a re-run of a bound skeleton). */
  readonly plan: { readonly bind: boolean; readonly straighten: boolean } | null;
  /** How the last run ended when it left a step behind: the bind cancelled, or an interruption. */
  readonly notice: 'cancelled' | 'interrupted' | null;
  /** The last failure's message (footer, assertive). */
  readonly error: string | null;
  /** The history top when *Adjust joints* opened (Done rebinds only after a change). */
  readonly adjustFrom: number | null;
  /** A rebind (Done, Bind again) is running. */
  readonly rebinding: boolean;
  /** *Show weights* in review (Skin mode with the Select tool, C6's greyscale display). */
  readonly showWeights: boolean;
}

const uis = new WeakMap<WizardContext['session'], SmallStore<RigUi>>();

export function rigUi(ctx: Pick<WizardContext, 'session'>): SmallStore<RigUi> {
  let store = uis.get(ctx.session);
  if (store === undefined) {
    store = smallStore<RigUi>({
      plan: null,
      notice: null,
      error: null,
      adjustFrom: null,
      rebinding: false,
      showWeights: false,
    });
    uis.set(ctx.session, store);
  }
  return store;
}
