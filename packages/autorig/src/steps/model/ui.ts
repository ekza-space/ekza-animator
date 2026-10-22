// ①'s transient UI state (AUTORIG-SPEC §5.2; D3): what is loading, the last failure, a skinned file waiting for
// Re-rig, a project's characters — read by the drop zone on the first visit, written by the lazy ① actions (`./flow`).
import type { CharacterId } from '@ekza-studio/doc';
import type { WizardContext } from '../../shell/context';
import { smallStore, type SmallStore } from '../../shell/store';
import type * as Flow from './flow';

/** ①'s transient UI state (per wizard). */
export interface ModelUi {
  readonly loading: string | null;
  /** The last failure of a ① action (shown in the footer until the next one). */
  readonly error: string | null;
  readonly rerig: { readonly name: string; readonly bytes: Uint8Array } | null;
  readonly choose: readonly CharacterId[] | null;
}

const uis = new WeakMap<WizardContext['session'], SmallStore<ModelUi>>();

export function modelUi(ctx: Pick<WizardContext, 'session'>): SmallStore<ModelUi> {
  let store = uis.get(ctx.session);
  if (store === undefined) {
    store = smallStore<ModelUi>({ loading: null, error: null, rerig: null, choose: null });
    uis.set(ctx.session, store);
  }
  return store;
}

/** The ① actions (`./flow`, a lazy chunk); a chunk that does not arrive (offline after a redeploy) shows as a ① failure. */
export function withFlow(
  ctx: Pick<WizardContext, 'session'>,
  failed: string,
  run: (flow: typeof Flow) => unknown,
): Promise<void> {
  return import('./flow').then(
    async (flow) => {
      await run(flow);
    },
    () => {
      modelUi(ctx).set((current) => ({ ...current, loading: null, error: failed }));
    },
  );
}
