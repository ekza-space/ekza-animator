// Edit operators (MVP-SPEC §4.9 `edit.*`): undo/redo through the editor history, the menu dispatchers for copy,
// paste and delete (by the panel the command is for), and Esc.
import { cancelChannelEditGestures } from '../../edit/channels';
import type { EditorApp } from '../../types';
import { GLOBAL_SCOPE, type HistoryResult, type OperatorContext, PANEL } from '../../types';
import { type AnyOperator, defineOperator, fail, forward, OK, panelOf, runContextOf } from './define';

function reportHistory(app: EditorApp, result: HistoryResult | null): HistoryResult | null {
  if (result === null) return null;
  const messages = [...result.warnings];
  const skipped = result.doc?.skipped.length ?? 0;
  if (skipped > 0) messages.push(`${skipped} change${skipped === 1 ? ' was' : 's were'} skipped (changed since)`);
  if (messages.length > 0) {
    app.services.notify.toast({ kind: 'warning', text: `${result.label}: ${messages.join('; ')}` });
  }
  return result;
}

const undo = defineOperator({
  id: 'edit.undo',
  label: 'Undo',
  description: 'Undo the last edit, keyed or not.',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => (app.history.canUndo() ? OK : fail('Nothing to undo')),
  apply: ({ app }) => reportHistory(app, app.history.undo()),
});

const redo = defineOperator({
  id: 'edit.redo',
  label: 'Redo',
  description: 'Redo the last undone edit.',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => (app.history.canRedo() ? OK : fail('Nothing to redo')),
  apply: ({ app }) => reportHistory(app, app.history.redo()),
});

/** Panels whose copy/paste/delete act on keys rather than on the pose. */
const KEY_PANELS: ReadonlySet<string> = new Set([PANEL.graph, PANEL.timeline]);

/** A menu command forwarded to the pose or key operator of the panel it is for (§4.9). */
function dispatcher(
  id: 'edit.copy' | 'edit.paste' | 'edit.delete',
  label: string,
  targets: { readonly pose: string; readonly keys: string },
): AnyOperator {
  const target = (ctx: OperatorContext): string => {
    const panel = panelOf(ctx);
    return panel !== null && KEY_PANELS.has(panel) ? targets.keys : targets.pose;
  };
  return defineOperator({
    id,
    label,
    description: `${label} poses (viewport, outliner, Channel Box) or keys (Graph Editor, time slider).`,
    category: 'edit',
    scope: GLOBAL_SCOPE,
    poll: (ctx) => ctx.app.operators.poll(target(ctx), runContextOf(ctx)),
    async prepare(ctx) {
      await forward(ctx, target(ctx), undefined);
    },
    apply() {},
  });
}

const escape = defineOperator({
  id: 'edit.escape',
  label: 'Cancel',
  description: 'Cancel the edit in progress; else close the dialog; else stop playback.',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  apply({ app }) {
    if (cancelChannelEditGestures(app)) return;
    const preview = app.store.preview;
    if (preview !== null && preview.active) {
      preview.cancel();
      return;
    }
    const state = app.session.getState();
    if (state.dialog !== null) {
      app.session.setState({ dialog: null });
      return;
    }
    if (state.time.playing) app.session.setState({ time: { ...state.time, playing: false } });
  },
});

export const EDIT_OPERATORS: readonly AnyOperator[] = [
  undo,
  redo,
  dispatcher('edit.copy', 'Copy', { pose: 'pose.copy', keys: 'graph.keys.copy' }),
  dispatcher('edit.paste', 'Paste', { pose: 'pose.paste', keys: 'graph.keys.paste' }),
  dispatcher('edit.delete', 'Delete', { pose: 'key.deleteAtFrame', keys: 'graph.keys.delete' }),
  escape,
];
