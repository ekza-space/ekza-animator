// The test-pose channel-edit gesture (M6B-SPEC §5.17; C7): in Rig & Skin a manipulator drag (`W`/`E` on controls in
// Object mode) or a Channel Box edit writes the character's test pose instead of overrides and keys — never a key,
// never the document. Updates write the pose without history (`record: false`); `commit` records ONE 'Test Pose'
// step per character the drag touched (before = the pose at the drag start); `cancel` puts the start pose back.
// Locked channels never move (as in Animate); keyability does not matter (a test pose is not a key).
import type { ChannelValues, CharacterId, ControlId } from '@ekza-studio/doc';
import { isLocked } from '../../edit/channelMeta';
import { ownerOfControl } from '../../session/location';
import type { ChannelEdit, ChannelEditGesture, EditorApp, TestPoseService } from '../../types';

type Pose = ReadonlyMap<ControlId, ChannelValues>;

/** `pose` with `edits` of one character applied (locked channels skipped). */
export function applyTestEdits(app: Pick<EditorApp, 'store'>, pose: Pose, edits: readonly ChannelEdit[]): Pose {
  const next = new Map(pose);
  for (const edit of edits) {
    const record = app.store.get('controls', edit.control);
    if (record === undefined || isLocked(record, edit.channel)) continue;
    next.set(edit.control, { ...next.get(edit.control), [edit.channel]: edit.value });
  }
  return next;
}

export function beginTestPoseGesture(app: EditorApp, testPose: TestPoseService, label: string): ChannelEditGesture {
  /** The pose of every character the gesture touched, as it was when the gesture started. */
  const start = new Map<CharacterId, Pose>();
  let active = true;
  let pending: readonly ChannelEdit[] | null = null;
  const taskKey = `testPoseGesture:${label}`;

  const write = (edits: readonly ChannelEdit[]): void => {
    const byCharacter = new Map<CharacterId, ChannelEdit[]>();
    for (const edit of edits) {
      const character = ownerOfControl(app.store, edit.control);
      if (character === null) continue;
      const list = byCharacter.get(character);
      if (list === undefined) byCharacter.set(character, [edit]);
      else list.push(edit);
    }
    for (const [character, list] of byCharacter) {
      if (!start.has(character)) start.set(character, testPose.values(character));
      testPose.set(character, applyTestEdits(app, start.get(character) as Pose, list), { record: false });
    }
  };
  const flush = (): void => {
    const edits = pending;
    pending = null;
    if (active && edits !== null) write(edits);
  };

  return {
    get active() {
      return active;
    },
    update(edits) {
      if (!active) return;
      pending = edits;
      app.scheduleBeforeFrame(taskKey, flush);
    },
    commit() {
      if (!active) return;
      flush();
      active = false;
      for (const [character, before] of start) {
        const after = testPose.values(character);
        if (after === before) continue;
        app.history.recordTestPose({ kind: 'testPose', character, before, after }, 'Test Pose');
      }
    },
    cancel() {
      if (!active) return;
      active = false;
      pending = null;
      for (const [character, before] of start) testPose.set(character, before, { record: false });
    },
  };
}
