// Entering Model in the B11 tests as the editor does (M6A-SPEC §5.27): the capture binding starts loading the B11
// runtime chunk (the Last-op card's tracker, the adjust engine, the capture window's state machine) on the first Model
// entry; the tests wait for it, as a user's first keystroke in Model comes after it.
import { type EditorApp, loadOpsRuntime, switchWorkspace } from '../../src';

export async function enterModel(app: EditorApp): Promise<void> {
  switchWorkspace(app, 'model');
  await loadOpsRuntime();
}
