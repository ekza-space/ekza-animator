// M6a test API, B11 group (M6A-SPEC §4.8): the last operation, its card, the help line and the history. B0a:
// `history` is kernel-level and works; the others throw until B11 (and B9 for the help line) land them.
import { historyLabels } from '@ekza-animator/editor-core';
import type { EkzaAnimatorTestApi } from '../types';
import { type M6aTestApiContext, notImplemented } from './support';

export type ModelOpsUiTestApi = Pick<EkzaAnimatorTestApi, 'lastOp' | 'helpLine' | 'lastOpCard' | 'history'>;

export function modelOpsUiTestApi(ctx: M6aTestApiContext): ModelOpsUiTestApi {
  const { app } = ctx.shell;
  return {
    lastOp: () => notImplemented('B11', 'lastOp'),
    helpLine: () => notImplemented('B11', 'helpLine'),
    lastOpCard: () => notImplemented('B11', 'lastOpCard'),
    history() {
      ctx.sync();
      const labels = historyLabels(app.history);
      return { undo: [...labels.undo], redo: [...labels.redo] };
    },
  };
}
