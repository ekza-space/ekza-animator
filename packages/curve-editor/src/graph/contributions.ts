// WP-6 contributions (MVP-SPEC §4.9 owner 6): the Graph Editor tools, `graph.frame` and `select.curveKeys`.
import type { Disposer } from '@ekza-animator/anim-core';
import { type EditorApp, type OperatorArgs, type OperatorDef, PANEL } from '@ekza-animator/editor-core';
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

/**
 * Registers the graph tools (select, move, insert), `graph.frame` and `select.curveKeys`; `focused` returns the
 * Graph Editor that `graph.frame` acts on. Call once per app (the Graph panel does, while one is mounted).
 */
export function registerGraphContributions(app: EditorApp, focused: () => GraphEditorController | null): Disposer {
  const disposers: Disposer[] = [];
  try {
    for (const tool of GRAPH_TOOLS) disposers.push(app.contribute({ kind: 'tool', def: tool }));
    disposers.push(
      app.contribute({ kind: 'operator', def: graphFrameOperator(focused) }),
      app.contribute({ kind: 'operator', def: SELECT_CURVE_KEYS_OPERATOR }),
    );
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
