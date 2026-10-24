// Halo's host of the shared Auto-Rig orchestration (STUDIO-TOUCH-SPEC §20.3 item 10, §9 J1; T5b's `autorigFlow`):
// one flow state per app, so what Home's intake records — the subject, the intake report, the start pose read once
// per subject — is what the Rig-it card (T9's `recipes/rigIt`) rigs with. The person's runs go through the shell's
// funnel (`ctx.run`: a refusal says why in Halo's toast); the flow's bookkeeping runs quietly (`app.runUntyped`).
import {
  type AutoRigFlowHost,
  type AutoRigFlowStore,
  autoRigFlowHost,
  type EditorApp,
  memoryAutoRigFlowStore,
  type OperatorResult,
} from '@ekza-studio/editor-core';

/** The page's flow state of each app (Halo's own: the wizard keeps its own in its session). */
const stores = new WeakMap<EditorApp, AutoRigFlowStore>();

/** The flow state Halo's intake and Rig it share for this app. */
export function haloFlowStore(app: EditorApp): AutoRigFlowStore {
  let store = stores.get(app);
  if (store === undefined) {
    store = memoryAutoRigFlowStore();
    stores.set(app, store);
  }
  return store;
}

/** A flow host over Halo's funnel: `run` is the person's (toasts a refusal), `quiet` the flow's bookkeeping. */
export function haloFlowHost(ctx: {
  readonly app: EditorApp;
  run(op: string, args?: unknown): Promise<OperatorResult<unknown>>;
}): AutoRigFlowHost {
  return autoRigFlowHost(ctx.app, haloFlowStore(ctx.app), {
    run: (op, args) => ctx.run(op, args),
    quiet: (op, args) => ctx.app.runUntyped(op, args),
  });
}
