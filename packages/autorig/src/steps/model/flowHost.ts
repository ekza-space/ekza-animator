// The wizard as an `autorigFlow` host (STUDIO-TOUCH-SPEC §20.3 item 10, T5b): the orchestration of ①–⑤ lives in
// editor-core so that Auto-Rig and Halo issue the same operator sequence (AS-ST-15, AS-ST-5); the steps call it with
// this host. Its funnels are the wizard's — `run` is `ctx.run` (a failure toasts and shows in the footer), `quiet` is
// `app.runUntyped` — and its store is the wizard's U state: the session's subject, intake and start pose, the `model`
// slice's parts, the `rig` slice's rigid parts, painted flag and straighten measure, and ③'s `boundKey` (③'s view state
// is keyed by the session store, as the slices are). Nothing here writes the document.
import {
  type AutoRigFlowHost,
  type AutoRigFlowState,
  type AutoRigFlowStore,
  autoRigFlowHost,
} from '@ekza-studio/editor-core';
import type { AutoRigSessionFields } from '../../session';
import type { WizardContext } from '../../shell/context';
import { rigUi } from '../rig/ui';

/** The flow state the wizard keeps across its session, slices and ③'s view state. */
export function wizardFlowStore(ctx: Pick<WizardContext, 'session'>): AutoRigFlowStore {
  const { session } = ctx;
  return {
    get(): AutoRigFlowState {
      const s = session.getState();
      return {
        subject: s.subject,
        intake: s.intake,
        startPose: s.startPose,
        parts: s.model.parts,
        rigidParts: s.rig.rigidParts,
        paintedSinceBind: s.rig.paintedSinceBind,
        straightened: s.rig.straightened,
        boundKey: rigUi(ctx).get().boundKey,
      };
    },
    set(patch) {
      if (patch.parts !== undefined) session.patch('model', { parts: patch.parts });
      const rig: { -readonly [K in 'rigidParts' | 'paintedSinceBind' | 'straightened']?: AutoRigFlowState[K] } = {};
      if (patch.rigidParts !== undefined) rig.rigidParts = patch.rigidParts;
      if (patch.paintedSinceBind !== undefined) rig.paintedSinceBind = patch.paintedSinceBind;
      if (patch.straightened !== undefined) rig.straightened = patch.straightened;
      if (Object.keys(rig).length > 0) session.patch('rig', rig);
      const fields: { -readonly [K in 'subject' | 'intake' | 'startPose']?: AutoRigSessionFields[K] } = {};
      if (patch.subject !== undefined) fields.subject = patch.subject;
      if (patch.intake !== undefined) fields.intake = patch.intake;
      if (patch.startPose !== undefined) fields.startPose = patch.startPose;
      if (Object.keys(fields).length > 0) session.set(fields);
      const boundKey = patch.boundKey;
      if (boundKey !== undefined) rigUi(ctx).set((current) => ({ ...current, boundKey }));
    },
    resetSubject(subject) {
      session.resetSubject(subject);
    },
  };
}

/**
 * The wizard's flow host: `run` through `ctx.run` when the context has it (a view), else `app.runUntyped` (a test's
 * or a listener's partial context).
 */
export function flowHost(
  ctx: Pick<WizardContext, 'app' | 'session'> & Partial<Pick<WizardContext, 'run'>>,
): AutoRigFlowHost {
  const { run } = ctx;
  return autoRigFlowHost(ctx.app, wizardFlowStore(ctx), run === undefined ? {} : { run: (op, args) => run(op, args) });
}
