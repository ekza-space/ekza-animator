// The Rig & Skin services of `app.rig` (M6B-SPEC §4.6; C0 baselines, then C7): created by the rig-workspace chunk
// when it loads (`app.rig.load()`), so none of them is in the eager route (§0.4.9): the test pose, the skin service
// (a stub until C4 lands the skin-worker client, `rig/skinService.ts`), the Validation service, and the workspace
// controller (entering and leaving, the Rig keymap rows, test-pose gestures; ./workspace.ts).
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { EditorApp, EditorHistory, SkinService, TestPoseService } from '../../types';
import { createTestPoseService } from '../testPose';
import { createRigValidation, type RigValidation } from '../validation';
import { startRigWorkspace } from './workspace';

export interface RigServices {
  readonly testPose: TestPoseService;
  readonly skin: SkinService;
  readonly validation: RigValidation;
  /** Detaches the workspace controller (the app is being disposed). */
  dispose(): void;
}

export function createRigServices(deps: {
  readonly app?: () => EditorApp;
  readonly history: () => EditorHistory;
  readonly changed: (character: CharacterId) => void;
}): RigServices {
  const testPose = createTestPoseService(deps);
  const app = deps.app;
  const validation = createRigValidation({
    app:
      app ??
      (() => {
        throw new EkzaError('unavailable', 'app.rig.validation needs the app');
      }),
  });
  let stop: Disposer | null = null;
  const services: RigServices = {
    testPose,
    skin: {
      bind: () => Promise.reject(new EkzaError('not-implemented', 'editor-core.SkinService.bind')),
      busy: false,
      clipboard: null,
    },
    validation,
    dispose: () => stop?.(),
  };
  if (app !== undefined) stop = startRigWorkspace(app(), { testPose, validation });
  return services;
}
