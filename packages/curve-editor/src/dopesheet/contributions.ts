// Contributions of the Dope Sheet (M2A-SPEC §4.9, §6, §8 A3): `dopeSheet.frame` on the focused controller, the
// Select / Move / Scale tools (`view.tool {panel: 'dopeSheet'}`, Q / W / R) and the Dope Sheet's ripple control set
// (§5.11: the controls it shows). This module imports the controller's type only, so registering the contributions
// does not load the controller (the panel's body is lazy, §5.21.2 boundary 4).
import type { Disposer } from '@ekza-animator/anim-core';
import {
  DOPE_TOOL,
  type EditorApp,
  type OperatorArgs,
  type OperatorDef,
  PANEL,
  registerRippleControls,
  type ToolDef,
} from '@ekza-animator/editor-core';
import type { DopeSheetController } from './DopeSheetController';

const FRAME_TARGETS = ['selection', 'all'] as const;

/** `dopeSheet.frame {what}` (F / A over the Dope Sheet): frames the selected keys (else all rows) with 8 % padding. */
export function dopeSheetFrameOperator(
  focused: () => DopeSheetController | null,
): OperatorDef<OperatorArgs<'dopeSheet.frame'>, void, void> {
  return {
    id: 'dopeSheet.frame',
    label: 'Frame',
    description: 'Frame the selected keys (F) or all rows (A) in the Dope Sheet',
    category: 'graph',
    scope: PANEL.dopeSheet,
    poll(_ctx, args) {
      const what = (args as { readonly what?: unknown } | undefined)?.what;
      if (!FRAME_TARGETS.includes(what as (typeof FRAME_TARGETS)[number])) {
        return { ok: false, reason: "expects { what: 'selection' | 'all' }" };
      }
      return focused() === null ? { ok: false, reason: 'The Dope Sheet is not open' } : true;
    },
    apply(_ctx, args) {
      focused()?.frame(args.what);
    },
  };
}

const TOOLS: readonly { readonly id: string; readonly label: string }[] = [
  { id: DOPE_TOOL.select, label: 'Select' },
  { id: DOPE_TOOL.move, label: 'Move' },
  { id: DOPE_TOOL.scale, label: 'Scale' },
];

/**
 * The Dope Sheet tools: the controller reads `session.tools.dopeSheet` itself (Select: click/marquee, drags on
 * selected glyphs move; Move: drags anywhere move; Scale: drags scale around the press frame), so the tool
 * instances carry no behaviour of their own.
 */
export const DOPE_SHEET_TOOLS: readonly ToolDef[] = TOOLS.map(
  ({ id, label }): ToolDef => ({ id, panel: PANEL.dopeSheet, label, create: () => ({}) }),
);

/** Registers the Dope Sheet tools, `dopeSheet.frame` and the ripple control set (acting on the focused controller). */
export function registerDopeSheetContributions(app: EditorApp, focused: () => DopeSheetController | null): Disposer {
  const disposers: Disposer[] = [];
  try {
    disposers.push(app.contribute({ kind: 'operator', def: dopeSheetFrameOperator(focused) }));
    for (const def of DOPE_SHEET_TOOLS) disposers.push(app.contribute({ kind: 'tool', def }));
    disposers.push(registerRippleControls(app, PANEL.dopeSheet, () => focused()?.shownControls() ?? null));
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
