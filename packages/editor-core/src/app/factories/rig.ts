// `app.rig` (M6B-SPEC §4.6; C0 baseline, then C7): the loader of the lazy rig-workspace chunk (§2.1), which registers
// its operators once per app and creates the Rig & Skin services (`rig/chunk/services.ts`: test pose, skin,
// validation). Eager and tiny (§0.4.9): the services exist once `load()` resolved; before, reading one throws.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { RigServices } from '../../rig/chunk/services';
import type { EditorApp, EditorHistory, RigValidationService, SkinService, TestPoseService } from '../../types';

export interface RigApi {
  readonly testPose: TestPoseService;
  readonly skin: SkinService;
  readonly validation: RigValidationService;
  /** The services once the chunk is loaded, else null (the evaluation's 'test' source reads the test pose here). */
  readonly services: RigServices | null;
  load(): Promise<void>;
  readonly loaded: boolean;
  dispose(): void;
}

export function createRig(deps: {
  readonly app: () => EditorApp;
  readonly history: () => EditorHistory;
  readonly changed: (character: CharacterId) => void;
}): RigApi {
  let loading: Promise<void> | null = null;
  let services: RigServices | null = null;
  let detach: Disposer | null = null;
  const service = <K extends keyof RigServices>(key: K): RigServices[K] => {
    if (services === null) throw new EkzaError('unavailable', `app.rig.${key}: await app.rig.load() first`);
    return services[key];
  };
  return {
    get testPose() {
      return service('testPose');
    },
    get skin() {
      return service('skin');
    },
    get validation() {
      return service('validation');
    },
    get services() {
      return services;
    },
    load(): Promise<void> {
      loading ??= import('../../operators/builtin/rig/index').then((chunk) => {
        services = chunk.createRigServices(deps);
        detach = chunk.registerRigWorkspaceOperators(deps.app());
      });
      return loading;
    },
    get loaded() {
      return services !== null;
    },
    dispose(): void {
      detach?.();
    },
  };
}
