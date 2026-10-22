// C7 (rig shell; M6B-SPEC §5.17, §6.3, §0.6): the pose view of Rig & Skin.
//
// - `rig.pose.view {view}`: 'bind' (Go to Bind Pose: status line, Skin menu, the `rig.modes` E slot) clears every
//   test pose and keeps a copy; 'test' brings the kept copy back (before/after checks). Never blocked: the `bind`
//   source evaluates the channel defaults (the rest pose). 'clip' arrives with the ROM clip, after the MVP.
// - `rig.pose.resetTest` (Reset Test Pose): forgets the test poses and their kept copies; the view returns to Bind.
// Both are U state: no undo step, the document is never written.
import type { PoseView } from '../../../types';
import { applyPoseView } from '../../../rig/chunk/workspace';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import { RIG_ONLY_REASON } from './mode';
import { ARRIVES_AFTER_MVP } from './stub';

const VIEWS: readonly PoseView[] = ['bind', 'test', 'clip'];

const poseView = defineOperator({
  id: 'rig.pose.view',
  label: 'Pose View',
  description: 'Go to Bind Pose (the rest pose) or back to the Test pose; test poses are never keys.',
  category: 'rig',
  scope: 'rig',
  workspaces: ['rig'],
  extraArgs: ['view'],
  poll({ app }, args) {
    if (!isRecord(args) || !VIEWS.includes(args['view'])) return fail('expects { view }');
    if (app.session.getState().workspace !== 'rig') return fail(RIG_ONLY_REASON);
    if (args['view'] === 'clip') return fail(ARRIVES_AFTER_MVP);
    return OK;
  },
  apply({ app }, args) {
    const testPose = app.rig.testPose;
    if (args.view === 'bind') {
      testPose.clear();
      applyPoseView(app, 'bind');
      return;
    }
    applyPoseView(app, 'test');
    for (const runtime of app.characters.list()) testPose.restore(runtime.id);
  },
});

const resetTest = defineOperator({
  id: 'rig.pose.resetTest',
  label: 'Reset Test Pose',
  description: 'Forgets the test pose (and the copy Go to Bind Pose keeps) of every character.',
  category: 'rig',
  scope: 'rig',
  workspaces: ['rig'],
  poll: ({ app }) => (app.session.getState().workspace === 'rig' ? OK : fail(RIG_ONLY_REASON)),
  apply({ app }) {
    app.rig.testPose.forget();
    applyPoseView(app, 'bind');
  },
});

export const RIG_POSE_OPERATORS: readonly AnyOperator[] = [poseView, resetTest];
