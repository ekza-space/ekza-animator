// `app.rig` (M6B-SPEC §4.6; C0 baselines, then C7 with C4's skin service): the test-pose service (U state, a working
// in-memory baseline that records its history parts), the skin service and the validation service (stubs), and the
// loader of the lazy rig-workspace chunk (§2.1) that registers its operators once per app.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { ChannelValues, CharacterId, ControlId, MeshId } from '@ekza-studio/doc';
import type { BindReport, SkinBindArgs, SkinWeights } from '@ekza-studio/mesh-core';
import type {
  EditorApp,
  EditorHistory,
  RigValidationService,
  SkinService,
  TestPoseService,
  WorkspaceStatus,
} from '../../types';

export interface RigApi {
  readonly testPose: TestPoseService;
  readonly skin: SkinService;
  readonly validation: RigValidationService;
  load(): Promise<void>;
  readonly loaded: boolean;
  dispose(): void;
}

type Pose = ReadonlyMap<ControlId, ChannelValues>;
const NO_POSE: Pose = new Map();

/** The test pose per character (§5.17): never in the document, never a key; `record` adds one history step. */
export function createTestPoseService(deps: {
  readonly history: () => EditorHistory;
  readonly changed: (character: CharacterId) => void;
}): TestPoseService {
  const poses = new Map<CharacterId, Pose>();
  const kept = new Map<CharacterId, Pose>();
  const listeners = new Set<(version: number) => void>();
  let version = 0;
  const bump = (characters: Iterable<CharacterId>): void => {
    version++;
    for (const character of characters) deps.changed(character);
    for (const listener of Array.from(listeners)) listener(version);
  };
  const service: TestPoseService = {
    get version() {
      return version;
    },
    values: (character) => poses.get(character) ?? NO_POSE,
    set(character, values, opts) {
      const before = poses.get(character) ?? NO_POSE;
      const after = new Map(values);
      if (after.size === 0) poses.delete(character);
      else poses.set(character, after);
      if (opts?.record !== false) {
        deps.history().recordTestPose({ kind: 'testPose', character, before, after }, 'Test Pose');
      }
      bump([character]);
    },
    clear(character) {
      const ids = character === undefined ? [...poses.keys()] : poses.has(character) ? [character] : [];
      if (ids.length === 0) return;
      for (const id of ids) {
        kept.set(id, poses.get(id) ?? NO_POSE);
        poses.delete(id);
      }
      bump(ids);
    },
    restore(character) {
      const pose = kept.get(character);
      if (pose === undefined || pose.size === 0) return false;
      poses.set(character, pose);
      bump([character]);
      return true;
    },
    forget(character) {
      const ids = character === undefined ? [...new Set([...poses.keys(), ...kept.keys()])] : [character];
      for (const id of ids) kept.delete(id);
      const cleared = ids.filter((id) => poses.delete(id));
      if (cleared.length > 0) bump(cleared);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return service;
}

/** C4 replaces it with the skin-worker client (`editor-core/src/rig/skinService.ts`). */
function createSkinServiceStub(): SkinService {
  return {
    bind: (_mesh: MeshId, _args: SkinBindArgs): Promise<{ readonly skin: SkinWeights; readonly report: BindReport }> =>
      Promise.reject(new EkzaError('not-implemented', 'editor-core.SkinService.bind')),
    busy: false,
    clipboard: null,
  };
}

const NO_STATUS: WorkspaceStatus = Object.freeze({ glyph: 'none', reasons: [] });

/** C7 replaces it with the Validation service (`editor-core/src/rig/validation/**`). */
function createValidationStub(): RigValidationService {
  return { rows: () => [], status: () => NO_STATUS };
}

export function createRig(deps: {
  readonly app: () => EditorApp;
  readonly history: () => EditorHistory;
  readonly changed: (character: CharacterId) => void;
}): RigApi {
  let loading: Promise<void> | null = null;
  let loaded = false;
  let detach: Disposer | null = null;
  return {
    testPose: createTestPoseService(deps),
    skin: createSkinServiceStub(),
    validation: createValidationStub(),
    load(): Promise<void> {
      loading ??= import('../../operators/builtin/rig/index').then((chunk) => {
        detach = chunk.registerRigWorkspaceOperators(deps.app());
        loaded = true;
      });
      return loading;
    },
    get loaded() {
      return loaded;
    },
    dispose(): void {
      detach?.();
    },
  };
}
