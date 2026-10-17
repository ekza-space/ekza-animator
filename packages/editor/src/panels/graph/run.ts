import { type EditorApp, PANEL } from '@ekza-animator/editor-core';

/**
 * Runs an operator from the Graph Editor panel (scope 'graph'); failures and refusals reach the user as toasts, the
 * way menu and toolbar commands report them.
 */
export function runGraphOperator(app: EditorApp, id: string, args?: unknown): void {
  void app.runUntyped(id, args, { panel: PANEL.graph }).then((result) => {
    const label = app.operators.get(id)?.label ?? id;
    if (result.status === 'failed') {
      app.services.notify.toast({ kind: 'error', text: `${label} failed: ${result.error.message}` });
    } else if (result.status === 'cancelled') {
      app.services.notify.toast({ kind: 'info', text: `${label}: ${result.reason}` });
    }
  });
}
