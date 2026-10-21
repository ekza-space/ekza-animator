// The test pose (M6B-SPEC §4.6, §5.17; C0 working baseline in C7's dir, then C7): per character, per control channel
// values, never in the document and never a key; `set` records one 'Test Pose' history step unless `record: false`
// and forgets the copy Go to Bind Pose kept (`clear`) for `restore`.
// It lives in the rig-workspace chunk (`rig/chunk/services.ts`; `app.rig.testPose` exists once the chunk is
// loaded): only Rig & Skin writes a test pose, and the eager route stays small (§0.4.9).
import type { CharacterId, ChannelValues, ControlId } from '@ekza-studio/doc';
import type { EditorHistory, TestPoseService } from '../../types';

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
      // A new pose — a test edit, or an undo/redo of a 'Test Pose' step — makes the copy Go to Bind Pose kept stale:
      // Test then shows only what the history says exists (never a pose an undo removed).
      kept.delete(character);
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
