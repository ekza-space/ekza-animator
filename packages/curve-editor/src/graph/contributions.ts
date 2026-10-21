// WP-6 contributions (MVP-SPEC §4.9 owner 6): the Graph Editor tools, `graph.frame` and `select.curveKeys`; M2a:
// the Scale tool and `graph.view.setMode` (M2A-SPEC §5.15.2–3, A4), acting on the focused Graph Editor.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type EditorApp,
  type GraphViewMode,
  type OperatorArgs,
  type OperatorDef,
  PANEL,
} from '@ekza-studio/editor-core';
import { GRAPH_TOOLS } from '../tools/graphTools';
import type { GraphEditorController } from './GraphEditorController';
import { applyKeySelection, KEY_PART } from './selection';

/** `graph.frame` (F / A in the Graph Editor): frames the focused controller's selection or all visible curves. */
export function graphFrameOperator(
  focused: () => GraphEditorController | null,
): OperatorDef<OperatorArgs<'graph.frame'>, void, void> {
  return {
    id: 'graph.frame',
    label: 'Frame',
    description: 'Frame the selected keys (F) or all visible curves (A) in the Graph Editor',
    category: 'graph',
    scope: PANEL.graph,
    poll: () => (focused() === null ? { ok: false, reason: 'no Graph Editor is open' } : true),
    apply: (_ctx, args) => {
      focused()?.frame(args.what === 'all' ? 'all' : 'selection');
    },
  };
}

/** `select.curveKeys` (double-click a curve): all keys of the curve, with the click's selection mode. */
export const SELECT_CURVE_KEYS_OPERATOR: OperatorDef<OperatorArgs<'select.curveKeys'>, void, void> = {
  id: 'select.curveKeys',
  label: 'Select Curve Keys',
  description: 'Select every key of a curve',
  category: 'select',
  scope: PANEL.graph,
  poll: (ctx, args) =>
    args !== undefined && ctx.app.store.get('curves', args.curve) !== undefined
      ? true
      : { ok: false, reason: 'no such curve' },
  apply: (ctx, args) => {
    const { app } = ctx;
    const keys = app.store.query.keysOfCurve(args.curve);
    const selection = app.session.getState().selection;
    const items = keys.map((key) => ({ key: key.id, parts: KEY_PART }));
    // Toggle acts on the curve as a whole: all keys selected → deselect them, otherwise select them all.
    const next = applyKeySelection(selection.keys, items, args.mode, { group: true });
    app.session.setState({ selection: { ...selection, keys: next } });
  },
};

const VIEW_MODES: readonly string[] = ['absolute', 'normalized', 'stacked', 'toggleNormalized', 'toggleStacked'];

/** The mode `graph.view.setMode` switches to from `current` (N toggles normalized, Shift+N stacked; again: absolute). */
export function nextViewMode(
  current: GraphViewMode,
  mode: GraphViewMode | 'toggleNormalized' | 'toggleStacked',
): GraphViewMode {
  if (mode === 'toggleNormalized') return current === 'normalized' ? 'absolute' : 'normalized';
  if (mode === 'toggleStacked') return current === 'stacked' ? 'absolute' : 'stacked';
  return mode;
}

/** `graph.view.setMode` (N / Shift+N, M2A-SPEC §5.15.2): absolute, normalized or stacked curves in the focused editor. */
export function graphViewModeOperator(
  focused: () => GraphEditorController | null,
): OperatorDef<OperatorArgs<'graph.view.setMode'>, void, void> {
  return {
    id: 'graph.view.setMode',
    label: 'Graph View',
    description: 'Absolute, normalized or stacked curves in the focused Graph Editor',
    category: 'graph',
    scope: PANEL.graph,
    poll: (_ctx, args) => {
      if (args === undefined || args === null || !VIEW_MODES.includes(String(args.mode))) {
        return { ok: false, reason: `mode is one of ${VIEW_MODES.join(', ')}` };
      }
      return focused() === null ? { ok: false, reason: 'no Graph Editor is open' } : true;
    },
    apply: (_ctx, args) => {
      const controller = focused();
      if (controller !== null) controller.setViewMode(nextViewMode(controller.viewMode, args.mode));
    },
  };
}

/**
 * Registers the graph tools (select, move, insert, scale), `graph.frame`, `select.curveKeys` and `graph.view.setMode`;
 * `focused` returns the Graph Editor that `graph.frame` acts on. Call once per app (the Graph panel does, while one
 * is mounted).
 */
export function registerGraphContributions(app: EditorApp, focused: () => GraphEditorController | null): Disposer {
  const disposers: Disposer[] = [];
  try {
    for (const tool of GRAPH_TOOLS) disposers.push(app.contribute({ kind: 'tool', def: tool }));
    disposers.push(
      app.contribute({ kind: 'operator', def: graphFrameOperator(focused) }),
      app.contribute({ kind: 'operator', def: SELECT_CURVE_KEYS_OPERATOR }),
      app.contribute({ kind: 'operator', def: graphViewModeOperator(focused) }),
    );
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
