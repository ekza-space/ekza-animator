// `app.rig` (M6B-SPEC §4.6; C0 baseline, then C7): the loader of the lazy rig-workspace chunk (§2.1), which registers
// its operators once per app and creates the Rig & Skin services (`rig/chunk/services.ts`: test pose, skin,
// validation, and the workspace controller with the Rig keymap rows). Eager and tiny (§0.4.9): the services exist
// once `load()` resolved; before, reading one throws EkzaError('unavailable'). They are prototype getters, so
// enumerating `app.rig` (React's dev-mode prop logging, a spread) never reads them.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { RigServices } from '../../rig/chunk/services';
import type { RigValidation } from '../../rig/validation';
import type { EditorApp, EditorHistory, SkinService, TestPoseService } from '../../types';

export interface RigApi {
  readonly testPose: TestPoseService;
  readonly skin: SkinService;
  /** The Validation service (C7: rows, profile, glyph, checklist). */
  readonly validation: RigValidation;
  /** The services once the chunk is loaded, else null (the evaluation's 'test' source reads the test pose here). */
  readonly services: RigServices | null;
  load(): Promise<void>;
  readonly loaded: boolean;
  dispose(): void;
}

interface RigDeps {
  readonly app: () => EditorApp;
  readonly history: () => EditorHistory;
  readonly changed: (character: CharacterId) => void;
}

const unavailable = (key: string): never => {
  throw new EkzaError('unavailable', `app.rig.${key}: await app.rig.load() first`);
};

class Rig implements RigApi {
  services: RigServices | null = null;
  private loading: Promise<void> | null = null;
  private detach: Disposer | null = null;
  constructor(private readonly deps: RigDeps) {}
  get testPose(): TestPoseService {
    return this.services?.testPose ?? unavailable('testPose');
  }
  get skin(): SkinService {
    return this.services?.skin ?? unavailable('skin');
  }
  get validation(): RigValidation {
    return this.services?.validation ?? unavailable('validation');
  }
  get loaded(): boolean {
    return this.services !== null;
  }
  load(): Promise<void> {
    if (this.loading === null) {
      const loading = import('../../operators/builtin/rig/index').then((chunk) => {
        this.services ??= chunk.createRigServices(this.deps);
        this.detach ??= chunk.registerRigWorkspaceOperators(this.deps.app());
      });
      this.loading = loading;
      // A failed load (offline after a redeploy) is retried by the next call.
      loading.catch(() => {
        if (this.loading === loading) this.loading = null;
      });
    }
    return this.loading;
  }
  dispose(): void {
    this.detach?.();
    this.services?.dispose();
  }
}

export function createRig(deps: RigDeps): RigApi {
  return new Rig(deps);
}
