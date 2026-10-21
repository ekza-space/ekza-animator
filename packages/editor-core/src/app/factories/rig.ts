// `app.rig` (M6B-SPEC §4.6; C0 baselines, then C7 with C4's skin service): the test-pose service (U state, a working
// in-memory baseline that records its history parts), the skin service and the validation service (stubs), and the
// loader of the lazy rig-workspace chunk (§2.1) that registers its operators once per app.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { ChannelValues, CharacterId, ControlId } from '@ekza-studio/doc';
import type { EditorApp, EditorHistory, RigValidationService, SkinService, TestPoseService } from '../../types';

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
  /** Writes (or, with an empty pose, removes) the poses of `ids`, then notifies. */
  const write = (ids: readonly CharacterId[], pose: (id: CharacterId) => Pose): void => {
    for (const id of ids) {
      const next = pose(id);
      if (next.size === 0) poses.delete(id);
      else poses.set(id, next);
      deps.changed(id);
    }
    version++;
    for (const listener of Array.from(listeners)) listener(version);
  };
  const values = (character: CharacterId): Pose => poses.get(character) ?? NO_POSE;
  return {
    get version() {
      return version;
    },
    values,
    set(character, next, opts) {
      if (opts?.record !== false) {
        deps
          .history()
          .recordTestPose({ kind: 'testPose', character, before: values(character), after: next }, 'Test Pose');
      }
      write([character], () => new Map(next));
    },
    clear(character) {
      const ids = character === undefined ? [...poses.keys()] : [character];
      for (const id of ids) kept.set(id, values(id));
      write(ids, () => NO_POSE);
    },
    restore(character) {
      const pose = kept.get(character) ?? NO_POSE;
      if (pose.size > 0) write([character], () => pose);
      return pose.size > 0;
    },
    forget(character) {
      if (character === undefined) kept.clear();
      else kept.delete(character);
      write(character === undefined ? [...poses.keys()] : [character], () => NO_POSE);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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
    // C4 replaces the skin service with the skin-worker client (`editor-core/src/rig/skinService.ts`).
    skin: {
      bind: () => Promise.reject(new EkzaError('not-implemented', 'editor-core.SkinService.bind')),
      busy: false,
      clipboard: null,
    },
    // C7 replaces the validation service (`editor-core/src/rig/validation/**`).
    validation: { rows: () => [], status: () => ({ glyph: 'none', reasons: [] }) },
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
