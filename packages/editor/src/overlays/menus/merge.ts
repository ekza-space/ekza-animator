// The merge marking menu (M6A-SPEC §8.4 `model.merge`, §7 `KeyM` in component modes; B11): N Merge to Center ·
// E Target Weld (the tool) · S Merge · W Collapse; Merge by Distance in the list. `M` with Alt stays Mirror Pose.
import type { MarkingMenuDef } from '@ekza-studio/editor-core';

export const MERGE_MENU: MarkingMenuDef = {
  id: 'model.merge',
  trigger: { key: 'KeyM' },
  workspaces: ['model'],
  when: { modes: ['vertex', 'edge', 'face'], over: 'any' },
  slots: {
    N: { op: 'mesh.mergeToCenter', label: 'Merge to Center' },
    E: { op: 'view.tool', label: 'Target Weld', args: { panel: 'viewport', tool: 'targetWeld' } },
    S: { op: 'mesh.merge', label: 'Merge' },
    W: { op: 'mesh.collapse', label: 'Collapse' },
  },
  list: [{ op: 'mesh.mergeByDistance', label: 'Merge by Distance' }],
};
