// Stage lighting (STUDIO-TOUCH-SPEC §4.7, AS-ST-10): each stage re-lights the same canvas through a non-persisted
// display overlay on the single pane (`ViewportManager.setDisplayOverlay`) — merged at render time, never written to
// the pane display memory Pro reads after a switch, removed on a stage change and when the shell unmounts.
import type { HaloStage } from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import { PANE, STAGE_BASICS } from '../shell/stage';

/** Sets a stage's lighting on the pane; the disposer clears it. */
export function stageOverlay(vm: Pick<ViewportManager, 'setDisplayOverlay'>, stage: HaloStage): () => void {
  return vm.setDisplayOverlay(PANE, STAGE_BASICS[stage].overlay);
}
