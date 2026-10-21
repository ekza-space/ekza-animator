// The Rig & Skin services of `app.rig` (M6B-SPEC §4.6; C0 baselines in C7's dir): created by the rig-workspace chunk
// when it loads (`app.rig.load()`), so none of them is in the eager route (§0.4.9). The test pose is a working baseline
// (C7 owns it); the skin service is C4's skin-worker client (`rig/skinService.ts`), the validation service a stub until
// C7 lands `rig/validation/**`.
import type { CharacterId } from '@ekza-studio/doc';
import type { EditorApp, EditorHistory, RigValidationService, SkinService, TestPoseService } from '../../types';
import { createSkinService } from '../skinService';
import { createTestPoseService } from '../testPose';

export interface RigServices {
  readonly testPose: TestPoseService;
  readonly skin: SkinService;
  readonly validation: RigValidationService;
}

export function createRigServices(deps: {
  readonly app: () => EditorApp;
  readonly history: () => EditorHistory;
  readonly changed: (character: CharacterId) => void;
}): RigServices {
  return {
    testPose: createTestPoseService(deps),
    skin: createSkinService(deps),
    validation: { rows: () => [], status: () => ({ glyph: 'none', reasons: [] }) },
  };
}
