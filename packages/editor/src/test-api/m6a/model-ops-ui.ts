// M6a test API, B11 group (M6A-SPEC §4.8): the last operation, its card, the help line and the history. `lastOp` reads
// `session.lastRun` (with the run's warnings); `lastOpCard` reads the card drawn in a pane (its fields' display texts
// and values, which field has the focus); `helpLine` the help line's current text (B9 renders it).
import { formatParamValue, historyLabels, lastRunWarnings, visibleParams } from '@ekza-studio/editor-core';
import type { EkzaAnimatorTestApi } from '../types';
import type { M6aTestApiContext } from './support';

export type ModelOpsUiTestApi = Pick<EkzaAnimatorTestApi, 'lastOp' | 'helpLine' | 'lastOpCard' | 'history'>;

interface CardField {
  name: string;
  label: string;
  text: string;
  value: number | boolean | string;
}

function cardElement(paneId: string | undefined): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (paneId !== undefined) return document.querySelector<HTMLElement>(`[data-testid="lastop-card-${paneId}"]`);
  return document.querySelector<HTMLElement>('[data-testid^="lastop-card-"]');
}

export function modelOpsUiTestApi(ctx: M6aTestApiContext): ModelOpsUiTestApi {
  const { app } = ctx.shell;
  return {
    lastOp() {
      ctx.sync();
      const last = app.session.getState().lastRun;
      if (last === null) return null;
      return {
        id: last.id,
        label: last.label,
        args: { ...last.args },
        adjustable: last.adjustable,
        repeatable: last.repeatable,
        closed: last.closed,
        source: last.source,
        kind: last.kind,
        targets: [...last.targets],
        warnings: lastRunWarnings(app).map((warning) => ({ code: warning.code, count: warning.count ?? null })),
      };
    },
    helpLine() {
      ctx.sync();
      if (typeof document === 'undefined') return '';
      return document.querySelector('[data-testid="helpline-text"]')?.textContent ?? '';
    },
    lastOpCard(paneId) {
      ctx.sync();
      const last = app.session.getState().lastRun;
      if (last === null || app.session.getState().workspace !== 'model') return null;
      const element = cardElement(paneId);
      if (element === null) return null;
      const active = typeof document === 'undefined' ? null : document.activeElement;
      const focusedId = active !== null && element.contains(active) ? active.getAttribute('data-testid') : null;
      const fields: CardField[] = visibleParams(last.params).map((def) => {
        const value = last.args[def.name];
        return {
          name: def.name,
          label: def.label,
          text: formatParamValue(def, value),
          value: (value ?? null) as number | boolean | string,
        };
      });
      return {
        title: last.label,
        expanded: element.dataset['state'] === 'expanded',
        fields,
        focused: focusedId?.startsWith('lastop-field-') === true ? focusedId.slice('lastop-field-'.length) : null,
      };
    },
    history() {
      ctx.sync();
      const labels = historyLabels(app.history);
      return { undo: [...labels.undo], redo: [...labels.redo] };
    },
  };
}
